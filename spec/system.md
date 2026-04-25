# AI Meeting Server

## Purpose

An MCP server that lets an orchestrator agent conduct multi-party committee meetings with external LLM agents and retrieve a structured transcript of the discussion.

## Containers

| Container | Tech | Responsibility |
|-----------|------|----------------|
| [ai-meeting-server](./containers/ai-meeting-server.md) | Node ≥ 20, TypeScript, `@modelcontextprotocol/sdk` | Exposes MCP tools over stdio; orchestrates committee discussions; persists meetings; spawns per-Participant CLI subprocesses. |

## External Systems

| System | Protocol | Purpose |
|--------|----------|---------|
| Codex CLI (`codex`) | child process + JSONL on stdout | Acts as a Participant backed by OpenAI Codex. Invoked non-interactively via `codex exec`. |
| Claude Code CLI (`claude`) | child process + JSON on stdout | Acts as a Participant backed by Anthropic Claude. Invoked non-interactively via `claude -p`. |
| Local filesystem | POSIX | Holds the event log for the `FileStore` adapter under `$AI_MEETING_HOME` and the user config file. |

## Actors

| Actor | Auth method | Description |
|-------|-------------|-------------|
| Orchestrator Agent | None at the MCP boundary (stdio is the trust envelope) | The external agent process that connects to this MCP server, issues tool calls, and consumes transcripts. Always the Facilitator of every Meeting it creates. |
| Human Operator | Filesystem permissions on `$AI_MEETING_HOME` | Person running the `ai-meeting` CLI from a terminal to read past transcripts (commands `list`, `show`) or to watch every Meeting live in a browser (command `watch`, see [watch-server](./features/web-viewer/watch-server.usecase.md)). Never writes to the store; inspects event logs produced by prior MCP sessions. |

## Key Decisions

- **Spec-driven development.** Implementation proceeds only after this `/spec` tree is approved. Code changes that drift from the spec are rejected; the spec is updated first.
- **Vertical Slices + Hexagonal.** Each feature is a self-contained slice holding its own domain, ports, application code, and tests. External concerns enter through ports and never reach the domain directly.
- **CLI subprocess over SDK.** Both Participant types are integrated via their official CLIs rather than native SDKs. CLIs expose a stable non-interactive contract (`exec --json`, `-p --output-format json`), hide provider auth and rate-limiting, and keep adapter surface narrow.
- **Self-extinguishing committee protocol.** Discussion runs in rounds. Each round is a parallel broadcast to the active Members; Members respond seeing the full prior Transcript. A Member signals completion with `<PASS/>`. The Meeting terminates when every active Member emits `<PASS/>` in the same Round or `max_rounds` is reached. See [committee-protocol](./features/committee-protocol/committee-protocol.md).
- **Asynchronous jobs.** `send_message` never blocks on the discussion — it returns a `jobId`. The Orchestrator polls `get_response` with a Cursor to consume the Transcript delta as the Rounds advance. MCP tool-call timeouts stay bounded even when Members are slow.
- **Recursion guard for Claude Code.** When the Claude Code CLI is spawned as a Member, the adapter appends `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` to every invocation. The child Claude Code accepts MCP servers only from the supplied config, which is empty, so it cannot re-enter this (or any) MCP server and spawn another committee. See [claude-code-cli-adapter](./features/agent-integration/claude-code-cli-adapter.usecase.md).
- **Two storage adapters.** The `MeetingStore` port has an `InMemoryStore` (tests and ephemeral dev) and a `FileStore` (JSONL under `$AI_MEETING_HOME`). Both are fed by the same event log model.
- **Resilient to Member failure.** An Adapter failure drops only the affected Participant; the remaining committee continues the discussion and the Transcript records the drop.
- **Read-only CLI decoupled from the server.** The `ai-meeting` binary (CLI) and the `ai-meeting-server` binary (MCP stdio) are independent processes. The CLI reads `$AI_MEETING_HOME` directly via `FileMeetingStore` and never acquires the append lock, so both can run against the same data at the same time. The CLI is the Human Operator's path to every past Meeting, including as a self-contained single-file HTML report. See [show-meeting-cli](./features/meeting/show-meeting-cli.usecase.md). The same binary also exposes a long-lived local HTTP server (`ai-meeting watch`) that streams a live view of every Meeting in a browser; the `watch` subcommand obeys the same read-only invariant and the same independence-from-the-MCP-server guarantee. See [watch-server](./features/web-viewer/watch-server.usecase.md).
- **Cross-process change detection uses polling, not in-process watchers.** The MCP server's `MeetingStorePort.watchNewEvents` is an in-process notification primitive (it wakes only callers in the same process that performed the write). The watch server is a separate process from the MCP server, so it MUST NOT use `watchNewEvents` and instead polls `readMessagesSince` and `listMeetings` at a fixed cadence. See [watch-server](./features/web-viewer/watch-server.usecase.md) → *Cross-process change detection*.

## Feature Index

- [meeting](./features/meeting/meeting.md) — Lifecycle of meetings and the MCP tool surface (start, send, get response, list, get transcript, end, cancel).
- [committee-protocol](./features/committee-protocol/committee-protocol.md) — The round-based discussion algorithm, Pass Signal, termination, and drop handling.
- [agent-integration](./features/agent-integration/agent-integration.md) — The `AgentAdapter` port and its CLI-based adapters for Codex and Claude Code.
- [persistence](./features/persistence/persistence.md) — The `MeetingStore` port and its `InMemoryStore` and `FileStore` adapters.
- [web-viewer](./features/web-viewer/web-viewer.md) — Local HTTP server (`ai-meeting watch`) that serves a self-contained SPA and SSE channels for live observation of every Meeting.
- [install](./features/install/install.md) — `ai-meeting install` CLI: copies the canonical skill file into Claude Code / Codex skills directory and registers the MCP server with each host through that host's own `mcp add` CLI.
