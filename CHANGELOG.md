# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-25

Initial public release.

### Added

- **MCP server** (`veche-server`, stdio) implementing the committee protocol with seven
  tools: `start_meeting`, `send_message`, `get_response`, `list_meetings`, `get_transcript`,
  `end_meeting`, `cancel_job`.
- **Self-extinguishing committee protocol** — bounded rounds with parallel member
  dispatch, `<PASS/>` token, automatic termination on `all-passed` / `max-rounds` /
  `no-active-members` / `cancelled`.
- **Two CLI-backed agent adapters** — `codex-cli` (OpenAI Codex) and `claude-code-cli`
  (Anthropic Claude Code) with a load-bearing recursion guard
  (`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`) for nested Claude Code.
- **`veche` CLI** with subcommands:
  - `list` — enumerate meetings (text / JSON).
  - `show` — render a transcript in `text` / `html` / `markdown` / `json`. HTML output is
    a single self-contained file with chat bubbles, deterministic per-participant colors
    (SHA-1 → HSL), and a paranoid escape-then-transform Markdown converter — no remote
    references, no `<script>`, XSS-safe.
  - `watch` — local web viewer (loopback HTTP, default port `0`). Single-page app with
    a sidebar of all meetings and a transcript pane that update live via two SSE channels.
    Cross-process safe — polls the on-disk store at 750 ms cadence so MCP-server-driven
    updates surface within ~1 s without restarting anything. Speech bubbles render the
    same Markdown subset as `show --format html`.
  - `install` — register the SKILL.md and `mcp add` for both Claude Code and Codex with
    `--for=claude-code|codex|both`. Idempotent (probe-then-replace for Claude Code,
    overwrite for Codex). `--dry-run`, `--force`, `--skills-only`, `--mcp-only` flags.
- **Persistence** — `MeetingStorePort` with two adapters: `InMemoryMeetingStore` (tests)
  and `FileMeetingStore` (default; append-only JSONL under `$VECHE_HOME`, default
  `~/.veche`). Cross-process change detection via `MeetingStorePort.refresh()`.
- **Specification tree** under `spec/` — C4-inspired four-level model. Every behaviour is
  covered by a use-case file; the codebase mirrors the spec.
- **Skill artefact** at `skills/veche/SKILL.md` — invoked as `/veche <question>` inside
  Claude Code or Codex after `veche install`.

### Conventions

- Spec-driven development: behavioural changes update `spec/` first, code follows.
- Hexagonal + vertical-slice architecture under `src/features/<slice>/`.
- No new npm dependencies for the CLI / web viewer / install paths — Node built-ins only.
- Read-only invariant: `list` / `show` / `watch` never mutate the store; `install` never
  opens the store.

[0.1.0]: https://github.com/cyberash-dev/veche/releases/tag/v0.1.0
