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
 * Per-request timeout for API calls, in milliseconds (the TypeScript SDK takes
 * ms). Guards against a hung request holding the route open indefinitely.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

// Input limits live in ./limits — that module is client-safe (no SDK import),
// so the browser and the server validate against the same numbers.
