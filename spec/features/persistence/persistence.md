# Feature: persistence

## Purpose

Provide durable, append-only storage for every Meeting, Transcript, and Job, plus a matching in-memory variant for tests and ephemeral usage. The port treats each Meeting as an event log; aggregates are built by folding events, and the Cursor is a position into that log.

## Domain Entities

### Event

Persisted record. Append-only, immutable after write.

| Field | Type | Rules |
|-------|------|-------|
| `meetingId` | `MeetingId` | Back-reference. |
| `seq` | integer ≥ 0 | Monotonic within a Meeting. Assigned by the Store at append time. |
| `type` | enum (below) | — |
| `at` | `Instant` | Supplied by `Clock` at append time. |
| `payload` | JSON | Shape determined by `type`. |

**Event types:**

| Type | Payload shape (summarised) | Emitted by |
|------|----------------------------|------------|
| `meeting.created` | `{ title, defaultMaxRounds, createdAt }` | [start-meeting](../meeting/start-meeting.usecase.md) |
| `participant.joined` | `{ participant }` (full Participant record) | start-meeting |
| `job.started` | `{ jobId, maxRounds }` | [send-message](../meeting/send-message.usecase.md) |
| `message.posted` | `{ messageId, round, author, kind, text }` | send-message (Round 0), [run-round](../committee-protocol/run-round.usecase.md) |
| `round.started` | `{ roundNumber, activeParticipantIds }` | run-round |
| `round.completed` | `{ roundNumber, passedParticipantIds }` | run-round |
| `human.turn.requested` | `{ jobId, requestId, roundNumber, participantId, agreeTargets, strengths }` | discussion loop |
| `human.turn.submitted` | `{ jobId, requestId, roundNumber, participantId, action, targetParticipantId?, strength?, text?, messageId, messageSeq, auto }` | `submit_human_turn`, discussion loop auto-skip |
| `human.participation.set` | `{ participantId, enabled, jobId? }` | `set_human_participation`, Web Viewer POST |
| `synthesis.submitted` | `{ jobId, text }` | `submit_synthesis` |
| `participant.dropped` | `{ participantId, reason, error? }` | [handle-agent-failure](../committee-protocol/handle-agent-failure.usecase.md) |
| `job.completed` | `{ jobId, terminationReason, lastSeq, rounds }` | [terminate-discussion](../committee-protocol/terminate-discussion.usecase.md) |
| `job.failed` | `{ jobId, error }` | send-message / run-round fatal errors |
| `job.cancelled` | `{ jobId, cancelReason }` | [cancel-job](../meeting/cancel-job.usecase.md) |
| `meeting.ended` | — | [end-meeting](../meeting/end-meeting.usecase.md) |

### Cursor

| Field | Type | Rules |
|-------|------|-------|
| `value` | opaque base64 | Encodes the `seq` of the last Event the caller has seen. `"0"`-cursor is represented by the absent value or by the sentinel returned at Meeting creation. |

### Snapshot views

The port composes aggregates by folding events. Consumers see only DTOs:

- `MeetingSnapshot` — `{ meeting, participants, openJobs, lastSeq }`.
- `MessagePage` — `{ messages: Message[], nextCursor: Cursor, hasMore: boolean }`.
- `JobSnapshot` — `{ job }` (mirrors the Job entity in [meeting](../meeting/meeting.md)).
- `MeetingSummary` — `{ id, title, status, createdAt, participants: { id, role, adapter }[], lastSeq }`.

## Ports

### MeetingStorePort

| Method | Input | Output | Errors |
|--------|-------|--------|--------|
| `createMeeting` | `{ meeting, participants }` | `MeetingSnapshot` | `MeetingAlreadyExists` |
| `loadMeeting` | `MeetingId` | `MeetingSnapshot` | `MeetingNotFound` |
| `listMeetings` | `{ status?, createdAfter?, createdBefore?, limit, cursor? }` | `{ summaries: MeetingSummary[], nextCursor?: string }` | — |
| `endMeeting` | `{ meetingId, at }` | `MeetingSnapshot` | `MeetingNotFound`, `MeetingAlreadyEnded` |
| `createJob` | `Job` | `JobSnapshot` | `MeetingNotFound`, `MeetingAlreadyEnded`, `JobAlreadyExists` |
| `loadJob` | `JobId` | `JobSnapshot` | `JobNotFound` |
| `updateJob` | `{ jobId, patch }` | `JobSnapshot` | `JobNotFound`, `JobStateTransitionInvalid` | (Patch fields: `status`, `startedAt`, `finishedAt`, `lastSeq`, `rounds`, `terminationReason`, `error`, `cancelReason`.) |
| `appendMessage` | `{ meetingId, message }` (message without `seq`) | `Message` (with `seq` filled) | `MeetingNotFound`, `MeetingAlreadyEnded` |
| `appendSystemEvent` | `{ meetingId, type, payload, at }` | `{ seq }` | `MeetingNotFound` |
| `readMessagesSince` | `{ meetingId, cursor?, limit }` | `MessagePage` | `MeetingNotFound`, `CursorInvalid` |
| `markParticipantDropped` | `{ meetingId, participantId, reason, error?, at }` | — | `MeetingNotFound`, `ParticipantNotFound` |
| `refresh` (optional) | — | — | — |
| `watchNewEvents` | `{ meetingId, cursor?, timeoutMs }` | — | `MeetingNotFound` |
| `readAllEvents` (optional) | `MeetingId` | `readonly AnyEvent[]` | `MeetingNotFound` |

**Optional methods.**

- **`refresh()`** — Re-read the on-disk store and pick up state mutated by another process (a new Meeting directory created by an `veche-server` instance, additional events appended to an existing Meeting's `events.jsonl`). Idempotent; safe to call between every `listMeetings` / `loadMeeting` poll cycle. Adapters that are intrinsically same-process (e.g. `InMemoryStore`) MAY leave this method unimplemented; callers MUST treat its absence as "nothing to refresh". Concrete behaviour for `FileStore`: list `<root>/meetings/`, fold events for any directory not yet known, and re-fold events for known directories so that the cached `Meeting`, `Participants`, `Jobs`, and `lastSeq` reflect the on-disk log. The append-lock and watcher set of any Meeting already in cache MUST be preserved across refresh — only the value-object slots are replaced.
- **`watchNewEvents`** — In-process notification primitive used by `get_response` (MCP) within the same process that performs writes. Cross-process callers (e.g. `veche watch`) MUST NOT rely on this method and MUST poll via `refresh()` + `listMeetings` / `readMessagesSince` instead. See [watch-server](../web-viewer/watch-server.usecase.md) → *Cross-process change detection*.
- **`readAllEvents`** — Full event stream of a Meeting, used by `show --raw` and tooling. Optional; renderers that need the raw event stream check at runtime and degrade gracefully if absent.

**Error semantics:**

| Error | Meaning |
|-------|---------|
| `MeetingNotFound` | No Meeting with the requested id. |
| `MeetingAlreadyExists` | `createMeeting` called with an id that exists. |
| `MeetingAlreadyEnded` | Write on an ended Meeting. |
| `JobNotFound` | No Job with the requested id. |
| `JobAlreadyExists` | `createJob` called with an existing id. |
| `JobStateTransitionInvalid` | A patch would take the Job into a state that its current state does not allow. |
| `ParticipantNotFound` | No Participant with that id in the referenced Meeting. |
| `CursorInvalid` | A cursor that cannot be decoded or that points outside the Meeting's log. |

## Use Cases

- [in-memory-store](./in-memory-store.usecase.md) — Behaviour of the in-process adapter.
- [file-store](./file-store.usecase.md) — On-disk JSONL layout, cursor encoding, atomicity rules.

## Rules

- **Append-only.** `appendMessage` and `appendSystemEvent` are the only write paths after creation events. Existing events never change.
- **Single model runner per Meeting.** The application layer guarantees that at any moment only one Job is `running` or `waiting_for_human` for a given Meeting, and that model Round execution inside that Job is serialised.
- **Bounded cross-process human writes.** `veche watch` may append only Human Turn submission and Human Participation events, plus the Transcript Message that represents the submitted Human Turn. The model runner treats the first valid submission by event `seq` as authoritative and ignores later duplicates.
- **Monotonic `seq`.** `seq` starts at 0 and increments by 1 per event. Gaps are a fatal inconsistency.
- **Cursors are opaque to callers.** Internal encoding is a store detail; callers only compare by equality and pass cursors back unchanged.
- **Endurance boundary.** `InMemoryStore` explicitly does not persist anything. `FileStore` survives process restarts and preserves all events indefinitely unless the operator deletes the directory.
- **Post-meeting synthesis.** `synthesis.submitted` may be appended after `meeting.ended` because it records facilitator output for an already-terminal Job and does not mutate the Transcript.
