/**
 * Shared route plumbing. Server-only (imports the Anthropic SDK) — never import
 * this from a client component.
 *
 * Every route validates the same body shape and maps the same upstream failures.
 * Keeping that in one place is not just tidiness: when it was duplicated, two
 * routes' 413 messages had already silently diverged.
 */

import Anthropic from "@anthropic-ai/sdk";
import { EMBEDDING_USD_PER_MTOK, MODEL_PRICING } from "./anthropic";
import { DimensionMismatchError } from "./chunk";
import { EmbeddingError } from "./embeddings";
import { MAX_INPUT_CHARS } from "./limits";
import {
  checkRateLimit,
  clientKey,
  rateLimitResponse,
  type RateLimitResult,
} from "./ratelimit";

/**
 * Gate a request on the per-IP rate limit. Returns a 429 to return immediately,
 * or null to proceed. Called first in every route, before parsing and before any
 * upstream call, so a limited caller costs nothing but a Map lookup.
 *
 * Fails OPEN when the caller cannot be identified (no x-forwarded-for, i.e. local
 * dev). The alternative — bucketing every anonymous caller together — meant two
 * people on one host would 429 each other, since a single document workflow is
 * about five requests against a budget of twenty. On a real deployment the
 * platform sets the header, so this path does not apply there.
 */
export function rateLimit(request: Request): Response | null {
  const key = clientKey(request);
  if (key === null) return null;
  const result: RateLimitResult = checkRateLimit(key);
  return result.allowed ? null : rateLimitResponse(result);
}

/**
 * Log what a request cost, in tokens and in dollars.
 *
 * "What does a query cost?" should be answerable with a number, not a shrug.
 *
 * Two things this had to learn the hard way. It previously claimed "every model
 * call goes through here" while embeddings — a whole paid provider — bypassed it
 * entirely; and it was only called on success, so the *most expensive* outcomes
 * (a truncated 8k-token extraction, or two failed attempts) were logged as
 * nothing at all. An audit trail that under-reports exactly when spend spikes is
 * worse than none, because it invites you to trust it.
 *
 * Rates come from lib/anthropic.ts, keyed by MODEL, so swapping models cannot
 * silently multiply the numbers.
 */
export function logUsage(
  route: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    /** Voyage tokens, when the route also embedded something. */
    embedding_tokens?: number;
  },
): void {
  const embeddingTokens = usage.embedding_tokens ?? 0;
  const usd =
    (usage.input_tokens / 1_000_000) * MODEL_PRICING.input +
    (usage.output_tokens / 1_000_000) * MODEL_PRICING.output +
    (embeddingTokens / 1_000_000) * EMBEDDING_USD_PER_MTOK;

  const embedPart = embeddingTokens > 0 ? ` embed=${embeddingTokens}` : "";
  console.info(
    `[cost] ${route} in=${usage.input_tokens} out=${usage.output_tokens}${embedPart} ≈ $${usd.toFixed(5)}`,
  );
}

export type TextBody =
  /** `raw` carries the rest of the parsed body, for routes that take extra fields. */
  | { ok: true; text: string; raw: Record<string, unknown> }
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

  return {
    ok: true,
    text,
    raw: (body ?? {}) as Record<string, unknown>,
  };
}

/**
 * Map an upstream/unknown failure to a real status code. Most specific first.
 * The client gets a human message; the details stay in the server log.
 */
export function errorResponse(err: unknown, route: string): Response {
  // A stored document embedded with a different model can no longer be compared
  // against a fresh query vector. That is not a server fault — it is the same
  // situation as a store miss, and it has the same remedy: index it again. Map
  // it to 409 so the client resets and offers the button that actually fixes it,
  // instead of a 500 that leaves the user retrying forever.
  if (err instanceof DimensionMismatchError) {
    return Response.json(
      {
        error:
          "This document was indexed with a different embedding model. Index it again to ask questions.",
      },
      { status: 409 },
    );
  }

  // Embeddings failures carry the upstream status. Mapping them matters: a rate
  // limit reported as "the server is broken" invites an immediate retry, which
  // makes it worse.
  if (err instanceof EmbeddingError) {
    if (err.status === 401 || err.status === 403) {
      console.error(`${route}: embeddings auth failed —`, err.message);
      return Response.json(
        { error: "Server is missing a valid embeddings API key." },
        { status: 500 },
      );
    }
    if (err.status === 429) {
      return Response.json(
        { error: "The embeddings service is rate limited. Try again in a moment." },
        { status: 429 },
      );
    }
    if (err.status === undefined) {
      // Timeout or network failure — no response was received.
      return Response.json(
        { error: "Could not reach the embeddings service (timeout or network error)." },
        { status: 504 },
      );
    }
    console.error(`${route}: embeddings failed —`, err.message);
    return Response.json(
      { error: "The embeddings service returned an error." },
      { status: 502 },
    );
  }

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
