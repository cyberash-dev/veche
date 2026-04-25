# Use Case: codex-cli-adapter

## Actor

Internal — concrete implementation of `AgentAdapterPort` for the Codex CLI. Invoked by [dispatch-turn](./dispatch-turn.usecase.md).

## Input

The Adapter implements every port method defined in [agent-integration](./agent-integration.md). Inputs are specified there; this document focuses on what the adapter does with them.

## Output

Port-conformant `Session` and `TurnResult`. Provider-specific contracts captured below.

## Flow

### `capabilities`

Returns:

```
{ adapter: 'codex-cli', supportsWorkdir: true, supportsSystemPrompt: true }
```

### `openSession`

1. Verify `CODEX_BIN` (default `codex`) is resolvable on `PATH`. If not → `AdapterNotAvailable` with code `codex-binary-not-found`.
2. Do **not** probe credentials. Codex accepts authentication from either `CODEX_API_KEY` (the CI path) or `~/.codex/auth.json` (the `codex login` path); the adapter lets `codex exec` itself report an auth failure on Turn 1 via a non-zero exit, which the committee protocol escalates to a participant drop via [handle-agent-failure](../committee-protocol/handle-agent-failure.usecase.md).
3. Build the new `Session` object: `{ id: sessionId, adapter: 'codex-cli', participantId, meetingId, providerRef: null, status: 'open', openedAt: Clock.now, closedAt: null }`.
4. Persist the `Session` in an adapter-local registry keyed by `sessionId` for subsequent `sendTurn` calls. No subprocess is spawned here; Codex creates the thread on Turn 1.
5. Return the `Session`.

### `sendTurn`

1. Resolve the `Session` from the adapter-local registry; fail with `AdapterNotAvailable { code: 'codex-session-closed' }` if it is `closed`.
2. Prepare a temporary file path for `--output-last-message`: `os.tmpdir() + '/veche-codex-<randomSuffix>/last.txt'`.
3. Decide between **initial invocation** and **resume** based on `session.providerRef`:
   - **Turn 1** (`providerRef === null`):
     `codex exec --json -o <tmpPath> [--model <model>] --sandbox <sandbox> [--cd <workdir>] [-c instructions=<systemPromptJson>] <extraFlags…> <promptText>`
   - **Turn N ≥ 2** (`providerRef !== null`):
     `codex exec resume <providerRef> --json -o <tmpPath> [--model <model>] <extraFlags…> <promptText>`

   The flag split is **not cosmetic** — `codex exec resume` rejects `--sandbox`, `--cd`, and `-c instructions=...` because the sandbox, working directory, and system prompt are inherited from the thread created in Turn 1. Passing them produces `error: unexpected argument '--sandbox' found` and a non-zero exit. The adapter therefore emits these flags only on Turn 1; on resume it emits only the small set that the CLI accepts on both subcommands (`--json`, `-o`, `--model`, allow-listed feature flags).
4. `<sandbox>` defaults to `read-only`. A Participant may upgrade via the `extraFlags` allow-list below.
5. `--cd` is passed only when `workdir` is non-null and only on Turn 1; subsequent Turns execute in the original cwd recorded by the thread.
6. `<promptText>` is provided as a positional argument — **not** via stdin — so Codex treats the whole string as the task.
7. Launch the subprocess with:
   - `env` = server `process.env` merged with `participant.env`, filtered against the forbidden list (`HOME`, `PATH`, `CLAUDE_BIN`, `CODEX_BIN`). `CODEX_API_KEY` is inherited as-is when present.
   - `stdio` = `['ignore', 'pipe', 'pipe']`.
   - `signal` = `cancellationSignal`.
8. Read stdout as UTF-8 and parse it as JSONL. Track events:
   - `thread.started { thread_id }` → capture `thread_id`. On Turn 1 this becomes `Session.providerRef`.
   - `item.completed { item: { type: 'assistant_message', text } }` → remember the latest assistant message (overwrites previous). Used as a fallback when `-o` yields no content.
   - `turn.completed` → end-of-turn marker.
   - `error { message, code? }` → remember the last error.
9. When the subprocess exits:
   - 9a. If `exitCode === 0`:
     - Read the final message from `<tmpPath>` (authoritative, since `-o` writes it atomically).
     - If `<tmpPath>` is unreadable, fall back to the last `item.completed` text captured in step 8.
     - If both are absent → `AdapterParseError { code: 'codex-parse-empty', retryable: false }`.
     - Construct `TurnResult` with `kind` delegated to [parse-pass-signal](../committee-protocol/parse-pass-signal.usecase.md) (`speech` or `pass`).
     - Delete the temp directory (best-effort).
     - Return `{ kind, text, error: null, providerRef: <captured thread_id or prior>, durationMs }`.
   - 9b. If `exitCode !== 0`:
     - Map the exit code:
       - `1` → `AdapterInvocationError { code: 'codex-generic', retryable: true, message: <last stderr line or error event> }`.
       - `2` → `AdapterConfigInvalid { code: 'codex-usage', retryable: false, message }`.
       - Other → `AdapterInvocationError { retryable: true }`.
     - Return `TurnResult` with `kind: 'failure'`.
10. On `cancellationSignal` firing mid-run:
    - 10a. Send `SIGTERM` to the subprocess. If it does not exit within `2000 ms`, send `SIGKILL`.
    - 10b. Return `TurnResult { kind: 'failure', error: { code: 'codex-cancelled', retryable: false, message: 'cancelled' } }`.
11. On wall-clock timeout (`timeoutMs` elapsed without exit):
    - 11a. Send `SIGTERM`; escalate to `SIGKILL` after `2000 ms`.
    - 11b. Return `TurnResult { kind: 'failure', error: { code: 'AdapterTurnTimeout', retryable: true } }`.

### `closeSession`

1. Mark the `Session` as `closed` in the registry.
2. If any in-flight subprocess exists for this Session, send `SIGTERM` then `SIGKILL` (same escalation as above).
3. Codex does not require an explicit thread-end call; the thread remains server-side but is no longer resumed.

## Errors

All errors are port-level (`AdapterNotAvailable`, `AdapterConfigInvalid`, `AdapterTurnTimeout`, `AdapterInvocationError`, `AdapterParseError`). Concrete `code` values used by this adapter:

| `error.code` | Raised from |
|--------------|-------------|
| `codex-binary-not-found` | `openSession` when `codex` is absent from `PATH`. |
| `codex-session-closed` | `sendTurn` called on a `closed` Session. |
| `codex-generic` | Non-zero exit, classified as generic failure (typically exit code 1). |
| `codex-usage` | Codex exit code 2 (invalid CLI usage — indicates an adapter bug or disallowed flag combination). |
| `codex-parse-empty` | stdout and `-o` path both empty on exit 0. |
| `codex-cancelled` | Cancellation signal fired. |
| `AdapterTurnTimeout` | Wall-clock `timeoutMs` elapsed before the subprocess finished. |

## Side Effects

- Spawns one `codex exec` subprocess per `sendTurn` call.
- Writes and deletes a temp directory containing `last.txt` per Turn.
- Mutates `Session.providerRef` on Turn 1 once the CLI emits `thread.started`.

## Rules

- **`--json` is mandatory** on every `sendTurn` invocation. The adapter depends on the `thread.started` event to capture `thread_id` on Turn 1 and relies on JSONL parsing as a fallback source of the final message.
- **`-o <tmpPath>` is mandatory** for reading the final message reliably. The adapter parses JSONL for capture but treats the `-o` file as authoritative on success.
- **Flag set differs between Turn 1 and resume.** The adapter MUST NOT emit `--sandbox`, `--cd`, or `-c instructions=...` on `codex exec resume`. Codex rejects them with a usage error because the thread inherits those settings from Turn 1.
- **Sandbox default `read-only`.** Upgrades require explicit `extraFlags` entries from the allow-list below, applied on Turn 1 only.
- **Allow-listed `extraFlags`:**
  - `--sandbox workspace-write`
  - `--sandbox danger-full-access` (strongly discouraged; the adapter still permits it for operators who explicitly need it)
  - `--profile <name>` (Codex's own profile system; orthogonal to this project's Profile concept)
  - `--ephemeral`
  - `--skip-git-repo-check`
  Any flag outside this allow-list fails `openSession` with `AdapterConfigInvalid`.
- **Model override** is passed via `--model` when `participant.model` is non-null; otherwise the adapter does not set the flag (Codex uses its configured default). `--model` is valid on both `exec` and `exec resume`.
- **System prompt injection.** Exposed through `-c instructions='<content>'` on Turn 1 only. Content is JSON-stringified (argv, not a shell). On resume the system prompt is inherited and the adapter does not re-send it.
- **Provider ref reuse.** Subsequent Turns always use `exec resume <thread_id>` so Codex treats them as continuations. The adapter never invents a new `thread_id`.
- **stdin unused.** `codex exec` can read prompts from stdin with the `-` argument; this adapter does not use that mode. Prompt goes on argv.
- **Temp file cleanup.** Successful Turn: delete. Failed Turn: retain for `10 minutes` then delete (best-effort). Retention aids post-mortem debugging.
- **Environment handling.** `HOME`, `PATH`, `USER` are inherited unchanged. `CODEX_API_KEY` is inherited when set. `participant.env` is applied after the inheritance and may override any key not in the forbidden list.
- **No auth pre-probe.** The adapter's availability check stops at binary discovery. Missing or expired credentials surface as non-zero exits on the first Turn and are translated into participant drops.
