# Veche — SDD Specification

> Canonical SDD-format specification. Migrated incrementally from the
> classical narrative spec under `spec/features/**`. Per-partition
> migration order: persistence (this revision) → agent-integration →
> committee-protocol → meeting → web-viewer → install.
>
> Every typed normative ID below lands in `lifecycle.status: proposed`.
> Promotion to `approved` requires `sdd approve` from a non-agent
> identity (SDD §7.5: self-approval is forbidden).
>
> Legacy narrative documents under `spec/features/persistence/*.md`
> stay in place during migration as informal context. The canonical
> contract for partition `persistence` is the typed YAML blocks in
> this file.

---

## 1. Context

The `persistence` partition is one slice of the Veche server. It owns
durable, append-only storage for every Meeting, Transcript, and Job
exposed by the `meeting` partition's MCP tools. Each Meeting is an
event log; aggregates are built by folding events; the Cursor is a
position into that log.

Two adapters implement the `MeetingStorePort`:

- `InMemoryMeetingStore` — process-memory state, used by tests and
  ephemeral dev (`VECHE_STORE=memory`).
- `FileMeetingStore` — JSONL on disk under `${VECHE_HOME}`, used by
  default (`VECHE_STORE=file`).

The on-disk layout is consumed by **two cooperating processes**:
the MCP server writes; the `veche` CLI (and its `watch` subcommand)
reads. Therefore the JSONL line format, the directory structure, and
the cursor encoding form a public storage Surface (`SUR-001`) with
semver evolution rules.

The other Veche partitions (`meeting`, `committee-protocol`,
`agent-integration`, `web-viewer`, `install`) are not yet migrated to
SDD format — their classical narrative documents under
`spec/features/<name>/*.md` remain authoritative until each is
migrated.

---

## 2. Glossary

- **Event** — Persisted append-only record. Fields: `meetingId`,
  `seq`, `type`, `at`, `payload`. Immutable after write.
- **`seq`** — Monotonic 0-based integer assigned by the store at
  append time. Unique within a Meeting; used as the raw Cursor value.
- **Event type** — Closed enum: `meeting.created`,
  `participant.joined`, `job.started`, `round.started`,
  `round.completed`, `message.posted`, `participant.dropped`,
  `job.completed`, `job.failed`, `job.cancelled`, `meeting.ended`.
- **Cursor** — Opaque base64url string carrying the `seq` of the last
  Event the caller has seen. Total-ordered within a Meeting; never
  valid across Meetings.
- **`MeetingStorePort`** — Outbound port consumed by the application
  layer. Defines the create/read/append/watch contract.
- **`InMemoryMeetingStore`** — In-process adapter for tests and
  ephemeral dev. State does not survive process exit.
- **`FileMeetingStore`** — On-disk JSONL adapter. State survives
  process restarts and is shared cross-process with the read-only
  `veche` CLI.
- **`${VECHE_HOME}`** — Filesystem root for `FileMeetingStore`.
  Defaults to `${HOME}/.veche`. Created with mode `0700` on first
  use.
- **`events.jsonl`** — Per-Meeting append-only line-delimited JSON
  log. Authoritative source of truth for one Meeting.
- **`manifest.json`** — Per-Meeting derived snapshot (status, title,
  participants, jobs index). Rewritten atomically (tmp + rename)
  after every state transition; rebuilt by folding `events.jsonl` if
  missing or corrupt.
- **`MeetingSnapshot`** — DTO `{ meeting, participants, openJobs,
  lastSeq }`.
- **`MessagePage`** — DTO `{ messages, nextCursor, hasMore }`.
- **`JobSnapshot`** — DTO `{ job }`.
- **`MeetingSummary`** — DTO `{ id, title, status, createdAt,
  participants[], lastSeq, openJobCount }`.
- **`fsync`** — POSIX call that forces buffered writes to durable
  storage. Required after every event append in `FileMeetingStore`.
- **Append-lock** — Per-Meeting in-process `Mutex<MeetingId>`
  serialising appends within one process. Not a cross-process file
  lock.
- **Single writer per process** — Application-layer guarantee that at
  most one running Job per Meeting performs writes; the store
  detects violations but does not arbitrate.
- **Refresh** — Optional `MeetingStorePort.refresh()` operation that
  re-reads the on-disk store so cross-process readers see new state.

---

## 3. Partition

```yaml
---
id: persistence
type: Partition
partition_id: persistence
owner_team: cyberash
gate_scope:
  - persistence
dependencies_on_other_partitions: []
default_policy_set:
  - persistence:POL-001
id_namespace: persistence
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-01"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

---

## 4. Brownfield baseline

```yaml
---
id: persistence:BL-001
type: BrownfieldBaseline
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
discovery_scope:
  - src/features/persistence
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: d4fa8f5a342cbd7ea01c9b17ab58e76b21088c13e9c79819ce35d0d3877afaf3
    note: |
      Token covers ports/, adapters/file/, adapters/in-memory/,
      domain/Event.ts, and index.ts of the persistence slice.
      Cross-cutting domain types (Meeting, Job, Message, Participant,
      Cursor) live in the meeting slice and are imported as types;
      they are intentionally excluded from this partition's Discovery
      scope and will be covered by the meeting partition's baseline
      when that partition migrates.
freshness_token: d4fa8f5a342cbd7ea01c9b17ab58e76b21088c13e9c79819ce35d0d3877afaf3
baseline_commit_sha: df14e222606e0a34c9fd9311b4829b896e4bde0b
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner records an
  approval_record via `sdd approve`. The Brownfield baseline carries
  no preserved as-is behavior by itself; the typed Behavior /
  Invariant / Contract blocks below explicitly preserve those facts
  the migration intends to keep.
---
```

---

## 5. Surfaces

```yaml
---
id: persistence:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
name: veche/file-store-format
version: "0.1.0"
boundary_type: public_storage
members:
  - persistence:CTR-001
  - persistence:CTR-002
  - persistence:CTR-003
  - persistence:CTR-004
  - persistence:CTR-005
consumer_compat_policy: semver_per_surface
notes: |
  Public storage surface: the on-disk JSONL/manifest layout under
  `${VECHE_HOME}` is consumed cross-process by the `veche` CLI and
  the `veche watch` viewer. Renaming a directory entry, an event
  type string, or a payload field is a major bump. Adding a new
  event type or a new optional payload field is a minor bump
  (consumers MUST skip unknown types per INV-008).
---
```

---

## 6. Requirements

```yaml
---
id: persistence:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: createMeeting persists meeting and joins each participant
given: |
  - the store has no record for `meeting.id`
  - `meeting.participants.length >= 1`
when: application calls `createMeeting({ meeting, participants })`
then: |
  the store atomically appends events in this order:
    seq=0  meeting.created       (payload: { title, defaultMaxRounds, createdAt })
    seq=1  participant.joined    (payload: { participant }, first Participant)
    ...
    seq=K  participant.joined    (payload: { participant }, last Participant)
  where K = participants.length.
  Returns a MeetingSnapshot with `lastSeq = K` and the full Participant
  list.
negative_cases:
  - meeting.id already exists => MeetingAlreadyExists, no events written
out_of_scope:
  - Job creation (handled by createJob, BEH-005)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: createdAt is supplied by the caller (Clock injection); the store does not read wall-clock time on createMeeting
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    For any meeting with N participants, after createMeeting the store
    contains exactly N+1 events with the prescribed types and payloads
    in the prescribed order; lastSeq = N. A second createMeeting with
    the same id raises MeetingAlreadyExists and emits no events.
  test_template: integration
  boundary_classes:
    - one Member, no Facilitator overrides
    - eight Members (max roster)
    - duplicate id rejected
  failure_scenarios:
    - partial event sequence written on duplicate
    - seq gap or non-monotonic seq
---
```

```yaml
---
id: persistence:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: appendMessage assigns seq and persists message.posted event
given: |
  - the Meeting exists with status active
  - the caller passes a DraftMessage without `seq`
when: application calls `appendMessage({ meetingId, jobId, message })`
then: |
  the store appends one `message.posted` event with payload
  { messageId, round, author, kind, text } at `seq = lastSeq + 1`
  and returns the resulting Message with `seq` filled. In-process
  watchers whose cursor < seq are resolved.
negative_cases:
  - Meeting unknown => MeetingNotFound, no event written
  - Meeting status = ended => MeetingAlreadyEnded, no event written
out_of_scope:
  - cross-process watcher notification (see BEH-010 + INV-009)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: createdAt on the message comes from the caller via Clock; store does not read wall-clock time
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After appendMessage, events.length == lastSeq+1; the event has
    type=message.posted with the supplied payload; the returned
    Message carries the assigned seq. Append on an ended Meeting is
    rejected.
  test_template: integration
  boundary_classes:
    - first message in Meeting
    - message after a long log
    - append rejected on ended Meeting
  failure_scenarios:
    - seq collision under serialised single-writer
    - silent acceptance on ended Meeting
---
```

```yaml
---
id: persistence:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: readMessagesSince returns a page filtered to message.posted events
given: |
  - the Meeting exists
  - cursor is either absent (start from seq=0) or a previously
    returned cursor (encoded per CTR-005)
when: application calls `readMessagesSince({ meetingId, cursor, limit })`
then: |
  the store iterates events with seq > cursor.seq, collects up to
  `limit` events whose `type == message.posted`, and returns
  MessagePage { messages, nextCursor, hasMore }.
  - nextCursor encodes the seq of the last scanned event (whether
    or not it was returned as a message)
  - hasMore = (scan reached limit AND further events exist)
  - non-message events are silently skipped, but advance the logical
    position so the next call resumes correctly.
negative_cases:
  - Meeting unknown                    => MeetingNotFound
  - cursor cannot be decoded           => CursorInvalid
  - cursor encodes a Meeting other than meetingId => CursorInvalid
out_of_scope:
  - returning non-message events (callers needing raw events use
    optional `readAllEvents`, see IMP-001)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(meetingId,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    For any sequence of mixed events, two successive readMessagesSince
    calls (using the returned cursor) yield exactly the message.posted
    events in seq order, with no duplicates and no gaps. CursorInvalid
    is raised on cross-meeting cursor reuse.
  test_template: integration
  boundary_classes:
    - empty log
    - log with only system events (no messages)
    - limit smaller than message count
    - cursor at end of log
    - cross-meeting cursor (rejected)
  failure_scenarios:
    - duplicate message returned across pages
    - cursor accepted from a different Meeting
---
```

```yaml
---
id: persistence:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: createJob and updateJob enforce the documented status transitions
given: |
  - the Meeting exists with status active (createJob requires this)
  - createJob payload references that meetingId
when: |
  application calls createJob(job) followed by zero or more
  updateJob({ jobId, patch }) calls
then: |
  createJob persists `job.started` (payload { jobId, maxRounds }) at
  the next seq and writes a jobs/<jobId>.json index pointer (FileStore
  only).
  updateJob accepts only these patches:
    queued    -> running                 (sets startedAt)
    queued    -> cancelled | failed      (Job never starts)
    running   -> completed | failed | cancelled (sets finishedAt,
      lastSeq, rounds, terminationReason | error | cancelReason)
  Terminal states (completed, failed, cancelled) are immutable. Any
  other transition raises JobStateTransitionInvalid.
  createJob raises JobStateTransitionInvalid (surfaced as MeetingBusy
  by the application) when any Job for the Meeting is already in
  status `queued` or `running`.
  createJob raises MeetingAlreadyEnded when the Meeting is `ended`.
negative_cases:
  - createJob with duplicate jobId          => JobAlreadyExists
  - updateJob on unknown jobId               => JobNotFound
  - illegal transition                       => JobStateTransitionInvalid
  - createJob while another Job is running   => JobStateTransitionInvalid (MeetingBusy)
  - createJob on ended Meeting               => MeetingAlreadyEnded
out_of_scope:
  - Round event emission (handled inside the committee-protocol
    partition; this Behavior describes only the Job state machine
    storage)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: startedAt and finishedAt come from the caller via Clock; store does not read wall-clock time
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    Every legal transition is accepted; every illegal transition is
    rejected with the documented error; terminal states cannot be
    patched. createJob with any concurrent queued/running Job for the
    same Meeting is rejected.
  test_template: integration
  boundary_classes:
    - happy path (queued → running → completed)
    - cancellation before start
    - failure during run
    - rejected post-terminal patch
    - rejected concurrent createJob
  failure_scenarios:
    - silent acceptance of terminal patch
    - silent acceptance of second running Job
---
```

```yaml
---
id: persistence:BEH-005
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: endMeeting appends meeting.ended and rejects subsequent writes
given: |
  - the Meeting exists with status active
when: application calls `endMeeting({ meetingId, at })`
then: |
  the store appends one `meeting.ended` event (empty payload) at the
  next seq, sets `meeting.status = ended` and `endedAt = at`, and
  returns the updated MeetingSnapshot. Subsequent appendMessage,
  appendSystemEvent, createJob, and endMeeting calls for the same
  Meeting raise MeetingAlreadyEnded.
negative_cases:
  - Meeting unknown                          => MeetingNotFound
  - Meeting already ended                    => MeetingAlreadyEnded
out_of_scope:
  - cancellation of in-flight Jobs (cancel-job use case, in the
    meeting partition)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: endedAt comes from the caller via Clock
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After endMeeting, the Meeting status is ended, the last event is
    meeting.ended, and every subsequent write call returns
    MeetingAlreadyEnded with no event added.
  test_template: integration
  boundary_classes:
    - end on Meeting with no Job
    - end after completed Job
    - double-end rejected
  failure_scenarios:
    - silent write after end
---
```

```yaml
---
id: persistence:BEH-006
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: listMeetings filters, sorts, and paginates summaries
given: |
  - any number of Meetings exist
when: |
  application calls `listMeetings({ status?, createdAfter?,
  createdBefore?, limit, cursor? })`
then: |
  the store filters by `status` (if provided), `createdAfter`, and
  `createdBefore`; sorts by `createdAt` descending then `meetingId`
  ascending; paginates by an opaque cursor encoding `(createdAt,
  meetingId)` of the last returned summary; returns
  ListMeetingsResult { summaries, nextCursor }.
  Each summary carries `openJobCount = count of jobs with status in
  {queued, running}` for that Meeting.
negative_cases:
  - cursor cannot be decoded                 => CursorInvalid
  - limit out of range                       => InvalidInput (asserted by application; store treats as ValidationError if applicable)
out_of_scope:
  - full-text search
  - server-side sorting other than the prescribed key
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(filter,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    Filters compose; sort is stable; pagination produces a partition of
    the filtered set with no duplicates and no omissions; cross-page
    iteration recovers every summary exactly once.
  test_template: integration
  boundary_classes:
    - empty store
    - mixed active/ended
    - limit smaller than result count
    - end-of-results (nextCursor null)
  failure_scenarios:
    - duplicate summary across pages
    - missing summary across pages
---
```

```yaml
---
id: persistence:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: appendSystemEvent persists non-message events
given: |
  - the Meeting exists with status active
  - `type` is a non-message event type from CTR-002
when: |
  application calls `appendSystemEvent({ meetingId, type, payload, at })`
then: |
  the store appends one event with the given type/payload/at at the
  next seq, returns `{ seq }`, and resolves in-process watchers whose
  cursor < seq.
negative_cases:
  - Meeting unknown                          => MeetingNotFound
  - Meeting already ended                    => MeetingAlreadyEnded
out_of_scope:
  - validating payload shape against the type (caller's responsibility
    until a CTR-002 sub-schema check is added)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After appendSystemEvent, events.length == lastSeq+1; event has the
    requested type and payload; rejected on ended Meetings.
  test_template: integration
  boundary_classes:
    - each non-message event type from CTR-002
  failure_scenarios:
    - acceptance of a forbidden type (message.posted /
      meeting.created / participant.joined)
---
```

```yaml
---
id: persistence:BEH-008
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: markParticipantDropped persists a participant.dropped event
given: |
  - the Meeting exists with status active
  - the Participant exists in that Meeting
when: |
  application calls `markParticipantDropped({ meetingId, participantId,
  reason, error?, jobId?, at })`
then: |
  the store appends one `participant.dropped` event with payload
  { participantId, reason, error?, jobId? } at the next seq and
  returns void.
negative_cases:
  - Meeting unknown                          => MeetingNotFound
  - Participant unknown for that Meeting     => ParticipantNotFound
out_of_scope:
  - retroactive drop after Meeting ended
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After markParticipantDropped, the last event has type
    participant.dropped with the supplied fields; unknown participant
    is rejected.
  test_template: integration
  boundary_classes:
    - drop with error attached
    - drop without jobId (out-of-job drop)
  failure_scenarios:
    - silent drop of unknown participant
---
```

```yaml
---
id: persistence:BEH-009
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: loadMeeting and loadJob return cached or rebuilt snapshots
given: |
  - either an existing Meeting (loadMeeting) or an existing Job
    (loadJob)
when: application calls `loadMeeting(meetingId)` or `loadJob(jobId)`
then: |
  - loadMeeting returns the current MeetingSnapshot.
  - loadJob returns { job, meetingId }.
  In FileMeetingStore, loadMeeting reads `manifest.json` if present
  and non-empty; if absent or malformed it rebuilds by folding
  `events.jsonl` (cold path). loadJob reads `jobs/<jobId>.json` first
  and then the owning Meeting's manifest.
negative_cases:
  - Meeting unknown                          => MeetingNotFound
  - Job unknown                              => JobNotFound
out_of_scope:
  - partial / truncated reads
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(meetingId|jobId)"
  time_source: none
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After any successful write, a subsequent loadMeeting / loadJob
    reflects the write. With manifest.json deleted, FileMeetingStore
    reconstructs the snapshot by folding events.jsonl and produces an
    identical MeetingSnapshot.
  test_template: integration
  boundary_classes:
    - hot path (manifest fresh)
    - cold path (manifest missing)
    - cold path (manifest corrupt)
  failure_scenarios:
    - stale snapshot returned after a write
    - failed cold rebuild
---
```

```yaml
---
id: persistence:BEH-010
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: watchNewEvents blocks within the same process until a write or timeout
given: |
  - the Meeting exists with status active
  - cursor is an existing cursor or absent
when: |
  application calls `watchNewEvents({ meetingId, cursor, timeoutMs })`
  *from the same process that owns the store instance*
then: |
  the call resolves immediately if any event with seq > cursor.seq
  already exists; otherwise it suspends until either an
  appendMessage / appendSystemEvent in this process advances seq past
  the cursor, or `timeoutMs` elapses (measured against the injected
  ClockPort).
negative_cases:
  - Meeting unknown                          => MeetingNotFound
  - timeoutMs <= 0                           => resolves immediately if no new event, otherwise as above
out_of_scope:
  - cross-process notification (NOT supported; cross-process readers
    MUST poll via refresh + listMeetings + readMessagesSince — see
    INV-009)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: timeout is measured against the injected ClockPort, not wall-clock
data_scope: new_writes_only
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    A watcher with no new events resolves at deadline (FakeClock
    advance). A watcher resolves immediately when an in-process append
    happens after the call begins. Watchers in a different process
    instance never resolve from another process's writes.
  test_template: integration
  boundary_classes:
    - watcher resolved by in-process append
    - watcher resolved by timeout
    - cross-process write does NOT resolve
  failure_scenarios:
    - watcher leaks past deadline
    - cross-process resolution
---
```

```yaml
---
id: persistence:BEH-011
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: refresh re-reads on-disk state for cross-process readers
given: |
  - FileMeetingStore is in use
  - another process has appended events or created new Meetings under
    the same `${VECHE_HOME}` since this instance's last read
when: cross-process reader calls `refresh()`
then: |
  the adapter rescans `${VECHE_HOME}/meetings/`, folds events for any
  Meeting directory not yet known to this instance, and re-folds
  events for known Meetings so that cached `Meeting`, `Participants`,
  `Jobs`, and `lastSeq` reflect on-disk state. The append-lock and
  watcher set of any Meeting already cached MUST be preserved across
  refresh — only value-object slots are replaced.
  refresh is a no-op (or unimplemented) on InMemoryMeetingStore;
  callers MUST treat absence as "nothing to refresh".
negative_cases:
  - filesystem error during rescan          => StoreUnavailable
out_of_scope:
  - notifying watchers across processes (not supported, see INV-009)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(VECHE_HOME)"
  time_source: none
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After process A appends an event and process B calls refresh(),
    process B's listMeetings / loadMeeting / readMessagesSince observe
    the new event. Append-lock identity in process B is unchanged
    across refresh.
  test_template: integration
  boundary_classes:
    - new Meeting visible after refresh
    - new event visible after refresh
    - watcher set preserved across refresh
  failure_scenarios:
    - refresh replaces append-lock and breaks in-flight writes
    - refresh fails to pick up new on-disk state
---
```

---

## 7. Data contracts

```yaml
---
id: persistence:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: events.jsonl line format
surface_ref: persistence:SUR-001
schema:
  description: |
    Each line of `${VECHE_HOME}/meetings/<meetingId>/events.jsonl` is
    a UTF-8 JSON object terminated by a single `\n` byte. No trailing
    whitespace inside the JSON. Lines are appended in `seq` order,
    one event per line.
  type: object
  required: [seq, type, at, payload]
  properties:
    seq:
      type: integer
      minimum: 0
      description: monotonic per Meeting, equals zero-based line index
    type:
      type: string
      enum:
        - meeting.created
        - participant.joined
        - job.started
        - round.started
        - round.completed
        - message.posted
        - participant.dropped
        - job.completed
        - job.failed
        - job.cancelled
        - meeting.ended
    at:
      type: string
      format: date-time
      description: RFC3339 / ISO-8601 instant supplied by ClockPort at append
    payload:
      type: object
      description: shape determined by `type`; see CTR-002
preconditions:
  - the Meeting directory exists at `${VECHE_HOME}/meetings/<meetingId>/`
  - file is opened in append-only mode (O_APPEND | O_WRONLY | O_CREAT)
postconditions:
  - byte length of file is monotonic non-decreasing
  - reader splitting on `\n` and JSON-parsing each chunk recovers
    every appended event in seq order
external_identifiers:
  - JSON field names: seq, type, at, payload
  - the eleven event-type enum strings (verbatim, lowercase, dotted)
  - the literal `\n` line terminator
compatibility_rules:
  - renaming any top-level field (seq/type/at/payload)        => major bump on SUR-001
  - renaming an event-type string                             => major bump
  - removing an event-type string                             => major bump (with Migration)
  - adding a new event-type string                            => minor bump (consumers MUST skip per INV-008)
  - changing the on-disk character encoding from UTF-8        => major bump
  - changing the line terminator                              => major bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    A file produced by FileMeetingStore parses cleanly when split on
    `\n` and JSON-decoded line by line. Every parsed line satisfies
    the schema above; seq values form 0..N without gaps.
  test_template: contract
  boundary_classes:
    - empty file (no events yet)
    - file with every event type at least once
    - last line ends with `\n` (no trailing partial line)
  failure_scenarios:
    - non-JSON line accepted
    - missing `\n` terminator on the last line
    - duplicate or non-monotonic seq
---
```

```yaml
---
id: persistence:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: event payload shapes per event type
surface_ref: persistence:SUR-001
schema: |
  The `payload` field of an event line is a closed object whose shape
  depends on `type`. Field names are part of the storage Surface
  (SUR-001) and follow the same compatibility rules as CTR-001's enum.
  Optional fields are noted as `?`; all others are required.

  meeting.created:
    title              : string, 1..200 chars after trim
    defaultMaxRounds   : integer, 1..VECHE_MAX_ROUNDS_CAP
    createdAt          : ISO-8601 instant

  participant.joined:
    participant        : full Participant record (id, role, adapter,
                         profile, systemPrompt, workdir, model,
                         extraFlags, status, ...). Sub-shape owned by
                         the meeting partition.

  job.started:
    jobId              : JobId
    maxRounds          : integer

  round.started:
    roundNumber           : integer >= 0
    activeParticipantIds  : array of ParticipantId

  round.completed:
    roundNumber           : integer >= 0
    passedParticipantIds  : array of ParticipantId

  message.posted:
    messageId : MessageId
    round     : integer >= 0
    author    : ParticipantId or the literal string "system"
    kind      : closed enum { speech, pass, system }
    text      : string

  participant.dropped:
    participantId : ParticipantId
    reason        : string
    error?        : object with fields code (string) and message (string)
    jobId?        : JobId

  job.completed:
    jobId             : JobId
    terminationReason : closed enum (owned by committee-protocol)
    lastSeq           : integer
    rounds            : integer

  job.failed:
    jobId : JobId
    error : object with fields code (string) and message (string)

  job.cancelled:
    jobId        : JobId
    cancelReason : string

  meeting.ended:
    (no payload fields)
preconditions:
  - the event's `type` field matches one of the entries above
postconditions:
  - the payload shape is exactly as specified for that type
external_identifiers:
  - every required and optional field name listed above
  - the message kind enum strings (speech / pass / system)
compatibility_rules:
  - renaming any field within any payload                     => major bump on SUR-001
  - widening a closed enum (kind, terminationReason)          => major bump
  - adding a new optional field to an existing payload        => minor bump
  - tightening an optional field to required                  => major bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_event_shape
  reason: payload schema has no runtime concurrency dimension
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    For every event type, a representative event written by the store
    parses against the schema above; missing required fields are
    rejected at append time (when validated by the application).
  test_template: contract
  boundary_classes:
    - one fixture per event type
    - missing required field per type (rejected)
  failure_scenarios:
    - silent acceptance of an unknown payload field on read
---
```

```yaml
---
id: persistence:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: VECHE_HOME directory layout
surface_ref: persistence:SUR-001
schema:
  description: |
    `${VECHE_HOME}` is the filesystem root of FileMeetingStore. Defaults
    to `${HOME}/.veche`. Layout at the public_storage Surface:
  layout: |
    ${VECHE_HOME}/
    ├── config.json                # user config (Profiles); read-only to FileMeetingStore
    ├── meetings/
    │   └── <meetingId>/
    │       ├── manifest.json
    │       └── events.jsonl
    └── jobs/
        └── <jobId>.json
  rules:
    - root mode: 0700 on creation
    - meetings/<id> directory mode: 0700 on creation
    - <meetingId> equals the Meeting's id (UUID v4 string form)
    - <jobId> equals the Job's id
    - Adapter never deletes files; operators prune manually
preconditions:
  - filesystem is POSIX-compliant (rename(2) is atomic across same FS)
  - process has read+write permission on parent of `${VECHE_HOME}`
postconditions:
  - on first write, all four directory levels exist with mode 0700
  - manifest.json and events.jsonl coexist under each meeting dir
  - jobs/<jobId>.json points to its owning meeting via {meetingId, jobId}
external_identifiers:
  - directory names: meetings, jobs
  - file names: config.json, manifest.json, events.jsonl, <jobId>.json
  - directory mode: 0700
compatibility_rules:
  - renaming any directory or file                            => major bump on SUR-001
  - changing default directory mode                           => major bump
  - moving config.json out of `${VECHE_HOME}`                 => major bump
  - adding a sibling top-level directory (e.g. cache/)        => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(VECHE_HOME,meetingId)"
  time_source: none
  reason: cross-process readers (the veche CLI) read concurrently with the writing MCP server; only one MCP server may write per VECHE_HOME (see INV-006)
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After createMeeting + one append, every prescribed file exists with
    mode 0700 (directories) and is parseable. Missing manifest.json is
    rebuilt from events.jsonl on next loadMeeting.
  test_template: contract
  boundary_classes:
    - first run (no `${VECHE_HOME}`)
    - existing `${VECHE_HOME}` from a previous session
  failure_scenarios:
    - directory mode wider than 0700
    - missing jobs/<jobId>.json after createJob
---
```

```yaml
---
id: persistence:CTR-004
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: manifest.json shape
surface_ref: persistence:SUR-001
schema:
  description: |
    A derived denormalised snapshot of the Meeting aggregate. Rewritten
    atomically (tmp + rename) after every state transition. Rebuilt by
    folding events.jsonl when missing or unparsable.
  type: object
  required:
    - meeting
    - participants
    - jobs
    - lastSeq
  properties:
    meeting:
      type: object
      description: { id, title, status, createdAt, endedAt, defaultMaxRounds }
    participants:
      type: array
      items:
        description: full Participant record (owned by the meeting partition)
    jobs:
      type: array
      items:
        description: full Job record (owned by the meeting partition)
    lastSeq:
      type: integer
      minimum: -1
      description: highest seq present in events.jsonl; -1 when no events written
preconditions:
  - events.jsonl exists alongside (the source of truth)
postconditions:
  - manifest content is a faithful fold of events.jsonl up to lastSeq
external_identifiers:
  - JSON field names: meeting, participants, jobs, lastSeq
  - the Meeting / Participant / Job sub-shapes (cross-partition refs;
    breaking those is a major bump on SUR-001 PLUS a Migration in the
    meeting partition)
compatibility_rules:
  - renaming any top-level field                              => major bump on SUR-001
  - tightening / removing a sub-shape field                   => major bump (see meeting partition for sub-shapes)
  - adding an optional top-level field                        => minor bump (readers MUST ignore unknowns per INV-008)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(meetingId,manifest_revision)"
  time_source: none
  reason: tmp + rename is atomic on POSIX; readers always see a complete prior version or the new one
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    After every state transition, manifest.json parses, satisfies the
    schema, and matches a fresh fold of events.jsonl. A reader that
    opens manifest.json during a write never observes a partial /
    truncated file.
  test_template: contract
  boundary_classes:
    - empty Meeting (no events beyond join)
    - Meeting with active and completed Jobs
    - Meeting with dropped Participant
  failure_scenarios:
    - reader observes truncated manifest
    - manifest disagrees with folded events.jsonl
---
```

```yaml
---
id: persistence:CTR-005
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: cursor encoding
surface_ref: persistence:SUR-001
schema:
  description: |
    A Cursor is an opaque base64url-encoded JSON object identifying a
    position within one Meeting's event log. Two encodings exist:
  variants:
    file_store:
      description: |
        FileMeetingStore: base64url(JSON.stringify({ seq: number,
        byteOffset: number })). `byteOffset` is advisory — the reader
        MUST fall back to a byte-position scan when the cached offset
        does not land on a JSON line start.
    in_memory_store:
      description: |
        InMemoryMeetingStore: base64url(JSON.stringify({ seq: number }))
        is acceptable; any compact encoding chosen by the adapter is
        permitted as long as it round-trips through readMessagesSince.
  rules:
    - cursors are opaque to callers (compare-by-equality, pass back unchanged)
    - cursors are total-ordered within a Meeting by `seq`
    - a cursor produced by Meeting A is invalid for Meeting B
      (CursorInvalid)
    - a malformed cursor (decode failure) is CursorInvalid
preconditions:
  - the Meeting referenced by the cursor exists
postconditions:
  - readMessagesSince(cursor) returns events with seq > cursor.seq
external_identifiers:
  - the JSON field names `seq` and `byteOffset`
  - the base64url encoding choice
compatibility_rules:
  - renaming `seq` or `byteOffset`                            => major bump on SUR-001
  - changing the encoding base                                => major bump
  - tightening `byteOffset` from advisory to authoritative    => major bump
  - in-memory variant adopting a new field                    => minor bump (file_store variant is the durable contract)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: encoding_is_static
  reason: cursor encoding is a wire format; no runtime concurrency dimension
data_scope: all_data
policy_refs:
  - persistence:POL-001
test_obligation:
  predicate: |
    A cursor produced by readMessagesSince round-trips through the
    same and the other adapter variant within their respective
    rules. Cross-meeting cursor reuse raises CursorInvalid. A cursor
    whose byteOffset is stale (e.g. an unknown old offset) still
    produces correct results via fallback scan.
  test_template: contract
  boundary_classes:
    - file_store: valid byteOffset
    - file_store: stale byteOffset (fallback scan)
    - file_store: malformed base64
    - in_memory: minimal encoding
    - cross-meeting reuse rejected
  failure_scenarios:
    - silent acceptance of cross-meeting cursor
    - infinite loop on stale byteOffset
---
```

---

## 8. Invariants

```yaml
---
id: persistence:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: events.jsonl is append-only
never: |
  No code path inside FileMeetingStore truncates, rewrites, or removes
  bytes from an existing `events.jsonl`. The only writable operation
  on this file is `O_APPEND` of one `\n`-terminated JSON line. If a
  shrinking or non-monotonic file size is observed on re-read, the
  store raises StoreUnavailable with `code: 'fs-log-regressed'` and
  refuses to operate on that Meeting until an operator intervenes.
scope: persistence/file-store
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - operator manually edits events.jsonl       => regression detected via fs-log-regressed code
  - file system corruption shrinks the file    => same path
out_of_scope:
  - third-party tooling that rewrites the file is unsupported
test_obligation:
  not_applicable: implementation_does_not_detect_log_regression_in_v1
  reason: |
    The v1 implementation of FileMeetingStore opens events.jsonl with
    O_APPEND on every write (so the never-truncate clause holds at
    runtime), but it does NOT explicitly detect a SHRUNK file between
    sessions and does NOT raise StoreUnavailable with the specific
    `fs-log-regressed` code documented in this Invariant. Adding
    that detection is engineering work tracked outside this spec
    migration. Until then this Test obligation is marked
    not_applicable; INV-001 stays approved as the canonical target,
    and a follow-up Delta will either implement detection or relax
    the Invariant text to match observed behaviour.
---
```

```yaml
---
id: persistence:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: seq is monotonic per Meeting starting at 0
always: |
  For any Meeting, the events stored under that Meeting form a sequence
  whose `seq` values are 0, 1, 2, ..., N with no gaps and no
  duplicates. A gap or duplicate is a fatal inconsistency; the store
  surfaces it as StoreUnavailable rather than continuing.
scope: persistence (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - reader detecting a gap                     => StoreUnavailable
  - reader detecting a duplicate seq           => StoreUnavailable
out_of_scope:
  - cross-Meeting seq comparisons (cursors are per-Meeting)
test_obligation:
  predicate: |
    For every Meeting, fold(events).map(e -> e.seq) equals
    range(0, events.length). A synthetic gap or duplicate inserted in
    events.jsonl raises StoreUnavailable.
  test_template: integration
  boundary_classes:
    - empty log
    - long log produced by multiple Jobs
    - synthetic gap
    - synthetic duplicate
  failure_scenarios:
    - reader silently accepts a gap
    - reader silently dedupes
---
```

```yaml
---
id: persistence:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: cursors are opaque and per-Meeting
always: |
  Callers MUST treat the cursor as an opaque token: they compare it
  only by equality and pass it back unchanged. The store decodes and
  validates every cursor on use; a cursor produced by Meeting A is
  never accepted by readMessagesSince for Meeting B.
scope: persistence (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_token_semantics
  reason: opacity is a callsite contract, not a runtime property
negative_cases:
  - cross-Meeting reuse                       => CursorInvalid
  - decode failure                            => CursorInvalid
out_of_scope:
  - tools that intentionally inspect cursor internals (debug only)
test_obligation:
  predicate: |
    readMessagesSince(meetingId=B, cursor=<from_A>) raises CursorInvalid.
    Encoded form is round-trippable.
  test_template: contract
  boundary_classes:
    - same-meeting reuse (accepted)
    - cross-meeting reuse (rejected)
    - malformed cursor (rejected)
  failure_scenarios:
    - cross-meeting cursor silently accepted
---
```

```yaml
---
id: persistence:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: InMemoryMeetingStore is ephemeral; FileMeetingStore is durable
always: |
  - InMemoryMeetingStore data does not survive process exit and is not
    written to disk. Selected by `VECHE_STORE=memory`.
  - FileMeetingStore data survives process restarts: every appended
    event is fsynced before the call returns; `manifest.json` is
    written via tmp + rename; no event is removed without operator
    action. Selected by `VECHE_STORE=file` (default).
scope: persistence (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - InMemoryMeetingStore touches the filesystem => contract violation
  - FileMeetingStore returns success without fsync => contract violation
out_of_scope:
  - alternate stores (PG, SQLite) — none in v1
test_obligation:
  predicate: |
    Strace / fs-probe of InMemoryMeetingStore shows no open(2) on
    `${VECHE_HOME}` paths. FileMeetingStore.appendMessage returns only
    after fsync(eventsJsonlFd) completes; restarting the process and
    re-loading produces an identical MeetingSnapshot.
  test_template: integration
  boundary_classes:
    - in-memory write + restart (data gone)
    - file-store write + restart (data preserved)
    - file-store crash before fsync (depending on OS, last write may be lost — see ASM-001)
  failure_scenarios:
    - in-memory adapter writing to disk
    - file-store adapter skipping fsync
---
```

```yaml
---
id: persistence:INV-005
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: manifest updates are atomic via tmp + rename
always: |
  FileMeetingStore writes manifest.json by:
    1. write payload to manifest.json.tmp
    2. fsync the tmp file
    3. rename(manifest.json.tmp, manifest.json) — atomic on POSIX
  No reader observes a partial / truncated manifest.json.
scope: persistence/file-store
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - reader sees truncated manifest             => contract violation
out_of_scope:
  - cross-filesystem rename atomicity (assumed in-FS)
test_obligation:
  predicate: |
    A reader looping `readFile(manifest.json)` during many concurrent
    state transitions never observes a parse error or zero-length
    file. Both old-version and new-version reads remain valid
    snapshots.
  test_template: integration
  boundary_classes:
    - high-frequency manifest rewrites
    - reader during write
  failure_scenarios:
    - reader observes truncated manifest
---
```

```yaml
---
id: persistence:INV-006
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: single writer per process per VECHE_HOME (no file lock in v1)
always: |
  At most one MCP server process may write to a given `${VECHE_HOME}`.
  Within that writer process, the per-Meeting append-lock
  (`Mutex<MeetingId>`) serialises appendMessage / appendSystemEvent /
  manifest rewrites. v1 does NOT provide a cross-process file lockfile;
  running two MCP servers against the same `${VECHE_HOME}` is
  unsupported and SHOULD be operationally prevented.
  Cross-process READERS (the `veche` CLI and `veche watch`) are
  permitted and must use refresh + listMeetings + readMessagesSince
  (see INV-009).
scope: persistence (entire partition)
evidence: operational_signal
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: none
  reason: ports allow multiple readers; v1 does not protect against multiple writers
negative_cases:
  - two writers simultaneously                 => undefined behavior, possible log corruption (see ASM-002)
out_of_scope:
  - implementing a fcntl / flock lockfile (deferred to v2)
test_obligation:
  predicate: |
    Within one process, two concurrent appendMessage invocations on
    the same Meeting serialise (no interleaved bytes in events.jsonl).
    Cross-process simultaneous writes are NOT tested; absence is
    documented in ASM-002.
  test_template: integration
  boundary_classes:
    - intra-process concurrency (must serialise)
  failure_scenarios:
    - interleaved bytes within one process
---
```

```yaml
---
id: persistence:INV-007
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: crash recovery rebuilds manifest from events.jsonl
always: |
  On startup, when FileMeetingStore opens a Meeting whose
  manifest.json is missing, zero-byte, malformed, or older than the
  last event timestamp in events.jsonl, the adapter rebuilds the
  manifest by folding events.jsonl. The rebuilt manifest carries the
  same content as the failed manifest would have had on a clean
  shutdown.
scope: persistence/file-store
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(meetingId)"
  time_source: none
negative_cases:
  - corrupt JSON line                         => StoreUnavailable (fs-corrupt-log)
out_of_scope:
  - partial repair of a corrupt log (operator intervention required)
test_obligation:
  predicate: |
    Deleting manifest.json before loadMeeting yields a MeetingSnapshot
    identical to the pre-deletion snapshot. Replacing manifest.json
    with garbage triggers cold rebuild and an identical snapshot. A
    corrupt JSON line in events.jsonl raises StoreUnavailable with
    fs-corrupt-log.
  test_template: integration
  boundary_classes:
    - manifest absent
    - manifest corrupt
    - manifest stale (older mtime than last event)
    - corrupt event line
  failure_scenarios:
    - silent recovery from a corrupt event line
    - mismatched rebuild
---
```

```yaml
---
id: persistence:INV-008
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: forward-compatible event reading skips unknown types
always: |
  Readers (loadMeeting fold, readAllEvents, listMeetings via manifest
  fallback) MUST tolerate unknown event-type strings encountered in
  events.jsonl: an unknown type advances `seq` and `lastSeq` but does
  not contribute to a known aggregate field. Readers MUST NOT raise
  CursorInvalid or StoreUnavailable on an unknown type.
scope: persistence (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_decoder_behavior
  reason: forward compatibility is a static decode rule
negative_cases:
  - reader fails on a future event type        => contract violation
out_of_scope:
  - emitting unknown event types from this version (writers are pinned
    to the closed enum in CTR-001)
test_obligation:
  predicate: |
    A synthetic events.jsonl containing one line with type
    `future.event.type` and a known message.posted is folded
    successfully: the message is returned by readMessagesSince and
    `lastSeq` reflects both events.
  test_template: contract
  boundary_classes:
    - unknown type in middle of log
    - unknown type at end of log
  failure_scenarios:
    - reader raises on unknown type
---
```

```yaml
---
id: persistence:INV-009
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: watchNewEvents notifies only same-process writers
always: |
  `watchNewEvents` is an in-process notification primitive. It resolves
  ONLY when a write performed by the same process advances `seq` past
  the watcher's cursor (or the timeout elapses). Cross-process readers
  (the `veche watch` viewer) MUST NOT rely on `watchNewEvents` and
  MUST poll via `refresh()` + `listMeetings` + `readMessagesSince`.
scope: persistence (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: cross-process notification is explicitly NOT supported in v1; watchers are bound to the process that owns the store instance
negative_cases:
  - cross-process write does NOT resolve a watcher in another process
out_of_scope:
  - cross-process notification primitive (deferred — see web-viewer
    partition's polling rule)
test_obligation:
  predicate: |
    A watcher in process A blocked on cursor C does not resolve when
    process B appends to the same `${VECHE_HOME}`. The same watcher
    DOES resolve when process A itself appends.
  test_template: integration
  boundary_classes:
    - same-process append (resolves)
    - cross-process append (does not resolve)
    - timeout (resolves)
  failure_scenarios:
    - cross-process write resolves a watcher in another process
---
```

```yaml
---
id: persistence:INV-010
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: InMemoryMeetingStore warns past 10 000 events
always: |
  When any Meeting in InMemoryMeetingStore reaches more than 10 000
  events, the adapter emits a `warn` log entry through the injected
  LoggerPort recommending FileMeetingStore. The warning is emitted at
  most once per Meeting per process lifetime.
scope: persistence/in-memory-store
evidence: operational_signal
stability: internal
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_logging_threshold
  reason: threshold is a static rule against event count
negative_cases:
  - silently growing past 10 000 with no warning => contract violation
out_of_scope:
  - automatic eviction (deferred — operators select FileMeetingStore)
test_obligation:
  not_applicable: implementation_does_not_emit_warning_in_v1
  reason: |
    InMemoryMeetingStore does not currently take a LoggerPort; the
    10 000-event warning prescribed by this Invariant is aspirational
    in v1. Wiring the LoggerPort through the constructor is
    engineering work that touches every InMemoryMeetingStore call site
    (bootstrap.ts, fixtures.ts) and is tracked outside this spec
    migration. Until then this Test obligation is marked
    not_applicable; INV-010 stays approved as the canonical target,
    and a follow-up Delta will either implement the warn path or
    soften the Invariant scope.
---
```

---

## 9. External dependencies

```yaml
---
id: persistence:EXT-001
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
provider: local POSIX filesystem (Node fs.promises)
provider_surface: "node:fs/promises@>=20"
authority_url_or_doc: "https://nodejs.org/api/fs.html"
consumer_contract:
  invocations:
    - cmd: "open(path, 'a')"
      expects: file descriptor with O_APPEND | O_WRONLY | O_CREAT semantics
    - cmd: "writeFile(tmpPath, payload); fsync(fd); rename(tmpPath, finalPath)"
      expects: rename is atomic within the same FS; reader observes either old or new content
    - cmd: "readFile(path)"
      expects: returns full file content; throws ENOENT on missing
    - cmd: "readdir(path)"
      expects: returns entry names; throws ENOENT on missing dir
    - cmd: "mkdir(path, { recursive: true, mode: 0o700 })"
      expects: creates with the requested mode on first creation
    - cmd: "watch(path)"
      expects: emits change events on appends; some FS coalesce events (mitigated by 1s safety poll, INV documented under file-store rules)
drift_detection:
  mechanism: contract_test_against_sandbox
  artefact: src/features/persistence/adapters/file/FileMeetingStore.test.ts
last_verified_at: 2026-04-25
auth_scope:
  not_applicable: local_fs_no_auth
  reason: filesystem permissions are enforced via mode 0700; no remote auth
rate_limits:
  not_applicable: local_fs_no_rate_limit
retry/idempotency:
  not_applicable: writes_are_serialised_per_meeting
  reason: per-Meeting Mutex serialises writes within one process; rename is atomic; no retry needed
error_taxonomy:
  - "ENOENT on events.jsonl with missing dir -> MeetingNotFound"
  - "EACCES -> StoreUnavailable"
  - "ENOSPC -> StoreUnavailable with code fs-no-space"
  - "malformed JSON line -> StoreUnavailable with code fs-corrupt-log"
sandbox_or_fixture:
  - integration tests run against a tmp dir per test
test_obligation:
  predicate: |
    Each invocation form above is exercised in
    FileMeetingStore.test.ts against a real tmp directory; error
    classes map to the prescribed StoreUnavailable codes.
  test_template: integration
  boundary_classes:
    - happy path per invocation
    - ENOENT on missing dir
    - EACCES (chmod 000)
    - simulated fs-corrupt-log (manual log surgery)
  failure_scenarios:
    - ENOENT on existing dir maps to wrong error
    - EACCES leaks a raw Node error
---
```

---

## 10. Generated artifacts

_None._ The persistence partition does not emit generated code or
SDK artifacts.

---

## 11. Localization

_Not applicable._ The persistence partition produces no human-facing
text. Error messages surface to the application layer as typed
domain errors (`MeetingNotFound`, `MeetingAlreadyEnded`,
`MeetingAlreadyExists`, `JobNotFound`, `JobStateTransitionInvalid`,
`ParticipantNotFound`, `CursorInvalid`, `StoreUnavailable`); their
localization is handled outside the persistence boundary.

---

## 12. Policies

```yaml
---
id: persistence:POL-001
type: Policy
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
title: persistence I/O is bounded to VECHE_HOME and respects 0700 mode
policy_kind: io_scope
applicability:
  applies_to: |
    every Behavior in §6 and every Contract in §7 — the entire
    persistence partition's interaction with the filesystem
predicate: |
  - InMemoryMeetingStore MUST NOT open any filesystem path.
  - FileMeetingStore MUST NOT open any path outside `${VECHE_HOME}`
    for read or write. The user config file
    `${VECHE_HOME}/config.json` is opened READ-ONLY.
  - FileMeetingStore MUST create `${VECHE_HOME}` and any
    `meetings/<id>/` directory with mode 0700.
  - FileMeetingStore MUST NOT delete any file. Operators prune
    manually.
  - No code path in this partition spawns a subprocess, opens a
    network socket, or reads environment variables other than
    `VECHE_HOME` (and `HOME` to derive its default).
negative_test_obligations:
  - run each BEH-001..011 path while monitoring open(2) syscalls (or
    equivalent fs-probe); assert no open against any path outside
    `${VECHE_HOME}`
  - run each BEH path while monitoring exec(2) / connect(2); assert
    none invoked
  - assert directory mode after first createMeeting is exactly 0700
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes: [each BEH path]
  failure_scenarios:
    - any open against a path outside `${VECHE_HOME}`
    - any subprocess spawned from this partition
    - directory mode wider than 0700
---
```

---

## 13. Constraints

```yaml
---
id: persistence:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
constraint: |
  Persistence MUST be implemented using only Node's built-in
  `node:fs/promises` and `node:path`. No third-party storage library
  (level, sqlite, lmdb, redis) is permitted in v1.
rationale: |
  The format on disk is the public storage Surface (SUR-001) and is
  read cross-process by the `veche` CLI. A third-party engine would
  hide the format behind a vendor library and break the
  cross-process read contract; using only `fs.promises` keeps the
  format inspectable with `cat` and portable across operating
  systems.
test_obligation:
  predicate: |
    package.json `dependencies` of the persistence slice (as expressed
    in src/features/persistence) contain no entries other than the
    Node built-ins listed above. Importing the persistence slice's
    index.ts and traversing its imports yields only first-party files
    and Node built-ins.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a third-party storage library is added
---
```

```yaml
---
id: persistence:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
constraint: |
  v1 ships without a cross-process file lock. The store does NOT
  attempt fcntl / flock / lockfile-based mutual exclusion between MCP
  server processes that share `${VECHE_HOME}`.
rationale: |
  The product invariant (single MCP server per `${VECHE_HOME}`) is
  enforced operationally. A naive lockfile creates new failure modes
  (stale locks across crashes, NFS lock semantics) that v1 has no
  budget to test on every supported filesystem. Deferred to v2 with
  an explicit ASSUMPTION (ASM-002).
test_obligation:
  predicate: |
    Source under src/features/persistence does not call any of:
    `fcntl`, `flock`, `lockfile`, `proper-lockfile`, or
    `'@npmcli/fs'.flock`. There is no `*.lock` file written under
    `${VECHE_HOME}` by FileMeetingStore.
  test_template: contract
  boundary_classes:
    - source dependency snapshot
  failure_scenarios:
    - a lockfile primitive is introduced without an accompanying
      Delta + Migration (because that change would also alter SUR-001)
---
```

---

## 14. Migrations

_None._ This is the brownfield baseline of the persistence partition;
no schema or data-at-rest migration is in flight. New `Migration`
elements are added when (a) the on-disk JSONL format changes, (b)
manifest.json shape evolves, or (c) the `${VECHE_HOME}` layout is
restructured.

---

## 15. Deltas

_None._ No behavior change relative to the brownfield baseline is
proposed in this revision. Future PRs touching persistence MUST
either (a) add a `Delta` here against `baseline_version: persistence:BL-001`,
or (b) extend `Discovery scope` and refresh the baseline first.

---

## 16. Implementation bindings

```yaml
---
id: persistence:IMP-001
type: ImplementationBinding
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
target_ids:
  - persistence:BEH-001
  - persistence:BEH-002
  - persistence:BEH-003
  - persistence:BEH-004
  - persistence:BEH-005
  - persistence:BEH-006
  - persistence:BEH-007
  - persistence:BEH-008
  - persistence:BEH-009
  - persistence:BEH-010
  - persistence:BEH-011
  - persistence:CTR-001
  - persistence:CTR-002
  - persistence:CTR-003
  - persistence:CTR-004
  - persistence:CTR-005
  - persistence:INV-001
  - persistence:INV-002
  - persistence:INV-003
  - persistence:INV-004
  - persistence:INV-005
  - persistence:INV-006
  - persistence:INV-007
  - persistence:INV-008
  - persistence:INV-009
  - persistence:INV-010
binding:
  feature_slice:
    root: src/features/persistence
    inbound_port: src/features/persistence/ports/MeetingStorePort.ts
    application: null   # this slice is a port + adapters; no use-case layer of its own
    domain:
      - src/features/persistence/domain/Event.ts
    adapters_outbound:
      in_memory: src/features/persistence/adapters/in-memory/InMemoryMeetingStore.ts
      file: src/features/persistence/adapters/file/FileMeetingStore.ts
    barrel: src/features/persistence/index.ts
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/features/persistence/adapters/in-memory/InMemoryMeetingStore.test.ts
  and src/features/persistence/adapters/file/FileMeetingStore.test.ts.
  Every test that closes a Test obligation carries an
  `// @covers persistence:<ID>` marker for `sdd ready` to count.
---
```

---

## 17. Open questions

```yaml
---
id: persistence:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
question: |
  Should v1 ship with a cross-process file lock that prevents two MCP
  servers from sharing the same `${VECHE_HOME}` and corrupting
  events.jsonl, or remain operationally enforced as today?
options:
  - id: a
    label: keep_no_lock_v1
    consequence: |
      v1 stays as-is. Operators must enforce single-MCP-per-VECHE_HOME
      out of band. Faster to ship; matches current code. Risk: a user
      starting two MCP processes against the same `${VECHE_HOME}` may
      observe interleaved events.jsonl bytes (silent corruption until
      INV-001 fires on next read).
  - id: b
    label: introduce_lockfile_v1
    consequence: |
      Add `${VECHE_HOME}/server.lock` written via proper-lockfile (or
      equivalent), refused on contention. Higher correctness; new
      failure modes around stale locks across process kills, NFS lock
      semantics, and the `veche` CLI accidentally observing the lock
      file. Requires a new Surface (or a member on SUR-001) and full
      cross-platform tests.
blocking: no
owner: cyberash
default_if_unresolved: a   # see ASM-002
---
```

```yaml
---
id: persistence:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
question: |
  Should `events.jsonl` support log rotation (per-Meeting size cap or
  age cap) in v1, or stay unbounded with manual operator pruning?
options:
  - id: a
    label: unbounded_v1
    consequence: |
      v1 stays as-is. Operators delete `meetings/<id>/` to reclaim
      space. Simple and matches current code. Long-running
      installations may accumulate unbounded disk usage.
  - id: b
    label: introduce_rotation_v1
    consequence: |
      Add rotation policy (e.g. cap at 10 MiB per events.jsonl with
      a follow-on `events.<n>.jsonl`). Requires updating CTR-001 (line
      format) and SUR-001 (directory layout) — at least a minor bump
      and a Migration for in-flight Meetings.
blocking: no
owner: cyberash
default_if_unresolved: a   # see ASM-003
---
```

---

## 18. Assumptions

```yaml
---
id: persistence:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
assumption: |
  POSIX filesystem semantics — specifically `rename(2)` atomicity
  within the same filesystem, `fsync(2)` durability, and `O_APPEND`
  serialisation — hold on every supported host (macOS, Linux, modern
  WSL2). Behaviour on networked filesystems (NFS, SMB) is out of
  scope; operators using such filesystems for `${VECHE_HOME}` are
  unsupported.
blocking: no
review_by: 2026-08-01
default_if_unresolved: keep_assumption
tests:
  - src/features/persistence/adapters/file/FileMeetingStore.test.ts § "atomic manifest rewrite under high concurrency"
partition_id_check: persistence
---
```

```yaml
---
id: persistence:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
assumption: |
  Single MCP server per `${VECHE_HOME}` is enforced operationally
  (e.g. by the orchestrator agent or a deployment guard). The
  partition does not implement a cross-process lockfile in v1; OQ-001
  remains open for v2 review.
source_open_q: persistence:OQ-001
blocking: no
review_by: 2026-08-01
default_if_unresolved: keep_assumption
tests:
  - src/features/persistence/adapters/file/FileMeetingStore.test.ts § "intra-process append serialisation"
---
```

```yaml
---
id: persistence:ASM-003
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-01T21:41:14.905Z
    change_request: local/spec-migration-persistence-v1
    scope: first-time-approval
partition_id: persistence
assumption: |
  No event-log rotation in v1. Operators prune Meetings by deleting
  `meetings/<id>/` directories. OQ-002 remains open for v2 review if
  field reports show unbounded growth becoming a problem.
source_open_q: persistence:OQ-002
blocking: no
review_by: 2026-10-01
default_if_unresolved: keep_assumption
tests:
  - src/features/persistence/adapters/file/FileMeetingStore.test.ts § "long log fold performance is bounded"
---
```

---

## 19. Out of scope

The following are explicitly **outside** the persistence partition's
gate and contract surface:

- Multi-machine clustering / shared `${VECHE_HOME}` across hosts.
- Backup, restore, or off-site replication tooling.
- Schema migration of `events.jsonl` (no Migration is in flight in
  this revision; future format changes will be authored as
  `Migration` blocks under §13).
- Authentication / authorization at the persistence boundary
  (filesystem permissions are the only access-control mechanism).
- The `Meeting`, `Job`, `Participant`, and `Message` entity shapes
  themselves — those are owned by the `meeting` partition (still in
  classical narrative form under `spec/features/meeting/*.md`); the
  persistence partition references them only as opaque sub-shapes
  inside CTR-002 / CTR-004.
- Cross-process notification primitives — the watch path uses
  polling (see web-viewer partition).

---
