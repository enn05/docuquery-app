import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client. The constructor reads ANTHROPIC_API_KEY from the
 * environment (.env.local) — the key never leaves the server.
 */
export const anthropic = new Anthropic();

/**
 * Price per million tokens, per model. USD.
 *
 * This table is the reason `MODEL` is typed against its keys: pricing and model
 * are one decision, not two. Previously the rates were loose constants in
 * lib/limits.ts with a comment asking the next person to "keep it in step with
 * MODEL" — while the comment right below actively recommended switching to a
 * model priced 5x lower. Taking that advice would have made every cost log wrong
 * by 5x, silently. A comment is a hope; this is a mechanism: change MODEL to a
 * model that isn't priced here and it does not compile.
 */
export const PRICING = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
} as const;

export type ModelId = keyof typeof PRICING;

/**
 * Model used for generation.
 *
 * Opus is the most capable and the most expensive. To iterate cheaply, switch to
 * "claude-haiku-4-5" — the cost log will follow automatically, because the price
 * comes from PRICING above rather than from a constant someone has to remember.
 */
export const MODEL: ModelId = "claude-opus-4-8";

/** Rates for the model actually in use. */
export const MODEL_PRICING = PRICING[MODEL];

/**
 * Voyage embeddings pricing (voyage-4-lite), USD per million tokens.
 *
 * Embeddings are cheap but not free, and the cost log claimed to be a complete
 * audit trail while omitting them entirely. Cheap and unlogged is how a bill
 * surprises you.
 */
export const EMBEDDING_USD_PER_MTOK = 0.02;
