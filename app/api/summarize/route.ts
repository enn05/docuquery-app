import { anthropic, MODEL, REQUEST_TIMEOUT_MS } from "@/lib/anthropic";
import { errorResponse, readTextBody } from "@/lib/api";
import { MAX_SUMMARY_TOKENS } from "@/lib/limits";

const SYSTEM_PROMPT =
  "You summarize documents for accountants. Be concise and factual. " +
  "Report only what the document states — no speculation, no invented figures. " +
  "If the text is too short or unclear to summarize, say so plainly.";

export async function POST(request: Request) {
  const body = await readTextBody(request);
  if (!body.ok) return body.response;

  // No `temperature` — it is removed on current models (Opus 4.8 / Sonnet 5) and
  // returns a 400. Factual tone is steered through the system prompt instead.
  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_SUMMARY_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: body.text }],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const summary = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    // Return usage so cost per request is visible (Phase 5 groundwork).
    return Response.json({ summary, usage: message.usage });
  } catch (err) {
    return errorResponse(err, "/api/summarize");
  }
}
