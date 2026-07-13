---
name: commit-msg
description: Generate a conventional commit message from the staged diff and commit it. Use when the user says "write a commit message", "generate a commit", "commit my changes", or runs /commit-msg.
---

# commit-msg

Generate a conventional-commit message from the **staged** diff, then commit.

## Workflow

### 1. Check for staged changes

```bash
git diff --staged --stat
```

If the output is empty, **stop immediately**. Do not commit, do not stage anything on the
user's behalf. Tell the user there is nothing staged and that they need to stage their
changes first (e.g. `git add <files>`).

### 2. Read the staged diff

```bash
git diff --staged
```

Read it in full so the message describes what actually changed. If the diff is very large,
also use `git diff --staged --stat` to summarize scope, but base the message on real content
— never guess.

### 3. Compose the message

Format:

```
type(scope): short subject
- bullet of what changed
- bullet of why
```

Rules:
- **type** — one of: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`
- **scope** — the area touched (e.g. `api`, `ui`, `auth`, `deps`). Omit the parens entirely
  if no single scope fits: `type: short subject`
- **subject** — imperative mood, **under 60 characters**, no trailing period
- **body bullets** — optional but encouraged; cover *what* changed and *why*
- **Never include a `Co-Authored-By` trailer.**

### 4. Commit

Use a heredoc so the multi-line body is preserved:

```bash
git commit -q -m "$(cat <<'EOF'
type(scope): short subject
- bullet of what changed
- bullet of why
EOF
)"
```

Then show the result with `git log --oneline -1`.

Commit only. **Do not push** unless the user explicitly asks.

## Example

```
feat(api): add document summarize route
- add POST /api/summarize with input validation and typed error handling
- gives the UI a server-side path to Claude so the API key never reaches the browser
```
