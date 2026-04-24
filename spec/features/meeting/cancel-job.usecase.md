# Use Case: cancel-job

## Actor

Orchestrator Agent calling MCP tool `cancel_job`. Also invoked internally by [end-meeting](./end-meeting.usecase.md).

## Input

| Field | Type | Validation |
|-------|------|------------|
| `jobId` | `JobId` | Required. Must exist. |
| `reason` | string | Optional. 1–200 chars. Default `"cancelled-by-user"`. Stored verbatim on the `job.cancelled` event. |

## Output

**Success:**

```
{
  jobId: JobId,
  status: 'cancelled',
  cancelledAt: Instant,
  lastSeq: integer
}
```

**Failure:** See *Errors*.

## Flow

1. Validate Input.
2. `MeetingStorePort.loadJob(jobId)`.
   - 2a. If absent → `JobNotFound`.
   - 2b. If `status ∈ { completed, failed, cancelled }` → `JobAlreadyTerminal`.
3. Set an in-memory cancellation signal for the Job's discussion loop. The committee-protocol feature observes this signal between Turns and at Round boundaries (see [terminate-discussion](../committee-protocol/terminate-discussion.usecase.md)).
4. Wait for the discussion loop to acknowledge termination (bounded by `AI_MEETING_CANCEL_TIMEOUT_MS = 30_000`). Acknowledgement is the discussion loop's own call to `MeetingStorePort.updateJob({ status: cancelled, ... })` and `appendSystemEvent('job.cancelled', ...)`.
   - 4a. If the loop does not acknowledge within the budget, the use case forcibly transitions the Job via `updateJob({ status: cancelled, cancelReason: reason, finishedAt: Clock.now })` and appends `job.cancelled` itself. In-flight Adapter subprocesses are signalled via `AgentAdapterPort.closeSession` on every Member Session associated with the Job; each Adapter's cancellation semantics are defined in its use case.
5. Return the snapshot.

## Errors

| Error | When | MCP code |
|-------|------|----------|
| `InvalidInput` | Schema violation. | `invalid_params` |
| `JobNotFound` | Unknown `jobId`. | `not_found` |
| `JobAlreadyTerminal` | Status is already terminal. | `failed_precondition` |
| `StoreUnavailable` | Store error. | `internal_error` |

## Side Effects

- `job.cancelled` event appended with the caller's `reason`.
- All Member Adapter subprocesses started for this Job are signalled to terminate; their Sessions are closed.
- Partial Transcript is preserved — any Messages appended before the cancellation land normally.

## Rules

- Cancellation is **cooperative first, forced second.** The discussion loop is given a bounded window to wind down cleanly (observable in Transcript as an early `job.cancelled`), then forced if it does not respond.
- Once a Job is `cancelled`, its Messages remain queryable and the Meeting remains `active`. A new `send_message` may be issued immediately.
- A Member Session closed as part of cancellation **is** reopenable in a subsequent Job — the Adapter starts a fresh Session with a new `sessionId`; prior thread state from the provider is not carried across.
- `job.cancelled` is terminal: a second `cancel_job` on the same id returns `JobAlreadyTerminal` rather than a silent no-op.
