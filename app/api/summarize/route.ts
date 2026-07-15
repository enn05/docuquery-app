import { anthropic, MODEL } from "@/lib/anthropic";
import { errorResponse, logUsage, rateLimit, readTextBody } from "@/lib/api";
import { MAX_SUMMARY_TOKENS, REQUEST_TIMEOUT_MS } from "@/lib/limits";
import { fenceDocument, untrustedContentRule } from "@/lib/prompt";

function systemPrompt(nonce: string): string {
  return `You summarize documents for accountants. Be concise and factual.
Report only what the document states — no speculation, no invented figures.
If the text is too short or unclear to summarize, say so plainly.

${untrustedContentRule(nonce)}`;
}

export async function POST(request: Request) {
  // Rate limit first — before parsing, before any upstream call, so a limited
  // caller costs nothing but a Map lookup.
  const limited = rateLimit(request);
  if (limited) return limited;

  const body = await readTextBody(request);
  if (!body.ok) return body.response;

  // No `temperature` — it is removed on current models (Opus 4.8 / Sonnet 5) and
  // returns a 400. Factual tone is steered through the system prompt instead.
  const fenced = fenceDocument(body.text);

  // Stream the summary token-by-token. The summary is the app's longest single
  // output, so this is where the wait actually disappears for the user. Same
  // params and { timeout } as the non-streaming call; the helper sets stream:true.
  const mstream = anthropic.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      system: systemPrompt(fenced.nonce),
      messages: [
        {
          role: "user",
          content: `Summarize the document below.\n\n${fenced.block}`,
        },
      ],
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  const iterator = mstream[Symbol.asyncIterator]();

  // Pre-flight the first event. Returning a streaming Response commits the status
  // to 200 — after that, a 401/429/400 discovered mid-stream can no longer become
  // a real status code. Connection-time failures surface on this first next(), so
  // we map them through the same errorResponse() the non-streaming route used.
  let first: Awaited<ReturnType<typeof iterator.next>>;
  try {
    first = await iterator.next();
  } catch (err) {
    return errorResponse(err, "/api/summarize");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Track cumulative usage as it arrives, so a mid-stream failure can still
      // bill what was already produced. message_start carries the input tokens
      // (charged the moment the prompt is processed); each message_delta carries
      // the running output-token total.
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        for (let result = first; !result.done; result = await iterator.next()) {
          const event = result.value;
          if (event.type === "message_start") {
            inputTokens = event.message.usage.input_tokens;
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens;
          } else if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        // Log cost from the accumulated final message — the same usage shape the
        // non-streaming path logged, so the audit trail is unchanged.
        const final = await mstream.finalMessage();
        logUsage("/api/summarize", final.usage);
        controller.close();
      } catch (err) {
        // A failure after the first event (mid-stream network drop, upstream
        // overload, client disconnect). The status is already 200, so all we can
        // do to the response is tear it down. But Anthropic still bills the
        // tokens generated before the break, so we log them — logging nothing
        // here is the exact audit gap lib/api.ts was hardened against: a
        // mid-stream abort is a spend spike, not a free failure.
        console.error("/api/summarize: stream failed —", err);
        logUsage("/api/summarize", {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });
        console.warn(
          "/api/summarize: stream ended early — the cost line above is a partial (incomplete) bill.",
        );
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      // Defeat proxy buffering so tokens reach the client as they are produced,
      // not held back until the response completes.
      "X-Accel-Buffering": "no",
    },
  });
}
