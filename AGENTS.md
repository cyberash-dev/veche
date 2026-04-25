# AGENTS.md

Conventions for any AI agent (Codex, Claude Code, Cursor, Aider, …) editing this repository.
This file is the single source of truth; `CLAUDE.md` points here.

## The non-negotiable rule

**Spec-Driven Development.** The specification in `spec/` is the contract. Code that diverges
from the spec is a bug.

The workflow for any non-trivial change is:

1. Read the relevant spec file(s).
2. **Update the spec first.** Get human approval if the change is substantive.
3. Only then modify code to match.
4. Run `npm run typecheck && npm test && npm run lint` before declaring done.

Trivial changes (typo, obvious one-line fix, dependency bump) can skip step 2. When in doubt,
change the spec first.

## Project layout

```
ai-meeting/
├── spec/                  ← authoritative contract (C4-inspired 4 levels)
│   ├── system.md          L1 — system overview, key decisions
│   ├── glossary.md        domain terms (every term used anywhere else must be here)
│   ├── c4-model.md        mermaid C4 diagrams (Context/Container/Component)
│   ├── containers/
│   │   └── ai-meeting-server.md   L2 — stack, conventions, env vars, tool catalog
│   └── features/
│       ├── meeting/       7 MCP tools + 2 CLI commands (list, show)
│       ├── committee-protocol/   round algorithm, pass, terminate, drop
│       ├── agent-integration/    AgentAdapterPort + Codex CLI + Claude Code CLI
│       └── persistence/          MeetingStorePort + in-memory + file
├── src/                   ← implementation (mirrors spec/)
│   ├── adapters/inbound/mcp/     ← MCP server (stdio)
│   ├── adapters/inbound/cli/     ← human-operator CLI (list, show) + renderers
│   ├── bin/ai-meeting-server.ts  ← stdio MCP entrypoint
│   └── bin/ai-meeting.ts         ← CLI entrypoint
├── examples/              ← sample .mcp.json, config.json
├── dist/                  ← build output (committed in CI, not locally)
└── node_modules/
```

Navigation: from `system.md` any use case is reachable in ≤ 3 file reads.

## Architecture

**Hexagonal + Vertical Slices.**

- Each feature under `src/features/<feature>/` owns its domain, ports, application code, and
  (if it owns ports) adapters.
- Domain code imports only from `shared/`. Never from `adapters/` or `infra/`.
- Application code imports from own `domain/` and `ports/`. Never from another feature's
  domain directly — cross-slice imports go through the barrel `index.ts`.
- Adapters implement a port. They never import another adapter.
- `infra/` is the composition root; it may import anything.

Dependency table lives in `spec/containers/ai-meeting-server.md` → *Dependency Rules*.

## Naming conventions

- **Entities** are pure classes — no ORM/framework decorators. File name = entity name
  (`Meeting.ts`, `Participant.ts`).
- **Ports** are interfaces or abstract classes with suffix `Port` (`AgentAdapterPort`,
  `MeetingStorePort`). File name = port name.
- **Adapters** are named `<Technology><Port>` (`CodexCliAgentAdapter`, `InMemoryMeetingStore`,
  `FileMeetingStore`).
- **Use cases** are classes with suffix `UseCase` (`StartMeetingUseCase`). File name = class
  name.
- **Errors** are domain-level classes ending in `Error` (`MeetingNotFound`,
  `AdapterTurnTimeout`). Framework error types stay at the adapter boundary.
- **Variables**
  - Booleans as questions: `isActive`, `hasDropped`, `canAcceptTurn`.
  - Query methods return values, zero side effects — noun-named (`Meeting.transcript()`).
  - Command methods return `void`, have side effects — verb-named (`Meeting.addMessage(...)`).
  - Predicates — question-named (`Round.isSettled()`).

One file = one public class/type. Private helpers may share a file only if used nowhere else.

## Coding rules

- **Do not add code comments by default.** Well-named identifiers document intent. Add a
  comment only when the *why* is non-obvious (hidden constraint, subtle invariant, workaround
  for a specific CLI bug). Never explain *what* the code does.
- **Do not add features, refactors, or abstractions beyond what the task requires.** Three
  similar lines is better than a premature abstraction.
- **Do not add validation for impossible states.** Validate at system boundaries (MCP input,
  CLI output), trust internal code.
- **Do not add backwards-compat shims.** Change the code instead.
- **Do not delete unfamiliar state.** Investigate before overwriting.
- **Do not bypass hooks (`--no-verify`) or sign-off** unless the user explicitly asks.

## Tests

- Unit tests live next to the code: `Foo.test.ts` next to `Foo.ts`.
- Integration tests for a slice live under `src/features/<slice>/.../__tests__/`.
- E2E tests that spawn real CLI subprocesses live under `src/e2e/` and MUST be gated on
  `process.env.AI_MEETING_E2E === '1'` (use `const d = runE2e ? describe : describe.skip;`).
  They are skipped by default because they consume tokens.
- Prefer `InMemoryMeetingStore` + `FakeAgentAdapter` for unit/integration tests.
- Use the fixed `FakeClock` + `FakeIdGen` from `src/test-utils/` so tests are deterministic.

## Commands

```bash
npm run typecheck      # tsc --noEmit, must pass
npm test               # vitest run — default suite excludes gated e2e
npm run lint           # biome check
npm run lint:fix       # biome check --write --unsafe
npm run build          # emit dist/
AI_MEETING_E2E=1 npx vitest run src/e2e/committee.e2e.test.ts   # opt-in real CLI run
```

Before declaring a change done: `npm run typecheck && npm test && npm run lint` must all pass.

## CLI invariants (`src/adapters/inbound/cli/`)

The `ai-meeting` CLI is a second inbound adapter (alongside MCP) that reads the event log via
`FileMeetingStore`. Keep these invariants intact when touching anything under
`src/adapters/inbound/cli/`:

- **Read-only against the store.** The CLI MUST NOT call `createMeeting`, `appendMessage`,
  `appendSystemEvent`, `markParticipantDropped`, `createJob`, `updateJob`, or `endMeeting`.
  Safety of concurrent `ai-meeting` + `ai-meeting-server` processes depends on this.
- **HTML output is self-contained.** `renderers/html.ts` must emit zero `<script>` tags, no
  `<link rel="stylesheet">`, and no `src="http…"` / `href="http…"` references. All strings
  originating from user / model content flow through `escapeHtml` from `renderers/helpers.ts`.
  `src/adapters/inbound/cli/__tests__/renderers.test.ts` asserts this with regex probes — do
  not weaken those assertions when editing the template.
- **No new npm deps for the CLI.** `AiMeetingCli.ts` hand-rolls argv parsing (no `yargs`,
  `commander`, `minimist`). Renderers are pure functions on Node built-ins only
  (`node:crypto` for the SHA-1 HSL colour, `node:fs/promises` for atomic writes,
  `node:child_process` for `--open`). If a dep feels needed, ask first.
- **Atomic `--out` writes.** Always write `<path>.tmp-<pid>-<ts>` and `rename()` onto the
  target. Never truncate the destination in place.
- **Deterministic participant colours.** `participantColor` in `renderers/helpers.ts` is a
  pure function of `participantId` (SHA-1 → HSL hue), facilitator always neutral. Tests snap
  on determinism — do not introduce randomness or time-dependency.
- **Exit codes are part of the contract.** `0` success · `1` unhandled · `2` store or
  filesystem error · `3` meeting not found · `64` usage error. `cli.integration.test.ts`
  exercises each. If you add a failure mode, pick one of these and document it in
  `spec/features/meeting/show-meeting-cli.usecase.md` *first*.

## WatchServer invariants (`src/adapters/inbound/web/`)

The `ai-meeting watch` subcommand is a third inbound adapter (alongside MCP and the static
CLI commands) that exposes the event log via a local HTTP server with SSE. It runs in a
different process from `ai-meeting-server`. The CLI invariants above apply in full. Plus:

- **Read-only against the store.** Same as the rest of the CLI. The integration test injects
  a mock store that throws on every write method and asserts no SSE channel or JSON handler
  trips them.
- **Never call `MeetingStorePort.watchNewEvents` from the watch path.** `watchNewEvents` is
  an in-process notification primitive — it does NOT observe writes performed by another
  process (e.g. the MCP server appending events). Cross-process change detection uses
  polling (`750 ms`) of `listMeetings` and `readMessagesSince` instead. Reviewers must reject
  any PR that wires `watchNewEvents` into the watch path.
- **Loopback-only by default.** Bind to `127.0.0.1`. `--host` for any non-loopback address
  prints a stderr warning. There is no auth in v1; exposing the port wider is the operator's
  explicit choice.
- **DNS rebind guard.** When bound to loopback, every HTTP request whose `Host:` header is
  not `localhost(:port)` / `127.0.0.1(:port)` / `[::1](:port)` is rejected with `421`.
- **No CORS headers.** The viewer is single-origin loopback; cross-origin browsers cannot
  read its responses.
- **No new npm deps.** `node:http`, `node:url`, `node:crypto`, `node:child_process`. The SPA
  uses `EventSource`, the DOM, and inline CSS only — no framework, no bundler.
- **SPA hygiene.** Exactly one inline `<script>` block (SSE consumer) and one inline
  `<style>` block. No `<script src=…>`, no `<link rel="stylesheet">`, no remote `href` / `src`,
  no web fonts. Store-derived strings reach the DOM via `textContent` / attribute setters,
  **except** for `Message.htmlBody` of `speech` messages — those are assigned via `innerHTML`
  because the server-side escape-then-transform Markdown converter
  (`src/shared/markdown.ts`) is the same pipeline backing `show --format=html` and makes
  raw-HTML injection impossible. No other field uses `innerHTML`.
- **Exit codes.** `0` graceful (SIGINT / SIGTERM) · `2` bind / store error · `64` usage
  error. (`1` and `3` are not used by `watch`.)
- **Polling cadence is not user-tunable.** `WATCH_POLL_MS = 750` is a constant. Change
  requires a spec PR.

## Recursion guard (Claude Code adapter)

Every `claude -p` invocation from the adapter MUST include
`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`. This is a load-bearing invariant
documented in `spec/features/agent-integration/claude-code-cli-adapter.usecase.md`. If you
refactor the adapter, preserve these flags and add a test asserting they appear in the argv.

Rationale: a Claude Code orchestrator can spawn a Claude Code member; without the guard, the
child would load this MCP server again and recurse indefinitely.

## Codex CLI resume semantics

`codex exec` and `codex exec resume <SESSION_ID>` accept **different** flag sets. On resume
the thread already has its sandbox/cwd/instructions fixed; passing `--sandbox`, `--cd`, or
`-c instructions=...` on resume causes `error: unexpected argument '<flag>' found`. The
adapter branches on `session.providerRef !== null` and emits only `--json`, `-o`, `--model`,
and allow-listed feature flags on resume. Don't regress this.

## Claude Code create-vs-resume semantics

Turn 1: `claude -p --session-id <uuid>` (creates a new conversation with that id).
Turn N ≥ 2: `claude -p --resume <uuid>` (continues it).

Reusing `--session-id` on a second turn produces `Session ID <uuid> is already in use`. The
adapter tracks `hasStartedConversation` per Session to pick the right flag.

Also: `--disallowedTools` is variadic and consumes any subsequent positional, including the
prompt. Always pass it as `--disallowedTools=<csv>` (single argv token with `=`).

## How to extend with a new adapter

Walkthrough lives in
`spec/features/agent-integration/agent-integration.md`. Short version:

1. Add the new `AdapterKind` literal to
   `src/features/meeting/domain/Participant.ts` and re-check every union switch the compiler
   flags. Update the spec first.
2. Create `src/features/agent-integration/adapters/<new>/` with `NewAdapter` implementing
   `AgentAdapterPort`.
3. Add it to the registry in `src/infra/bootstrap.ts`.
4. Add a `capabilities()` entry + allow-listed `extraFlags` in `ProfileResolver`.
5. Write an opt-in e2e test under `src/e2e/<new>.e2e.test.ts` gated on `AI_MEETING_E2E`.
6. Update `spec/features/agent-integration/agent-integration.md` and write a dedicated
   `spec/features/agent-integration/<new>-adapter.usecase.md`.

## Memory

Cross-session memory lives in `~/.claude/` for Claude Code users. Do not commit anything
learned there into the repo unless it's spec-worthy.

## If you break the build

- Do not silence errors with `any` casts, `@ts-expect-error`, or unjustified `!` assertions.
- Non-null assertions in this codebase are permitted only at places where an upstream
  validator has already guaranteed the value. If you add a new `!`, document in comment why
  the value is guaranteed.
- If tsc complains about `exactOptionalPropertyTypes`, the fix is usually to reshape the
  object with `...(foo !== undefined ? { foo } : {})` spreads rather than `foo: foo ?? undefined`.

## Questions to ask before coding

1. Does the spec cover this change? (If no → update the spec first.)
2. Is there an existing port/adapter/use-case that already does 80% of what I need? (Reuse.)
3. Which vertical slice does this belong to? (Don't cross-contaminate.)
4. Can I write the test first? (Usually yes for anything touching committee-protocol or
   adapter output.)
