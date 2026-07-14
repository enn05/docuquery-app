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
export const MAX_ANSWER_TOKENS = 1024;

/**
 * How many chunks to retrieve per question.
 *
 * A trade-off, not a default. Too few and the answer misses context sitting in a
 * neighbouring chunk. Too many and the prompt fills with irrelevant text, which
 * costs tokens and gives the model more room to drift off the source.
 */
export const TOP_K = 4;

/**
 * Cap on a single question.
 *
 * Without this, an unauthenticated caller can post a multi-megabyte "question"
 * that gets embedded by Voyage *and* prepended to the Anthropic prompt — two
 * paid APIs, uncapped. Questions are sentences; 1000 characters is generous.
 */
export const MAX_QUESTION_CHARS = 1_000;

/**
 * Most documents we will hold in the in-memory store at once. Bounded so a
 * long-running server cannot grow it without limit.
 */
export const MAX_DOCUMENTS = 20;

/**
 * Per-request timeout for upstream API calls, in milliseconds.
 *
 * Lives here rather than in `anthropic.ts` so `embeddings.ts` can use it without
 * importing the Anthropic module — which constructs an SDK client at module
 * scope, and has no business being pulled into the embeddings path.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Rate limit: requests per IP per window.
 *
 * Sized for a human using the app, not a script. Every route costs real money on
 * an upstream API, so this is a spend control first and a load control second.
 */
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * How many distinct clients the limiter tracks before it evicts.
 *
 * Bounds memory so a flood of distinct IPs cannot grow the map without limit.
 * Lives here with the other rate-limit knobs, not next to the code that uses it.
 */
export const MAX_TRACKED_IPS = 10_000;

// Model pricing is NOT here. It belongs with MODEL in lib/anthropic.ts: pricing
// and model choice are one decision, and this module is imported by the browser.
