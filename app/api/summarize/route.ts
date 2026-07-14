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

  try {
    const message = await anthropic.messages.create(
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

    const summary = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    logUsage("/api/summarize", message.usage);
    return Response.json({ summary, usage: message.usage });
  } catch (err) {
    return errorResponse(err, "/api/summarize");
  }
}
