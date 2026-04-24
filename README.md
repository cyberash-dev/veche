# ai-meeting-server

An MCP server that lets an orchestrator agent (Claude Code, a custom agent, your IDE) conduct
multi-party **committee meetings** with other LLM agents and read back a structured transcript.

v1 ships two symmetric CLI-backed adapters:

- **Codex** via `codex exec` (OpenAI)
- **Claude Code** via `claude -p` (Anthropic) — with a recursion guard that prevents a child
  Claude Code from re-entering this same server

The orchestrator may be Claude Code itself, enabling
`Claude Code ↔ another Claude Code + Codex` committees. Architecture and behaviour are fully
specified in [`spec/`](spec/) using a C4-inspired four-level model; implementation follows the
spec and changes are made to the spec first.

---

## Why

LLMs collapse into a single line of reasoning on complex problems. A standing MCP tool for
pulling a second opinion from a different model (or a differently-prompted instance of the same
model) broadens the search, surfaces blind spots, and produces more balanced decisions. The
committee protocol drives the discussion to a stable point — each member either contributes or
emits `<PASS/>` — without the orchestrator having to hand-roll turn-taking.

## Install

```bash
npm install
npm run build
```

Prerequisites:

| | Required for |
|---|---|
| Node.js ≥ 20.11 | running the server |
| `codex` on `PATH` | Codex participants |
| `claude` on `PATH` | Claude Code participants |
| `CODEX_API_KEY` **or** `codex login` | Codex auth (either path works) |
| `claude login` | Claude Code auth |

## Quick start

### As an MCP server registered with Claude Code

Add this to `.mcp.json` or your Claude Code user MCP config (see
[`examples/.mcp.json.example`](examples/.mcp.json.example)):

```json
{
  "mcpServers": {
    "ai-meeting": {
      "command": "node",
      "args": ["/abs/path/to/ai-meeting/dist/bin/ai-meeting-server.js"],
      "env": {
        "AI_MEETING_STORE": "file",
        "AI_MEETING_HOME": "/Users/you/.ai-meeting",
        "AI_MEETING_LOG_LEVEL": "info"
      }
    }
  }
}
```

Then in Claude Code:

```
> start a meeting with a codex member called "coder" and another Claude Code member
  called "reviewer"; ask them whether `argparse` or `click` is the better default for a
  new Python CLI; give them up to 3 rounds.
```

Claude Code calls `start_meeting` → `send_message` → polls `get_response` until the Job
terminates, then summarises the transcript.

### Programmatically (Node)

```ts
import { bootstrap } from 'ai-meeting-server';

const { mcp, shutdown } = await bootstrap();
await mcp.connect(); // stdio — point an MCP client at the process
// ...
await shutdown();
```

## Committee protocol

One `send_message` = one `Job`. Each Job executes up to `maxRounds` (default 8, capped by
`AI_MEETING_MAX_ROUNDS_CAP`, default 16) rounds:

1. **Round 0** — the facilitator's message is appended to the transcript.
2. **Round N (N ≥ 1)** — every active member is dispatched in parallel. Each member sees every
   other member's prior messages since its own last turn. A member replies with either new
   substantive content (`speech`) or the literal token `<PASS/>` (`pass`) to opt out of the
   current round.
3. The discussion terminates when:
   - every active member emits `<PASS/>` in the same round → `all-passed`
   - `roundNumber >= maxRounds` → `max-rounds`
   - all members dropped out → `no-active-members`
   - an external `cancel_job` fired → `cancelled`

If a member's adapter fails irrecoverably, that member is **dropped** and the discussion
continues. The drop is recorded in the transcript as a `system` message so remaining members
can acknowledge the missing voice.

Full rules live in
[`spec/features/committee-protocol/`](spec/features/committee-protocol/committee-protocol.md).

## MCP tool surface

| Tool | Purpose |
|------|---------|
| `start_meeting` | Create a Meeting. Opens an adapter Session per member. |
| `send_message` | Post a facilitator message; returns `jobId` + `cursor`. Non-blocking. |
| `get_response` | Poll a Job: status + transcript delta since a cursor. Supports `waitMs`. |
| `list_meetings` | Enumerate meetings. Filter by status / time range. |
| `get_transcript` | Read a transcript outside of a Job-polling loop. |
| `end_meeting` | Close a meeting. `cancelRunningJob` terminates an in-flight Job first. |
| `cancel_job` | Abort a running Job. Graceful first (30s), forced after. |

Exact schemas and behaviour live in
[`spec/features/meeting/*.usecase.md`](spec/features/meeting/).

## Configuration

### Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_MEETING_HOME` | `~/.ai-meeting` | Root for `FileStore` data and the user config. |
| `AI_MEETING_STORE` | `file` | `file` or `memory`. |
| `AI_MEETING_LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error`. |
| `AI_MEETING_MAX_ROUNDS_CAP` | `16` | Hard clamp for `max_rounds`. |
| `CODEX_API_KEY` | — | Optional; Codex also reads `~/.codex/auth.json`. |
| `CODEX_BIN` | `codex` | Override the Codex binary. |
| `CLAUDE_BIN` | `claude` | Override the Claude Code binary. |

### Profiles

Named participant profiles live in `$AI_MEETING_HOME/config.json`
(see [`examples/config.json.example`](examples/config.json.example)):

```json
{
  "version": 1,
  "profiles": [
    {
      "name": "codex-senior",
      "adapter": "codex-cli",
      "model": "gpt-5-codex",
      "systemPrompt": "You are a senior engineer. Give concise opinions.",
      "workdir": null,
      "extraFlags": ["--skip-git-repo-check"],
      "env": {}
    }
  ]
}
```

`start_meeting.members[]` accepts either `{ profile: "codex-senior" }` or ad-hoc overrides.

### Recursion guard (Claude Code)

Every `claude -p` invocation is launched with
`--strict-mcp-config --mcp-config '{"mcpServers":{}}'` plus
`--disallowedTools=Bash,Edit,Write,NotebookEdit` by default. The child Claude Code cannot
inherit the parent's MCP configuration, so it cannot re-enter this server and spawn more
children. Participants that need extended isolation can add `--bare` via `extraFlags`
(which additionally requires `ANTHROPIC_API_KEY`).

## Development

```bash
npm run typecheck      # strict tsc across src/
npm run lint           # biome check
npm run lint:fix       # biome check --write
npm test               # vitest — unit + MCP stdio smoke
npm run build          # emit dist/
```

### End-to-end against real CLIs (opt-in)

Gated on `AI_MEETING_E2E=1` to avoid token spend on normal runs:

```bash
AI_MEETING_E2E=1 npx vitest run src/e2e/claude-code.e2e.test.ts   # ~4s
AI_MEETING_E2E=1 npx vitest run src/e2e/codex.e2e.test.ts         # ~6s
AI_MEETING_E2E=1 npx vitest run src/e2e/committee.e2e.test.ts     # ~25s
```

The committee test runs a real 3-round discussion between `codex exec` and `claude -p` through
the full pipeline (`start_meeting` → `send_message` → `DiscussionRunner` → adapters →
`get_response`).

## Architecture

Hexagonal + Vertical Slices. Every feature lives under `src/features/<feature>/` with its own
`domain/`, `application/`, `ports/`, and (for features that own ports) `adapters/`.

```
src/
├── features/
│   ├── meeting/              # 7 MCP tools, domain entities, JobRunner
│   ├── committee-protocol/   # round algorithm, pass signal, terminate/drop
│   ├── agent-integration/    # AgentAdapterPort + codex-cli, claude-code-cli, fake
│   └── persistence/          # MeetingStorePort + in-memory, file (JSONL)
├── adapters/inbound/mcp/     # MCP server (stdio), tool registration, zod schemas
├── infra/                    # DI composition root, StructuredLogger, SystemClock, UuidIdGen
├── shared/                   # branded ids, DomainError, Clock/IdGen/Logger ports
└── bin/ai-meeting-server.ts  # stdio entrypoint
```

Full specification: [`spec/system.md`](spec/system.md) → containers/features/use cases.

## Troubleshooting

- **`claude-runtime: Not logged in · Please run /login`** — run `claude login` on the host.
  Do not set `--bare` in member `extraFlags` unless you also provide `ANTHROPIC_API_KEY`.
- **`codex-generic` on every turn** — check `codex login` status or set `CODEX_API_KEY`.
- **`MeetingBusy`** — an earlier Job is still running. `get_response` to let it finish, or
  `cancel_job` to abort.
- **`Session ID <uuid> is already in use`** (direct `claude -p` test) — don't hand-craft a
  stable UUID across runs; the adapter generates a fresh one per session.
- **Empty transcript on `get_response`** — make sure you're passing `cursor` back unchanged
  each poll; advancing it is the server's job.

## License

MIT
