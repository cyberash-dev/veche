# Use Case: end-meeting

## Actor

Orchestrator Agent calling MCP tool `end_meeting`.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `meetingId` | `MeetingId` | Required. Must exist. |
| `cancelRunningJob` | boolean | Optional. Default `false`. When `true`, a Job with `status ∈ { queued, running }` is cancelled before the Meeting transitions to `ended`. |

## Output

**Success:**

```
{
  meetingId: MeetingId,
  status: 'ended',
  endedAt: Instant,
  cancelledJobId: JobId | null
}
```

**Failure:** See *Errors*.

## Flow

1. Validate Input.
2. `MeetingStorePort.loadMeeting(meetingId)`. If absent → `MeetingNotFound`. If `status = ended` → `MeetingAlreadyEnded`.
3. Detect an in-flight Job (the store's `openJobCount > 0`):
   - 3a. If `cancelRunningJob = false` → `MeetingBusy` with the open `jobId`.
   - 3b. If `cancelRunningJob = true` → invoke [cancel-job](./cancel-job.usecase.md) internally with `reason = "meeting-ended"` and wait for the Job to reach a terminal state. The cancel use case terminates in-flight Adapter subprocesses and closes their Sessions; this use case only triggers the cancel and waits.
4. For each Member Participant whose Session is `open`, call `AgentAdapterPort.closeSession`. Failures are logged at `warn` level and do not abort the end.
5. `MeetingStorePort.endMeeting({ meetingId, at: Clock.now })` — persists `meeting.ended` and flips status.
6. Return `{ meetingId, status: 'ended', endedAt, cancelledJobId }` — `cancelledJobId` is the id that step 3b cancelled, or `null` otherwise.

## Errors

| Error | When | MCP code |
|-------|------|----------|
| `InvalidInput` | Schema violation. | `invalid_params` |
| `MeetingNotFound` | Unknown `meetingId`. | `not_found` |
| `MeetingAlreadyEnded` | `status = ended`. | `failed_precondition` |
| `MeetingBusy` | In-flight Job and `cancelRunningJob = false`. | `failed_precondition` |
| `StoreUnavailable` | Store error. | `internal_error` |

## Side Effects

- `meeting.ended` event appended.
- Every Member Session is closed (best-effort).
- Optionally, one in-flight Job is cancelled via `cancel-job` (which emits its own events).

## Rules

- Ending a Meeting is **idempotent from the caller's perspective** only as `MeetingAlreadyEnded` — a second call does not silently succeed; it signals the prior state clearly.
- An ended Meeting is immutable: no further Jobs, Messages, or drops are accepted. The Transcript remains queryable.
- Closing a Session may fail (e.g. the Adapter subprocess already exited). Failures are logged but never propagated as errors from `end_meeting` — ending the Meeting is the authoritative state change; Session cleanup is best-effort.
