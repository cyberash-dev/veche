# Use Case: claude-code-cli-adapter

## Actor

Internal — concrete implementation of `AgentAdapterPort` for the Claude Code CLI. Invoked by [dispatch-turn](./dispatch-turn.usecase.md).

## Input

The Adapter implements every port method defined in [agent-integration](./agent-integration.md).

## Output

Port-conformant `Session` and `TurnResult`.

## Flow

### `capabilities`

Returns:

```
{ adapter: 'claude-code-cli', supportsWorkdir: true, supportsSystemPrompt: true }
```

### `openSession`

1. Verify `CLAUDE_BIN` (default `claude`) is resolvable on `PATH`. If not → `AdapterNotAvailable` with code `claude-binary-not-found`.
2. Generate `session.providerRef` by reusing the caller-supplied `sessionId` (which is a UUID v4 from `IdGen.newParticipantSessionId`). The adapter does not need a separate lookup from provider → session because the same id is passed back in `--session-id` / `--resume` on every Turn.
3. Do **not** probe Claude Code authentication. `claude -p` writes its own auth-failure message to stdout on Turn 1 (`subtype: error_during_execution` or similar), which the adapter maps to `claude-runtime`; the committee protocol then escalates that to a participant drop via [handle-agent-failure](../committee-protocol/handle-agent-failure.usecase.md).
4. Build the `Session`: `{ id: sessionId, adapter: 'claude-code-cli', participantId, meetingId, providerRef: sessionId, status: 'open', openedAt: Clock.now, closedAt: null }`. Persist in the adapter-local registry with an internal `hasStartedConversation = false` flag.
5. Return the `Session`.

### `sendTurn`

1. Resolve the `Session`. Fail with `AdapterNotAvailable` if `closed`.
2. Pick the conversation flag:
   - 2a. First Turn (`hasStartedConversation === false`): use `--session-id <providerRef>`. This instructs Claude Code to **create** a new conversation with the supplied UUID.
   - 2b. Subsequent Turns (`hasStartedConversation === true`): use `--resume <providerRef>`. Re-using `--session-id` on a second Turn causes Claude Code to fail with `Session ID <uuid> is already in use`, since `--session-id` is a *create-only* flag.
3. Build the argv:
   - **Always present:**
     - `-p` — print mode (non-interactive).
     - `--output-format json` — single-object JSON with a `result` field.
     - `--input-format text` — positional prompt.
     - `--strict-mcp-config` — **Recursion Guard** (part 1): only MCP servers from `--mcp-config` count.
     - `--mcp-config '{"mcpServers":{}}'` — **Recursion Guard** (part 2): zero MCP servers.
     - `--permission-mode default` — no dangerous-skip.
     - `--disallowedTools=<csv>` — see *Rules* below. The `=` form is mandatory: without it Claude Code's variadic parser consumes both the list and the positional prompt, producing `Error: Input must be provided either through stdin or as a prompt argument when using --print`.
   - **Conditional:**
     - `--model <participant.model>` when `participant.model !== null`.
     - `--append-system-prompt <content>` on Turn 1 only, where `<content>` is the resolved system prompt plus the `PASS_PROTOCOL_SUFFIX`. On Turn 2+ this flag is omitted; prior system-prompt content is already baked into the Claude Code session state.
     - `--add-dir <participant.workdir>` when `workdir !== null`.
     - Any entries in `participant.extraFlags` that pass the allow-list below.
   - **Prompt argument:** appended last as a single positional — `<promptText>`. The prompt is passed on argv, not stdin.
4. Launch the subprocess:
   - `env` = server `process.env` merged with `participant.env`, filtered against the forbidden list (`HOME`, `PATH`, `CLAUDE_BIN`, `CODEX_BIN`). Claude Code auth lives in `~/.claude/` and is inherited as-is.
   - `stdio` = `['ignore', 'pipe', 'pipe']`.
   - `signal` = `cancellationSignal`.
5. Read stdout in full (`--output-format json` produces a single final JSON object).
6. On process exit:
   - 6a. If `exitCode === 0`:
     - Parse stdout as JSON. Expect shape `{ type: 'result', subtype: 'success', result: <string>, session_id: <uuid>, ... }`.
     - If JSON parse fails → return `TurnResult { kind: 'failure', error: { code: 'claude-parse-json', retryable: false } }`.
     - If `typeof result !== 'string'` → return `TurnResult { kind: 'failure', error: { code: 'claude-parse-empty', retryable: false } }`.
     - If `subtype !== 'success'` → return `TurnResult { kind: 'failure', error: { code: 'claude-runtime', retryable: true, message: <result> } }`. This covers auth failures, network errors, and other runtime issues the CLI reports through the JSON envelope.
     - If the returned `session_id` differs from the id the adapter supplied → return `TurnResult { kind: 'failure', error: { code: 'claude-session-mismatch', retryable: false } }`.
     - Flip `hasStartedConversation = true` so subsequent Turns use `--resume`.
     - Pass `result` text into [parse-pass-signal](../committee-protocol/parse-pass-signal.usecase.md).
     - Return `{ kind, text, error: null, providerRef: <unchanged>, durationMs }`.
   - 6b. If `exitCode !== 0`:
     - `2` → `AdapterConfigInvalid { code: 'claude-usage', retryable: false }` (CLI usage error — indicates an adapter bug or unsupported flag combination).
     - `130` (SIGINT) → `AdapterTurnTimeout { code: 'claude-sigint', retryable: false }`.
     - Other → `AdapterInvocationError { code: 'claude-exit-<N>', retryable: true }`.
7. Cancellation and timeout handling match the Codex adapter: `SIGTERM` then `SIGKILL` after 2000 ms.

### `closeSession`

1. Mark the `Session` as `closed` and drop it from the adapter-local registry.
2. Terminate any in-flight subprocess via `SIGTERM`/`SIGKILL` escalation.
3. The adapter does **not** issue a separate "forget session" call to Claude Code. The CLI manages its own session store under `~/.claude/`; untouched sessions expire according to Claude Code's own TTL policy.

## Errors

| `error.code` | Source |
|--------------|--------|
| `claude-binary-not-found` | `openSession` — `CLAUDE_BIN` is not on `PATH`. |
| `claude-parse-json` | stdout did not contain valid JSON. |
| `claude-parse-empty` | JSON parsed but `result` is missing/non-string. |
| `claude-session-mismatch` | Returned `session_id` differs from the id the adapter supplied. |
| `claude-runtime` | Exit 0 but `subtype !== 'success'`. Typical cause: missing auth (`Not logged in · Please run /login`), quota, network. |
| `claude-usage` | Exit code 2 — invalid CLI usage. |
| `claude-sigint` | Exit code 130 — killed by signal before completion. |
| `claude-cancelled` | `cancellationSignal` fired. |
| `claude-exit-<N>` | Generic non-zero exit. |

## Side Effects

- Spawns one `claude -p` subprocess per `sendTurn` call.
- Creates a Claude Code session record on disk under `~/.claude/` on Turn 1 (the CLI writes and updates these session files itself).

## Rules

- **Recursion Guard is load-bearing.** `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` MUST be present on every Turn. A child Claude Code must never inherit this server's MCP configuration, or it would recurse into another `start_meeting` and spawn more children indefinitely. Integration tests verify the flags are present in the spawned argv.
- **`--session-id` creates, `--resume` continues.** The adapter's `hasStartedConversation` flag decides which form to emit. This is a behavioural property of the Claude Code CLI, not a convention — reusing `--session-id` on a second Turn fails with `Session ID <uuid> is already in use`.
- **`--disallowedTools` must use the `=` form.** The CLI declares this flag as variadic (`<tools...>`), which consumes every subsequent token until the next flag — including the positional prompt. The adapter emits `--disallowedTools=Bash,Edit,Write,NotebookEdit` as a single argv entry so the list is bound to the flag only.
- **Disallowed tool list.** By default the adapter passes `--disallowedTools=Bash,Edit,Write,NotebookEdit`. Rationale: a Member Claude Code spawned for a committee discussion should not be editing files on disk — the Meeting is a reasoning exercise, not a coding session. A Participant may override by listing `--allowedTools <list>` or `--disallowedTools <list>` in `extraFlags`; when either flag is present, the adapter does **not** prepend its default.
- **No `--bare` by default.** `--bare` disables auto-memory, CLAUDE.md discovery, plugin sync, keychain reads, and — critically — OAuth authentication (`--bare` restricts Claude Code to `ANTHROPIC_API_KEY` / `apiKeyHelper` only). Enabling it by default would break the common case where operators rely on their existing `claude login`. Participants that need the additional isolation can opt in by adding `--bare` to `extraFlags`; they must then also provide `ANTHROPIC_API_KEY` or an `apiKeyHelper` via `--settings`.
- **No auth pre-probe.** The adapter does not run `claude auth status` at startup. Auth failures arrive as `claude-runtime` outcomes on the first Turn and are converted into participant drops by the committee protocol. This avoids a spurious startup RTT and keeps the adapter's availability contract narrow: "binary on `PATH`" is a necessary and sufficient pre-flight check.
- **Allow-listed `extraFlags`:**
  - `--allowedTools <list>` / `--disallowedTools <list>` — override the default tool policy.
  - `--append-system-prompt <content>` — advanced, stacks after the adapter's own append on Turn 1.
  - `--max-budget-usd <number>`
  - `--effort low|medium|high|xhigh|max`
  - `--agent <name>`
  - `--setting-sources <list>` (strongly discouraged — can weaken the recursion guard if it enables external MCP config)
  - `--verbose`
  - `--no-session-persistence` (stateless Turns; not useful with multi-Round because resume relies on disk state)
  - `--bare` (opt-in; requires `ANTHROPIC_API_KEY` or an `apiKeyHelper`)
  Any flag outside this allow-list fails `openSession` with `AdapterConfigInvalid`.
- **Environment handling.** `HOME` and `PATH` are always inherited. `CLAUDE_BIN` is consumed by the adapter itself, not forwarded. `participant.env` can override any non-forbidden key.
- **Model override** is passed via `--model` when `participant.model` is non-null.
- **No `--continue`.** The adapter relies exclusively on `--session-id` (Turn 1) and `--resume` (Turn 2+) for continuity. `--continue` is interactive-only semantics (most-recent conversation), incompatible with the deterministic Meeting model.
