import { REQUEST_TIMEOUT_MS } from "./anthropic";

/**
 * Embeddings come from Voyage AI; generation comes from Anthropic.
 *
 * This is not indecision — Anthropic has no embeddings endpoint, and Voyage is
 * the provider they recommend for it. The split is clean: Voyage only ever sees
 * document text and questions, never a generated answer.
 *
 * Called via fetch rather than an SDK: it is a single REST endpoint, and one
 * function is cheaper to reason about than a dependency. The cost of that choice
 * is that the timeout, error typing, and response validation an SDK would give
 * us for free have to be written here — which is what the rest of this file is.
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/**
 * voyage-4-lite: 1024 dimensions, covered by Voyage's free token allowance.
 * Larger models cost more for a retrieval gain a single-document demo will never
 * notice.
 */
export const EMBEDDING_MODEL = "voyage-4-lite";

/**
 * Voyage embeds documents and queries *asymmetrically*.
 *
 * A stored passage and the question that should retrieve it are different kinds
 * of text — a question is short and interrogative, a passage long and
 * declarative. Telling the model which one it is embedding places them closer
 * together in vector space, measurably improving retrieval. Use "document" when
 * indexing and "query" when asking; mixing them up silently degrades results.
 */
export type InputType = "document" | "query";

/**
 * A typed error carrying the upstream status, so routes can map an embeddings
 * failure to a real status code instead of collapsing everything into a 500.
 * A rate limit must not be reported to the user as "the server is broken".
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, or undefined for a timeout/network failure. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Embed a batch of texts in one request. Batching matters: embedding 40 chunks
 * one at a time is 40 round trips for no benefit.
 *
 * Returns vectors in the same order as the inputs. Throws EmbeddingError on any
 * failure — including a malformed response, which must fail *here* rather than
 * silently storing an undefined vector that only surfaces later as a NaN score.
 */
export async function embed(
  texts: string[],
  inputType: InputType,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError("VOYAGE_API_KEY is not set.", 401);
  }

  let response: Response;
  try {
    response = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        input_type: inputType,
      }),
      // Without this the request has no deadline: a stalled Voyage would hold the
      // route open until the platform killed it.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new EmbeddingError(
      timedOut
        ? "Embeddings request timed out."
        : "Could not reach the embeddings service.",
      undefined,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmbeddingError(
      `Voyage returned ${response.status}: ${detail.slice(0, 200)}`,
      response.status,
    );
  }

  // The response shape is untrusted until checked. Without this, a short or
  // reshaped payload stores `undefined` as an embedding — TypeScript won't catch
  // it (noUncheckedIndexedAccess is off), and it resurfaces much later as a NaN
  // similarity score and a blank page.
  const json: unknown = await response.json().catch(() => null);
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new EmbeddingError("Malformed embeddings response: missing 'data'.");
  }
  if (data.length !== texts.length) {
    throw new EmbeddingError(
      `Embeddings response length mismatch: asked for ${texts.length}, got ${data.length}.`,
    );
  }

  const items = data as { embedding?: unknown; index?: unknown }[];
  const vectors = items
    .slice()
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((item) => item.embedding);

  if (!vectors.every((v) => Array.isArray(v) && v.length > 0)) {
    throw new EmbeddingError("Malformed embeddings response: empty vector.");
  }

  return vectors as number[][];
}
