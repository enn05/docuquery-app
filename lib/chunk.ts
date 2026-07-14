/**
 * Chunking and similarity — the two pieces of RAG that involve no API calls.
 *
 * Both are hand-rolled on purpose. They are the parts of retrieval worth
 * actually understanding, and they are pure functions, so they can be tested
 * without spending a cent.
 */

/**
 * Target chunk size, in characters.
 *
 * The unit that matters to the model is tokens, but counting tokens exactly
 * requires a tokenizer we don't otherwise need. ~4 characters per token is the
 * standard rule of thumb for English prose, so 2000 chars ≈ 500 tokens. This is
 * an approximation, and it is deliberately one: chunk size is a retrieval-quality
 * knob, not a correctness boundary — being 15% off costs nothing.
 */
export const CHUNK_CHARS = 2000;

/**
 * Overlap between consecutive chunks (~50 tokens).
 *
 * Without overlap, a fact that straddles a chunk boundary is split in half and
 * neither chunk retrieves well for it. The overlap means any span shorter than
 * OVERLAP_CHARS appears intact in at least one chunk.
 */
export const OVERLAP_CHARS = 200;

export type Chunk = {
  /** Position in the document — used to cite sources back to the user. */
  index: number;
  text: string;
};

/**
 * Break a paragraph that is larger than one chunk into chunk-sized pieces.
 *
 * This walks the string from start to end, so **every character is emitted
 * exactly once**. That property is the whole point.
 *
 * The previous implementation matched sentences with a regex and kept whatever
 * it matched. On prose that worked. On a PDF table flattened to a single line —
 * no newlines, and every "." a decimal point rather than a sentence end — the
 * only sub-pattern that could match was the run of text after the final period,
 * so a 2,631-character document produced one 177-character chunk and silently
 * discarded the other 94%. Retrieval then answered from the scraps and honestly
 * reported that the data was not there.
 *
 * A splitter is allowed to cut text in an awkward place. It is never allowed to
 * lose it. Hence: walk, don't match.
 */
function splitOversizedParagraph(paragraph: string): string[] {
  const pieces: string[] = [];
  let start = 0;

  while (start < paragraph.length) {
    let end = Math.min(start + CHUNK_CHARS, paragraph.length);

    // Not the final piece — prefer a natural boundary, but only if it falls in
    // the back half of the window. A boundary too near the start would produce
    // tiny pieces and a lot of them.
    if (end < paragraph.length) {
      const window = paragraph.slice(start, end);
      const floor = Math.floor(CHUNK_CHARS / 2);

      const sentenceEnd = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("\n"),
      );
      const wordEnd = window.lastIndexOf(" ");

      if (sentenceEnd > floor) {
        end = start + sentenceEnd + 1;
      } else if (wordEnd > floor) {
        // Break between words rather than mid-token, so numbers and names in a
        // table are not sliced in half.
        end = start + wordEnd;
      }
      // Otherwise fall through: a hard cut at CHUNK_CHARS. Ugly, but lossless.
    }

    const piece = paragraph.slice(start, end).trim();
    if (piece.length > 0) pieces.push(piece);
    start = end;
  }

  return pieces;
}

/**
 * Split text into overlapping chunks, preferring to break at paragraph
 * boundaries and falling back to sentence boundaries, so chunks stay
 * semantically coherent rather than cutting mid-thought.
 */
export function chunkText(input: string): Chunk[] {
  const text = input.trim();
  if (text.length === 0) return [];
  if (text.length <= CHUNK_CHARS) return [{ index: 0, text }];

  // Split into paragraphs, then sentences — the units a human would keep whole.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= CHUNK_CHARS) {
      pieces.push(para.trim());
      continue;
    }
    // Paragraph is bigger than a whole chunk — break it up.
    pieces.push(...splitOversizedParagraph(para));
  }

  // Greedily pack pieces into chunks up to the size budget.
  const chunks: Chunk[] = [];
  let current = "";
  const flush = () => {
    const body = current.trim();
    if (body.length === 0) return;
    chunks.push({ index: chunks.length, text: body });
    // Carry the tail of this chunk into the next one, so facts spanning the
    // boundary survive intact in at least one chunk.
    current = body.length > OVERLAP_CHARS ? body.slice(-OVERLAP_CHARS) : body;
  };

  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length + 2 > CHUNK_CHARS) {
      flush();
    }
    current = current.length > 0 ? `${current}\n\n${piece}` : piece;
  }

  // Final chunk: only emit it if it holds more than the carried-over overlap,
  // otherwise it would just duplicate the tail of the previous chunk.
  const tail = current.trim();
  if (tail.length > 0) {
    const previous = chunks[chunks.length - 1]?.text ?? "";
    if (!previous.endsWith(tail)) {
      chunks.push({ index: chunks.length, text: tail });
    }
  }

  return chunks;
}

/**
 * Vectors from different embedding models cannot be compared.
 *
 * Typed rather than a plain Error so routes can map it to a **409** — the stored
 * document is unusable and must be re-indexed, which is the same remedy as a
 * store miss. As a plain Error it fell through to an opaque 500, the client
 * (which only resets on 409) kept a dead documentId, and every retry produced
 * the same 500 with no way out.
 */
export class DimensionMismatchError extends Error {
  constructor(a: number, b: number) {
    super(
      `Vector length mismatch (${a} vs ${b}) — these were embedded with different models.`,
    );
    this.name = "DimensionMismatchError";
  }
}

/**
 * Cosine similarity: the cosine of the angle between two vectors.
 *
 * An embedding places text in a space where semantic closeness ≈ geometric
 * closeness. Cosine ignores magnitude and measures only direction, so it
 * compares *what the text means* rather than how long it is. Returns roughly
 * -1 (opposite) to 1 (identical).
 */
export function cosine(a: number[], b: number[]): number {
  // Fail loudly on mismatched vectors. Without this the loop reads past the end
  // of the shorter one, producing NaN — which poisons the sort comparator
  // (arbitrary ordering, no error), serialises to null over JSON, and finally
  // throws in the UI as a TypeError on null.toFixed(), three layers from here.
  // Changing EMBEDDING_MODEL with a document already indexed reproduces this.
  if (a.length !== b.length || a.length === 0) {
    throw new DimensionMismatchError(a.length, b.length);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
