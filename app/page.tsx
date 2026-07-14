"use client";

import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, MAX_INPUT_CHARS } from "@/lib/limits";
// Type-only import: erased at build, so zod never reaches the browser bundle.
import type { Extraction } from "@/lib/schema";

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

  const overLimit = text.length > MAX_INPUT_CHARS;
  const busy = loading || analyzing || uploading;
  const canSubmit = text.trim().length > 0 && !overLimit && !busy;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setNotice("");
    // Clear BOTH results — a new document must never be shown alongside the
    // previous document's summary or extracted figures.
    setSummary("");
    setExtraction(null);

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
        setText(data.text);
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
            onChange={(e) => {
              setText(e.target.value);
              // Results describe the text they were derived from. The moment the
              // text changes they are stale, so drop them rather than showing a
              // summary and a table that no longer match what's on screen.
              setSummary("");
              setExtraction(null);
            }}
            placeholder={
              uploading ? "Reading file…" : "Paste document text here, or upload a file above…"
            }
            rows={12}
            disabled={uploading}
            className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <div className="flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
            </span>
            <div className="flex gap-2">
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
