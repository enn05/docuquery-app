import { errorResponse, readTextBody } from "@/lib/api";
import { chunkText } from "@/lib/chunk";
import { embed } from "@/lib/embeddings";
import { saveDocument, type StoredChunk } from "@/lib/store";

/**
 * Index a document so it can be questioned: chunk it, embed every chunk, store
 * the vectors, and return the id the client must present when asking questions.
 *
 * That id is what binds a question to the document it was asked against — see
 * lib/store.ts for why a single shared slot was not safe.
 */
export async function POST(request: Request) {
  const body = await readTextBody(request);
  if (!body.ok) return body.response;

  // If the client is re-indexing, it tells us which document it is replacing so
  // the old one can be dropped. Otherwise every re-index leaks a slot, and enough
  // clicks would evict other visitors' documents from a bounded store.
  const replacing = body.raw?.documentId;
  const previousId = typeof replacing === "string" ? replacing : null;

  const chunks = chunkText(body.text);
  if (chunks.length === 0) {
    return Response.json({ error: "Nothing to index." }, { status: 400 });
  }

  try {
    // One batched request for all chunks, not one request per chunk.
    // "document" — these are passages to be retrieved, not questions.
    const vectors = await embed(
      chunks.map((c) => c.text),
      "document",
    );

    // embed() guarantees one vector per input, so this pairing is sound.
    const stored: StoredChunk[] = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: vectors[i],
    }));

    const document = saveDocument(stored, previousId);

    return Response.json({
      documentId: document.id,
      chunks: stored.length,
      dimensions: vectors[0].length,
    });
  } catch (err) {
    return errorResponse(err, "/api/index");
  }
}
