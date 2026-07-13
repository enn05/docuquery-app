# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands
- `npm run dev` — start dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`)

No test runner is configured yet; add one before writing tests.

## Architecture
Next.js 16 App Router project. Intended as an LLM-backed document-query app
("docuquery") — the product code does not exist yet; `app/` currently holds
only the create-next-app starter (`layout.tsx`, `page.tsx`, `globals.css`).

- **LLM SDKs already installed**: `@anthropic-ai/sdk` (Claude — default/preferred
  per Anthropic guidance) and `openai`. `zod` is available for schema/validation
  and structured LLM output.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/postcss` (`postcss.config.mjs`);
  there is no `tailwind.config` file — configure in CSS.
- **Path alias**: `@/*` resolves to the repo root (`tsconfig.json`).
- TypeScript `strict` mode is on.

## Next.js 16 caveat
This is not the Next.js in your training data. Before writing routes, server
actions, config, or data-fetching code, read the matching guide under
`node_modules/next/dist/docs/` (e.g. `01-app/`) and heed deprecation notices.
