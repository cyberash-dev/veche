# Use Case: terminate-discussion

## Actor

Internal — committee-protocol, invoked at the end of every Round by [run-round](./run-round.usecase.md) and at cancellation checkpoints by the Job runner.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `state` | `DiscussionState` | Non-null. |
| `cancellationSignal` | `AbortSignal` | — |
| `activeMembers` | `ParticipantId[]` | Members currently `active` and not in `droppedThisJob`. |

## Output

```
{
  terminationReason: 'all-passed' | 'max-rounds' | 'no-active-members' | 'cancelled' | null,
  shouldFinalize: boolean
}
```

`shouldFinalize = true` when `terminationReason ≠ null`. When `true`, the Job runner performs the finalisation steps in *Flow* below.

## Flow

Evaluation order matters — conditions are checked top-down and the first match wins.

1. If `cancellationSignal.aborted` → `{ terminationReason: 'cancelled', shouldFinalize: true }`.
2. If `activeMembers.length === 0` → `{ terminationReason: 'no-active-members', shouldFinalize: true }`.
3. If `state.roundNumber >= state.maxRounds` → `{ terminationReason: 'max-rounds', shouldFinalize: true }`.
4. If every id in `activeMembers` is present in `state.pendingPass` → `{ terminationReason: 'all-passed', shouldFinalize: true }`.
5. Otherwise → `{ terminationReason: null, shouldFinalize: false }`.

**Finalisation (when `shouldFinalize === true`, performed by the caller):**

1. Derive the final `cancelReason` (when `terminationReason === 'cancelled'`) from the cancellation source. For the `cancel_job` path it is the user-supplied `reason`; for the `end_meeting` path it is `"meeting-ended"`.
2. Update the Job:
   - 2a. `all-passed`, `max-rounds`, `no-active-members` → `MeetingStorePort.updateJob({ jobId, status: 'completed', terminationReason, lastSeq: state.lastSeq, finishedAt: Clock.now })`. Emit `job.completed`.
   - 2b. `cancelled` → `MeetingStorePort.updateJob({ jobId, status: 'cancelled', cancelReason, finishedAt: Clock.now })`. Emit `job.cancelled`.
3. Do **not** close Member Sessions here — they remain open across Jobs for the same Meeting. Sessions are closed only on drop, on [end-meeting](../meeting/end-meeting.usecase.md), or on [cancel-job](../meeting/cancel-job.usecase.md) when the Adapter's cancellation strategy requires it.

## Errors

| Error | When | Behaviour |
|-------|------|-----------|
| `StoreUnavailable` | Store write failure during finalisation. | Propagated. The Job runner maps this to `job.failed` with `error.code = 'StoreUnavailable'` and attempts to persist the failure terminal marker; if that also fails, the process logs and exits the loop. |

## Side Effects

- One `job.completed` or `job.cancelled` Event on finalisation.
- `Job.status` transitions to a terminal value.

## Rules

- **Termination evaluates between Rounds, never mid-Round.** Cancellation checkpoints are explicit — see the `cancellationSignal` checks in [run-round](./run-round.usecase.md).
- **`max-rounds` is inclusive.** After Round N completes, if `roundNumber === maxRounds`, the Job terminates. Example: `maxRounds = 5` allows Rounds 1..5 inclusive.
- **`all-passed` requires every active Member to have passed in the *current* Round.** It is not cumulative across Rounds. A Member that passed in Round 2 and spoke again in Round 3 contributes only their Round-3 state to this check.
- **No partial completion.** A Job is either completed cleanly, cancelled, or failed. There is no "completed with drops" distinct status — drops are recorded on the Transcript but do not affect `status`.
- **Deterministic Job end.** Given the same event log and cancellation timing, the termination decision is the same on any replay.
