/**
 * Shared limits — the single source of truth for both the client and the server.
 *
 * This module deliberately has **no imports**. It is pulled into the browser
 * bundle by the UI, so it must never reach for the Anthropic SDK (or anything
 * else server-only). Keeping the numbers here means client-side validation and
 * server-side enforcement can never drift apart.
 */

/**
 * Hard cap on characters sent to the model. ~50k chars is roughly 12–15k tokens
 * — comfortably inside the context window. Documents longer than this are
 * truncated in v1; retrieving only the relevant chunks (RAG) is the real fix.
 */
export const MAX_INPUT_CHARS = 50_000;

/**
 * Hard cap on uploaded file size. Checked before the bytes are read, so a huge
 * file can't exhaust server memory.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Used for the file input's `accept` attribute, and to describe what we take. */
export const ACCEPTED_EXTENSIONS = ".txt,.pdf";

/**
 * Text shorter than this almost certainly means extraction failed rather than
 * the document being genuinely tiny — the usual cause is a scanned PDF with no
 * text layer (an image of a page, not characters).
 */
export const MIN_EXTRACTED_CHARS = 20;

/**
 * Output caps, per request. These bound cost and latency — the model cannot
 * bill us for more output than this, regardless of what it wants to write.
 *
 * Extraction needs far more room than a summary: it emits one JSON entry per
 * party, date, and amount, so a document with many line items produces a long
 * response. At 2048 a 60-line invoice was cut off mid-string, and the resulting
 * fragment was unparseable JSON.
 *
 * Raising this moves the wall, it does not remove it — a document with enough
 * line items will still overflow. Note that this is an *output* limit; retrieval
 * (which shrinks the input) does not help. The real fix for unbounded documents
 * is to extract in batches. See the truncation handling in /api/analyze.
 */
export const MAX_SUMMARY_TOKENS = 1024;
export const MAX_EXTRACTION_TOKENS = 8192;
