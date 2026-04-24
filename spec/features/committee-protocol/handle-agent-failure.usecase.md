# Use Case: handle-agent-failure

## Actor

Internal — committee-protocol, invoked by [run-round](./run-round.usecase.md) whenever a Member's Turn resolves with `TurnOutcome.kind = 'failure'` after adapter-level retries are exhausted.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `state` | `DiscussionState` | — |
| `participantId` | `ParticipantId` | Must identify an `active` Member. |
| `error` | `{ code: string, message: string, retryable: boolean }` | Required. |
| `attempts` | integer ≥ 1 | Number of attempts the Adapter already tried (as reported by `dispatchTurn`). |

## Output

Updated `DiscussionState` with `participantId ∈ droppedThisJob`.

Side effects: one `participant.dropped` Event and one `system` Message appended.

## Flow

1. Classify the failure:
   - 1a. `fatal = error.retryable === false OR attempts >= MAX_ATTEMPTS_PER_TURN`. `MAX_ATTEMPTS_PER_TURN = 3`.
   - 1b. If `fatal` is `false`, this use case does not run — the caller retries instead. By contract, the caller invokes this use case only for fatal failures; its behaviour on a non-fatal input is a programming error and must throw at the application boundary.
2. `MeetingStorePort.markParticipantDropped({ meetingId, participantId, reason: error.code, error: { code: error.code, message: error.message }, at: Clock.now })`.
3. Compose the system Message: `author = 'system'`, `kind = 'system'`, `text = "participant:<participantId> dropped:<error.code> message:<error.message>"`. Append via `MeetingStorePort.appendMessage`.
4. `AgentAdapterPort.closeSession(session)` for the dropped Participant. Failures are caught and logged at `warn`; they do not block the drop.
5. Add `participantId` to `state.droppedThisJob`. Remove it from `state.pendingPass` if present.
6. Return the updated `state`.

## Errors

| Error | When | Behaviour |
|-------|------|-----------|
| `ParticipantNotFound` | `participantId` is not a Member of the Meeting. | Thrown up the stack as a programming error — indicates a contract violation by the caller. |
| `StoreUnavailable` | Store write failure. | Propagated; handled by the Job runner which transitions the Job to `failed`. |

## Side Effects

- `participant.dropped` Event appended.
- One `system` Message appended (visible in the Transcript).
- Adapter Session closed (best-effort).

## Rules

- **Dropping is permanent for the Meeting.** A dropped Member stays dropped for every subsequent Job in the same Meeting — the Meeting aggregate carries the `dropped` status forward, not the per-Job set.
- **Retry policy lives in the Adapter, not here.** By the time this use case runs, retries are exhausted.
- **System Messages about drops are part of the Transcript**, so Members in later Rounds see the drop in their `transcriptPrefix`. This gives the committee a chance to acknowledge the missing voice.
- **Reason codes match the port's error taxonomy.** Values: `AdapterTurnTimeout`, `AdapterInvocationError`, `AdapterParseError`, `AdapterConfigInvalid` (unexpected at runtime but possible if config mutates underneath us), `AdapterNotAvailable` (e.g. the CLI binary was removed mid-Meeting).
