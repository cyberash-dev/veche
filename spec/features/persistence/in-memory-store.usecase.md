# Use Case: in-memory-store

## Actor

Internal — `InMemoryMeetingStore` implements `MeetingStorePort` for tests and ephemeral usage. No MCP surface.

## Input

Every `MeetingStorePort` method (see [persistence](./persistence.md)).

## Output

Port-conformant responses. State lives in process memory only.

## Flow

### State shape

```
meetings: Map<MeetingId, {
  meeting: Meeting,
  participants: Map<ParticipantId, Participant>,
  events: Event[],             // append-only, indexed by seq === array index
  jobs: Map<JobId, Job>,
  watchers: Set<{ sinceCursor: Cursor, resolve: () => void, deadline: Instant }>
}>
globalJobs: Map<JobId, MeetingId>       // secondary index for loadJob
```

### `createMeeting`

1. If `meetings.has(meeting.id)` → `MeetingAlreadyExists`.
2. Create an empty bucket; push `meeting.created` and one `participant.joined` per Participant.
3. Return `MeetingSnapshot` with `lastSeq = participants.length`.

### `appendMessage`

1. If `meetings[meetingId]` missing → `MeetingNotFound`.
2. If `meeting.status === 'ended'` → `MeetingAlreadyEnded`.
3. Assign `seq = events.length`. Push `message.posted` with `payload = { messageId, round, author, kind, text }`.
4. Resolve all `watchers` whose `sinceCursor < seq`.
5. Return `Message` with filled `seq`.

### `appendSystemEvent`

1. Same preconditions as `appendMessage`.
2. Assign `seq`; push the Event.
3. Resolve watchers.

### `readMessagesSince`

1. Decode `cursor` (see *Cursor encoding* below).
2. Iterate `events` starting at `seq > cursor.seq`.
3. Collect up to `limit` Events whose `type === 'message.posted'`. Events of other types are skipped but advance the logical position.
4. Return `MessagePage` with `messages`, `nextCursor = seq of last-scanned event`, `hasMore = scanCursor < events.length - 1`.

### `listMeetings`

1. Filter `meetings` by `status`, `createdAfter`, `createdBefore`.
2. Sort by `createdAt` descending, then `meetingId` ascending.
3. Apply cursor-based pagination: the cursor encodes `(createdAt, meetingId)`.
4. For each selection, compute `openJobCount = count of jobs where status ∈ {queued, running}`.
5. Return `{ summaries, nextCursor: null | '<cursor>' }`.

### `createJob`, `loadJob`, `updateJob`

- `createJob`: refuse when `meeting.status !== 'active'` (`MeetingAlreadyEnded`). Refuse when any Job for the Meeting has status `queued` or `running` (`JobStateTransitionInvalid`, surfaced as `MeetingBusy` by the application layer).
- `loadJob`: lookup in `globalJobs` then fetch from the Meeting bucket.
- `updateJob`: apply the patch. Validate transitions:
  - `queued → running → completed|failed|cancelled`.
  - `queued → cancelled|failed` (allowed if the Job never starts).
  - Terminal states are immutable.

### `watchNewEvents` (internal helper, exposed as port method on stores supporting blocking reads)

1. If any event exists with `seq > cursor.seq` → resolve immediately.
2. Otherwise add a watcher with `deadline = Clock.now + timeoutMs`.
3. Any `appendMessage` / `appendSystemEvent` that advances `seq` beyond the watcher's cursor resolves it.
4. A background timer resolves watchers whose `deadline <= Clock.now`.

### `endMeeting`, `markParticipantDropped`

Straightforward: mutate the in-memory record and append the matching Event.

## Cursor encoding

- Base64-url of `<seq>`. Example: `"42"` → base64 `MzA0Mg==` (illustrative; the implementation may pick a compact encoding).
- Decoding rejects malformed cursors with `CursorInvalid`.

## Errors

As per [persistence](./persistence.md). All store errors are domain errors; no infrastructure-specific wrappers are thrown.

## Side Effects

- In-memory state mutation only. No filesystem, no network.

## Rules

- **Ephemeral.** Data does not survive process exit. `AI_MEETING_STORE=memory` selects this adapter.
- **Thread-safety** is guaranteed by the single-threaded Node event loop. The store assumes the application layer serialises writes within a Meeting.
- **Memory bound.** No automatic eviction. Operators running long sessions should prefer `FileStore`. The adapter logs a `warn` when any Meeting exceeds `10 000` events.
- **Determinism.** With a fixed `Clock` and `IdGen`, operations yield identical `seq` / payload sequences across runs.
- **`watchNewEvents` timeout respects `Clock`.** Tests can fast-forward time by driving a fake `Clock`; the store's timer implementation must be injectable via the infra layer.
