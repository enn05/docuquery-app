import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client. The constructor reads ANTHROPIC_API_KEY from the
 * environment (.env.local) — the key never leaves the server.
 */
export const anthropic = new Anthropic();

/**
 * Model used for generation.
 *
 * Cost note (per 1M tokens): claude-opus-4-8 is $5 in / $25 out — most capable
 * but pricey. For cheap iteration on a small budget, swap to:
 *   - "claude-haiku-4-5"  ($1 / $5)  — fastest/cheapest, good for testing
 *   - "claude-sonnet-5"   ($3 / $15) — balanced
 */
export const MODEL = "claude-opus-4-8";

/**
 * Hard cap on characters accepted from the client. ~50k chars is roughly
 * 12–15k tokens — comfortably inside the context window, and enough to reject
 * pathologically large inputs before they ever reach the API. RAG (Phase 4)
 * is the real answer for documents larger than this.
 */
export const MAX_INPUT_CHARS = 50_000;

/**
 * Per-request timeout for API calls, in milliseconds (the TypeScript SDK takes
 * ms). Guards against a hung request holding the route open indefinitely.
 */
export const REQUEST_TIMEOUT_MS = 60_000;
