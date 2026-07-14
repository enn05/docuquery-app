import { anthropic, MODEL } from "@/lib/anthropic";
import { errorResponse } from "@/lib/api";
import { embed } from "@/lib/embeddings";
import {
  MAX_ANSWER_TOKENS,
  MAX_QUESTION_CHARS,
  REQUEST_TIMEOUT_MS,
} from "@/lib/limits";
import { getDocument, retrieve } from "@/lib/store";

/**
 * The generation prompt is where RAG succeeds or fails.
 *
 * Three jobs, all load-bearing:
 *   1. Answer ONLY from the excerpts — otherwise the model quietly falls back on
 *      its own knowledge and you get a confident answer with no source.
 *   2. Say so when the answer isn't there. A RAG system that invents an answer
 *      for a question the document doesn't cover is worse than useless, because
 *      it looks exactly like one that works.
 *   3. Cite the excerpt behind each claim, so the user can check it.
 */
function systemPrompt(sourceCount: number): string {
  const valid =
    sourceCount === 1 ? "[1]" : `[1] through [${sourceCount}]`;
  return `You answer questions about a document for accountants, using ONLY the excerpts provided.

Rules:
- Base every part of your answer solely on the excerpts below. Do not use outside knowledge.
- If the excerpts do not contain the answer, reply exactly: "Not found in the document."
  Do not guess, infer beyond what is written, or fill gaps from general knowledge.
- Cite the excerpt supporting each claim inline. You were given ${sourceCount} excerpt(s), so
  the ONLY valid citation labels are ${valid}. Never cite any other number.
- The document may contain its own numbered sections or clauses. Those numbers are NOT
  citation labels. Cite the excerpt number you were given, never the document's own numbering.
- Be concise and factual. Quote figures exactly as they appear.`;
}

/**
 * Strip citations that point at excerpts the model was never given.
 *
 * Models conflate our [n] labels with numbering inside the document itself — a
 * contract with a "2. FEES" clause reliably produces a "[2]" citation even when
 * only one excerpt was supplied. A citation the user cannot open is worse than
 * no citation: it looks verifiable and isn't.
 *
 * Same principle as schema validation in /api/analyze — model output is
 * untrusted until checked.
 */
function stripDanglingCitations(
  answer: string,
  sourceCount: number,
): { answer: string; dropped: number[] } {
  const dropped = new Set<number>();
  // Consume the space *before* a bad citation as part of the match, so removing
  // it leaves no gap to clean up afterwards. A blanket whitespace collapse would
  // reflow the whole answer — including any column alignment the model copied
  // from the document, which the system prompt explicitly asks it to preserve.
  const cleaned = answer.replace(
    / ?\[(\d+)\]/g,
    (match, digits: string) => {
      const n = Number(digits);
      if (n >= 1 && n <= sourceCount) return match;
      dropped.add(n);
      return "";
    },
  );
  return { answer: cleaned.trim(), dropped: [...dropped] };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { question, documentId } = (body ?? {}) as {
    question?: unknown;
    documentId?: unknown;
  };

  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json(
      { error: "Provide a non-empty 'question' string." },
      { status: 400 },
    );
  }
  // Cap it at the boundary. Uncapped, a single request could send megabytes to
  // *two* paid APIs — Voyage to embed it, then Anthropic with it in the prompt.
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json(
      {
        error: `Question is too long (${question.length} chars). The limit is ${MAX_QUESTION_CHARS}.`,
      },
      { status: 413 },
    );
  }
  if (typeof documentId !== "string" || documentId.length === 0) {
    return Response.json(
      { error: "Provide the 'documentId' returned when the document was indexed." },
      { status: 400 },
    );
  }

  // The id binds the question to a specific indexed document. A miss means the
  // document is gone (restart, cold start, or evicted) — never someone else's.
  const document = getDocument(documentId);
  if (!document) {
    return Response.json(
      { error: "That document is no longer indexed. Index it again to ask questions." },
      { status: 409 },
    );
  }

  try {
    // 1. Embed the question into the same space as the chunks.
    //    "query" — embedded asymmetrically from the stored passages, which is
    //    what pulls a short question close to the long passage that answers it.
    const [queryEmbedding] = await embed([question], "query");

    // 2. Retrieve the chunks whose meaning sits closest to it.
    // k defaults to TOP_K — one source of truth, in lib/limits.ts.
    const hits = retrieve(document, queryEmbedding);

    // 3. Generate an answer constrained to those excerpts.
    const excerpts = hits
      .map((hit, i) => `[${i + 1}] (excerpt ${hit.index + 1})\n${hit.text}`)
      .join("\n\n---\n\n");

    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_ANSWER_TOKENS,
        system: systemPrompt(hits.length),
        messages: [
          {
            role: "user",
            content: `Excerpts from the document:\n\n${excerpts}\n\n---\n\nQuestion: ${question}`,
          },
        ],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const raw = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    // Never ship a citation the user cannot open.
    const { answer, dropped } = stripDanglingCitations(raw, hits.length);
    if (dropped.length > 0) {
      console.warn(
        `/api/ask: dropped citation(s) ${dropped.join(", ")} — only ${hits.length} excerpt(s) were provided.`,
      );
    }

    return Response.json({
      answer,
      // Return the sources so the UI can show its work — the user can check
      // every claim against the text it came from.
      sources: hits.map((hit, i) => ({
        label: i + 1,
        chunkIndex: hit.index,
        score: Number(hit.score.toFixed(4)),
        text: hit.text,
      })),
      usage: message.usage,
    });
  } catch (err) {
    return errorResponse(err, "/api/ask");
  }
}
