import { errorResponse, logUsage, rateLimit, readTextBody } from "@/lib/api";
import { indexDocument } from "@/lib/indexer";

/**
 * Index a document up front so questions about it are fast.
 *
 * This is the fast path, not the only path: /api/ask indexes on the fly when the
 * cache does not have the document (a cold serverless instance, a redeploy, an
 * eviction). Doing it here means the user pays the embedding latency once, when
 * they click "Index", instead of on their first question.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const body = await readTextBody(request);
  if (!body.ok) return body.response;

  // If the client is re-indexing, it names the document this one supersedes, so
  // the old entry is dropped rather than leaking a slot in a bounded cache.
  const replacing = body.raw?.documentId;
  const previousId = typeof replacing === "string" ? replacing : null;

  try {
    const { document, embeddingTokens } = await indexDocument(
      body.text,
      previousId,
    );

    logUsage("/api/index", {
      input_tokens: 0,
      output_tokens: 0,
      embedding_tokens: embeddingTokens,
    });

    return Response.json({
      documentId: document.id,
      chunks: document.chunks.length,
      dimensions: document.chunks[0].embedding.length,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Nothing to index.") {
      return Response.json({ error: "Nothing to index." }, { status: 400 });
    }
    return errorResponse(err, "/api/index");
  }
}
