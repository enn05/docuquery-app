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

Built in phases. **Shipped:** summarize (Phase 1), document upload (Phase 2).
**Planned:** Zod structured extraction with a validate-and-retry loop (3), RAG — chunk /
embed / cosine retrieve / cite (4), hardening — prompt-injection defense, rate limits, cost
caps (5), README + deploy (6). See `context/` for the session log.

## Architecture

Request flow:

```
file → POST /api/extract → text → (textarea, user-visible) → POST /api/summarize → summary
```

**Extraction and summarization are separate routes on purpose.** Phases 3 and 4 both need
raw document text (structured extraction; chunking for RAG), so extraction is not folded into
the summarizer. Extracted text is surfaced in the UI textarea so the user sees exactly what
the model will see — truncation and bad PDF parses are visible, not silent.

| Module | Role |
|---|---|
| `lib/limits.ts` | Input limits shared by client **and** server |
| `lib/anthropic.ts` | Anthropic client, `MODEL`, request timeout |
| `lib/extract.ts` | `truncateToLimit()` — enforces the model's input budget |
| `app/api/extract/route.ts` | `FormData` → text (`unpdf` for PDFs) |
| `app/api/summarize/route.ts` | text → Claude summary + token usage |

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
  Retrieval (Phase 4) is the real fix; don't silently expand the cap instead.

## Environment
`ANTHROPIC_API_KEY` in `.env.local` (gitignored; see `.env.example`). `OPENAI_API_KEY` is only
needed from Phase 4 (embeddings — Anthropic has no embeddings endpoint).

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
