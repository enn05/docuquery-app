"use client";

import { useState } from "react";

const MAX_INPUT_CHARS = 50_000;

export default function Home() {
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const overLimit = text.length > MAX_INPUT_CHARS;
  const canSubmit = text.trim().length > 0 && !overLimit && !loading;

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

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            DocuQuery
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Paste a document and get a concise, factual AI summary.
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste document text here…"
            rows={12}
            className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <div className="flex items-center justify-between text-xs">
            <span className={overLimit ? "text-red-600" : "text-zinc-500"}>
              {text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
            </span>
            <button
              onClick={handleSummarize}
              disabled={!canSubmit}
              className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {loading ? "Summarizing…" : "Summarize"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
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
