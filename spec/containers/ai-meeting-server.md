# Container: ai-meeting-server

## Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js ≥ 20.11 (LTS `iron`) |
| Language | TypeScript 5.x, `strict` = true, `noUncheckedIndexedAccess` = true |
| Module system | ESM (`"type": "module"`) |
| MCP transport | `@modelcontextprotocol/sdk` — stdio transport only |
| Process spawning | Node built-in `node:child_process` (`spawn`) |
| Filesystem | `node:fs/promises`; JSONL with `O_APPEND` semantics for FileStore |
| Schema validation | `zod` for MCP tool input validation |
| Testing | `vitest` (unit), `vitest` + filesystem tmpdir (adapter integration) |
| Lint / format | `biome` (lint + format) |
| Build | `tsc` emitting ESM `dist/` |
| Binary entries | `bin/ai-meeting-server.js` — stdio MCP server. `bin/ai-meeting.js` — human-operator CLI for reading transcripts; read-only; reads `$AI_MEETING_HOME` directly via `FileMeetingStore`; does not open a network socket. |
| CLI dependencies | The `ai-meeting` CLI uses Node built-ins only (`process.stdout`, `process.stderr`, `node:fs/promises`, `node:os`, `node:child_process`, `node:crypto`). No new npm dependencies beyond those listed above. |

External binaries (resolved via `PATH`):

| Binary | Minimum version | Purpose |
|--------|-----------------|---------|
| `codex` | the version that supports `exec resume <SESSION_ID>` and `--json` | Codex Participant adapter |
| `claude` | the version that supports `--session-id`, `--resume`, `--strict-mcp-config`, `--mcp-config`, and `--disallowedTools` | Claude Code Participant adapter |

## Architecture

**Pattern:** Hexagonal (Ports and Adapters) + Vertical Slices.

- Each vertical slice lives under `src/features/<feature>/` and owns its domain, application (use cases), ports, and application-level tests.
- Inbound adapters (MCP) live under `src/adapters/inbound/`. Outbound adapters (agent CLIs, storage) live under the feature that owns the port.
- Domain code imports nothing from `adapters/` or `infra/`. Application code imports from `domain/` and `ports/` only. Adapter code imports from `ports/` (the interface it implements) but never from another adapter.

## Slice Structure

```
src/
  features/
    meeting/
      domain/                       pure entities and invariants
      application/                  use-case handlers, one per MCP tool
      ports/                        interfaces consumed by this feature
      index.ts                      barrel: public surface of the slice
    committee-protocol/
      domain/                       Round state, Pass Signal parsing rules
      application/                  round orchestrator, failure handler, terminator
      ports/                        re-exports AgentAdapter from agent-integration
      index.ts
    agent-integration/
      domain/                       Session, Turn, TurnResult, Profile
      application/                  dispatch-turn use case, profile resolver
      ports/                        AgentAdapterPort
      adapters/
        codex-cli/                  CodexCliAgentAdapter
        claude-code-cli/            ClaudeCodeCliAgentAdapter
      index.ts
    persistence/
      domain/                       Event model, Cursor
      application/                  event-log reducers
      ports/                        MeetingStorePort
      adapters/
        in-memory/                  InMemoryMeetingStore
        file/                       FileMeetingStore
      index.ts
  adapters/
    inbound/
      mcp/                          MCP server, tool registration, zod schemas
      cli/                          human-operator CLI (read-only transcript viewer)
        AiMeetingCli.ts             argv parser + command dispatcher
        commands/
          list.ts                   `ai-meeting list` — renders MeetingSummary[]
          show.ts                   `ai-meeting show <id>` — renders a Transcript
        renderers/
          text.ts                   TTY-oriented, optional ANSI colors
          html.ts                   self-contained HTML report (inline CSS, no remote refs)
          markdown.ts               GitHub-Flavored Markdown
          json.ts                   stable-order JSON snapshot
  infra/
    config.ts                       config loader (env + user config file)
    logger.ts                       structured logger (pino-compatible interface)
    clock.ts                        SystemClock adapter
    id-gen.ts                       UuidIdGen adapter
    bootstrap.ts                    wires DI graph and returns an MCP server
  bin/
    ai-meeting-server.ts            stdio entrypoint → bootstrap() → listen
    ai-meeting.ts                   CLI entrypoint → loadConfig() + FileMeetingStore + AiMeetingCli
```

## Shared Code

```
src/shared/
  errors/                           base domain error classes (DomainError, ValidationError)
  types/                            branded ids (MeetingId, JobId, MessageId, ParticipantId)
  ports/                            Clock, IdGen, Logger
```

## Naming Conventions

- **Entities** are pure classes, no ORM or framework decorators. File name equals the entity name: `Meeting.ts`, `Participant.ts`.
- **Ports** are TypeScript `interface` or `abstract class` declarations with suffix `Port`: `AgentAdapterPort`, `MeetingStorePort`. File name equals the port name.
- **Adapters** are named by technology + port: `CodexCliAgentAdapter`, `ClaudeCodeCliAgentAdapter`, `InMemoryMeetingStore`, `FileMeetingStore`.
- **Use-case handlers** are classes with suffix `UseCase`: `StartMeetingUseCase`, `SendMessageUseCase`. File name equals the class.
- **Errors** are domain-level classes ending in `Error`: `MeetingNotFound`, `ParticipantAlreadyEnded`, `AdapterTurnTimeout`. Framework error types (e.g. `Error` subclasses from MCP SDK) stay at the adapter boundary and are mapped to domain errors before entering application code.
- **Variables**
  - Boolean fields and locals are named as questions: `isActive`, `hasDropped`, `canAcceptTurn`.
  - Query methods return values and carry no side effects — named as nouns: `Meeting.transcript()`, `Job.status()`.
  - Command methods return `void`, carry side effects — named as verbs: `Meeting.addMessage(...)`, `Job.markCompleted()`.
  - Predicate methods return booleans — named as questions: `Round.isSettled()`, `Participant.hasDropped()`.
- One file holds one public class or type. Private helpers may share a file only when they are used nowhere else.

## Configuration

**Environment variables:**

| Env variable | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `AI_MEETING_HOME` | absolute path | No | `${HOME}/.ai-meeting` | Root directory for `FileStore` data and the user config file. |
| `AI_MEETING_LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` | No | `info` | Log level for structured logs to stderr. |
| `AI_MEETING_STORE` | `memory` \| `file` | No | `file` | Which `MeetingStore` adapter to mount. |
| `AI_MEETING_MAX_ROUNDS_CAP` | integer ≥ 1 | No | `16` | Hard cap enforced on `send_message.max_rounds`; a larger request is clamped. |
| `CODEX_API_KEY` | string | No | — | Forwarded to `codex exec` via its environment. Codex also accepts credentials from a prior `codex login` (i.e. `~/.codex/auth.json`); either path is sufficient. The adapter does not probe for credentials at startup — missing auth surfaces as a non-zero `codex exec` exit at Turn dispatch, which the committee protocol converts into a participant drop. |
| `CODEX_BIN` | path or bare command | No | `codex` | Overrides the Codex CLI binary used by `CodexCliAgentAdapter`. |
| `CLAUDE_BIN` | path or bare command | No | `claude` | Overrides the Claude Code CLI binary used by `ClaudeCodeCliAgentAdapter`. |

**User config file** — JSON at `${AI_MEETING_HOME}/config.json`. Schema and override rules live in [agent-integration](../features/agent-integration/agent-integration.md) under *Profile*.

## MCP Tool Catalogue

Every tool input and output shape is defined in the linked use case file. No tool surface exists outside this table.

| Tool name | Kind | Use case |
|-----------|------|----------|
| `start_meeting` | Command | [start-meeting](../features/meeting/start-meeting.usecase.md) |
| `send_message` | Command | [send-message](../features/meeting/send-message.usecase.md) |
| `get_response` | Query | [get-response](../features/meeting/get-response.usecase.md) |
| `list_meetings` | Query | [list-meetings](../features/meeting/list-meetings.usecase.md) |
| `get_transcript` | Query | [get-transcript](../features/meeting/get-transcript.usecase.md) |
| `end_meeting` | Command | [end-meeting](../features/meeting/end-meeting.usecase.md) |
| `cancel_job` | Command | [cancel-job](../features/meeting/cancel-job.usecase.md) |

## Dependency Rules

| Layer | May import from |
|-------|-----------------|
| `domain/` | `shared/types`, `shared/errors` only |
| `application/` | own `domain/`, `ports/`, `shared/types`, `shared/errors` |
| `ports/` | `domain/`, `shared/types` |
| `adapters/` | the port they implement, plus `shared/types`, `shared/errors` |
| `adapters/inbound/mcp/` | feature `application/` entrypoints and `ports/` (for injection types) |
| `infra/` | any layer — this is the composition root |

Cross-slice imports go through the slice `index.ts` barrel. A slice never imports another slice's `domain/` directly.

## Logging

- All logs are structured JSON on stderr. stdout is reserved for the MCP framing.
- Every log line carries at minimum: `ts`, `level`, `event`, plus context fields relevant to the event.
- Key events: `meeting.created`, `job.started`, `round.started`, `round.completed`, `participant.dropped`, `adapter.turn.started`, `adapter.turn.completed`, `adapter.turn.failed`, `job.completed`, `job.cancelled`.
