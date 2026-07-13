import Anthropic from "@anthropic-ai/sdk";
import {
  anthropic,
  MODEL,
  MAX_INPUT_CHARS,
  REQUEST_TIMEOUT_MS,
} from "@/lib/anthropic";

const SYSTEM_PROMPT =
  "You summarize documents for accountants. Be concise and factual. " +
  "Report only what the document states — no speculation, no invented figures. " +
  "If the text is too short or unclear to summarize, say so plainly.";

export async function POST(request: Request) {
  // 1. Parse body — malformed JSON must not crash the route.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // 2. Validate input at the boundary — treat it like any untrusted input.
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return Response.json(
      { error: "Provide a non-empty 'text' string." },
      { status: 400 },
    );
  }
  if (text.length > MAX_INPUT_CHARS) {
    return Response.json(
      {
        error: `Text is too long (${text.length} chars). The limit is ${MAX_INPUT_CHARS}. For large documents, retrieval (RAG) is the right approach.`,
      },
      { status: 413 },
    );
  }

  // 3. Call Claude. Note: no `temperature` — it is removed on current models
  //    (Opus 4.8 / Sonnet 5) and factual tone is steered via the system prompt.
  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const summary = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    // Return usage so we can show/track token cost per request (Phase 5 groundwork).
    return Response.json({ summary, usage: message.usage });
  } catch (err) {
    // 4. Typed error handling — most specific first.
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "Server is missing a valid API key." },
        { status: 500 },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "The AI service is rate limited. Try again in a moment." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.APIConnectionError) {
      // Includes timeouts (APIConnectionTimeoutError) and network failures.
      return Response.json(
        { error: "Could not reach the AI service (timeout or network error)." },
        { status: 504 },
      );
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json(
        { error: "The AI service returned an error." },
        { status: 502 },
      );
    }
    console.error("Unexpected error in /api/summarize:", err);
    return Response.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
