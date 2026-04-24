# Use Case: dispatch-turn

## Actor

Internal — committee-protocol, called once per Member per Round by [run-round](../committee-protocol/run-round.usecase.md). Not an MCP tool.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `session` | `Session` | `status = open`. |
| `participant` | `Participant` | Must correspond to `session.participantId`. |
| `transcriptPrefix` | `MessageView[]` | 0..N entries. Messages from other Participants in rounds this Participant has not yet seen, in `seq` order. Specifically: every `speech`/`pass`/`system` Message with `round >= lastRound[participant]` authored by anyone else. On Round 1 it is exactly `[facilitator]`; on Round N+1 it is every other Member's Message from Round N (and any earlier round the Member missed). Excludes this Participant's own messages. The adapter relies on session resume for older context. |
| `roundNumber` | integer ≥ 1 | — |
| `timeoutMs` | integer ≥ 1000 | From the Job. |
| `cancellationSignal` | `AbortSignal` | Propagated to the Adapter subprocess. |

## Output

A `TurnResult` (see [agent-integration](./agent-integration.md)):

| `kind` | Meaning |
|--------|---------|
| `speech` | Member produced content; appended as a `speech` Message. |
| `pass` | Member emitted `<PASS/>`; appended as a `pass` Message. |
| `failure` | Exhausted retries; caller drops the Member via [handle-agent-failure](../committee-protocol/handle-agent-failure.usecase.md). |

## Flow

1. **Build the prompt content.** The Adapter receives a single `prompt` string plus the native Session reference. Content is assembled as follows:
   - 1a. **Preamble** (always): a short tag block identifying the Round and the Participant's own id, e.g. `[meeting-round=3 self=codex]`. This anchors context for the model.
   - 1b. **The new Messages** from rounds this Member has not yet seen (`m.round >= lastRound[member]`, excluding own), in `seq` order. One block per `MessageView`. The block tag is chosen by `MessageView.authorRole`:
     - `facilitator` → `[facilitator=<id> round=<n>] <text>` (only on Round 1; thereafter the facilitator Message is in session memory)
     - `member` → `[author=<id> role=member round=<n>] <text>`
     - `system` → `[system round=<n>] <text>` — included verbatim so the Member can acknowledge new dropouts and other incidents.
   - 1c. No raw JSON; plain text blocks separated by a blank line. This keeps the payload model-agnostic.
   - 1d. The prompt is incremental — older context (the Member's own past responses, prior peer messages it has already received) is retained by the adapter's provider session (Codex `thread_id`, Claude Code `--resume`). The protocol depends on session continuity to keep prompts compact.
2. **Build the system prompt for the first Turn only.** On `session.providerRef === null`, the Adapter ships `systemPrompt = resolvedSystemPrompt + "\n\n" + PASS_PROTOCOL_SUFFIX`. The suffix is the literal block defined under *Rules* below. On subsequent Turns, the Adapter relies on the provider's session memory (Codex `thread`, Claude Code `--session-id`) and does not re-send the system prompt.
3. **Invoke the Adapter** up to `MAX_ATTEMPTS_PER_TURN` times:
   - 3a. Call `AgentAdapterPort.sendTurn({ session, prompt, systemPrompt, workdir: participant.workdir, roundNumber, timeoutMs })`.
   - 3b. If the call resolves with `kind: 'speech' | 'pass'` → parse via [parse-pass-signal](../committee-protocol/parse-pass-signal.usecase.md). Return `{ kind, text, providerRef, durationMs }`. `providerRef` is propagated into the `Session`.
   - 3c. If the call throws `AdapterTurnTimeout` or `AdapterInvocationError` with `retryable = true` and attempts remain → apply exponential backoff `250ms * 2^(attempt-1)` capped at `5000ms`, then retry. Backoff is cancellable via `cancellationSignal`.
   - 3d. If the call throws a non-retryable error or attempts are exhausted → return `{ kind: 'failure', error, durationMs }`.
4. The caller ([run-round](../committee-protocol/run-round.usecase.md)) persists the outcome.

## Errors

Returned as `TurnResult.kind = 'failure'`, with `error`:

| `error.code` | `retryable` | Source |
|--------------|-------------|--------|
| `AdapterTurnTimeout` | `true` | Adapter subprocess did not finish within `timeoutMs`. |
| `AdapterInvocationError` | per adapter | Non-zero exit from the CLI. |
| `AdapterParseError` | `false` | Subprocess output could not be classified. |
| `AdapterNotAvailable` | `false` | Binary or credentials vanished between Meeting start and this Turn. |

## Side Effects

- Exactly one subprocess may be spawned and cleaned up per attempt.
- On success, the Adapter may update `Session.providerRef` (Codex captures the thread id on Turn 1).

## Rules

- **System prompt lifetime.** The resolved system prompt enters the provider session exactly once (on Turn 1). Adapters never re-send it on resume.
- **No prompt mutation for retries.** A retry inside this use case reuses the identical prompt. The Adapter may add idempotency measures (Codex: stick with the same `thread_id` via `resume`; Claude Code: stick with the same `--session-id`) so the provider side treats retries as the natural continuation.
- **`MAX_ATTEMPTS_PER_TURN = 3`.** Global constant; not tunable per Meeting.
- **PASS_PROTOCOL_SUFFIX** appended to every Member's first-Turn system prompt:

  ```
  You are one of several agents participating in a committee discussion.
  Each round you receive prior messages from other agents. You may reply
  with new substantive content or, if you have nothing more to add, reply
  with exactly the token <PASS/> on a line by itself with no other characters.
  Mixed content that contains <PASS/> alongside other text is treated as a
  normal reply; the pass is only recognised when your response consists
  solely of <PASS/>.
  ```

- **Cancellation.** `cancellationSignal.aborted` during backoff terminates the loop immediately and returns `{ kind: 'failure', error: { code: 'AdapterTurnTimeout', message: 'cancelled', retryable: false } }` — callers then treat this as a fatal failure. An in-flight subprocess is terminated by the Adapter upon `cancellationSignal`.
- **Determinism for tests.** With a deterministic `Clock` and a fake Adapter, this use case produces identical outputs for identical inputs. Backoff timing uses `Clock`, not `Date.now()`.
