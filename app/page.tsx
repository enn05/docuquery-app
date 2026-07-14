"use client";

import { useRef, useState } from "react";
import {
  ACCEPTED_EXTENSIONS,
  MAX_INPUT_CHARS,
  MAX_QUESTION_CHARS,
} from "@/lib/limits";
// Type-only import: erased at build, so zod never reaches the browser bundle.
import type { Extraction } from "@/lib/schema";

/** A retrieved chunk, as returned by /api/ask — the evidence behind an answer. */
type Source = {
  label: number;
  chunkIndex: number;
  score: number;
  text: string;
};

export default function Home() {
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Always holds the current text. An in-flight request's closure captures the
   * `text` from the render that started it, so it cannot tell whether the user
   * has since typed something else — this ref can.
   */
  const textRef = useRef("");

  /**
   * Set the document text through here.
   *
   * This is the single invalidation point for everything derived from the text:
   * a summary, an extraction, and an answer all describe the text they were
   * produced from, and the stored embeddings describe it too. The moment the
   * text changes, all of them are stale. Centralising this is deliberate — when
   * the clearing lived in the callers, one of them always forgot.
   */
  function updateText(value: string) {
    textRef.current = value;
    setText(value);
    setSummary("");
    setExtraction(null);
    setAnswer("");
    setSources([]);
    setDocumentId(null);
  }

  /** Same idea as `textRef`, for the question an in-flight ask was issued for. */
  const questionRef = useRef("");

  /**
   * Set the question through here. Changing the question invalidates the answer:
   * an answer describes the question it was asked, so the moment the question
   * changes the answer on screen belongs to a question that is no longer there.
   */
  function updateQuestion(value: string) {
    questionRef.current = value;
    setQuestion(value);
    setAnswer("");
    setSources([]);
  }

  // --- Q&A (RAG) state ---
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  // The id of the indexed document. Sent with every question so an answer can
  // only ever come from the document it was asked against.
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [asking, setAsking] = useState(false);

  const indexed = documentId !== null;

  const overLimit = text.length > MAX_INPUT_CHARS;
  const busy = loading || analyzing || uploading || indexing || asking;
  const canSubmit = text.trim().length > 0 && !overLimit && !busy;
  const canAsk = indexed && question.trim().length > 0 && !busy;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setNotice("");
    // Clear ALL results — a new document must never be shown alongside the
    // previous document's summary, extracted figures, or answers.
    setSummary("");
    setExtraction(null);
    setDocumentId(null);
    setAnswer("");
    setSources([]);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        // Leave any text the user already pasted intact — a failed upload
        // shouldn't destroy unrelated work.
        setError(data.error ?? "Could not read that file.");
      } else {
        updateText(data.text);
        setNotice(
          data.truncated
            ? `Loaded "${data.filename}" — the document was ${data.originalChars.toLocaleString()} characters and has been truncated to ${MAX_INPUT_CHARS.toLocaleString()}. Only the first part will be summarized.`
            : `Loaded "${data.filename}" (${data.originalChars.toLocaleString()} characters).`,
        );
      }
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
      // Reset so re-selecting the same file fires a change event again.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSummarize() {
    setLoading(true);
    setError("");
    setSummary("");
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setSummary(data.summary);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Chunk + embed + store the current text so it can be questioned. */
  async function handleIndex() {
    // Snapshot the text this index run is for. The request takes seconds, and
    // the user can keep typing during it — if they do, the id coming back
    // belongs to text that is no longer on screen. Binding it anyway would make
    // every later question cite a document the user has already replaced, which
    // is exactly the wrong-document failure the documentId handshake exists to
    // prevent. So we check before accepting the result.
    const indexedText = text;

    setIndexing(true);
    setError("");
    setNotice("");
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send the current id (if any) so the server can drop the document this
        // one supersedes, instead of orphaning it in a bounded store.
        body: JSON.stringify({ text: indexedText, documentId }),
      });
      const data = await res.json();

      // The text moved on while we were waiting. Discard the result rather than
      // binding an id to something the user no longer has in front of them.
      if (textRef.current !== indexedText) return;

      if (!res.ok) {
        setError(data.error ?? "Could not index the document.");
        setDocumentId(null);
      } else {
        setDocumentId(data.documentId);
        setNotice(
          `Indexed ${data.chunks} chunk${data.chunks === 1 ? "" : "s"} (${data.dimensions}-dimensional embeddings). You can now ask questions.`,
        );
      }
    } catch {
      if (textRef.current !== indexedText) return;
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIndexing(false);
    }
  }

  async function handleAsk() {
    if (!documentId) return;

    // Snapshot the question this request is for. If the user edits the question
    // while it is in flight, the answer that comes back belongs to the *old*
    // question — displaying it under the new one would be the same stale-result
    // bug as binding a documentId to replaced text.
    const askedQuestion = question;

    setAsking(true);
    setError("");
    setNotice("");
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The id binds this question to the document it was asked against.
        // The text rides along so the server can rebuild its cache on a miss —
        // routine on serverless, where the question can land on a different
        // instance than the one that indexed. See lib/store.ts.
        body: JSON.stringify({ question: askedQuestion, documentId, text }),
      });
      const data = await res.json();

      // The question moved on while we were waiting — discard this answer.
      if (questionRef.current !== askedQuestion) return;

      if (!res.ok) {
        setError(data.error ?? "Could not answer that question.");
        // 409 means the server no longer holds this document (restart, cold
        // start, eviction). Drop back to the un-indexed state so the user is
        // offered the button that actually fixes it, instead of being told to
        // index inside a panel that only exists because it *is* indexed.
        if (res.status === 409) setDocumentId(null);
      } else {
        setAnswer(data.answer);
        setSources(data.sources ?? []);
      }
    } catch {
      if (questionRef.current !== askedQuestion) return;
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAsking(false);
    }
  }

  async function handleExtract() {
    setAnalyzing(true);
    setError("");
    setExtraction(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The model failed validation twice. Show a clean error — never render
        // unvalidated model output.
        setError(data.error ?? "Extraction failed.");
      } else {
        setExtraction(data.data);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            DocuQuery
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Upload a document or paste text, then get a concise, factual AI summary.
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="file"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Upload a document
          </label>
          <input
            id="file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleFileChange}
            disabled={busy}
            className="w-full cursor-pointer rounded-lg border border-zinc-300 bg-white p-2 text-sm text-black file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:file:bg-zinc-50 dark:file:text-black"
          />
          <p className="text-xs text-zinc-500">
            .txt or .pdf, up to 5 MB. Scanned PDFs have no text layer and cannot be read.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="text"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Document text
          </label>
          <textarea
            id="text"
            value={text}
            // updateText owns the invalidation of everything derived from the text.
            onChange={(e) => updateText(e.target.value)}
            placeholder={
              uploading ? "Reading file…" : "Paste document text here, or upload a file above…"
            }
            rows={12}
            // Disabled while any request is in flight, not just uploads: editing
            // mid-index would otherwise leave a request racing against the edit.
            disabled={busy}
            className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <div className="flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleIndex}
                disabled={!canSubmit}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                {indexing ? "Indexing…" : indexed ? "Re-index" : "Index for Q&A"}
              </button>
              <button
                onClick={handleExtract}
                disabled={!canSubmit}
                className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                {analyzing ? "Extracting…" : "Extract data"}
              </button>
              <button
                onClick={handleSummarize}
                disabled={!canSubmit}
                className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {loading ? "Summarizing…" : "Summarize"}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div
            aria-live="polite"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {indexed && (
          <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <label
              htmlFor="question"
              className="text-sm font-semibold text-zinc-700 dark:text-zinc-300"
            >
              Ask a question about this document
            </label>
            <div className="flex gap-2">
              <input
                id="question"
                type="text"
                value={question}
                onChange={(e) => updateQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAsk) handleAsk();
                }}
                placeholder="e.g. What is the total amount due?"
                maxLength={MAX_QUESTION_CHARS}
                disabled={busy}
                className="flex-1 rounded-lg border border-zinc-300 bg-white p-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <button
                onClick={handleAsk}
                disabled={!canAsk}
                className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {asking ? "Asking…" : "Ask"}
              </button>
            </div>

            {/*
              The live region is mounted permanently and its *contents* toggle.
              A region inserted into the DOM together with its text is generally
              not announced — the region has to already exist for a screen reader
              to notice the mutation. Wrapping this in {answer && …} looked like
              an accessibility fix while announcing nothing.
            */}
            <div aria-live="polite" className="contents">
              {answer && (
                <div className="mt-2 flex flex-col gap-3">
                  <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-black dark:border-zinc-800 dark:bg-black dark:text-zinc-50">
                    {answer}
                  </div>

                  {sources.length > 0 && (
                    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <summary className="cursor-pointer p-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Sources — {sources.length} retrieved excerpt
                        {sources.length === 1 ? "" : "s"}
                      </summary>
                      <div className="flex flex-col gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
                        {sources.map((source) => (
                          <div key={source.label} className="flex flex-col gap-1">
                            <div className="text-xs font-medium text-zinc-500">
                              [{source.label}] excerpt {source.chunkIndex + 1} · similarity{" "}
                              {source.score.toFixed(3)}
                            </div>
                            <p className="whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-2 text-xs leading-5 text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                              {source.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {extraction && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Extracted data
            </h2>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  <tr>
                    <th scope="row" className="w-40 p-3 align-top font-medium text-zinc-600 dark:text-zinc-400">
                      Type
                    </th>
                    <td className="p-3 text-black dark:text-zinc-50">{extraction.documentType}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="p-3 align-top font-medium text-zinc-600 dark:text-zinc-400">
                      Parties
                    </th>
                    <td className="p-3 text-black dark:text-zinc-50">
                      {extraction.parties.length === 0
                        ? "—"
                        : extraction.parties.join(", ")}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="p-3 align-top font-medium text-zinc-600 dark:text-zinc-400">
                      Key dates
                    </th>
                    <td className="p-3 text-black dark:text-zinc-50">
                      {extraction.keyDates.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {extraction.keyDates.map((d, i) => (
                            <li key={`${d.date}-${i}`}>
                              <span className="font-mono">{d.date}</span> — {d.description}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="p-3 align-top font-medium text-zinc-600 dark:text-zinc-400">
                      Amounts
                    </th>
                    <td className="p-3 text-black dark:text-zinc-50">
                      {extraction.amounts.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {extraction.amounts.map((a, i) => (
                            <li key={`${a.currency}-${a.value}-${i}`}>
                              <span className="font-mono">
                                {a.value.toLocaleString()} {a.currency}
                              </span>{" "}
                              — {a.description}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="p-3 align-top font-medium text-zinc-600 dark:text-zinc-400">
                      Summary
                    </th>
                    <td className="p-3 text-black dark:text-zinc-50">{extraction.summary}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {summary && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Summary
            </h2>
            <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-6 text-black dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
              {summary}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
