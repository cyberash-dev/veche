# Use Case: run-round

## Actor

Internal — committee-protocol's discussion loop. Not exposed as an MCP tool.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `state` | `DiscussionState` | Non-null. `state.terminationReason` must be `null`. |
| `cancellationSignal` | `AbortSignal` | Provided by the Job runner. Checked at every await point. |
| `turnTimeoutMs` | integer ≥ 1000 | From the Job. |

## Output

**Success:**

Updated `DiscussionState` with:
- `roundNumber` incremented.
- `pendingPass` updated based on this Round's outcomes.
- `droppedThisJob` expanded with Members dropped this Round.
- `terminationReason` set if any termination condition fires (delegated to [terminate-discussion](./terminate-discussion.usecase.md)).

Side effect: `round.started`, zero or more `message.posted`, zero or more `participant.dropped`, and `round.completed` Events appended to the Meeting's log, in that order.

**Failure:** See *Errors*.

## Flow

1. Select active Model Members:
   - 1a. `activeMembers = Participants with role=member AND participantKind=model AND status=active AND id NOT IN droppedThisJob`.
   - 1b. If `activeMembers` is empty → return `state` with `terminationReason = 'no-active-members'`. (The loop exits without running a Round.)
2. Increment `state.roundNumber`.
3. `MeetingStorePort.appendSystemEvent('round.started', { roundNumber, activeParticipantIds: activeMembers })`.
4. Build the `transcriptPrefix` for each Member:
   - 4a. For each Member, the prefix is the ordered list of every `message.posted` Event whose `author` is not this Member AND whose `round` is greater than or equal to `lastRound[member]` — the round in which this Member most recently spoke (or `-1` on the very first Turn). On Round 1 this collapses to a single entry: the facilitator's opening Message (round 0). On Round N+1 it is every other Member's Message from Round N. The prefix is symmetric across Members within a Round — both the first and last dispatched Members see the same set of peer Messages from the prior round, irrespective of intra-round dispatch ordering.
   - 4b. The prefix relies on the assumption that every Member's prior context (its own past responses + peer Messages it has already received in earlier rounds) is retained by the adapter's provider session. New stateless adapters MUST therefore opt in via a different code path, not by widening this prefix.
   - 4c. The prefix is emitted to the Adapter as part of the Turn prompt — formatting is defined in [dispatch-turn](../agent-integration/dispatch-turn.usecase.md).
5. Dispatch one Turn per Member in parallel:
   - 5a. `turnPromise[i] = dispatchTurn({ session, prompt, transcriptPrefix, roundNumber, timeoutMs, workdir })` — see [dispatch-turn](../agent-integration/dispatch-turn.usecase.md).
   - 5b. `prompt` is empty in every Round; the entire content for the Member lives in `transcriptPrefix`.
   - 5c. The dispatch uses `Promise.allSettled` so that one failing Member does not abort the others.
6. Check `cancellationSignal.aborted`. If set → return `state` with `terminationReason = 'cancelled'`.
7. Process outcomes (order: Member id ascending, deterministic for Transcript stability):
   - 7a. **TurnOutcome.kind = 'speech'** → `appendMessage({ meetingId, message: { round, author: participantId, kind: 'speech', text } })`. Clear `pendingPass.delete(participantId)`. Clear any prior pass state from *other* Members too — because a new `speech` invalidates any prior passes for the *next* Round (documented in Rule below).
   - 7b. **TurnOutcome.kind = 'pass'** → `appendMessage({ meetingId, message: { round, author: participantId, kind: 'pass', text: '<PASS/>' } })`. `pendingPass.add(participantId)`.
   - 7c. **TurnOutcome.kind = 'failure'** → delegate to [handle-agent-failure](./handle-agent-failure.usecase.md), which updates `droppedThisJob` and emits `participant.dropped`.
8. `MeetingStorePort.appendSystemEvent('round.completed', { roundNumber, passedParticipantIds: [...pendingPass] })`.
9. The outer discussion loop pauses for a Human Turn when an enabled Human Member exists:
   - 9a. Emit `human.turn.requested` with a unique `requestId`, the just-completed `roundNumber`, the Human Participant, `agreeTargets`, and strengths `[1, 2, 3]`.
   - 9b. Set Job status to `waiting_for_human`.
   - 9c. Poll/refetch store state until the request has a valid submission, cancellation is observed, or the Human Participant is toggled disabled. Browser submissions from `veche watch` and MCP submissions are both observed through the same event log.
   - 9d. `agree` appends a readable Human speech Message naming the target + strength. `skip` appends a Human pass Message with `<PASS/>`. `steer` appends the Human text as speech and clears `pendingPass` so another model Round can run when the cap permits it.
   - 9e. First valid submission for the `requestId` wins. Later duplicate submissions are rejected at the boundary or ignored by the runner.
10. Evaluate termination via [terminate-discussion](./terminate-discussion.usecase.md). If it returns a `terminationReason`, set it on `state`.
11. Return updated `state`.

## Errors

| Error | When | Behaviour |
|-------|------|-----------|
| `AdapterTurnTimeout` (raised inside `dispatchTurn`) | A single Turn exceeded `turnTimeoutMs`. | Surfaced as `TurnOutcome.kind = 'failure'` with `retryable = true`. The handler applies the adapter's retry policy (see [dispatch-turn](../agent-integration/dispatch-turn.usecase.md)); if the retry also fails, the outcome is passed to step 7c. |
| `AdapterInvocationError` | Non-zero exit from the CLI. | Same as above. |
| `AdapterParseError` | Output could not be classified. | Non-retryable failure; step 7c drops the Member. |
| `StoreUnavailable` | Store write failure. | Propagated up to the Job runner, which transitions the Job to `failed` with `error.code = 'StoreUnavailable'`. |

## Side Effects

- One `round.started` Event.
- Zero or more `message.posted` Events, one per speech/pass outcome.
- Zero or more `participant.dropped` Events, one per failed-and-non-recoverable outcome.
- One `round.completed` Event.
- Adapter subprocesses spawned and cleaned up (by the Adapters themselves).

## Rules

- **Deterministic ordering of appends.** Outcomes are appended in ascending `participantId` order so that replays of the event log yield identical Transcripts — even though dispatch is concurrent, persistence is serial.
- **Speech clears every pending pass.** Rationale: once *anyone* has said something new, every other Member has new information to react to. A Member who passed this Round can speak again next Round because `pendingPass` resets at Round start; mid-Round the only effect is the Round-end termination check, which correctly sees that not everyone held their pass.
- **Cancellation is observed between awaits.** The check happens before dispatch, after dispatch, and after persisting outcomes. A running Turn cannot be synchronously aborted by the loop; the Adapter cooperates with `AbortSignal` inside `dispatchTurn`.
- **Empty Rounds are impossible.** Step 1b guarantees that `run-round` never starts a Round with zero Members.
- **`round.started` always pairs with `round.completed`.** Even when every Turn fails, both markers land so the event log remains consistent.
- **Human Turns are between model Rounds.** Human submissions share the just-completed round number for rendering, but they are not dispatched through `AgentAdapterPort` and are not counted as model pass votes for all-passed termination.
