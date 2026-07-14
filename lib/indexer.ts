import { chunkText } from "./chunk";
import { embed } from "./embeddings";
import { saveDocument, type IndexedDocument, type StoredChunk } from "./store";

/**
 * Chunk a document, embed every chunk, and put it in the store.
 *
 * Shared by /api/index (the explicit, up-front path) and /api/ask (the fallback
 * when the cache does not have the document — a cold serverless instance, a
 * redeploy, an eviction). One implementation, so the two paths cannot drift into
 * producing differently-chunked documents for the same text.
 */
export async function indexDocument(
  text: string,
  replacing?: string | null,
): Promise<{ document: IndexedDocument; embeddingTokens: number }> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("Nothing to index.");
  }

  // One batched request for all chunks, not one request per chunk.
  // "document" — these are passages to be retrieved, not questions.
  const { vectors, tokens } = await embed(
    chunks.map((c) => c.text),
    "document",
  );

  // embed() guarantees one vector per input, so this pairing is sound.
  const stored: StoredChunk[] = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors[i],
  }));

  return {
    document: saveDocument(stored, replacing),
    embeddingTokens: tokens,
  };
}
