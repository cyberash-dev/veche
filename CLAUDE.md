# CLAUDE.md

Project-level guidance for Claude Code sessions on this repository.

## Start here

**Read [`AGENTS.md`](AGENTS.md) first.** It holds the canonical conventions (architecture,
naming, spec-driven workflow, testing rules). This file only adds Claude-Code-specific
context.

## Two cardinal rules

1. **Spec before code.** The contract is in `spec/`. If a change touches behaviour, update the
   spec file(s) first, show me the diff, wait for approval, then modify code.
2. **No divergence.** Code and spec must match at all times. If you find a divergence while
   working on something else, flag it — don't silently "fix" one side.

## Where to look

| I want to… | Read this |
|---|---|
| Understand the system | [`spec/system.md`](spec/system.md) |
| Find the MCP tool schema for `send_message` | [`spec/features/meeting/send-message.usecase.md`](spec/features/meeting/send-message.usecase.md) |
| See how a round is actually executed | [`spec/features/committee-protocol/run-round.usecase.md`](spec/features/committee-protocol/run-round.usecase.md) |
| Add a new LLM adapter | [`spec/features/agent-integration/agent-integration.md`](spec/features/agent-integration/agent-integration.md) |
| Change the CLI output format / add a renderer | [`spec/features/meeting/show-meeting-cli.usecase.md`](spec/features/meeting/show-meeting-cli.usecase.md) |
| Touch `list` or `show` command logic | `src/adapters/inbound/cli/commands/{list,show}.ts` |
| Touch the live web viewer (`veche watch`) | [`spec/features/web-viewer/watch-server.usecase.md`](spec/features/web-viewer/watch-server.usecase.md) and `src/adapters/inbound/web/*` |
| Touch the install / setup command (`veche install`) | [`spec/features/install/install-cli.usecase.md`](spec/features/install/install-cli.usecase.md), `src/adapters/inbound/cli/commands/install.ts`, canonical skill at `skills/veche/SKILL.md` |
| Touch HTML / text / markdown / json rendering | `src/adapters/inbound/cli/renderers/*.ts` (pure functions) |
| See the DI wiring | `src/infra/bootstrap.ts` (MCP) or `src/bin/veche.ts` (CLI) |
| Launch an e2e against real CLIs | `src/e2e/*.e2e.test.ts` (opt-in via `VECHE_E2E=1`) |

## Claude-Code-specific conventions

- **`claude-code-cli-adapter` is sensitive to CLI flag shapes.** If you change the adapter,
  re-read [`spec/features/agent-integration/claude-code-cli-adapter.usecase.md`](spec/features/agent-integration/claude-code-cli-adapter.usecase.md)
  for the known landmines (`--session-id` vs `--resume`, `--disallowedTools=` with `=`,
  recursion guard flags).
- **Don't set `--bare` by default.** `--bare` in the adapter breaks OAuth login for most
  users; the recursion guard is provided by `--strict-mcp-config --mcp-config {"mcpServers":{}}`
  alone. `--bare` is opt-in via `extraFlags`.
- **This project's committee can be entered by a Claude Code orchestrator and have Claude Code
  as a member.** The recursion guard is what makes that safe. If you ever see a nested
  `start_meeting` from a child process, something is wrong with the guard — debug, don't paper
  over.

## Recommended tools in this repo

Because the spec is substantial, prefer semantic navigation:

- `mcp__code-skeleton__get_outline` for a file's structure before reading.
- `LSP.goToDefinition` / `LSP.findReferences` / `LSP.hover` for "where is X" / "who calls Y" /
  "type of Z" questions.
- Plain `Read` only when you need exact content for an `Edit`.

## Running things

```bash
npm run typecheck && npm test && npm run lint      # must pass before finishing
npm run build                                       # emit dist/
VECHE_E2E=1 npx vitest run src/e2e             # real CLIs (uses tokens)
```

## Handoff etiquette

- Keep your diffs small and focused. One spec change ↔ one code change ↔ one test change.
- When you finish a task, say what you did in two sentences (one for the outcome, one for the
  risk or follow-up). No essays.
- Don't open documentation files (`README.md`, `CLAUDE.md`, `AGENTS.md`) unless the task
  explicitly asks for it.

## Past decisions worth not re-litigating

These are documented in the spec; I mention them so Claude Code sessions don't re-discover
them by trial and error:

- `codex exec resume` rejects `--sandbox`, `--cd`, and `-c instructions=...`. Branch on
  `isResume` in the adapter.
- Claude Code's `--disallowedTools` is variadic; use `--disallowedTools=<csv>`.
- `--session-id` creates; `--resume` continues. Re-using `--session-id` fails.
- `CODEX_API_KEY` is optional; `~/.codex/auth.json` is accepted too. The adapter doesn't
  probe auth — the first failing turn drops the participant.
- `InMemoryMeetingStore` is for tests and ephemeral dev; `FileMeetingStore` is the default.
- The Job runner is fire-and-forget: `send_message` returns immediately with a `jobId`; the
  discussion runs in the background until terminal.
- The `veche` CLI (`src/adapters/inbound/cli/`) is **read-only** and decoupled from the
  MCP server — both processes can safely run against the same `$VECHE_HOME`. Never call
  a write method on the store from CLI code. This applies to the `watch` subcommand too —
  `WatchServer` is just another inbound adapter, never a writer.
- The HTML renderer MUST stay self-contained: no `<script>`, no remote `href`/`src`, all
  user text through `escapeHtml`. Tests in
  `src/adapters/inbound/cli/__tests__/renderers.test.ts` enforce this with regex probes.
  The `watch` SPA at `src/adapters/inbound/web/spa/index.html.ts` allows exactly **one** inline
  `<script>` block (it needs JS to consume SSE) and exactly one inline `<style>`; everything
  else (`<script src=…>`, `<link rel="stylesheet">`, remote `href`/`src`) stays banned.
- `WatchServer` runs in a **different process** from the MCP server, so it MUST NOT call
  `MeetingStorePort.watchNewEvents` (an in-process notification primitive). Cross-process
  change detection in the watch path is via 750 ms polling of `listMeetings` and
  `readMessagesSince`. See `spec/features/web-viewer/watch-server.usecase.md` →
  *Cross-process change detection*.
- The CLI hand-rolls argv parsing (no `yargs` / `commander` / `minimist`). If you think you
  need one of those, you probably don't. Same applies to the watch path — `node:http` and
  `EventSource` are the whole stack, no Express / Fastify / framework.
