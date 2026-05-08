# CLAUDE.md

Project-level guidance for Claude Code sessions on this repository.

> **Read [`AGENTS.md`](AGENTS.md) first.** It is the single source of truth for
> conventions (architecture, naming, SDD workflow, testing, CLI/Watch/install
> invariants, adapter gotchas, build-break rules). This file only adds what is
> genuinely Claude-Code-specific and does not repeat anything from there.

## Tools to prefer in this repo

The spec is large (~10k lines in `spec/spec.md`) and the source tree is
hexagonal with deep slices. Lean on semantic navigation rather than `Read`:

- `mcp__code-skeleton__get_outline` — file outline before reading.
- `LSP.goToDefinition` / `LSP.findReferences` / `LSP.hover` — for "where is X" /
  "who calls Y" / "type of Z" questions.
- `Read` — only when you need exact bytes for an `Edit`.
- `Grep` — for string/log/literal searches; not for symbol lookups.

## Handoff etiquette

- Diffs stay small and focused: one spec change ↔ one code change ↔ one test
  change.
- End-of-turn summary is one or two sentences (outcome + risk/follow-up). No
  essays.
- Don't open `README.md`, `AGENTS.md`, or `CLAUDE.md` unless the task explicitly
  asks for it.

## Claude-Code-specific notes about this committee

This project's committee can be entered by a Claude Code orchestrator AND can
have Claude Code as a member. The recursion guard documented in `AGENTS.md` →
*Recursion guard* is what makes that safe. If you ever see a nested
`start_meeting` from a child process, something is wrong with the guard —
debug, don't paper over.

`--bare` on `claude -p` is opt-in via `extraFlags`, never default — it breaks
OAuth login for most users. The recursion guard relies on
`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`, not on `--bare`.
