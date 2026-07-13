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
