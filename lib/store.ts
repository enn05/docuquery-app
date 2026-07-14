import { cosine, type Chunk } from "./chunk";
import { MAX_DOCUMENTS, TOP_K } from "./limits";

/**
 * The vector store: a Map in module scope.
 *
 * Documents are keyed by an id minted at index time, and every question must
 * carry the id of the document it is asking about. That handshake is what stops
 * a question being answered from someone else's document: with a single shared
 * slot, visitor B indexing would silently overwrite visitor A's document, and
 * A's next question would be answered — confidently, with citations — from B's
 * text, disclosing it in the process.
 *
 * ⚠️ KNOWN LIMITATION — still a demo store.
 *
 * Module-level state lives in one server process:
 *   - Serverless instances do not share it. On Vercel, a document indexed on
 *     instance 1 is invisible to a question that lands on instance 2. The id
 *     handshake turns that into an honest 409 ("index it again") rather than a
 *     wrong answer, but it remains a real limitation.
 *   - It does not survive a restart, redeploy, or cold start.
 *
 * In production this is a `pgvector` table or a managed vector DB, keyed by user
 * and document, with the id carried in a session rather than by the client.
 */

export type StoredChunk = Chunk & { embedding: number[] };

export type IndexedDocument = {
  id: string;
  chunks: StoredChunk[];
};

/** Insertion order is LRU order — see getDocument(), which refreshes on read. */
const documents = new Map<string, IndexedDocument>();

/**
 * Store a document and return it with its new id.
 *
 * `replacing` is the id of the document this one supersedes (a re-index of the
 * same text). Dropping it matters: otherwise every re-index leaks a slot, and
 * twenty clicks of "Re-index" would flush every other visitor's document out of
 * a store bounded at twenty.
 */
export function saveDocument(
  chunks: StoredChunk[],
  replacing?: string | null,
): IndexedDocument {
  if (replacing) documents.delete(replacing);

  // Evict the least-recently-used entry once we are at capacity.
  while (documents.size >= MAX_DOCUMENTS) {
    const oldest = documents.keys().next().value;
    if (oldest === undefined) break;
    documents.delete(oldest);
  }

  const document: IndexedDocument = { id: crypto.randomUUID(), chunks };
  documents.set(document.id, document);
  return document;
}

/**
 * Look up a document, refreshing its position so eviction is LRU rather than
 * FIFO. Without the refresh, the visitor who indexed first and is actively
 * asking questions is evicted before nineteen abandoned documents.
 */
export function getDocument(id: string): IndexedDocument | null {
  const document = documents.get(id);
  if (!document) return null;
  documents.delete(id);
  documents.set(id, document);
  return document;
}

export type Retrieved = StoredChunk & { score: number };

/**
 * Retrieve the top-k chunks most similar to the question's embedding.
 *
 * A linear scan: cosine against every chunk, sort, take the best k. O(n) over a
 * few dozen chunks is nothing — this is exactly the work a vector database does,
 * minus the index that makes it fast at millions of rows.
 */
export function retrieve(
  document: IndexedDocument,
  queryEmbedding: number[],
  k: number = TOP_K,
): Retrieved[] {
  return document.chunks
    .map((chunk) => ({ ...chunk, score: cosine(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
