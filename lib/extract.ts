import { MAX_INPUT_CHARS } from "./limits";

export type ExtractResult = {
  text: string;
  /** Characters extracted before any truncation. */
  originalChars: number;
  /** True when the text was cut down to fit MAX_INPUT_CHARS. */
  truncated: boolean;
};

/**
 * Enforce the model's input budget.
 *
 * v1 behaviour: truncate and tell the user. This is a deliberate trade-off, not
 * an oversight — the correct answer for long documents is to retrieve only the
 * relevant chunks (RAG, Phase 4) instead of sending the whole thing.
 */
export function truncateToLimit(text: string): ExtractResult {
  const originalChars = text.length;
  if (originalChars <= MAX_INPUT_CHARS) {
    return { text, originalChars, truncated: false };
  }
  return {
    text: text.slice(0, MAX_INPUT_CHARS),
    originalChars,
    truncated: true,
  };
}
