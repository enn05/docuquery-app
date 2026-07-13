---
name: code-reviewer
description: Review the current uncommitted changes and report findings grouped by severity, without making edits. Use when the user says "review my code", "run the reviewer", or runs /code-reviewer.
---

# code-reviewer

Thin entry point for the `code-reviewer` subagent. The review checklist and report format live
in `.claude/agents/code-reviewer.md` — this skill exists so the review can be launched with the
`/code-reviewer` slash command.

## Workflow

Launch the `code-reviewer` subagent with the **Agent** tool:

- `subagent_type`: `code-reviewer`
- `run_in_background`: `false` — the user is waiting for the report
- `prompt`: instruct it to review the current uncommitted changes (staged, unstaged, and
  untracked source files) and return its markdown report. Pass along any extra scope the user
  gave — e.g. if they said "review my code in app/api", scope the review to that path.

When the agent returns, **relay its markdown report to the user in full**. Do not summarize it
away — the findings, their severities, and the `file:line` anchors are the deliverable.

## Hard rule

This is a **report-only** flow. Do not edit, stage, commit, or revert anything, and do not
apply the suggested fixes. If the user wants them applied, they will ask in a follow-up.
