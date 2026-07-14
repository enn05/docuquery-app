# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands
- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`)

No test runner is configured; add one before writing tests. Until then, verify changes by
driving the running app (e.g. `curl -X POST localhost:3000/api/extract -F file=@doc.pdf`).

## What this is
DocuQuery — upload a document, get an AI summary, and (planned) ask questions answered via
retrieval with citations. Next.js 16 App Router, TypeScript strict, Tailwind v4.

Built in phases. **Shipped:** summarize (1), document upload (2), Zod structured extraction
with a validate-and-retry loop (3), RAG — chunk / embed / cosine retrieve / cite (4).
**Planned:** hardening — prompt-injection defense, rate limits, cost caps (5), README +
deploy (6). See `context/` for the session log.

## Architecture

Everything starts from one piece of document text, surfaced in the UI textarea:

```
file → POST /api/extract → text ─┬→ POST /api/summarize → prose summary
                                 ├→ POST /api/analyze   → Zod-validated JSON (table)
                                 └→ POST /api/index     → chunks + embeddings (documentId)
                                                            ↓
                                    question + documentId → POST /api/ask → cited answer
```

**Extraction is its own route on purpose.** Three consumers need raw document text
(summarize, structured extraction, chunking for RAG), so it is not folded into any one of
them. Extracted text is shown in the textarea so the user sees exactly what the model will
see — truncation and bad PDF parses are visible, not silent.

| Module | Role |
|---|---|
| `lib/limits.ts` | Limits shared by client **and** server (import-free — see invariants) |
| `lib/anthropic.ts` | Anthropic client, `MODEL`, request timeout |
| `lib/api.ts` | `readTextBody()` + `errorResponse()` — shared route plumbing |
| `lib/extract.ts` | `truncateToLimit()` — enforces the model's input budget |
| `lib/schema.ts` | Zod `ExtractionSchema`; prompt shape **derived** via `z.toJSONSchema()` |
| `lib/chunk.ts` | Hand-rolled chunker (paragraph/sentence aware) + `cosine()` |
| `lib/embeddings.ts` | Voyage AI embeddings, `EmbeddingError`, asymmetric doc/query types |
| `lib/store.ts` | In-memory vector store keyed by `documentId` + top-k retrieval |
| `app/api/extract/route.ts` | `FormData` → text (`unpdf` for PDFs) |
| `app/api/summarize/route.ts` | text → Claude summary |
| `app/api/analyze/route.ts` | text → validated JSON, with one retry on validation failure |
| `app/api/index/route.ts` | text → chunks + embeddings → `documentId` |
| `app/api/ask/route.ts` | question + `documentId` → retrieved excerpts → cited answer |

### Invariants — read before editing `lib/`

- **`lib/limits.ts` must stay import-free.** `app/page.tsx` is a client component that imports
  it, so anything it pulls in lands in the browser bundle. `lib/anthropic.ts` constructs the
  SDK client at module scope (`new Anthropic()`), so **never import `lib/anthropic.ts` from
  `lib/limits.ts` or from client code.** All limits live in `limits.ts` precisely so client-side
  validation and server-side enforcement cannot drift apart — do not re-declare them locally.
- **Do not pass `temperature`, `top_p`, or `top_k`.** They are removed on current Claude models
  (Opus 4.8, Sonnet 5) and return a **400**. Steer factual/no-speculation output via the system
  prompt instead.
- Routes validate at the boundary and map failures to real status codes (400 bad input, 413 too
  large, 415 unsupported type, 422 unreadable/scanned PDF, 429/502/504 upstream). Keep that
  mapping when adding routes.
- Over-long documents are **truncated with a visible warning** — a deliberate v1 trade-off.
  Retrieval is the real fix for large *inputs*; don't silently expand the cap instead. Note
  `max_tokens` truncation is a different problem — an **output** limit, which retrieval does
  not help with (`/api/analyze` detects it via `stop_reason` and does not retry).
- **Model output is untrusted until validated.** `/api/analyze` rejects anything failing
  `safeParse`; `/api/ask` strips citations pointing at excerpts that were never supplied.
  Never render unvalidated model output.
- **Every question carries a `documentId`.** The store is keyed by it, so an answer can only
  come from the document it was asked against — a single shared slot would let one visitor's
  document answer another's question, and leak its text in the sources.

## Environment
Both keys go in `.env.local` (gitignored; see `.env.example`):
- `ANTHROPIC_API_KEY` — generation (summaries, extraction, answers).
- `VOYAGE_API_KEY` — embeddings for RAG. Anthropic has **no embeddings endpoint**; Voyage is
  their recommended provider, and has a free token allowance.

⚠️ **A shell-exported `ANTHROPIC_API_KEY` overrides `.env.local` in Next.js.** A stale key in
the environment will silently win and produce 401s that look like a bad `.env.local`. If auth
fails unexpectedly, check `echo $ANTHROPIC_API_KEY` before debugging anything else.

## Conventions
- **Path alias** `@/*` → repo root.
- **Tailwind v4** via `@tailwindcss/postcss`; there is no `tailwind.config` — configure in CSS.
- **Commits:** conventional format, subject under 60 chars, blank line before the body, and
  **never** a `Co-Authored-By` trailer. The `/commit-msg` skill enforces this.
- `/code-reviewer` runs a read-only review of uncommitted changes (`.claude/agents/`).

## Next.js 16 caveat
This is not the Next.js in your training data. Before writing routes, server actions, config, or
data-fetching code, read the matching guide under `node_modules/next/dist/docs/` (e.g. `01-app/`)
and heed deprecation notices.
