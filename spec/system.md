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

## Key Decisions

- **Spec-driven development.** Implementation proceeds only after this `/spec` tree is approved. Code changes that drift from the spec are rejected; the spec is updated first.
- **Vertical Slices + Hexagonal.** Each feature is a self-contained slice holding its own domain, ports, application code, and tests. External concerns enter through ports and never reach the domain directly.
- **CLI subprocess over SDK.** Both Participant types are integrated via their official CLIs rather than native SDKs. CLIs expose a stable non-interactive contract (`exec --json`, `-p --output-format json`), hide provider auth and rate-limiting, and keep adapter surface narrow.
- **Self-extinguishing committee protocol.** Discussion runs in rounds. Each round is a parallel broadcast to the active Members; Members respond seeing the full prior Transcript. A Member signals completion with `<PASS/>`. The Meeting terminates when every active Member emits `<PASS/>` in the same Round or `max_rounds` is reached. See [committee-protocol](./features/committee-protocol/committee-protocol.md).
- **Asynchronous jobs.** `send_message` never blocks on the discussion — it returns a `jobId`. The Orchestrator polls `get_response` with a Cursor to consume the Transcript delta as the Rounds advance. MCP tool-call timeouts stay bounded even when Members are slow.
- **Recursion guard for Claude Code.** When the Claude Code CLI is spawned as a Member, the adapter appends `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` to every invocation. The child Claude Code accepts MCP servers only from the supplied config, which is empty, so it cannot re-enter this (or any) MCP server and spawn another committee. See [claude-code-cli-adapter](./features/agent-integration/claude-code-cli-adapter.usecase.md).
- **Two storage adapters.** The `MeetingStore` port has an `InMemoryStore` (tests and ephemeral dev) and a `FileStore` (JSONL under `$AI_MEETING_HOME`). Both are fed by the same event log model.
- **Resilient to Member failure.** An Adapter failure drops only the affected Participant; the remaining committee continues the discussion and the Transcript records the drop.

## Feature Index

- [meeting](./features/meeting/meeting.md) — Lifecycle of meetings and the MCP tool surface (start, send, get response, list, get transcript, end, cancel).
- [committee-protocol](./features/committee-protocol/committee-protocol.md) — The round-based discussion algorithm, Pass Signal, termination, and drop handling.
- [agent-integration](./features/agent-integration/agent-integration.md) — The `AgentAdapter` port and its CLI-based adapters for Codex and Claude Code.
- [persistence](./features/persistence/persistence.md) — The `MeetingStore` port and its `InMemoryStore` and `FileStore` adapters.
