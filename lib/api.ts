import Anthropic from "@anthropic-ai/sdk";
import { MAX_INPUT_CHARS } from "./limits";

/**
 * Shared route plumbing. Server-only (imports the Anthropic SDK) — never import
 * this from a client component.
 *
 * Both /api/summarize and /api/analyze validate the same body and map the same
 * upstream failures. Keeping that in one place is not just tidiness: when it was
 * duplicated, the two routes' 413 messages had already silently diverged.
 */

export type TextBody =
  | { ok: true; text: string }
  | { ok: false; response: Response };

/** Parse and validate a `{ text: string }` body at the boundary. */
export async function readTextBody(request: Request): Promise<TextBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return {
      ok: false,
      response: Response.json(
        { error: "Provide a non-empty 'text' string." },
        { status: 400 },
      ),
    };
  }

  if (text.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      response: Response.json(
        {
          error: `Text is too long (${text.length} chars). The limit is ${MAX_INPUT_CHARS}. For large documents, retrieval (RAG) is the right approach.`,
        },
        { status: 413 },
      ),
    };
  }

  return { ok: true, text };
}

/**
 * Map an upstream/unknown failure to a real status code. Most specific first.
 * The client gets a human message; the details stay in the server log.
 */
export function errorResponse(err: unknown, route: string): Response {
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
  console.error(`Unexpected error in ${route}:`, err);
  return Response.json({ error: "Unexpected server error." }, { status: 500 });
}
