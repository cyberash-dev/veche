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
    reference: 2e943cd66ff1376efd0e7bbaa43b20f52d1b9685cd45b51a8c0f83e4a3a5d92e
    note: |
      Token covers ports/, adapters/file/, adapters/in-memory/,
      domain/Event.ts, and index.ts of the persistence slice.
      Cross-cutting domain types (Meeting, Job, Message, Participant,
      Cursor) live in the meeting slice and are imported as types;
      they are intentionally excluded from this partition's Discovery
      scope and will be covered by the meeting partition's baseline
      when that partition migrates.
freshness_token: 2e943cd66ff1376efd0e7bbaa43b20f52d1b9685cd45b51a8c0f83e4a3a5d92e
baseline_commit_sha: 1b81125334731d6a8340c1368ad3c9e98e586f69
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

## Partition: agent-integration

> Migrated from `spec/features/agent-integration/*.md` (legacy
> narrative remains until this partition is approved). Every typed ID
> below lands as `lifecycle.status: proposed`; promotion requires
> `sdd approve` from a non-agent identity.

### Context (agent-integration)

The `agent-integration` partition owns the single abstraction every
external LLM integration conforms to (`AgentAdapterPort`) plus the
Profile system that resolves Participant configuration. v1 ships two
concrete adapters, both stdio subprocesses: `codex-cli` (the Codex
CLI) and `claude-code-cli` (the Claude Code CLI). Adapters are
consumed by the `committee-protocol` partition (which owns the
`DispatchTurnUseCase`); the `meeting` partition consumes them only
indirectly during `start_meeting` (`openSession`) and `end_meeting`
(`closeSession`).

Boundaries:

- The Adapter does NOT own retry policy at the per-Turn level —
  `DispatchTurnUseCase` (committee-protocol) drives retries.
- The Adapter does NOT own conversation transcript composition —
  prompt assembly is the dispatcher's job; the Adapter receives a
  finished prompt string + a Session reference.
- The Adapter does NOT probe authentication. The first Turn that
  fails on auth surfaces as a runtime adapter error and the
  Participant is dropped via `handle-agent-failure`.

### Glossary (agent-integration)

- **`AdapterKind`** — Closed enum: `codex-cli`, `claude-code-cli`.
- **`Session`** — Per-Participant adapter-local state with `{ id,
  adapter, participantId, meetingId, providerRef, status, openedAt,
  closedAt }`. `providerRef` is the provider-side continuity token
  (Codex `thread_id`; Claude Code echoes the supplied UUID).
- **`Turn`** — Input to `sendTurn`: `{ session, prompt,
  transcriptPrefix, systemPrompt, workdir, model, extraFlags, env,
  roundNumber, timeoutMs, cancellationSignal }`.
- **`TurnResult`** — Output of `sendTurn`: `{ kind: 'speech' | 'pass'
  | 'failure', text, error?, providerRef?, durationMs }`.
- **`Profile`** — Named record in `${VECHE_HOME}/config.json`:
  `{ name, adapter, model?, systemPrompt?, workdir?, extraFlags[],
  env }`.
- **`PASS_PROTOCOL_SUFFIX`** — Literal text appended to every
  Member's first-Turn system prompt instructing the model that
  `<PASS/>` (alone) means decline-this-Round.
- **`MAX_ATTEMPTS_PER_TURN`** — Global constant `3`.
- **Recursion Guard (Claude Code only)** — `--strict-mcp-config
  --mcp-config '{"mcpServers":{}}'`. Without it, a Claude Code
  Member could re-enter `start_meeting` and recurse.
- **Allow-listed `extraFlags`** — Per-adapter set of flags that may
  appear in `Profile.extraFlags` / Member overrides; everything
  outside the set is rejected at `start_meeting` time.
- **Forbidden env keys** — `HOME`, `PATH`, `CLAUDE_BIN`, `CODEX_BIN`,
  `CODEX_API_KEY` (the last is also forbidden in `Profile.env` but
  the adapter inherits it from the server process when set).

### Partition record (agent-integration)

```yaml
---
id: agent-integration
type: Partition
partition_id: agent-integration
owner_team: cyberash
gate_scope:
  - agent-integration
dependencies_on_other_partitions:
  - persistence    # adapters do not touch the store directly, but
                   # `meeting` flows them to `MeetingStorePort` for
                   # message persistence; this declaration is for
                   # gate ordering only.
default_policy_set:
  - agent-integration:POL-001
id_namespace: agent-integration
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (agent-integration)

```yaml
---
id: agent-integration:BL-001
type: BrownfieldBaseline
lifecycle:
  status: proposed
partition_id: agent-integration
discovery_scope:
  - src/features/agent-integration
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: b25bd93a32b9d122658dfbdc2048c7254c4d1e8132ed3b0051be94065f42cf54
    note: |
      Token covers domain/ (Session, Turn, Profile, errors), ports/
      (AgentAdapterPort, AgentAdapterRegistryPort), application/
      (ProfileResolver), adapters/ (codex-cli, claude-code-cli, fake,
      shared/SubprocessRunner), and index.ts of the slice. The
      DispatchTurnUseCase that drives the port lives in the
      committee-protocol slice and is intentionally excluded from this
      baseline.
freshness_token: b25bd93a32b9d122658dfbdc2048c7254c4d1e8132ed3b0051be94065f42cf54
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner records
  an approval_record via `sdd approve`. The Brownfield baseline
  carries no preserved as-is behavior by itself; the typed Behavior /
  Invariant / Contract blocks below preserve those facts the
  migration intends to keep.
---
```

### Surfaces (agent-integration)

```yaml
---
id: agent-integration:SUR-001
type: Surface
lifecycle:
  status: proposed
partition_id: agent-integration
name: veche/agent-adapter-port
version: "0.1.0"
boundary_type: sdk
members:
  - agent-integration:CTR-001
  - agent-integration:CTR-002
  - agent-integration:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  In-process SDK Surface: the TypeScript shape of AgentAdapterPort
  + Session + Turn + TurnResult that other slices import. Boundary
  is `sdk` per SDD §1.4 (the closed enum has no `internal_port`
  value; `sdk` is the canonical fit for an importable, versionable
  TypeScript contract). Consumers: committee-protocol
  (DispatchTurnUseCase, RunRoundUseCase, HandleAgentFailureUseCase)
  and meeting (StartMeetingUseCase, EndMeetingUseCase,
  CancelJobUseCase). Renaming a port method, changing the shape of
  Session / Turn / TurnResult, or widening the error.code enum is a
  major bump. Adding a new optional field on Turn or a new
  AdapterKind is a minor bump.
---
```

```yaml
---
id: agent-integration:SUR-002
type: Surface
lifecycle:
  status: proposed
partition_id: agent-integration
name: veche/profile-config-format
version: "0.1.0"
boundary_type: public_storage
members:
  - agent-integration:CTR-004
consumer_compat_policy: semver_per_surface
notes: |
  Public storage surface for `${VECHE_HOME}/config.json`. The file is
  authored by humans and read by ProfileResolver at meeting start.
  `version: 1` in the JSON envelope pins the on-disk schema; bumping
  the envelope version is a major bump on this Surface and triggers
  a Migration on operator config.
---
```

### Behaviors (agent-integration)

```yaml
---
id: agent-integration:BEH-001
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: capabilities returns the static adapter capability record
given: |
  - the Adapter binary is resolvable on PATH (or unresolvable — this
    method does not check)
when: caller invokes `AgentAdapterPort.capabilities()`
then: |
  the call returns `{ adapter: AdapterKind, supportsWorkdir: boolean,
  supportsSystemPrompt: boolean }` synchronously (or as a resolved
  Promise). The codex-cli adapter returns
  `{ supportsWorkdir: true, supportsSystemPrompt: true }`; the
  claude-code-cli adapter returns the same. The result is stable for
  the lifetime of the Adapter instance and does NOT spawn a
  subprocess.
negative_cases:
  - none — `capabilities` is total
out_of_scope:
  - probing whether the binary exists (handled by openSession)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: pure_query_no_runtime_side_effects
  reason: capabilities is a static accessor, not a port operation against external state
data_scope: all_data
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    For every concrete adapter, capabilities() returns the documented
    record without I/O.
  test_template: unit
  boundary_classes:
    - codex-cli capability shape
    - claude-code-cli capability shape
  failure_scenarios:
    - capabilities returns null or throws
    - capabilities triggers a subprocess spawn
---
```

```yaml
---
id: agent-integration:BEH-002
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: openSession constructs a Session and never spawns a subprocess
given: |
  - Adapter binary is on PATH (otherwise AdapterNotAvailable)
  - caller passes a fresh sessionId from IdGenPort
when: caller invokes `AgentAdapterPort.openSession(input)`
then: |
  the Adapter:
    1. probes `<bin> --version` once per process lifetime to verify
       binary availability (Claude Code: same probe; Codex: same).
       Subsequent calls reuse the cached result. On ENOENT raises
       AdapterNotAvailable with code `claude-binary-not-found` /
       `codex-binary-not-found`.
    2. validates `extraFlags` against the adapter's allow-list. Any
       flag outside the set raises AdapterConfigInvalid with code
       `AdapterFlagNotAllowed` (raised at ProfileResolver layer for
       static configs; at openSession for runtime overrides).
    3. records the Session in an adapter-local registry and returns
       `{ id: sessionId, adapter, participantId, meetingId,
       providerRef: <adapter-specific>, status: 'open', openedAt:
       Clock.now, closedAt: null }`.
  No `codex` / `claude` invocation happens here. Provider-side state
  (Codex thread, Claude Code session record) is created on Turn 1.
negative_cases:
  - bin missing on PATH                     => AdapterNotAvailable
  - extraFlags outside allow-list           => AdapterConfigInvalid
out_of_scope:
  - auth pre-probe (per Rule "No auth pre-probe")
  - reading the user config file (handled by ProfileResolver)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(sessionId)"
  time_source: external
  reason: openedAt is supplied by the injected Clock; the binary-probe is cached, not re-run per call
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    For each adapter, openSession with a valid input returns a
    Session whose status=open, providerRef satisfies the adapter's
    contract (null for codex-cli, equal to sessionId for
    claude-code-cli), and no child process is spawned. Missing
    binary raises AdapterNotAvailable; disallowed extraFlag raises
    AdapterConfigInvalid.
  test_template: integration
  boundary_classes:
    - codex-cli openSession (providerRef null)
    - claude-code-cli openSession (providerRef = sessionId)
    - missing binary
    - disallowed extraFlag at openSession
  failure_scenarios:
    - openSession spawns the binary
    - missing binary raises a different error class
---
```

```yaml
---
id: agent-integration:BEH-003
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: sendTurn dispatches one subprocess per attempt and parses one outcome
given: |
  - Session.status=open
  - prompt is a non-null string (possibly empty)
  - timeoutMs >= 1000
when: caller invokes `AgentAdapterPort.sendTurn(turn)`
then: |
  the Adapter:
    1. selects the invocation form per Session.providerRef state
       (Turn 1 vs resume — see CTR-001 / CTR-002 for the per-adapter
       argv contract).
    2. spawns the binary as a child process with the chosen argv,
       env (filtered against the forbidden list), stdio piped, and
       cancellationSignal forwarded.
    3. enforces timeoutMs by sending SIGTERM at the deadline; if the
       process does not exit within 2000 ms it sends SIGKILL.
    4. on exit code 0, parses the output per the adapter's contract;
       if parse succeeds, returns
       `{ kind: 'speech'|'pass', text, error: null, providerRef,
       durationMs }`. The kind/text is determined by ParsePassSignal
       (committee-protocol:BEH-009).
    5. on exit code != 0, classifies per the adapter's exit-code
       table (CTR-001 / CTR-002) and returns
       `{ kind: 'failure', error: { code, message, retryable },
       durationMs }`.
    6. on parse failure (or empty output despite exit 0) returns
       `{ kind: 'failure', error: { code: '*-parse-*' or
       '*-parse-empty', retryable: false }, durationMs }`.
    7. on timeout returns `{ kind: 'failure', error:
       { code: 'AdapterTurnTimeout', retryable: true }, durationMs }`.
    8. on cancellation returns `{ kind: 'failure', error:
       { code: '*-cancelled', retryable: false }, durationMs }`.
  Exactly one subprocess per call. Retries are NOT performed inside
  sendTurn — DispatchTurnUseCase (committee-protocol:BEH-007) owns
  retry policy.
negative_cases:
  - sendTurn called on closed Session       => AdapterNotAvailable with code 'codex-session-closed' or 'claude-session-closed'
  - subprocess spawn fails (ENOENT on rerun) => AdapterNotAvailable
out_of_scope:
  - prompt assembly (committee-protocol:BEH-007)
  - retry loop (committee-protocol:BEH-007)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: deadlines are measured against the injected Clock; durationMs is the wall-clock difference between spawn and outcome
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    For each adapter, sendTurn yields exactly one TurnResult per
    invocation, exactly one subprocess is spawned (or zero for
    closed Session), every error class maps to the documented code,
    and timeouts honour the SIGTERM→SIGKILL escalation timing.
  test_template: integration
  boundary_classes:
    - happy path: speech outcome
    - happy path: pass outcome
    - timeout fires SIGTERM then SIGKILL
    - cancellation mid-run
    - non-zero exit per adapter exit-code table
    - parse failure on exit 0
  failure_scenarios:
    - second subprocess spawned per call
    - silently retrying on retryable failure
    - SIGKILL never sent after SIGTERM grace period
---
```

```yaml
---
id: agent-integration:BEH-004
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: closeSession transitions Session to closed and terminates in-flight subprocess
given: |
  - Session was created via openSession; status may be open or
    already closed
when: caller invokes `AgentAdapterPort.closeSession(session)`
then: |
  the Adapter:
    1. flips Session.status to `closed` and sets closedAt = Clock.now
       (no-op if already closed).
    2. removes the Session from the adapter-local registry.
    3. if any in-flight sendTurn subprocess exists for this Session,
       sends SIGTERM, waits up to 2000 ms, escalates to SIGKILL.
    4. does NOT issue a provider-side "forget" call. Codex thread
       state remains server-side (no longer resumed); Claude Code
       session files under `~/.claude/` are managed by the CLI's
       own TTL.
  Returns the updated Session synchronously after termination
  attempts complete.
negative_cases:
  - closeSession on already-closed Session is a no-op (returns the
    same Session unchanged)
out_of_scope:
  - removing provider-side state (out of v1)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(sessionId)"
  time_source: external
  reason: closedAt comes from the injected Clock
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    closeSession on an open Session terminates any in-flight child
    subprocess within the SIGTERM/SIGKILL window and removes the
    Session from the registry. closeSession on a closed Session is
    idempotent.
  test_template: integration
  boundary_classes:
    - close with no in-flight subprocess
    - close with in-flight subprocess (SIGTERM grace honoured)
    - close with stuck subprocess (SIGKILL fires)
    - double close
  failure_scenarios:
    - subprocess survives close
    - second close throws
---
```

```yaml
---
id: agent-integration:BEH-005
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: ProfileResolver merges Profile + Member overrides into ResolvedParticipantConfig
given: |
  - the user config file (UserConfigFile) is loaded or null
  - caller passes MemberInput { profile?, adapter?, systemPrompt?,
    model?, workdir?, extraFlags?, env? }
when: caller invokes `ProfileResolver.resolve(input)`
then: |
  the resolver:
    1. if `input.profile` is set, looks it up in
       UserConfigFile.profiles by `name`; raises ProfileNotFound on
       miss.
    2. if `input.adapter` is also set, asserts it equals
       `profile.adapter`; raises ProfileAdapterMismatch on conflict.
    3. derives the effective adapter from `input.adapter` or
       `profile.adapter`; if both absent, raises ProfileNotFound
       with synthetic name `(missing adapter and profile)`.
    4. merges fields with input precedence over profile
       (systemPrompt, model, workdir, extraFlags); env is shallow
       union with input keys taking precedence.
    5. validates every effective `extraFlags` entry against the
       adapter's allow-list (regex set per adapter); raises
       AdapterFlagNotAllowed on the first mismatch.
    6. returns ResolvedParticipantConfig with the resolved values
       plus `profile: input.profile ?? null` for traceability.
negative_cases:
  - input.profile not in UserConfigFile     => ProfileNotFound
  - input.adapter != profile.adapter        => ProfileAdapterMismatch
  - neither input.adapter nor profile.adapter => ProfileNotFound
  - extraFlag outside allow-list            => AdapterFlagNotAllowed
out_of_scope:
  - resolving Profile.workdir to absolute / readable (handled at
    StartMeetingUseCase boundary)
  - validating env key shape (handled at StartMeetingUseCase)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: pure_function_over_static_config
  reason: ProfileResolver is a pure resolver; no I/O, no clock
data_scope: all_data
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    For each branch (profile-only, override-only, profile+override,
    mismatching adapter, missing profile, disallowed flag), the
    resolver returns the documented record or raises the documented
    error.
  test_template: unit
  boundary_classes:
    - profile only (no overrides)
    - overrides only (no profile)
    - profile + overrides (overrides win)
    - missing profile referenced by name
    - adapter mismatch between profile and override
    - disallowed extraFlag
  failure_scenarios:
    - input.env silently dropped
    - profile.adapter wins over input.adapter
---
```

```yaml
---
id: agent-integration:BEH-006
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: codex-cli emits Turn-1 vs resume argv shapes per CTR-001
given: |
  - codex-cli adapter Session
  - sendTurn is invoked
when: the adapter builds argv for the subprocess
then: |
  - Turn 1 (`session.providerRef === null`): argv =
    `['exec', '--json', '-o', <tmpPath>, '--skip-git-repo-check',
     ...(model ? ['--model', model] : []),
     '--sandbox', <sandbox or 'read-only'>,
     ...(workdir ? ['--cd', workdir] : []),
     ...(systemPrompt ? ['-c', `instructions=${JSON.stringify(systemPrompt)}`] : []),
     ...extraFlags, prompt]`.
  - Turn N>=2 (`session.providerRef !== null`): argv =
    `['exec', 'resume', <providerRef>, '--json', '-o', <tmpPath>,
     '--skip-git-repo-check',
     ...(model ? ['--model', model] : []),
     ...extraFlags, prompt]`.
  The adapter MUST NOT emit `--sandbox`, `--cd`, or `-c instructions=…`
  on resume — Codex rejects them with a usage error.
  `--skip-git-repo-check` is auto-injected on every invocation; if a
  user-supplied `extraFlags` already contains it the adapter
  de-duplicates rather than emitting it twice.
negative_cases:
  - resume invocation includes `--sandbox`     => contract violation
out_of_scope:
  - upgrading sandbox above read-only on resume
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    For each Turn-1 input shape, the spawned argv matches the
    documented contract. For each Turn-N (resume) shape, the
    forbidden Turn-1-only flags are absent. `--skip-git-repo-check`
    is present exactly once on every invocation.
  test_template: integration
  boundary_classes:
    - Turn 1 with workdir + systemPrompt + extraFlags
    - Turn 1 minimal (no overrides)
    - resume with model override
    - resume rejects --sandbox attempt
    - --skip-git-repo-check auto-inject + de-dup
  failure_scenarios:
    - resume emits --sandbox / --cd / -c instructions
    - --skip-git-repo-check duplicated
---
```

```yaml
---
id: agent-integration:BEH-007
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: claude-code-cli emits --session-id on Turn 1 and --resume thereafter per CTR-002
given: |
  - claude-code-cli adapter Session
  - sendTurn invoked; the adapter tracks `hasStartedConversation`
    per Session, initialised false at openSession
when: the adapter builds argv for the subprocess
then: |
  - Turn 1 (`hasStartedConversation === false`): argv contains
    `--session-id <providerRef>` (creates a new conversation).
  - Turn N>=2 (`hasStartedConversation === true`): argv contains
    `--resume <providerRef>` (continues the existing conversation).
  Every Turn unconditionally emits the Recursion Guard pair
  (`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`),
  `-p`, `--output-format json`, `--input-format text`,
  `--permission-mode default`, and `--disallowedTools=<csv>` (with
  the `=` form — see CTR-002). The default disallowed list is
  `Bash,Edit,Write,NotebookEdit`; if `extraFlags` includes
  `--allowedTools` or `--disallowedTools`, the adapter omits its
  default. `--bare` is opt-in only via `extraFlags` and requires
  the operator to provide ANTHROPIC_API_KEY or apiKeyHelper.
  After exit 0, if the parsed `session_id` matches the supplied
  `providerRef`, the adapter flips `hasStartedConversation = true`;
  on mismatch returns AdapterParseError with code
  `claude-session-mismatch`.
negative_cases:
  - Turn 2+ uses --session-id (would fail "Session ID … is already in use")
  - missing Recursion Guard
out_of_scope:
  - --continue (interactive-only; never used)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
  - agent-integration:POL-002
test_obligation:
  predicate: |
    For Turn 1 the spawned argv contains `--session-id <uuid>`; for
    Turn 2 it contains `--resume <uuid>`. Recursion Guard pair is
    present on every spawn. Default disallowed-tools list is emitted
    iff the operator did not override allow/disallow lists.
  test_template: integration
  boundary_classes:
    - Turn 1 with default tool policy
    - Turn 2 (resume)
    - operator override of disallowedTools suppresses default
    - opt-in --bare requires ANTHROPIC_API_KEY (config-time check)
  failure_scenarios:
    - Recursion Guard absent on any Turn
    - --session-id reused on Turn 2
    - default disallowed list leaked despite operator override
---
```

```yaml
---
id: agent-integration:BEH-008
type: Behavior
lifecycle:
  status: proposed
partition_id: agent-integration
title: codex-cli captures provider thread_id on Turn 1 from the JSONL stream
given: |
  - codex-cli sendTurn Turn 1 (providerRef == null)
when: the subprocess emits the JSONL `thread.started { thread_id }` event on stdout
then: |
  the adapter captures `thread_id`, stores it as
  `Session.providerRef`, and returns it in TurnResult.providerRef.
  Subsequent Turns invoke `codex exec resume <thread_id>`. The
  adapter never invents a thread_id; the only source is the
  provider's own event.
negative_cases:
  - Turn 1 exits 0 without thread.started   => AdapterParseError code 'codex-parse-empty' (or codex-parse-* depending on cause)
out_of_scope:
  - reusing a thread across Meetings (each Member gets a fresh
    Session at start_meeting; thread_id is ephemeral to the Session)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    With a fake codex subprocess emitting thread.started, the
    adapter records the thread_id on the Session and uses it on the
    next Turn. Without thread.started on Turn 1, the adapter
    surfaces an AdapterParseError.
  test_template: integration
  boundary_classes:
    - Turn 1 with thread.started + assistant_message
    - Turn 1 with no thread.started (parse error)
    - Turn 2 reuses the captured thread_id
  failure_scenarios:
    - adapter invents a thread_id
    - thread_id silently overwritten on resume
---
```

### Contracts (agent-integration)

```yaml
---
id: agent-integration:CTR-001
type: Contract
lifecycle:
  status: proposed
partition_id: agent-integration
title: codex-cli subprocess argv and exit-code contract
surface_ref: agent-integration:SUR-001
schema:
  description: |
    Argv shapes and exit-code-to-error mapping for the codex-cli
    adapter (`bin: $CODEX_BIN || codex`).
  argv_turn_1: |
    [
      'exec',
      '--json',
      '-o', <tmpPath>,
      '--skip-git-repo-check',
      ...(model ? ['--model', model] : []),
      '--sandbox', <sandbox>,
      ...(workdir ? ['--cd', workdir] : []),
      ...(systemPrompt ? ['-c', `instructions=${JSON.stringify(systemPrompt)}`] : []),
      ...extraFlags,
      <promptText>
    ]
  argv_turn_n_resume: |
    [
      'exec', 'resume', <providerRef>,
      '--json',
      '-o', <tmpPath>,
      '--skip-git-repo-check',
      ...(model ? ['--model', model] : []),
      ...extraFlags,
      <promptText>
    ]
  outcome_parsing: |
    On exit 0:
      1. read final assistant message from <tmpPath> (atomic write
         by the CLI).
      2. fall back to the last JSONL `item.completed { item:
         { type: 'assistant_message', text } }` if -o yielded
         empty.
      3. if both empty -> AdapterParseError code 'codex-parse-empty'.
      4. classify kind via ParsePassSignal (committee-protocol).
    On non-zero exit:
      1   -> AdapterInvocationError code 'codex-generic',
              retryable=true, message=<last stderr line or error event>.
      2   -> AdapterConfigInvalid code 'codex-usage', retryable=false.
      *   -> AdapterInvocationError code 'codex-exit-<N>', retryable=true.
    On wall-clock timeout (timeoutMs elapsed):
      AdapterTurnTimeout, retryable=true. SIGTERM, escalate to
      SIGKILL after 2000 ms.
    On cancellation:
      AdapterInvocationError code 'codex-cancelled', retryable=false.
preconditions:
  - codex binary on PATH (verified at openSession)
  - tmpPath parent dir is writable
postconditions:
  - tmpPath cleaned up on success (best-effort); retained 10 minutes on failure
external_identifiers:
  - "argv strings: exec, resume, --json, -o, --skip-git-repo-check, --model, --sandbox, --cd, -c, instructions=<json>"
  - "error code strings: codex-binary-not-found, codex-session-closed, codex-generic, codex-usage, codex-parse-empty, codex-cancelled, codex-exit-<N>, AdapterTurnTimeout"
compatibility_rules:
  - removing or renaming any argv form (e.g. dropping --skip-git-repo-check) => major bump on SUR-001
  - widening exit-code -> error mapping (e.g. classifying exit 2 as retryable) => major bump
  - adding a new error code value => minor bump
  - extending allow-listed extraFlags => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: timeout enforcement uses the injected Clock; subprocess lifetime is per-call
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    A captured argv from the FakeSubprocessRunner equals the
    documented templates, modulo placeholder substitution. Each
    documented exit-code branch produces the documented error code
    and retryable flag.
  test_template: contract
  boundary_classes:
    - argv Turn 1 (full options)
    - argv Turn N (resume)
    - exit 0 with -o populated
    - exit 0 with -o empty (fallback to JSONL)
    - exit 1 (generic)
    - exit 2 (usage)
    - timeout
    - cancellation
  failure_scenarios:
    - argv string drift unbumped
    - exit 2 silently classified retryable
---
```

```yaml
---
id: agent-integration:CTR-002
type: Contract
lifecycle:
  status: proposed
partition_id: agent-integration
title: claude-code-cli subprocess argv and exit-code contract
surface_ref: agent-integration:SUR-001
schema:
  description: |
    Argv shapes and exit-code-to-error mapping for the
    claude-code-cli adapter (`bin: $CLAUDE_BIN || claude`).
  argv_turn_1: |
    [
      '-p',
      '--output-format', 'json',
      '--input-format', 'text',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'default',
      '--disallowedTools=<csv-or-empty-when-overridden>',
      ...(model ? ['--model', model] : []),
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt + '\n\n' + PASS_PROTOCOL_SUFFIX] : []),
      ...(workdir ? ['--add-dir', workdir] : []),
      '--session-id', <providerRef>,
      ...extraFlags,
      <promptText>
    ]
  argv_turn_n_resume: |
    [
      '-p',
      '--output-format', 'json',
      '--input-format', 'text',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'default',
      '--disallowedTools=<csv-or-empty-when-overridden>',
      ...(model ? ['--model', model] : []),
      '--resume', <providerRef>,
      ...extraFlags,
      <promptText>
    ]
  outcome_parsing: |
    On exit 0:
      Parse stdout as a single JSON object.
      Expect `{ type: 'result', subtype: 'success', result: <string>,
      session_id: <uuid> }`.
      If JSON parse fails -> AdapterParseError code 'claude-parse-json'.
      If typeof result !== 'string' -> AdapterParseError code 'claude-parse-empty'.
      If subtype !== 'success' -> AdapterInvocationError code 'claude-runtime', retryable=true, message=<result>.
      If session_id !== providerRef -> AdapterParseError code 'claude-session-mismatch'.
      Else classify kind via ParsePassSignal.
    On non-zero exit:
      2   -> AdapterConfigInvalid code 'claude-usage', retryable=false.
      130 -> AdapterTurnTimeout code 'claude-sigint', retryable=false.
      *   -> AdapterInvocationError code 'claude-exit-<N>', retryable=true.
    Cancellation / timeout: SIGTERM, escalate SIGKILL after 2000 ms.
preconditions:
  - claude binary on PATH
  - --disallowedTools uses the `=<csv>` argv-form (the CLI's variadic
    parser otherwise consumes the prompt)
postconditions:
  - first successful Turn flips hasStartedConversation = true
external_identifiers:
  - "argv strings: -p, --output-format, json, --input-format, text, --strict-mcp-config, --mcp-config, --mcp-config-payload-empty-mcpServers-object, --permission-mode, default, --disallowedTools=<csv>, --session-id, --resume, --model, --append-system-prompt, --add-dir"
  - "default disallowedTools list members: Bash, Edit, Write, NotebookEdit"
  - "error code strings: claude-binary-not-found, claude-parse-json, claude-parse-empty, claude-runtime, claude-session-mismatch, claude-usage, claude-sigint, claude-cancelled, claude-exit-<N>"
compatibility_rules:
  - removing the Recursion Guard pair (`--strict-mcp-config`, `--mcp-config '{"mcpServers":{}}'`) => major bump on SUR-001 + critical-security review
  - dropping the `=` form on --disallowedTools => major bump (CLI breaks with variadic parsing)
  - swapping --session-id semantics with --resume semantics on Turn 1 => major bump
  - widening default disallowedTools list (e.g. adding 'Read') => minor bump
  - tightening default disallowedTools list (removing an entry) => major bump
  - adding a new allow-listed extraFlag => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: new_writes_only
policy_refs:
  - agent-integration:POL-001
  - agent-integration:POL-002
test_obligation:
  predicate: |
    Captured argv on Turn 1 contains --session-id; on Turn 2
    contains --resume. Recursion Guard pair appears on every spawn.
    --disallowedTools always uses the `=` form. JSON envelope parse
    failures map to the documented error codes.
  test_template: contract
  boundary_classes:
    - Turn 1 with full options
    - Turn 2 resume
    - operator override suppresses default disallowedTools
    - exit 0 with subtype=success
    - exit 0 with subtype=error_during_execution -> claude-runtime
    - exit 2 (usage)
    - exit 130 (sigint)
  failure_scenarios:
    - Recursion Guard missing
    - --disallowedTools without `=`
    - claude-runtime classified as non-retryable
---
```

```yaml
---
id: agent-integration:CTR-003
type: Contract
lifecycle:
  status: proposed
partition_id: agent-integration
title: AgentAdapterPort method shapes and error taxonomy
surface_ref: agent-integration:SUR-001
schema:
  description: |
    Port-level method signatures and the closed error taxonomy.
    Implemented identically by every adapter.
  port: |
    interface AgentAdapterPort {
      capabilities(): AdapterCapabilities;
      openSession(input: OpenSessionInput): Promise<Session>;
      sendTurn(turn: Turn): Promise<TurnResult>;
      closeSession(session: Session): Promise<Session>;
    }
  capabilities_record: |
    AdapterCapabilities {
      adapter: 'codex-cli' | 'claude-code-cli';
      supportsWorkdir: boolean;
      supportsSystemPrompt: boolean;
    }
  open_session_input: |
    OpenSessionInput {
      meetingId: MeetingId;
      participantId: ParticipantId;
      sessionId: SessionId;
      systemPrompt: string | null;
      workdir: string | null;
      model: string | null;
      extraFlags: readonly string[];
      env: Readonly<Record<string,string>>;
    }
  turn_input: |
    Turn {
      session: Session;
      participantId: ParticipantId;
      prompt: string;
      transcriptPrefix: readonly MessageView[];
      systemPrompt: string | null;
      workdir: string | null;
      model: string | null;
      extraFlags: readonly string[];
      env: Readonly<Record<string,string>>;
      roundNumber: number;       // >= 1
      timeoutMs: number;          // >= 1000
      cancellationSignal: AbortSignal;
    }
  turn_result: |
    TurnResult {
      kind: 'speech' | 'pass' | 'failure';
      text: string | null;          // non-null for speech and failure
      error: { code: string; message: string; retryable: boolean } | null; // non-null for failure
      providerRef: string | null;
      durationMs: number;
    }
  error_classes: |
    AdapterNotAvailable    : retryable=false; binary missing or session closed
    AdapterConfigInvalid   : retryable=false; disallowed flag / unsupported option
    AdapterTurnTimeout     : retryable=true;  wall-clock budget exceeded
    AdapterInvocationError : retryable per-instance; non-zero exit, generic
    AdapterParseError      : retryable=false; subprocess output unparsable
preconditions:
  - SessionId is provided by the caller via IdGenPort
  - Clock and Signals are injected (no Date.now / no global AbortController in adapter code)
postconditions:
  - openSession produces a Session whose id == input.sessionId
  - sendTurn returns exactly one TurnResult; never throws an Adapter*Error directly (errors are folded into TurnResult.kind='failure')
external_identifiers:
  - method names: capabilities, openSession, sendTurn, closeSession
  - field names listed in the schema blocks above
  - error class names: AdapterNotAvailable, AdapterConfigInvalid, AdapterTurnTimeout, AdapterInvocationError, AdapterParseError
compatibility_rules:
  - renaming any port method                  => major bump on SUR-001
  - tightening optional field to required     => major bump
  - widening AdapterKind enum (new adapter)   => minor bump (new value, consumers use a switch with a default branch per INV)
  - adding a new error class                  => major bump (callers exhaustively switch)
  - adding a new error code (string) within an existing class => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: contract_describes_static_method_shapes
  reason: per-call concurrency lives on the BEH blocks, not on the schema record
data_scope: all_data
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    Every concrete adapter satisfies the port shape (TypeScript
    structural check via `Adapter satisfies AgentAdapterPort`); the
    error taxonomy is exercised end-to-end via the FakeAgentAdapter
    in committee.integration.test.ts.
  test_template: contract
  boundary_classes:
    - one concrete adapter satisfies port at compile time
    - each error class round-trips through TurnResult.failure
  failure_scenarios:
    - port shape drift unbumped
    - error class quietly downgraded to a different one
---
```

```yaml
---
id: agent-integration:CTR-004
type: Contract
lifecycle:
  status: proposed
partition_id: agent-integration
title: UserConfigFile JSON schema (${VECHE_HOME}/config.json)
surface_ref: agent-integration:SUR-002
schema:
  description: |
    The Profile config file consumed by ProfileResolver. JSON UTF-8.
  type: object
  required: [version, profiles]
  properties:
    version:
      type: integer
      const: 1
      description: schema envelope; bumping this is a major bump on SUR-002
    profiles:
      type: array
      items:
        type: object
        required: [name, adapter]
        properties:
          name:
            type: string
            pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$"
            description: unique within the file
          adapter:
            type: string
            enum: [codex-cli, claude-code-cli]
          model:
            type: [string, "null"]
          systemPrompt:
            type: [string, "null"]
          workdir:
            type: [string, "null"]
            description: absolute path; existence checked at start_meeting, not at file load
          extraFlags:
            type: array
            items: { type: string }
            description: every entry must be allow-listed for `adapter`
          env:
            type: object
            additionalProperties: { type: string }
            description: keys must match `^[A-Z_][A-Z0-9_]*$`; forbidden keys CODEX_API_KEY, HOME, PATH, CLAUDE_BIN, CODEX_BIN
preconditions:
  - file is UTF-8 JSON; parses with JSON.parse without errors
  - one profile name appears at most once
postconditions:
  - ProfileResolver builds a ResolvedParticipantConfig from any
    Member whose `profile` references an entry in `profiles[]`
external_identifiers:
  - JSON field names: version, profiles, name, adapter, model, systemPrompt, workdir, extraFlags, env
  - the integer literal 1 in `version`
  - adapter enum strings: codex-cli, claude-code-cli
compatibility_rules:
  - renaming any field                        => major bump on SUR-002 + Migration
  - adding a new optional field to Profile    => minor bump (resolvers ignore unknowns)
  - tightening an optional field to required  => major bump + Migration
  - widening adapter enum (new AdapterKind)   => minor bump (Profile.adapter remains sound; new adapter becomes selectable)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_on_disk_config
  reason: file is human-edited; no runtime concurrency dimension
data_scope: all_data
policy_refs:
  - agent-integration:POL-001
test_obligation:
  predicate: |
    The bundled `examples/config.json.example` parses against the
    schema. ProfileResolver round-trips a minimal profile and a
    full profile (every field set) through resolve() without
    mutation of unspecified fields.
  test_template: contract
  boundary_classes:
    - empty profiles[] (valid)
    - one profile per adapter
    - duplicate name rejected at resolver boundary (caller responsibility)
  failure_scenarios:
    - silent acceptance of unknown adapter string
    - silent acceptance of HOME / PATH in env
---
```

### Invariants (agent-integration)

```yaml
---
id: agent-integration:INV-001
type: Invariant
lifecycle:
  status: proposed
partition_id: agent-integration
title: every Adapter is a port-conformant black box
always: |
  Every concrete AgentAdapterPort implementation passes the
  TypeScript structural check `Adapter satisfies AgentAdapterPort`
  AND the integration tests in committee.integration.test.ts that
  exercise openSession → sendTurn × N → closeSession against the
  FakeAgentAdapter. New adapters MUST land with both checks in the
  same PR.
scope: agent-integration (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_port_conformance
  reason: structural conformance is a compile-time + test-time property, not a runtime one
negative_cases:
  - adapter omits closeSession              => compile failure
  - adapter sendTurn throws AdapterError     => contract violation (errors must be folded into TurnResult.kind='failure')
out_of_scope:
  - testing every adapter with real binaries (see e2e tests, opt-in)
test_obligation:
  predicate: |
    For every concrete AgentAdapterPort, a unit test asserts the
    structural-conformance property and the FakeAgentAdapter-driven
    integration test passes.
  test_template: contract
  boundary_classes:
    - codex-cli
    - claude-code-cli
    - FakeAgentAdapter (test fixture)
  failure_scenarios:
    - adapter throws Adapter*Error from sendTurn
---
```

```yaml
---
id: agent-integration:INV-002
type: Invariant
lifecycle:
  status: proposed
partition_id: agent-integration
title: Recursion Guard is present on every claude-code-cli spawn
always: |
  Every claude-code-cli subprocess invocation MUST include both
  `--strict-mcp-config` and `--mcp-config '{"mcpServers":{}}'` in
  the argv. Without this pair, a Member Claude Code would inherit
  the parent server's MCP configuration and could re-enter
  `start_meeting`, recursing infinitely. This is a load-bearing
  security invariant; the integration test asserts presence in
  every captured argv.
scope: agent-integration/claude-code-cli
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_argv_construction
  reason: argv shape is static per-call; concurrency lives on BEH-003
negative_cases:
  - any spawned argv is missing --strict-mcp-config or --mcp-config => contract violation
out_of_scope:
  - third-party tooling that wraps claude with its own argv
test_obligation:
  predicate: |
    Every argv captured by the FakeSubprocessRunner during the
    claude-code-cli adapter integration tests contains the exact
    pair (`--strict-mcp-config`, `--mcp-config`,
    `'{"mcpServers":{}}'`) in adjacent positions.
  test_template: contract
  boundary_classes:
    - Turn 1 (default options)
    - Turn 2 (resume)
    - operator overrides do not suppress the guard
  failure_scenarios:
    - guard accidentally suppressed by a refactor
    - guard payload mutated to include a server entry
---
```

```yaml
---
id: agent-integration:INV-003
type: Invariant
lifecycle:
  status: proposed
partition_id: agent-integration
title: forbidden env keys are filtered from every spawned subprocess
always: |
  When any adapter spawns its CLI, the merged env passed to the
  child process MUST NOT contain operator-supplied values for the
  forbidden keys: `HOME`, `PATH`, `CLAUDE_BIN`, `CODEX_BIN`. The
  forbidden list ensures (a) the adapter binary is reachable via
  the server process's PATH, (b) the operator cannot redirect
  child auth via $HOME, (c) the operator cannot recurse by
  swapping CLAUDE_BIN/CODEX_BIN at the child boundary.
  CODEX_API_KEY is inherited from the server process unchanged when
  set; operators MUST NOT override it via Profile.env / Member.env.
scope: agent-integration (entire partition)
evidence: public_api
stability: contractual
data_scope: new_writes_only
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_env_filtering
  reason: env construction is a static merge; no runtime concurrency
negative_cases:
  - operator supplies HOME via Member.env  => filtered (server's HOME wins)
  - operator supplies CLAUDE_BIN via Profile.env => filtered
out_of_scope:
  - filtering at the AccessibleEnv level (the test checks the spawned argv's env, not process.env)
test_obligation:
  predicate: |
    For each adapter, with operator-supplied env including each
    forbidden key, the captured spawn env equals
    `{ ...process.env, ...operatorEnv \ forbidden }`.
  test_template: integration
  boundary_classes:
    - HOME override attempted
    - PATH override attempted
    - CLAUDE_BIN / CODEX_BIN override attempted
    - allowed env key passes through
  failure_scenarios:
    - HOME override leaks into child env
    - CLAUDE_BIN override redirects child to a different binary
---
```

```yaml
---
id: agent-integration:INV-004
type: Invariant
lifecycle:
  status: proposed
partition_id: agent-integration
title: extraFlags are validated against per-adapter allow-lists
always: |
  Every entry in a ResolvedParticipantConfig.extraFlags MUST match
  the regex set declared by ProfileResolver for the resolved
  adapter. Allow-lists per adapter are documented in CTR-001 and
  CTR-002. A non-matching entry raises AdapterFlagNotAllowed at
  ProfileResolver.resolve (static config) or at openSession
  (runtime override).
scope: agent-integration (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_validation
  reason: validation is a pure function over the input
negative_cases:
  - codex-cli flag '--allowedTools' supplied (claude-only) => AdapterFlagNotAllowed
  - claude-cli flag '--sandbox' supplied (codex-only)      => AdapterFlagNotAllowed
out_of_scope:
  - whitelisting flags introduced after this baseline (each new flag is a minor bump on the relevant CTR)
test_obligation:
  predicate: |
    For each adapter, every member of its allow-list passes; one
    representative non-member raises AdapterFlagNotAllowed.
  test_template: unit
  boundary_classes:
    - happy path: every documented flag accepted
    - cross-adapter flag rejected
    - empty extraFlags accepted
  failure_scenarios:
    - cross-adapter flag silently accepted
---
```

```yaml
---
id: agent-integration:INV-005
type: Invariant
lifecycle:
  status: proposed
partition_id: agent-integration
title: sendTurn never performs internal retries
always: |
  Adapter.sendTurn invokes the subprocess at most once per call.
  Retries on AdapterTurnTimeout / AdapterInvocationError(retryable)
  are owned by DispatchTurnUseCase (committee-protocol:BEH-007),
  not by the adapter. This keeps the adapter contract
  side-effect-bounded ("one call, one subprocess, one outcome")
  and lets the dispatcher apply backoff + cancellation uniformly
  across adapters.
scope: agent-integration (entire partition)
evidence: public_api
stability: contractual
data_scope: new_writes_only
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - adapter retries on retryable failure  => contract violation; dispatcher would retry again, doubling subprocesses
out_of_scope:
  - subprocess restart inside the CLI itself (the CLI's own internal retries are out of our control)
test_obligation:
  predicate: |
    For each adapter, exactly one subprocess is observed per
    sendTurn call across all happy-path and failure-path tests
    (FakeSubprocessRunner counts spawns).
  test_template: integration
  boundary_classes:
    - happy path
    - retryable timeout
    - non-retryable parse error
  failure_scenarios:
    - adapter doubles the subprocess on internal retry
---
```

### External dependencies (agent-integration)

```yaml
---
id: agent-integration:EXT-001
type: ExternalDependency
lifecycle:
  status: proposed
partition_id: agent-integration
provider: Codex CLI (`codex` binary)
provider_surface: "codex@>=0.21"
authority_url_or_doc: "https://github.com/openai/codex"
consumer_contract:
  invocations:
    - cmd: "codex --version"
      expects: "exit 0; version string on stdout"
    - cmd: "codex exec --json -o <path> [...flags] <prompt>"
      expects: "exit 0 + JSONL events on stdout including thread.started, item.completed, turn.completed; final assistant message at <path>"
    - cmd: "codex exec resume <thread_id> --json -o <path> [...flags] <prompt>"
      expects: "exit 0 + JSONL events; rejects --sandbox, --cd, -c instructions=..."
drift_detection:
  mechanism: contract_test_against_fake_runner
  artefact: src/features/meeting/application/__tests__/committee.integration.test.ts
last_verified_at: 2026-04-25
auth_scope:
  not_applicable: provider_owns_auth
  reason: Codex reads CODEX_API_KEY (env) or ~/.codex/auth.json (interactive login); the adapter passes neither itself
rate_limits:
  not_applicable: provider_enforced
retry/idempotency:
  policy: "thread-id-stable resume on Turn N >= 2"
  reason: re-using the captured thread_id makes provider-side retries idempotent; adapter does not create a new thread on retry
error_taxonomy:
  - "exit 0, JSON envelope subtype != success -> claude-runtime / codex-generic"
  - "exit 1 -> AdapterInvocationError code 'codex-generic' retryable=true"
  - "exit 2 -> AdapterConfigInvalid code 'codex-usage' retryable=false"
  - "no thread.started on Turn 1 -> AdapterParseError 'codex-parse-empty'"
sandbox_or_fixture:
  - integration tests use FakeSubprocessRunner with scripted JSONL streams
  - e2e tests (opt-in via VECHE_E2E=1) hit the real `codex` binary
test_obligation:
  predicate: |
    Every documented invocation form is exercised against
    FakeSubprocessRunner; representative success and failure
    branches map to the documented error codes.
  test_template: integration
  boundary_classes:
    - Turn 1 happy path with thread.started captured
    - Turn N resume happy path
    - exit-code mapping per CTR-001
  failure_scenarios:
    - Turn 2 attempts forbidden Turn-1-only flags
    - exit 2 silently classified retryable
---
```

```yaml
---
id: agent-integration:EXT-002
type: ExternalDependency
lifecycle:
  status: proposed
partition_id: agent-integration
provider: Claude Code CLI (`claude` binary)
provider_surface: "claude-code@>=1.0"
authority_url_or_doc: "https://docs.claude.com/en/docs/claude-code"
consumer_contract:
  invocations:
    - cmd: "claude --version"
      expects: "exit 0; version string on stdout"
    - cmd: "claude -p --output-format json --input-format text --strict-mcp-config --mcp-config '{\"mcpServers\":{}}' --permission-mode default --disallowedTools=<csv> [--model X] [--append-system-prompt Y] [--add-dir Z] --session-id <uuid> [...] <prompt>"
      expects: "exit 0; single JSON object on stdout with type='result', subtype='success', result=<text>, session_id=<uuid>"
    - cmd: "claude -p ... --resume <uuid> ... <prompt>"
      expects: "same JSON envelope; session_id matches the provided <uuid>"
drift_detection:
  mechanism: contract_test_against_fake_runner
  artefact: src/features/meeting/application/__tests__/committee.integration.test.ts
last_verified_at: 2026-04-25
auth_scope:
  not_applicable: provider_owns_auth
  reason: Claude Code reads ~/.claude/ session/credential state from `claude login`; the adapter inherits HOME unchanged
rate_limits:
  not_applicable: provider_enforced
retry/idempotency:
  policy: "--session-id on Turn 1 (create), --resume on Turn N >= 2 (continue)"
  reason: reusing --session-id on Turn 2 fails with 'Session ID … is already in use'; --resume is the only correct continuation
error_taxonomy:
  - "exit 0 + subtype != success -> AdapterInvocationError 'claude-runtime' retryable=true"
  - "exit 0 + session_id mismatch -> AdapterParseError 'claude-session-mismatch'"
  - "exit 0 + non-JSON stdout -> AdapterParseError 'claude-parse-json'"
  - "exit 2 -> AdapterConfigInvalid 'claude-usage' retryable=false"
  - "exit 130 -> AdapterTurnTimeout 'claude-sigint' retryable=false"
sandbox_or_fixture:
  - integration tests use FakeSubprocessRunner
  - e2e tests (opt-in) hit the real `claude` binary
test_obligation:
  predicate: |
    Every documented invocation form is exercised against
    FakeSubprocessRunner; the Recursion Guard pair is asserted on
    every spawn; --disallowedTools always uses the `=` argv form.
  test_template: integration
  boundary_classes:
    - Turn 1 (--session-id)
    - Turn N (--resume)
    - operator override of disallowedTools
    - exit 0 with subtype != success
    - exit 2
    - exit 130
  failure_scenarios:
    - Recursion Guard quietly removed
    - --disallowedTools without `=` consuming the prompt
---
```

### Policies (agent-integration)

```yaml
---
id: agent-integration:POL-001
type: Policy
lifecycle:
  status: proposed
partition_id: agent-integration
title: agent-integration spawns only allow-listed binaries with bounded env
policy_kind: io_scope
applicability:
  applies_to: |
    every Behavior in the agent-integration partition that spawns a
    subprocess (BEH-003 directly; BEH-006 / BEH-007 via argv
    construction). Includes the openSession version probe.
predicate: |
  - The partition MUST spawn ONLY the binary identified by
    `$CODEX_BIN || codex` or `$CLAUDE_BIN || claude`. No other
    process is started.
  - The merged env passed to every spawn MUST exclude operator
    overrides for `HOME`, `PATH`, `CLAUDE_BIN`, `CODEX_BIN`.
    `CODEX_API_KEY` is inherited from the server process and MUST
    NOT be overridden by Profile.env / Member.env.
  - Stdin is `'ignore'`; stdout/stderr are piped and consumed in
    full; cancellationSignal is forwarded to the child.
  - No code path in this partition opens a network socket or reads
    from `${VECHE_HOME}/meetings/`.
negative_test_obligations:
  - run each BEH-003 path while monitoring exec(2)/spawn calls;
    assert the only argv[0] values seen are the configured codex /
    claude binary paths (or `--version` probes thereof)
  - run each BEH path while monitoring connect(2); assert no socket
    is opened
  - assert `${VECHE_HOME}/meetings/` is never opened by this slice
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes: [each BEH path]
  failure_scenarios:
    - any spawn against a binary outside { codex, claude }
    - any network socket opened from this partition
---
```

```yaml
---
id: agent-integration:POL-002
type: Policy
lifecycle:
  status: proposed
partition_id: agent-integration
title: claude-code-cli enforces the Recursion Guard on every spawn
policy_kind: security_boundary
applicability:
  applies_to: |
    every spawn from the claude-code-cli adapter (BEH-003 +
    BEH-007). Equivalent guard does not apply to codex-cli because
    Codex does not have an MCP-config-inheritance vector.
predicate: |
  Every claude subprocess argv MUST contain the literal pair
  ('--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}') in
  adjacent positions. Operator-supplied extraFlags MUST NOT
  suppress, mutate, or weaken the guard. `--bare`, when opted into
  via extraFlags, does not replace the guard — it is additional
  isolation.
negative_test_obligations:
  - capture argv on every claude spawn during BEH-003 / BEH-007
    paths; assert the guard pair is present and exact-byte
    identical
  - assert that operator-supplied extraFlags containing
    '--mcp-config' produce a usage error at openSession (extraFlags
    allow-list does not include --mcp-config)
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - Turn 1 default
    - Turn 2 resume
    - operator extraFlags do not suppress guard
  failure_scenarios:
    - guard removed by refactor
    - operator able to override mcp-config via extraFlags
---
```

### Constraints (agent-integration)

```yaml
---
id: agent-integration:CST-001
type: Constraint
lifecycle:
  status: proposed
partition_id: agent-integration
constraint: |
  v1 supports exactly two adapters: `codex-cli` and
  `claude-code-cli`. Adding a third adapter requires (a) a new
  AdapterKind enum value (minor bump on SUR-001), (b) a new
  Behavior + Contract pair documenting its argv and exit-code
  contract, and (c) a new ExternalDependency record.
rationale: |
  The closed AdapterKind enum keeps `Participant.adapter`
  switch-coverage exhaustive across the codebase. Adapter additions
  are infrequent and warrant explicit spec updates rather than a
  registry-driven free expansion.
test_obligation:
  predicate: |
    The AdapterKind type alias contains exactly the two enum values
    'codex-cli' and 'claude-code-cli'. Adding a third value would
    require updating this Constraint.
  test_template: contract
  boundary_classes:
    - type-level snapshot at build time
  failure_scenarios:
    - third value added without an accompanying CTR / EXT record
---
```

```yaml
---
id: agent-integration:CST-002
type: Constraint
lifecycle:
  status: proposed
partition_id: agent-integration
constraint: |
  Adapter implementations MUST use only Node built-ins (`node:child_process`,
  `node:os`, `node:path`, `node:fs/promises`, `node:url`,
  `node:crypto`, `node:timers/promises`, `node:stream`) plus the
  shared `SubprocessRunner` helper. Third-party process-management
  libraries (execa, cross-spawn) are NOT permitted in v1.
rationale: |
  The two CLI binaries have specific argv requirements (variadic
  flags, `=` separators, sandbox edge cases) that bend or break
  most third-party wrappers. The bespoke runner makes those
  requirements explicit and the test surface deterministic.
test_obligation:
  predicate: |
    Source under src/features/agent-integration imports only Node
    built-ins and first-party files. No execa / cross-spawn / shell
    imports.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a third-party process library appears in a future PR
---
```

### Implementation bindings (agent-integration)

```yaml
---
id: agent-integration:IMP-001
type: ImplementationBinding
lifecycle:
  status: proposed
partition_id: agent-integration
target_ids:
  - agent-integration:BEH-001
  - agent-integration:BEH-002
  - agent-integration:BEH-003
  - agent-integration:BEH-004
  - agent-integration:BEH-005
  - agent-integration:BEH-006
  - agent-integration:BEH-007
  - agent-integration:BEH-008
  - agent-integration:CTR-001
  - agent-integration:CTR-002
  - agent-integration:CTR-003
  - agent-integration:CTR-004
  - agent-integration:INV-001
  - agent-integration:INV-002
  - agent-integration:INV-003
  - agent-integration:INV-004
  - agent-integration:INV-005
binding:
  feature_slice:
    root: src/features/agent-integration
    inbound_port: src/features/agent-integration/ports/AgentAdapterPort.ts
    application:
      - src/features/agent-integration/application/ProfileResolver.ts
    domain:
      - src/features/agent-integration/domain/Session.ts
      - src/features/agent-integration/domain/Turn.ts
      - src/features/agent-integration/domain/Profile.ts
      - src/features/agent-integration/domain/errors.ts
    adapters_outbound:
      codex_cli: src/features/agent-integration/adapters/codex-cli/CodexCliAgentAdapter.ts
      claude_code_cli: src/features/agent-integration/adapters/claude-code-cli/ClaudeCodeCliAgentAdapter.ts
      fake: src/features/agent-integration/adapters/fake/FakeAgentAdapter.ts
      shared_runner: src/features/agent-integration/adapters/shared/SubprocessRunner.ts
    barrel: src/features/agent-integration/index.ts
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/features/meeting/application/__tests__/committee.integration.test.ts
  (FakeAgentAdapter-driven scenarios) and src/e2e/{codex,
  claude-code,committee}.e2e.test.ts (opt-in real-binary tests
  gated by VECHE_E2E=1). Tests that close a Test obligation carry
  an `// @covers agent-integration:<ID>` marker.
---
```

### Open questions (agent-integration)

```yaml
---
id: agent-integration:OQ-001
type: Open-Q
lifecycle:
  status: proposed
partition_id: agent-integration
question: |
  Should the adapter expose a probe method that pre-validates
  authentication (e.g. `claude auth status`) at openSession so
  failures surface before the first Turn is dispatched?
options:
  - id: a
    label: keep_lazy_auth_v1
    consequence: |
      Stay with the current "first Turn surfaces auth failure"
      path. Simple; the participant drop pathway is already
      exercised. Risk: the first dropped Member emits a system
      message that may confuse operators on otherwise-healthy
      Meetings.
  - id: b
    label: introduce_auth_probe_v1
    consequence: |
      Add an `ensureAuthenticated()` method invoked at openSession.
      Faster operator feedback. New failure modes (probe RTT,
      provider-side rate limits on auth probes), and would change
      the openSession contract — minor bump on SUR-001.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

```yaml
---
id: agent-integration:OQ-002
type: Open-Q
lifecycle:
  status: proposed
partition_id: agent-integration
question: |
  Should the adapter's `MAX_ATTEMPTS_PER_TURN` and backoff schedule
  be tunable per Profile (or per Meeting), or stay fixed at 3
  attempts × `250ms * 2^(attempt-1)` capped at 5000 ms?
options:
  - id: a
    label: keep_global_constants_v1
    consequence: |
      Operators have no knob; behaviour is deterministic and
      uniform across Meetings. Easiest to test; matches current
      code.
  - id: b
    label: introduce_per_profile_tuning
    consequence: |
      Add `Profile.retryPolicy: { maxAttempts, baseMs, capMs }`
      with safe defaults. Greater flexibility; new validation
      surface on the Profile schema (CTR-004 minor bump) and a new
      Test obligation for retry-policy bounds.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (agent-integration)

```yaml
---
id: agent-integration:ASM-001
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: agent-integration
assumption: |
  The `codex` and `claude` CLI binaries continue to honour the argv
  shapes captured in CTR-001 / CTR-002 across minor version bumps.
  Drift in either CLI's argv parser is detected by the e2e tests
  (opt-in via VECHE_E2E=1) and surfaces as a contract test failure
  in CI when run on demand.
blocking: no
review_by: 2026-08-01
default_if_unresolved: keep_assumption
tests:
  - src/e2e/codex.e2e.test.ts
  - src/e2e/claude-code.e2e.test.ts
---
```

```yaml
---
id: agent-integration:ASM-002
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: agent-integration
assumption: |
  Auth credentials for both providers are managed out-of-band by
  the operator (`codex login` / `claude login` or an equivalent
  env-var). The adapter never persists credentials and never reads
  files outside the standard provider config trees (`~/.codex/`,
  `~/.claude/`). Operators running in non-standard environments
  (containers without a writable HOME) are not supported in v1.
source_open_q: agent-integration:OQ-001
blocking: no
review_by: 2026-08-01
default_if_unresolved: keep_assumption
tests:
  - src/e2e/codex.e2e.test.ts § "auth via CODEX_API_KEY env"
  - src/e2e/claude-code.e2e.test.ts § "auth via existing claude login"
---
```

### Out of scope (agent-integration)

The following are explicitly **outside** the agent-integration
partition's gate and contract surface:

- The `DispatchTurnUseCase` itself — it lives in committee-protocol
  and orchestrates retries, prompt assembly, and the
  `cancellationSignal` lifetime.
- The `MessageView` shape used in `transcriptPrefix` — owned by the
  meeting partition's Message contract.
- Provider-side conversation TTL / quota — Codex and Claude Code
  decide when sessions / threads expire; the adapter treats expiry
  as `claude-runtime` / `codex-generic` and lets the dispatcher
  drop the Member.
- Multi-process coordination (a future "shared MCP server pool")
  is out of v1's scope.
- Streaming partial outputs (`speech` is delivered in one shot at
  exit 0; intra-Turn streaming is not part of the v1 contract).

---

## Partition: committee-protocol

> Migrated from `spec/features/committee-protocol/*.md`. Every typed
> ID below lands as `lifecycle.status: proposed`; promotion requires
> `sdd approve` from a non-agent identity.

### Context (committee-protocol)

The `committee-protocol` partition owns the deterministic
multi-party discussion loop launched by `send_message`. It runs
broadcast Rounds until every active Member declines (Pass Signal)
or `maxRounds` is reached, persisting every Member response, every
drop incident, and the termination marker through the
`MeetingStorePort`. It consumes `AgentAdapterPort` from
agent-integration and `MeetingStorePort` from persistence; it does
not own any external Surface.

This partition's contract is **internal between slices**: meeting
calls into it from `SendMessageUseCase`, `CancelJobUseCase`, and
`EndMeetingUseCase`; the discussion loop persists outcomes through
the store; the cycle of Round/Job events is observable externally
only via the `meeting`, `web-viewer`, and `persistence`
partitions.

### Glossary (committee-protocol)

- **Round** — One broadcast iteration. Round 0 is the Facilitator
  Message (appended by meeting:BEH-002 before this partition runs);
  Rounds 1..N are concurrent Member Turns followed by a single
  `round.completed` marker.
- **`DiscussionState`** — Ephemeral aggregate `{ jobId, meetingId,
  maxRounds, roundNumber, pendingPass, droppedThisJob,
  terminationReason, lastSeq }` held in memory during one Job.
- **`RoundPlan`** — Ephemeral per-Round record `{ number,
  activeMembers, transcriptCursor }` driving one iteration of the
  loop.
- **`TurnOutcome`** — Result of one Member dispatch: `{ participantId,
  kind: 'speech' | 'pass' | 'failure', text?, error? }`.
- **`PASS_PROTOCOL_SUFFIX`** — Literal block appended to every
  Member's first-Turn system prompt (defined here, used by
  agent-integration:BEH-007).
- **`MAX_ATTEMPTS_PER_TURN`** — Global constant `3`; the dispatcher
  attempts at most this many subprocess calls per Member per Round.
- **`VECHE_CANCEL_TIMEOUT_MS`** — Constant `30_000`; how long
  `CancelJobUseCase` waits for the discussion loop to acknowledge
  cooperative cancellation before forcing terminal state itself.
- **`terminationReason`** — Closed enum: `all-passed`, `max-rounds`,
  `cancelled`, `no-active-members`. Set on the Job when the Round
  loop ends.
- **Pass Signal** — The literal token `<PASS/>` (case-sensitive,
  exact byte sequence, surrounding whitespace ignored). A response
  matching this token alone is classified as `kind: 'pass'`;
  anything else is `kind: 'speech'`.

### Partition record (committee-protocol)

```yaml
---
id: committee-protocol
type: Partition
partition_id: committee-protocol
owner_team: cyberash
gate_scope:
  - committee-protocol
dependencies_on_other_partitions:
  - agent-integration
  - persistence
default_policy_set:
  - committee-protocol:POL-001
id_namespace: committee-protocol
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (committee-protocol)

```yaml
---
id: committee-protocol:BL-001
type: BrownfieldBaseline
lifecycle:
  status: proposed
partition_id: committee-protocol
discovery_scope:
  - src/features/committee-protocol
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: b0ef4ef5ccc6380a1ae867d40a679bb27c6bd489e1a471227721da08cbb161e5
    note: |
      Token covers application/ (DispatchTurnUseCase,
      RunRoundUseCase, HandleAgentFailureUseCase,
      TerminateDiscussionUseCase, ParsePassSignalUseCase,
      DiscussionRunner) and domain/ (DiscussionState, PassSignal)
      and index.ts.
freshness_token: b0ef4ef5ccc6380a1ae867d40a679bb27c6bd489e1a471227721da08cbb161e5
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner records
  an approval_record via `sdd approve`. The Brownfield baseline
  carries no preserved as-is behavior by itself; the typed Behavior
  / Invariant / Contract blocks below preserve those facts the
  migration intends to keep.
---
```

### Surfaces (committee-protocol)

```yaml
---
id: committee-protocol:SUR-001
type: Surface
lifecycle:
  status: proposed
partition_id: committee-protocol
name: veche/discussion-runtime
version: "0.1.0"
boundary_type: sdk
members:
  - committee-protocol:CTR-001
  - committee-protocol:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
  In-process SDK Surface: the TypeScript shapes
  DispatchTurnUseCase / RunRoundUseCase / DiscussionState /
  TurnOutcome that the meeting slice imports from this partition.
  Boundary `sdk` per SDD §1.4 (no `internal_port` value in the
  closed enum). Renaming a use case method, changing
  DiscussionState, or widening the terminationReason enum is a
  major bump. Adding a new optional field on DiscussionState or a
  new internal failure-handling step is a minor bump.
---
```

### Behaviors (committee-protocol)

```yaml
---
id: committee-protocol:BEH-001
type: Behavior
lifecycle:
  status: proposed
partition_id: committee-protocol
title: RunRoundUseCase dispatches active Members in parallel and persists outcomes deterministically
given: |
  - DiscussionState with roundNumber=R-1 and terminationReason=null
  - at least one active, non-dropped Member exists
when: caller invokes `RunRoundUseCase.execute({ state, cancellationSignal, turnTimeoutMs })`
then: |
  the use case:
    1. derives `activeMembers` = Members with role=member AND status=active AND id NOT IN droppedThisJob.
       If empty, sets state.terminationReason='no-active-members' and returns without persisting any new event.
    2. increments state.roundNumber.
    3. appends `round.started` event with payload { roundNumber, activeParticipantIds: <activeMembers> }.
    4. builds per-Member `transcriptPrefix`: every speech/pass/system Message authored by anyone OTHER than this
       Member with `round >= lastRound[member]` (where lastRound[member] is the most recent round in which the
       Member spoke, or -1 before the first Turn). On Round 1 this is exactly the facilitator's Round 0 Message.
    5. dispatches all Member Turns in parallel via `Promise.allSettled` over DispatchTurnUseCase.
    6. checks cancellationSignal.aborted; if set, sets state.terminationReason='cancelled' and stops persisting
       further events for this Round (the Round-completed marker is NOT appended on cancellation).
    7. processes outcomes in ascending participantId order (deterministic for replay):
       speech  -> appendMessage(round=R, author=participantId, kind=speech, text); pendingPass.delete(participantId)
       pass    -> appendMessage(round=R, author=participantId, kind=pass, text='<PASS/>'); pendingPass.add(participantId)
       failure -> delegate to HandleAgentFailureUseCase (BEH-003)
    8. appends `round.completed` event with payload { roundNumber, passedParticipantIds: [...pendingPass] }.
    9. evaluates termination via TerminateDiscussionUseCase; if it returns a non-null reason, sets state.terminationReason.
    10. returns the updated state.
negative_cases:
  - StoreUnavailable from any append    => propagated (Job runner converts to job.failed StoreUnavailable)
out_of_scope:
  - retries on individual Member failures (BEH-002 / BEH-007 own retry semantics)
  - cancellation observation between awaits (covered by BEH-001 step 6 + INV-002)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: round.started/completed timestamps come from the injected ClockPort; concurrency is per-Job (single Job per Meeting at a time)
data_scope: new_writes_only
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    With a FakeAgentAdapter scripted to produce mixed
    speech/pass/failure outcomes, RunRoundUseCase appends
    round.started, the Member messages in ascending participantId
    order, zero-or-more participant.dropped events, and exactly
    one round.completed (or none if cancelled). state.roundNumber
    is incremented exactly once. activeMembers=∅ short-circuits
    without any new event.
  test_template: integration
  boundary_classes:
    - all speech
    - mixed speech + pass
    - one fatal failure (drops Member)
    - cancellation between dispatch and persist
    - empty active set (no-active-members termination)
  failure_scenarios:
    - non-deterministic append order across runs
    - round.completed missing after partial failure
    - second run-round increments roundNumber twice
---
```

```yaml
---
id: committee-protocol:BEH-002
type: Behavior
lifecycle:
  status: proposed
partition_id: committee-protocol
title: ParsePassSignalUseCase deterministically classifies adapter output
given: |
  - raw is the adapter's final message string (possibly empty)
when: caller invokes `ParsePassSignalUseCase.classify(raw)` (or the equivalent module-level `classifyResponse(raw)`)
then: |
  - trimmed = raw.trim()
  - if trimmed.length == 0 => { kind: 'speech', text: '' }
  - if trimmed.replace(/\s+/g,'') === '<PASS/>' => { kind: 'pass', text: '<PASS/>' }
  - else if trimmed contains the substring '<PASS/>' AND any other non-`<PASS/>` content => { kind: 'speech', text: trimmed }
  - else => { kind: 'speech', text: trimmed }
  Function is total: never throws, never reads I/O, never branches on Clock.
negative_cases:
  - input '<pass/>' (lowercase) => speech with text '<pass/>'
  - input '<PASS/>ignore' => speech (mixed content cancels pass)
out_of_scope:
  - localising the pass token
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: pure_function_no_side_effects
  reason: classifyResponse is a deterministic transform
data_scope: all_data
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    For each documented branch (empty, pure-pass with surrounding
    whitespace, pure-pass exact, mixed content with token, plain
    speech), classifyResponse returns the documented record.
  test_template: unit
  boundary_classes:
    - empty
    - pure pass with leading/trailing whitespace
    - pure pass with internal whitespace
    - mixed content containing the token
    - lowercase variant rejected
    - speech with no token
  failure_scenarios:
    - pass classified despite extra text
    - lowercase variant accepted as pass
---
```

```yaml
---
id: committee-protocol:BEH-003
type: Behavior
lifecycle:
  status: proposed
partition_id: committee-protocol
title: HandleAgentFailureUseCase drops the Member, emits events, closes the Session
given: |
  - DiscussionState with the Member currently active
  - a fatal failure (`error.retryable === false` OR `attempts >= MAX_ATTEMPTS_PER_TURN`)
when: caller invokes `HandleAgentFailureUseCase.execute({ state, participantId, error, attempts })`
then: |
  the use case:
    1. asserts the failure is fatal; on a non-fatal input the use
       case throws (programming error — the dispatcher must retry,
       not delegate).
    2. calls `MeetingStorePort.markParticipantDropped({ meetingId,
       participantId, reason: error.code, error: { code, message },
       jobId: state.jobId, at: Clock.now })`.
    3. appends a system Message: author='system', kind='system',
       text="participant:<participantId> dropped:<error.code> message:<error.message>"
       via MeetingStorePort.appendMessage at the current round.
    4. invokes `AgentAdapterPort.closeSession(session)` for the
       dropped Participant; failures are caught and logged at warn,
       never propagated.
    5. mutates state: droppedThisJob.add(participantId); pendingPass.delete(participantId).
    6. returns the updated state.
negative_cases:
  - participantId not a Member of the Meeting     => ParticipantNotFound (programming error, propagated)
  - StoreUnavailable from append                  => propagated; Job runner converts to job.failed
out_of_scope:
  - retries (dispatcher decides retryability; this use case only
    runs after the dispatcher gave up)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(jobId,participantId)"
  time_source: external
  reason: drop timestamp + system Message createdAt come from ClockPort
data_scope: new_writes_only
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    For a fatal failure on Member M of an active Meeting,
    participant.dropped event is appended with the documented
    payload, a system Message is appended at the current round,
    closeSession is called once on the corresponding Session, and
    state.droppedThisJob now contains M. A non-fatal input throws.
  test_template: integration
  boundary_classes:
    - first drop in Meeting
    - drop after Member already passed (pendingPass cleared)
    - closeSession failure logged but does not abort drop
    - non-fatal input throws (programming error)
  failure_scenarios:
    - silent drop without participant.dropped event
    - silent drop without system Message in Transcript
---
```

```yaml
---
id: committee-protocol:BEH-004
type: Behavior
lifecycle:
  status: proposed
partition_id: committee-protocol
title: TerminateDiscussionUseCase decides termination using a fixed evaluation order
given: |
  - DiscussionState
  - cancellationSignal
  - activeMembers list
when: caller invokes `TerminateDiscussionUseCase.execute({ state, cancellationSignal, activeMembers })`
then: |
  the use case evaluates these conditions in order; the first
  match wins:
    1. cancellationSignal.aborted          => { terminationReason: 'cancelled', shouldFinalize: true }
    2. activeMembers.length === 0           => { terminationReason: 'no-active-members', shouldFinalize: true }
    3. state.roundNumber >= state.maxRounds => { terminationReason: 'max-rounds', shouldFinalize: true }
    4. activeMembers.every(id => state.pendingPass.has(id)) => { terminationReason: 'all-passed', shouldFinalize: true }
    5. otherwise                            => { terminationReason: null, shouldFinalize: false }
  When shouldFinalize=true, the caller (RunRoundUseCase or the Job
  runner) performs finalisation: updateJob({ status: completed |
  cancelled, terminationReason, lastSeq, rounds: state.roundNumber,
  finishedAt: Clock.now, [cancelReason if cancelled] }) +
  appendSystemEvent('job.completed' or 'job.cancelled') accordingly.
negative_cases:
  - StoreUnavailable during finalisation           => propagated; Job runner maps to job.failed
out_of_scope:
  - mid-Round cancellation observation (covered by RunRoundUseCase
    step 6)
  - closing Member Sessions (deferred to handle-agent-failure or
    cancel-job)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: pure_decision_function_over_state
  reason: evaluation has no I/O; finalisation is the caller's responsibility
data_scope: all_data
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    For each evaluation branch (cancellation, empty active,
    max-rounds, all-passed, none) the use case returns the
    documented record. The evaluation order is preserved across
    refactors: a synthetic state where multiple conditions hold
    yields the first-listed match.
  test_template: unit
  boundary_classes:
    - cancellation wins over max-rounds
    - max-rounds wins over all-passed when both true
    - all-passed precise (every active Member in pendingPass)
    - no-active-members on first Round
  failure_scenarios:
    - evaluation order drift (e.g. all-passed wins over cancelled)
    - silent reuse of a stale terminationReason
---
```

```yaml
---
id: committee-protocol:BEH-005
type: Behavior
lifecycle:
  status: proposed
partition_id: committee-protocol
title: DiscussionRunner advances the loop until termination and emits the terminal Job event
given: |
  - state.terminationReason is null
  - the meeting partition has handed control over after appending the Facilitator Message and flipping the Job to running
when: caller invokes the discussion loop (DiscussionRunner.run)
then: |
  the runner loops:
    repeat:
      result = RunRoundUseCase.execute({ state, cancellationSignal, turnTimeoutMs })
      if result.terminationReason != null break
    on exit, performs finalisation per BEH-004:
      - completed/max-rounds/no-active-members/all-passed -> updateJob({ status: completed, terminationReason, ... }) + appendSystemEvent('job.completed', { jobId, terminationReason, lastSeq, rounds })
      - cancelled -> updateJob({ status: cancelled, cancelReason, ... }) + appendSystemEvent('job.cancelled', { jobId, cancelReason })
    on uncaught error from any append -> updateJob({ status: failed, error: { code: 'StoreUnavailable', message } }) + appendSystemEvent('job.failed', { jobId, error })
  Member Sessions remain open across Jobs (closed only on drop, on
  cancel-job's adapter cleanup, or on end-meeting).
negative_cases:
  - second iteration starts before round.completed of the previous round    => contract violation (Rounds are strictly serial)
out_of_scope:
  - process-restart recovery (a running Job that survives a process restart is classified failed at startup; see meeting:OQ-* if added)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: round / job timestamps come from ClockPort
data_scope: new_writes_only
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    Given a scripted Meeting reaching each terminationReason, the
    runner emits exactly one job.completed or job.cancelled per
    Job; Round events appear in correct serial order;
    Job.status reaches terminal exactly once.
  test_template: integration
  boundary_classes:
    - happy path: all-passed after 2 rounds
    - max-rounds boundary
    - cancellation mid-Round
    - StoreUnavailable mid-loop -> job.failed
  failure_scenarios:
    - Round 2 starts before Round 1 completed
    - second job.completed appended for the same Job
    - terminal Job patched again
---
```

### Contracts (committee-protocol)

```yaml
---
id: committee-protocol:CTR-001
type: Contract
lifecycle:
  status: proposed
partition_id: committee-protocol
title: DiscussionState shape and termination enum
surface_ref: committee-protocol:SUR-001
schema:
  description: |
    In-memory state carried through one Job's discussion loop.
  type: object
  required: [jobId, meetingId, maxRounds, roundNumber, pendingPass, droppedThisJob, terminationReason, lastSeq]
  properties:
    jobId: { type: string, description: "branded JobId" }
    meetingId: { type: string, description: "branded MeetingId" }
    maxRounds: { type: integer, minimum: 1 }
    roundNumber: { type: integer, minimum: 0 }
    pendingPass:
      type: object
      description: "Set<ParticipantId> of Members that emitted <PASS/> in the most recent Round; cleared at Round start"
    droppedThisJob:
      type: object
      description: "Set<ParticipantId> of Members dropped during this Job; cumulative for the remainder of the Meeting (the Meeting aggregate carries the dropped status forward, not the per-Job set)"
    terminationReason:
      type: [string, "null"]
      enum: [null, all-passed, max-rounds, cancelled, no-active-members]
    lastSeq:
      type: integer
      minimum: -1
      description: "highest event-log seq touched by this Job; -1 before the Facilitator Message"
preconditions:
  - jobId / meetingId / maxRounds are immutable for the lifetime of the state object
  - pendingPass is reset at Round start; droppedThisJob is monotonic-add
postconditions:
  - on terminal state, terminationReason is non-null
external_identifiers:
  - "terminationReason enum strings: all-passed, max-rounds, cancelled, no-active-members"
compatibility_rules:
  - renaming a top-level field                  => major bump on SUR-001
  - widening terminationReason enum             => major bump (downstream switches must add the case)
  - adding a new optional field                 => minor bump
  - removing a field                            => major bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_in_memory_record
  reason: state is single-actor (one runner per Job); no concurrency dimension on the schema
data_scope: all_data
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    The TypeScript type `DiscussionState` matches the schema (every
    required field present and typed). Adding a new
    terminationReason value forces every consumer switch (compile
    error in TerminateDiscussionUseCase, DiscussionRunner,
    meeting-side renderers) per CTR-002 cascade.
  test_template: contract
  boundary_classes:
    - shape snapshot at build time
    - exhaustive switch on terminationReason
  failure_scenarios:
    - non-exhaustive switch silently accepts a new value
    - field renamed without major bump
---
```

```yaml
---
id: committee-protocol:CTR-002
type: Contract
lifecycle:
  status: proposed
partition_id: committee-protocol
title: TurnOutcome shape and dispatcher / drop boundary
surface_ref: committee-protocol:SUR-001
schema:
  description: |
    Per-Member result of one dispatcher attempt; consumed by
    RunRoundUseCase step 7. Mirrors TurnResult from agent-integration
    but the dispatcher folds adapter retries into a single outcome.
  type: object
  required: [participantId, kind]
  properties:
    participantId: { type: string }
    kind: { type: string, enum: [speech, pass, failure] }
    text:
      type: [string, "null"]
      description: "non-null when kind='speech' or kind='failure' (failure carries the error.message); null for kind='pass' (the literal '<PASS/>' is implied)"
    error:
      type: [object, "null"]
      description: |
        non-null only when kind='failure'; shape { code, message,
        retryable }. The dispatcher converts non-retryable / exhausted
        retries to kind='failure'; the loop never sees kind='speech'
        with a non-null error.
preconditions:
  - kind='speech' implies a non-empty text (empty string is allowed and recorded as a speech of length 0)
  - kind='failure' implies a non-null error with a non-empty code
postconditions:
  - exactly one outcome per Member per Round
external_identifiers:
  - "kind enum strings: speech, pass, failure"
compatibility_rules:
  - renaming kind / participantId / text / error      => major bump on SUR-001
  - widening kind enum                                => major bump
  - tightening text from optional to required when kind='pass' => major bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_outcome_record
  reason: per-call concurrency lives on BEH-001
data_scope: all_data
policy_refs:
  - committee-protocol:POL-001
test_obligation:
  predicate: |
    For each kind, a representative outcome roundtrips through
    RunRoundUseCase step 7 and produces the documented persisted
    event (message.posted speech / message.posted pass /
    participant.dropped + system message).
  test_template: contract
  boundary_classes:
    - speech with non-empty text
    - speech with empty text (zero-length)
    - pass
    - failure retryable=true
    - failure retryable=false
  failure_scenarios:
    - kind='pass' with text != '<PASS/>'
    - kind='speech' carrying a non-null error
---
```

### Invariants (committee-protocol)

```yaml
---
id: committee-protocol:INV-001
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: Members within a Round are dispatched in parallel; Rounds are strictly serial
always: |
  Within one Round, all Member Turns are dispatched concurrently
  (Promise.allSettled) so that one failing Member does not delay
  the others. Across Rounds, Round R+1 cannot start until every
  Turn in Round R has reached a terminal state (speech, pass, or
  failure) AND `round.completed` for Round R has been persisted.
  The runner never holds two `round.started` markers without an
  intervening `round.completed`.
scope: committee-protocol (entire partition)
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
  - Round R+1 begins before round.completed for R   => contract violation
  - intra-Round Turns serialised (e.g. await per Member) => contract violation (loses concurrency benefit)
out_of_scope:
  - intra-Member parallelism (each Member dispatches one subprocess via the adapter)
test_obligation:
  predicate: |
    A scripted Meeting where Member B's adapter takes 5x longer
    than Member A still sees both Round-1 outcomes appended before
    Round 2 begins. The event log never contains two consecutive
    round.started without an intervening round.completed.
  test_template: integration
  boundary_classes:
    - skewed Member latencies
    - one Member fails, others continue
  failure_scenarios:
    - serialised dispatch
    - Round 2 racing Round 1
---
```

```yaml
---
id: committee-protocol:INV-002
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: cancellation is observed only at explicit checkpoints
always: |
  The discussion loop checks cancellationSignal.aborted at three
  explicit points: (1) before dispatching a Round (RunRoundUseCase
  step 1), (2) after dispatch and before persisting outcomes
  (step 6), (3) at every TerminateDiscussionUseCase invocation
  (BEH-004 condition #1). A running adapter subprocess cannot be
  synchronously aborted by the loop itself — the adapter cooperates
  via cancellationSignal forwarded into Turn.cancellationSignal.
  Mid-step polling is forbidden; cancellation latency is bounded by
  one Turn's worst-case duration.
scope: committee-protocol (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: cancellation latency is measured against ClockPort, not wall-clock
negative_cases:
  - mid-Turn polling of cancellationSignal -> forced kill of subprocess by loop => contract violation (only adapters terminate subprocesses)
out_of_scope:
  - process-level SIGTERM handling (lives in the Job runner, not this partition)
test_obligation:
  predicate: |
    With cancellation fired during dispatch, no further events are
    appended after the in-flight Round's outcomes are persisted; a
    `job.cancelled` follows the last `round.completed` if it was
    appended in time, or directly after the last `round.started` if
    cancellation happened before step 8.
  test_template: integration
  boundary_classes:
    - cancellation before dispatch
    - cancellation between dispatch and persist
    - cancellation after Round completed
  failure_scenarios:
    - mid-Turn poll forcibly kills a subprocess from the loop side
    - cancellation not observed until next Round
---
```

```yaml
---
id: committee-protocol:INV-003
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: pendingPass resets at Round start; speech in current Round invalidates other passes for termination check
always: |
  At the start of every Round, RunRoundUseCase clears
  state.pendingPass and rebuilds it from the Round's outcomes.
  Within a single Round, a Member's pass contributes to
  pendingPass; if any Member emits a speech in the same Round, the
  termination decision at Round end correctly sees that not every
  active Member passed (because pendingPass holds only the
  passers). A Member that passed in Round R may speak again in
  Round R+1 because the set is reset — pass status is per-Round,
  not cumulative.
scope: committee-protocol (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_state_transition_rule
  reason: applies to single-actor state mutation
negative_cases:
  - pendingPass carries over from Round R to Round R+1   => Member who passed in R cannot speak again in R+1
out_of_scope:
  - cumulative pass tracking across Jobs
test_obligation:
  predicate: |
    A Member that passes in Round R speaks normally in Round R+1
    (their dispatch is not skipped). A Round in which one Member
    speaks and another passes does not trigger 'all-passed'
    termination at Round end.
  test_template: integration
  boundary_classes:
    - "all members pass first round (terminates all-passed)"
    - "1/3 pass in round 1, all pass in round 2 (terminates all-passed at round 2)"
    - 1 speech + 1 pass in same round (does not terminate)
  failure_scenarios:
    - pendingPass treated as cumulative
    - "all-passed fires while one Member still speaking"
---
```

```yaml
---
id: committee-protocol:INV-004
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: Member outcomes are appended in ascending participantId order for replay determinism
always: |
  Even though dispatch is concurrent, persistence within a Round
  is serial AND ordered: outcomes are appended to the event log in
  ascending participantId byte order. A second replay of the same
  Job — given identical adapter outputs — produces a byte-identical
  event log slice for that Round.
scope: committee-protocol (entire partition)
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
  - dispatch order leaks into append order   => non-deterministic replay
out_of_scope:
  - cross-Round ordering (already covered by INV-001 strict serial Rounds)
test_obligation:
  predicate: |
    With three Members A, B, C and adapter latencies B < A < C,
    the appended message.posted seq order remains A, B, C. A
    second test run with reversed latencies yields the same
    persisted order.
  test_template: integration
  boundary_classes:
    - skewed latencies
    - one Member fails (its participant.dropped lands in id-sorted position)
  failure_scenarios:
    - append order tracks dispatch latency
    - two runs of the same Job produce different event-log byte sequences
---
```

```yaml
---
id: committee-protocol:INV-005
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: dropped Members stay dropped for the rest of the Meeting
always: |
  Once a Member is dropped (participant.dropped event appended
  during Job J), the Meeting aggregate carries
  Participant.status='dropped' forward across every subsequent Job
  in the same Meeting. The committee runtime MUST NOT re-dispatch a
  dropped Member, MUST NOT include them in `transcriptPrefix`
  computation as an author target, and MUST NOT count them in
  `activeMembers` for termination evaluation. They MAY appear in
  Transcript content as past speakers — the drop is forward-only.
scope: committee-protocol (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_aggregate_carry_forward
  reason: state is single-actor per Meeting
negative_cases:
  - second Job in same Meeting re-dispatches a dropped Member  => contract violation
out_of_scope:
  - re-admitting a dropped Member (out of v1; would require a Delta on this partition)
test_obligation:
  predicate: |
    After a Member is dropped in Job J1, a subsequent Job J2 on
    the same Meeting executes without that Member; activeMembers
    in J2 excludes the dropped id; no further dispatch attempts
    against the dropped Session occur.
  test_template: integration
  boundary_classes:
    - drop in J1, J2 runs without Member
    - drop on the only Member -> next Job terminates 'no-active-members'
  failure_scenarios:
    - drop forgotten across Jobs
    - dropped Member's old Session reused
---
```

```yaml
---
id: committee-protocol:INV-006
type: Invariant
lifecycle:
  status: proposed
partition_id: committee-protocol
title: "dispatcher retry policy is fixed: MAX_ATTEMPTS_PER_TURN=3, exponential backoff capped at 5000ms"
always: |
  DispatchTurnUseCase attempts each Member's Turn at most 3 times
  per Round. Between attempts, the dispatcher sleeps for
  `min(5000, 250 * 2^(attempt-1))` ms, measured against the
  injected ClockPort (not Date.now). The sleep is interrupted by
  cancellationSignal; on cancel, the dispatcher returns failure
  with code='AdapterTurnTimeout' message='cancelled during
  backoff' retryable=false. A retry MUST NOT mutate the prompt or
  the providerRef; the next attempt sticks with the same
  thread/session continuity primitives.
scope: committee-protocol (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: backoff timing uses ClockPort
negative_cases:
  - prompt mutated between attempts                          => contract violation
  - 4th attempt observed                                     => contract violation
out_of_scope:
  - per-Profile retry tuning (see agent-integration:OQ-002)
test_obligation:
  predicate: |
    With a FakeAgentAdapter scripted to emit 2 retryable failures
    followed by a speech, exactly 3 attempts are observed and the
    final speech is persisted. Cancellation during the second
    backoff returns immediately with code='AdapterTurnTimeout'
    message='cancelled during backoff'.
  test_template: unit
  boundary_classes:
    - 1 failure then success
    - 2 failures then success
    - 3 failures (drop)
    - non-retryable failure on attempt 1 (no retry)
    - cancellation during backoff
  failure_scenarios:
    - 4th attempt
    - prompt mutated for the retry
    - real Date.now() used instead of ClockPort
---
```

### Policies (committee-protocol)

```yaml
---
id: committee-protocol:POL-001
type: Policy
lifecycle:
  status: proposed
partition_id: committee-protocol
title: committee-protocol writes only Round / Job markers and Member messages; never bypasses the store
policy_kind: io_scope
applicability:
  applies_to: |
    every Behavior in this partition (BEH-001..005). The runtime
    NEVER writes to the filesystem directly; every effect goes
    through MeetingStorePort calls.
predicate: |
  - The partition's only side-effect surface is MeetingStorePort
    (appendMessage, appendSystemEvent, markParticipantDropped,
    updateJob) and AgentAdapterPort (sendTurn, closeSession on
    drop / cancellation).
  - No code path opens a filesystem path directly, opens a network
    socket, or spawns a subprocess. Subprocesses are spawned by
    the agent-integration adapters; this partition observes them
    only through TurnResult.
  - The partition reads no environment variables. Configuration
    (turnTimeoutMs, maxRounds) arrives from the meeting partition
    via SendMessageUseCase.
negative_test_obligations:
  - run each BEH-001..005 path while monitoring open(2) and
    spawn calls; assert this partition makes none directly
  - assert MeetingStorePort method calls match the documented
    pattern per BEH (no extra writes, no skipped writes)
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes: [each BEH path]
  failure_scenarios:
    - direct filesystem write from this partition
    - subprocess spawned outside the adapter boundary
---
```

### Constraints (committee-protocol)

```yaml
---
id: committee-protocol:CST-001
type: Constraint
lifecycle:
  status: proposed
partition_id: committee-protocol
constraint: |
  All cross-Member parallelism uses `Promise.allSettled` (or
  equivalent that waits for every settlement). Concurrency
  primitives that can short-circuit on first failure
  (`Promise.all`, `Promise.race` over Members) are forbidden inside
  RunRoundUseCase.
rationale: |
  A failing Member must not abort sibling Members within the same
  Round — the surviving outcomes still need to be persisted, and
  the failure has to flow through HandleAgentFailureUseCase. Using
  Promise.all would propagate the first failure and lose the
  others' work.
test_obligation:
  predicate: |
    With three Members where the middle one rejects synchronously,
    the other two outcomes are persisted normally and the
    rejecting Member is dropped via the failure path.
  test_template: integration
  boundary_classes:
    - sync rejection in the middle Member
    - async rejection in the first Member
  failure_scenarios:
    - first failure aborts sibling outcomes
---
```

### Implementation bindings (committee-protocol)

```yaml
---
id: committee-protocol:IMP-001
type: ImplementationBinding
lifecycle:
  status: proposed
partition_id: committee-protocol
target_ids:
  - committee-protocol:BEH-001
  - committee-protocol:BEH-002
  - committee-protocol:BEH-003
  - committee-protocol:BEH-004
  - committee-protocol:BEH-005
  - committee-protocol:CTR-001
  - committee-protocol:CTR-002
  - committee-protocol:INV-001
  - committee-protocol:INV-002
  - committee-protocol:INV-003
  - committee-protocol:INV-004
  - committee-protocol:INV-005
  - committee-protocol:INV-006
binding:
  feature_slice:
    root: src/features/committee-protocol
    application:
      - src/features/committee-protocol/application/RunRoundUseCase.ts
      - src/features/committee-protocol/application/DispatchTurnUseCase.ts
      - src/features/committee-protocol/application/HandleAgentFailureUseCase.ts
      - src/features/committee-protocol/application/TerminateDiscussionUseCase.ts
      - src/features/committee-protocol/application/ParsePassSignalUseCase.ts
      - src/features/committee-protocol/application/DiscussionRunner.ts
    domain:
      - src/features/committee-protocol/domain/DiscussionState.ts
      - src/features/committee-protocol/domain/PassSignal.ts
    barrel: src/features/committee-protocol/index.ts
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/features/committee-protocol/application/ParsePassSignalUseCase.test.ts
  and src/features/meeting/application/__tests__/committee.integration.test.ts
  (FakeAgentAdapter-driven full-loop tests). Tests that close a
  Test obligation carry an `// @covers committee-protocol:<ID>`
  marker.
---
```

### Open questions (committee-protocol)

```yaml
---
id: committee-protocol:OQ-001
type: Open-Q
lifecycle:
  status: proposed
partition_id: committee-protocol
question: |
  Should a Member dropped in Job J be re-admitted on a future Job
  in the same Meeting (e.g. via an explicit `readmit_member` MCP
  tool), or stay dropped for the Meeting's lifetime?
options:
  - id: a
    label: keep_drops_permanent_v1
    consequence: |
      v1 stays as-is. Dropping is meeting-scoped; operators
      restart the Meeting (or omit the failing Member from the
      next start_meeting) if they need a different roster.
      Simpler; matches current code; one-way state transition.
  - id: b
    label: introduce_readmit_member_v1
    consequence: |
      Add a tool that re-opens the Member's Session and clears the
      drop. New aggregate transition (`status: dropped -> active`),
      new event type, and a Migration on existing event logs.
      Major bump on persistence:SUR-001 (new event type) plus a
      Delta on this partition's Member-state-machine.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (committee-protocol)

```yaml
---
id: committee-protocol:ASM-001
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: committee-protocol
assumption: |
  An adapter's TurnResult.providerRef remains valid across at
  least one provider-side TTL window. If a provider expires the
  thread/session between Turn N and Turn N+1, the next attempt
  surfaces as an AdapterInvocationError with a retryable flag the
  dispatcher follows; the resulting drop is acceptable v1
  behaviour. Reconnecting a Member after expiry is out of scope.
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/features/meeting/application/__tests__/committee.integration.test.ts § "expired provider session leads to drop after retries"
---
```

### Out of scope (committee-protocol)

The following are explicitly **outside** the committee-protocol
partition's gate and contract surface:

- The persisted event types themselves — owned by persistence
  (CTR-001 / CTR-002).
- The MCP tool layer (`send_message`, `cancel_job`, `end_meeting`)
  that triggers and cancels Jobs — owned by the meeting partition.
- The adapter-level retry behaviour — adapters are single-shot per
  sendTurn; this partition's dispatcher owns the retry loop.
- Multi-Job concurrency on the same Meeting — meeting:BEH-002
  enforces `MeetingBusy`; this partition assumes at most one
  active Job per Meeting.
- Process-restart recovery for Jobs interrupted by a server crash
  (currently classified `failed` with a synthetic
  `InterruptedByShutdown`-style error; that classification is
  meeting partition territory).

---

## Partition: meeting

> Migrated from `spec/features/meeting/*.md`. Owns the public MCP
> tool surface (start_meeting / send_message / get_response /
> get_transcript / list_meetings / end_meeting / cancel_job) and
> the read-only CLI surface (`veche list`, `veche show`).

### Context (meeting)

The `meeting` partition owns the Meeting aggregate (Meeting +
Participants + Jobs + Messages) and the Orchestrator-facing MCP
tool surface that creates, drives, polls, and closes Meetings. It
also owns two read-only CLI commands (`list`, `show`) that an
operator can run against the same `${VECHE_HOME}` while an MCP
server is writing.

Boundaries:

- It depends on persistence (MeetingStorePort) for durable state,
  on agent-integration (AgentAdapterPort, ProfileResolver) for
  Member runtime configuration, and on committee-protocol for the
  fire-and-forget discussion loop launched by send_message.
- It does NOT own the on-disk format (persistence) or the dispatch
  loop semantics (committee-protocol).
- The CLI surface is decoupled from the MCP server — both run
  against `${VECHE_HOME}` independently, and the CLI MUST NOT
  invoke store write methods.

### Glossary (meeting)

- **Meeting** — Aggregate `{ id, title, status, createdAt,
  endedAt, participants[], defaultMaxRounds }`.
- **Participant** — Aggregate part `{ id, role, adapter, profile,
  systemPrompt, workdir, model, extraFlags, env, status,
  droppedAt, droppedReason }`.
- **Job** — Aggregate part `{ id, meetingId, status, createdAt,
  startedAt, finishedAt, maxRounds, lastSeq, rounds, error,
  cancelReason, terminationReason }`.
- **Message** — Persisted record `{ id, meetingId, seq, round,
  author, kind, text, createdAt }`.
- **`VECHE_MAX_ROUNDS_CAP`** — Server-wide constant (currently
  `64`) used as the upper bound on `defaultMaxRounds` and
  `maxRounds`.
- **`VECHE_CANCEL_TIMEOUT_MS`** — Constant `30_000`, the
  cooperative-cancellation budget consumed by `cancel_job`.
- **MCP code** — String identifier in the JSON-RPC error envelope:
  `invalid_params`, `not_found`, `failed_precondition`,
  `unavailable`, `internal_error`. Domain errors map to MCP codes
  per CTR-002.
- **`text` (CLI format)** — Plain-Unicode rendering with optional
  ANSI colours; default destination stdout.
- **`html` (CLI format)** — Single self-contained HTML5 document
  with one inline `<style>`, no `<script>`, no remote `href` /
  `src`, escape-then-transform Markdown for speech bubbles.
- **`markdown` (CLI format)** — GFM rendering with header as a
  `yaml` fenced block, rounds as `### Round N`, speech as
  blockquotes.
- **`json` (CLI format)** — Pretty-printed `{ meeting,
  participants, jobs, messages, generatedAt }` with stable key
  order.
- **`--raw` (show CLI flag)** — Emits the full event stream
  including `round.started` / `round.completed` / `job.*` events;
  default omits these and renders only `speech` / `pass` /
  `system` Messages.
- **`MessageDto.htmlBody`** — Pre-rendered HTML of a `speech`
  Message produced by `src/shared/markdown.ts`; consumed by the
  HTML renderer and the web-viewer SPA.

### Partition record (meeting)

```yaml
---
id: meeting
type: Partition
partition_id: meeting
owner_team: cyberash
gate_scope:
  - meeting
dependencies_on_other_partitions:
  - persistence
  - agent-integration
  - committee-protocol
default_policy_set:
  - meeting:POL-001
id_namespace: meeting
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (meeting)

```yaml
---
id: meeting:BL-001
type: BrownfieldBaseline
lifecycle:
  status: proposed
partition_id: meeting
discovery_scope:
  - src/features/meeting
  - src/adapters/inbound/mcp
  - src/adapters/inbound/cli/commands/list.ts
  - src/adapters/inbound/cli/commands/show.ts
  - src/adapters/inbound/cli/renderers
  - src/adapters/inbound/cli/lib/opener.ts
  - src/adapters/inbound/cli/lib/packageRoot.ts
  - src/shared/markdown
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: da5153eb66235782b2c63e3ab4ade9aa51e45b2fbfc9a04fdd90a38164ff4f4d
    note: |
      Token covers (a) the meeting slice domain + application use
      cases (StartMeeting, SendMessage, GetResponse,
      GetTranscript, ListMeetings, EndMeeting, CancelJob, the
      JobRunner that owns the fire-and-forget discussion loop and
      its constants), (b) the inbound MCP server adapter
      (VecheMcpServer + schemas + errorMapping + e2e tests), (c)
      the two read-only CLI commands (list, show) plus their
      renderers, helpers, and integration tests, and (d) the
      shared escape-then-transform Markdown converter consumed by
      the HTML renderer and the web-viewer DTO mapper. The
      VecheCli shell (src/adapters/inbound/cli/VecheCli.ts) and
      the bin entrypoints are intentionally excluded from this
      partition's Discovery scope; they are cross-cutting CLI
      infrastructure not owned by any single partition.
freshness_token: da5153eb66235782b2c63e3ab4ade9aa51e45b2fbfc9a04fdd90a38164ff4f4d
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner
  records an approval_record via `sdd approve`. The Brownfield
  baseline carries no preserved as-is behavior by itself; the
  typed Behavior / Invariant / Contract blocks below preserve
  those facts the migration intends to keep.
---
```

### Surfaces (meeting)

```yaml
---
id: meeting:SUR-001
type: Surface
lifecycle:
  status: proposed
partition_id: meeting
name: veche/mcp-tools
version: "0.1.0"
boundary_type: api
members:
  - meeting:CTR-001
  - meeting:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
  Public MCP tool API: the seven tools (start_meeting,
  send_message, get_response, get_transcript, list_meetings,
  end_meeting, cancel_job) advertised by the MCP server, plus the
  domain entities (Meeting, Participant, Message, Job) returned in
  their payloads. Renaming a tool, removing a tool, or changing
  the shape of any tool's input / output / error code is a major
  bump. Adding a new optional input field, a new optional output
  field, a new tool, or a new domain-error mapping is a minor
  bump.
---
```

```yaml
---
id: meeting:SUR-002
type: Surface
lifecycle:
  status: proposed
partition_id: meeting
name: veche/cli-readonly
version: "0.1.0"
boundary_type: cli
members:
  - meeting:CTR-003
  - meeting:CTR-004
  - meeting:CTR-005
consumer_compat_policy: semver_per_surface
notes: |
  Read-only CLI surface: the `veche list` and `veche show`
  commands and their output formats. Renaming a flag, removing a
  format, or changing exit-code semantics is a major bump. Adding
  a new flag, format, or output column is a minor bump. The HTML
  output's escape pipeline and inline-tag allowlist are part of
  this Surface (CTR-004); changes that widen the allowlist are a
  minor bump, narrowing it is a major bump.
---
```

### Behaviors (meeting)

```yaml
---
id: meeting:BEH-001
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: start_meeting validates input, persists Meeting, opens Member Sessions
given: |
  - the MCP tool `start_meeting` is invoked with
    { title, facilitator, members[], defaultMaxRounds? }
when: caller invokes `StartMeetingUseCase.execute(command)`
then: |
  1. validate input per CTR-001 (title 1..200 trimmed; members
     1..8; ids match `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`; env keys
     match `^[A-Z_][A-Z0-9_]*$`; forbidden env keys CODEX_API_KEY,
     HOME, PATH, CLAUDE_BIN, CODEX_BIN; extraFlags <= 16; env <=
     32 entries; defaultMaxRounds 1..VECHE_MAX_ROUNDS_CAP).
  2. for each Member entry, resolve via ProfileResolver.resolve;
     surface ProfileNotFound / ProfileAdapterMismatch /
     AdapterFlagNotAllowed.
  3. for each Member with workdir, verify it is absolute, exists,
     and is readable; otherwise WorkdirUnavailable.
  4. for each Member, verify the resolved adapter's capabilities
     match (supportsWorkdir if workdir set; supportsSystemPrompt
     if systemPrompt set); else AdapterConfigInvalid.
  5. assemble the Meeting aggregate with status='active', new
     MeetingId from IdGenPort, createdAt from ClockPort,
     facilitator first, members in input order. Each Member
     carries a fresh sessionId from
     IdGenPort.newParticipantSessionId.
  6. call MeetingStorePort.createMeeting; the store appends
     meeting.created at seq=0 then participant.joined at seq=1..K
     (one per Participant including the Facilitator).
  7. for each Member (NOT the Facilitator), call
     AgentAdapterPort.openSession with the resolved configuration
     and the pre-allocated sessionId.
  8. on any AdapterNotAvailable / AdapterConfigInvalid from
     openSession, roll back: closeSession every Session opened so
     far; MeetingStorePort.endMeeting(meetingId, at: Clock.now)
     so the partial Meeting is marked ended (it remains visible in
     the event log but is excluded by the default `status=active`
     filter). Surface the original error.
  9. return { meetingId, title, createdAt, participants[],
     defaultMaxRounds, cursor } where cursor points past the last
     participant.joined event.
negative_cases:
  - schema violation                        => InvalidInput (invalid_params)
  - profile name unknown                    => ProfileNotFound (invalid_params)
  - profile adapter mismatch                => ProfileAdapterMismatch (invalid_params)
  - duplicate participant id                => DuplicateParticipantId (invalid_params)
  - workdir absent / not readable           => WorkdirUnavailable (invalid_params)
  - extraFlag outside allow-list            => AdapterFlagNotAllowed (invalid_params)
  - adapter binary missing                  => AdapterNotAvailable (unavailable) — Meeting rolled back per step 8
  - store error                             => StoreUnavailable (internal_error)
out_of_scope:
  - opening a Session for the Facilitator (Facilitator has adapter=null)
  - automatic profile creation (Profile must pre-exist in config)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(meetingId)"
  time_source: external
  reason: createdAt and openedAt come from the injected ClockPort; meetingId is generated by IdGenPort
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    For each happy path (1..8 members; profile-only; override-only;
    profile+override) the Meeting is persisted with the correct
    Participant order, every Member has an open Session, and the
    returned cursor decodes to seq = K (number of Participants
    plus zero-based meeting.created index = K). For each rollback
    path, the Meeting ends up with status=ended, all opened
    Sessions are closed, and the original error class is surfaced.
  test_template: integration
  boundary_classes:
    - 1 member, no overrides
    - 8 members, mixed profiles + overrides
    - duplicate id rejection
    - workdir not readable
    - openSession fails on the third member -> rollback
    - store failure mid-create -> propagate
  failure_scenarios:
    - rollback leaves an open Session
    - rollback leaves the Meeting in status=active
---
```

```yaml
---
id: meeting:BEH-002
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: send_message creates a Job, appends Round 0 Message, hands off to committee-protocol
given: |
  - the Meeting exists with status=active
  - no other Job for this Meeting is queued or running
  - text passes the 1..32 KiB UTF-8 / non-empty-after-trim check
when: caller invokes `SendMessageUseCase.execute({ meetingId, text, maxRounds?, turnTimeoutMs?, addressees? })`
then: |
  1. validate input per CTR-001 (text 1..32 KiB; maxRounds 1..VECHE_MAX_ROUNDS_CAP;
     turnTimeoutMs 10000..3_600_000; addressees subset of non-dropped Members).
  2. loadMeeting -> if absent MeetingNotFound; if status=ended MeetingAlreadyEnded.
  3. compute effective active-Member set; if empty NoActiveMembers.
  4. createJob with status=queued, maxRounds, turnTimeoutMs,
     addressees (or null), createdAt=Clock.now. Store enforces
     "at most one Job in {queued,running} per Meeting" and raises
     JobStateTransitionInvalid -> surfaced as MeetingBusy.
  5. appendMessage with author=facilitator.id, kind='speech',
     round=0, text=trimmed-text, createdAt=Clock.now. The
     returned seq is the cursor handed to the caller.
  6. updateJob({ status: running, startedAt: Clock.now }); store
     emits the job.started event.
  7. fire-and-forget hand-off: register the Job with the
     application-layer JobRunner (which owns committee-protocol's
     DiscussionRunner). The hand-off MUST return synchronously
     before Round 1 begins.
  8. return { jobId, meetingId, cursor } pointing at the Round 0
     seq.
negative_cases:
  - schema violation                          => InvalidInput
  - meeting unknown                           => MeetingNotFound
  - meeting ended                             => MeetingAlreadyEnded
  - all Members dropped or addressees empty   => NoActiveMembers
  - other Job queued/running                  => MeetingBusy
  - addressees contains unknown id            => AddresseeNotFound
  - store error                               => StoreUnavailable
out_of_scope:
  - blocking on Round 1 completion (send_message is non-blocking)
  - process-restart recovery of in-flight Jobs (a running Job that
    survives a server restart is classified failed at startup with
    error code 'InterruptedByShutdown')
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: timestamps come from ClockPort; the MeetingBusy guard is enforced by the store
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    A successful send_message returns within the MCP SLA, persists
    facilitator Round 0 Message + job.started, returns a cursor
    that decodes to the Facilitator Message's seq, and triggers
    Round 1 execution asynchronously (observable via subsequent
    get_response polls). Sending a second send_message while the
    first Job is queued/running raises MeetingBusy.
  test_template: integration
  boundary_classes:
    - happy path
    - text trimming (whitespace-only rejected)
    - addressees narrowing
    - second send_message (MeetingBusy)
    - meeting ended
  failure_scenarios:
    - send_message blocks until termination (defeats async)
    - second Job persists despite MeetingBusy
---
```

```yaml
---
id: meeting:BEH-003
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: get_response polls a Job's status and Transcript deltas with optional bounded wait
given: |
  - the Job exists
  - cursor (if provided) is a valid Cursor for the Job's Meeting
when: caller invokes `GetResponseUseCase.execute({ jobId, cursor?, limit?, waitMs? })`
then: |
  1. validate input (limit 1..500 default 200; waitMs 0..60000
     default 0).
  2. loadJob -> if absent JobNotFound. Resolve meetingId.
  3. if waitMs > 0 AND Job.status in {queued,running} AND
     readMessagesSince(meetingId, cursor, limit=1) yields no
     events: call MeetingStorePort.watchNewEvents({ meetingId,
     cursor, timeoutMs: waitMs }). Resolves on event or timeout.
  4. read the next page: readMessagesSince({ meetingId, cursor,
     limit }).
  5. reload the Job snapshot for the latest status /
     terminationReason / error.
  6. compose { jobId, meetingId, status, terminationReason,
     error, messages: <speech|pass|system messages from page>,
     nextCursor, hasMore }. round.started / round.completed and
     job.* events are NOT surfaced through this tool.
negative_cases:
  - schema violation                              => InvalidInput
  - job unknown                                   => JobNotFound
  - cursor invalid (decode / cross-meeting)       => CursorInvalid
  - store error                                   => StoreUnavailable
out_of_scope:
  - filtering by author (caller filters client-side)
  - returning round-marker events (use show --raw or get_transcript)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(jobId,cursor)"
  time_source: external
  reason: waitMs deadline measured against ClockPort via watchNewEvents
data_scope: all_data
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    Multiple get_response calls with the same cursor return the
    same events. waitMs > 0 unblocks on the first appended event
    (within tolerance). Terminal Jobs (completed/failed/cancelled)
    return immediately regardless of waitMs. round.* events are
    excluded from the messages array. Cross-meeting cursor reuse
    is rejected.
  test_template: integration
  boundary_classes:
    - terminal Job (waitMs ignored)
    - blocked wait resolves on append
    - blocked wait times out
    - pagination via nextCursor
    - cross-meeting cursor (rejected)
  failure_scenarios:
    - round.started leaks into messages
    - duplicate message across pages
---
```

```yaml
---
id: meeting:BEH-004
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: get_transcript reads a Meeting's Messages without blocking
given: |
  - the Meeting exists
when: caller invokes `GetTranscriptUseCase.execute({ meetingId, cursor?, limit? })`
then: |
  1. validate input (limit 1..500 default 200).
  2. loadMeeting -> if absent MeetingNotFound.
  3. readMessagesSince({ meetingId, cursor, limit }).
  4. return { meetingId, status, messages, nextCursor, hasMore }
     where messages contains speech/pass/system kinds only (no
     round.* / job.* events).
  Never blocks; ignores live updates. Safe to call on ended
  Meetings indefinitely.
negative_cases:
  - meeting unknown                              => MeetingNotFound
  - cursor invalid                               => CursorInvalid
  - store error                                  => StoreUnavailable
out_of_scope:
  - blocking wait (use get_response with waitMs)
  - returning the raw event stream (use show --raw)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(meetingId,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    For a Meeting with mixed event types, get_transcript returns
    speech/pass/system Messages in ascending seq with no round.*
    leakage. Cursor pagination yields a partition of the Message
    set with no duplicates and no omissions.
  test_template: integration
  boundary_classes:
    - empty Meeting
    - Meeting with only system events (no speech)
    - ended Meeting
    - cursor pagination
  failure_scenarios:
    - round.* events leak into result
---
```

```yaml
---
id: meeting:BEH-005
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: list_meetings filters, sorts, paginates Meeting summaries
given: |
  - any number of Meetings exist
when: caller invokes `ListMeetingsUseCase.execute({ status?, createdAfter?, createdBefore?, limit?, cursor? })`
then: |
  1. validate input (status default 'active'; limit 1..100
     default 50; reject createdAfter > createdBefore as
     InvalidInput).
  2. normalise status='all' to no filter.
  3. listMeetings({ status, createdAfter, createdBefore, limit,
     cursor }).
  4. each summary carries openJobCount = count of Jobs with
     status in {queued,running} (computed by the store; no N+1
     reads).
  5. return { summaries[], nextCursor: nextCursorOrNull } sorted
     newest createdAt first, ties broken by meetingId ascending.
negative_cases:
  - schema violation / inverted time range       => InvalidInput
  - cursor invalid                               => CursorInvalid
  - store error                                  => StoreUnavailable
out_of_scope:
  - full-text search
  - returning Transcript content
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(filter,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    For a mix of active / ended / startup-failed Meetings,
    default filter (status=active) hides ended; status=all returns
    everything; sort order is stable across pages.
  test_template: integration
  boundary_classes:
    - empty store
    - default status filter
    - status=all
    - inverted time range rejected
  failure_scenarios:
    - default filter shows ended Meetings
    - non-deterministic sort across runs
---
```

```yaml
---
id: meeting:BEH-006
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: end_meeting closes Sessions, optionally cancels in-flight Job, persists meeting.ended
given: |
  - the Meeting exists with status=active
when: caller invokes `EndMeetingUseCase.execute({ meetingId, cancelRunningJob? })`
then: |
  1. validate input.
  2. loadMeeting -> if absent MeetingNotFound; if status=ended
     MeetingAlreadyEnded.
  3. if openJobCount > 0 (in-flight Job):
     3a. cancelRunningJob=false -> MeetingBusy with the open
         jobId.
     3b. cancelRunningJob=true -> internally invoke CancelJobUseCase
         with reason='meeting-ended'; wait for the Job to reach a
         terminal state (bounded by VECHE_CANCEL_TIMEOUT_MS).
  4. for each Member Participant whose Session is open: call
     AgentAdapterPort.closeSession; failures are logged at warn,
     not propagated.
  5. MeetingStorePort.endMeeting({ meetingId, at: Clock.now });
     store appends meeting.ended and flips status.
  6. return { meetingId, status: 'ended', endedAt, cancelledJobId }
     (cancelledJobId is the id from step 3b or null).
negative_cases:
  - meeting unknown                              => MeetingNotFound
  - meeting already ended                        => MeetingAlreadyEnded
  - in-flight Job + cancelRunningJob=false       => MeetingBusy
  - store error                                  => StoreUnavailable
out_of_scope:
  - reopening an ended Meeting (no path; Meetings are immutable post-end)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(meetingId)"
  time_source: external
  reason: endedAt comes from ClockPort
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    end_meeting with no in-flight Job closes every Member Session
    and persists meeting.ended. With cancelRunningJob=true and an
    in-flight Job, the Job reaches terminal status (cancelled)
    before meeting.ended is appended; cancelledJobId is returned.
    With cancelRunningJob=false and an in-flight Job, MeetingBusy
    is raised and no events are appended. closeSession failures
    are logged but do not block the end.
  test_template: integration
  boundary_classes:
    - clean end (no Job)
    - end with in-flight Job (cancel + wait)
    - end with in-flight Job (MeetingBusy)
    - closeSession fails on one Member (logged, end succeeds)
  failure_scenarios:
    - meeting.ended appended despite MeetingBusy
    - close failure aborts the end
---
```

```yaml
---
id: meeting:BEH-007
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: cancel_job cooperatively cancels then forces terminal status within VECHE_CANCEL_TIMEOUT_MS
given: |
  - the Job exists and is non-terminal
when: caller invokes `CancelJobUseCase.execute({ jobId, reason? })`
then: |
  1. validate input (reason 1..200 chars; default 'cancelled-by-user').
  2. loadJob -> if absent JobNotFound; if status in
     {completed,failed,cancelled} JobAlreadyTerminal.
  3. set the in-memory cancellation signal for the Job's
     DiscussionRunner. The committee-protocol loop observes the
     signal at its checkpoints (committee-protocol:INV-002) and
     calls updateJob(status=cancelled) + appendSystemEvent('job.cancelled')
     on observation.
  4. wait up to VECHE_CANCEL_TIMEOUT_MS = 30_000 for the Job to
     reach a terminal state. Polling cadence is implementation-
     bounded (loop checks via loadJob / store change notification).
  5. on timeout (loop did not acknowledge): forcibly transition
     via updateJob({ status: 'cancelled', cancelReason: reason,
     finishedAt: Clock.now }) and appendSystemEvent('job.cancelled',
     { jobId, cancelReason }). Signal AgentAdapterPort.closeSession
     on every Member Session associated with the Job.
  6. return { jobId, status: 'cancelled', cancelledAt, lastSeq }.
negative_cases:
  - job unknown                                  => JobNotFound
  - job already terminal                         => JobAlreadyTerminal
  - store error                                  => StoreUnavailable
out_of_scope:
  - cancelling individual Member Turns (the unit of cancellation is the Job)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(jobId)"
  time_source: external
  reason: cooperative-cancellation budget measured against ClockPort
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    Cooperative path: with the loop honouring cancellationSignal,
    job.cancelled is appended by the loop within
    VECHE_CANCEL_TIMEOUT_MS and the Job is terminal at return.
    Forced path: with a stuck loop, the use case forces the Job
    terminal exactly once and emits job.cancelled itself; partial
    Transcript prior to cancel is preserved. A second cancel_job
    on the same id returns JobAlreadyTerminal.
  test_template: integration
  boundary_classes:
    - cooperative cancel within budget
    - forced cancel after timeout
    - second cancel rejected
  failure_scenarios:
    - double job.cancelled appended (cooperative + forced race)
    - forced cancel skips closeSession for in-flight Members
---
```

```yaml
---
id: meeting:BEH-008
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: veche list (CLI) prints Meeting summaries from FileMeetingStore as text or json
given: |
  - $VECHE_HOME (or --home override) is readable
when: operator invokes `veche list [--status …] [--limit …] [--format …] [--no-color] [--home …]`
then: |
  1. parse argv; reject unknown flags / invalid values with exit
     code 64 and a one-line stderr message.
  2. resolve VECHE_HOME via --home || $VECHE_HOME || $HOME/.veche.
  3. instantiate FileMeetingStore (read-only — no write methods
     called); call listMeetings({ status, limit }).
  4. for an empty default-filter result, print an advisory hint
     to stderr (`no active meetings; try --status all`) and still
     exit 0.
  5. render via the selected format and write to stdout.
     - text: aligned columns MEETING-ID/TITLE/STATUS/CREATED (UTC)
       /MEMBERS/OPEN JOBS; trailing footer `N meetings shown
       (filter: status=<status>)`. Colours when stdout is a TTY
       and --no-color absent and NO_COLOR absent.
     - json: pretty-printed `{ summaries, nextCursor }` with
       stable key order.
  6. exit 0.
negative_cases:
  - unknown flag / bad value                    => UsageError, exit 64
  - VECHE_HOME missing / corrupt                => StoreUnavailable, exit 2
  - any unhandled exception                     => InternalError, exit 1
out_of_scope:
  - cursor pagination across pages (use --format json | jq)
  - rendering env / secrets (env never reaches output)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(filter)"
  time_source: external
  reason: createdAt timestamps come from store data; CLI reads injected Clock for log lines only
data_scope: all_data
policy_refs:
  - meeting:POL-001
  - meeting:POL-002
test_obligation:
  predicate: |
    Happy path produces deterministic text and json output (snap
    tests). Default filter hides ended Meetings. --status=all
    includes them. --no-color disables colors even on a TTY. Bad
    flag exits 64 with empty stdout. Missing VECHE_HOME exits 2.
  test_template: integration
  boundary_classes:
    - text output (TTY + colours)
    - text output (non-TTY)
    - json output (stable keys)
    - empty store
    - bad flag (exit 64)
    - missing VECHE_HOME (exit 2)
  failure_scenarios:
    - env / secrets leak into output
    - non-empty stdout on a failure path
    - CLI calls a write method on the store
---
```

```yaml
---
id: meeting:BEH-009
type: Behavior
lifecycle:
  status: proposed
partition_id: meeting
title: veche show (CLI) renders one Meeting in text|html|markdown|json
given: |
  - $VECHE_HOME (or --home override) is readable
  - meetingId positional argument resolves via FileMeetingStore.loadMeeting
when: operator invokes `veche show <meetingId> [--format …] [--out …] [--open] [--raw] [--no-color] [--home …]`
then: |
  1. parse argv; reject usage errors (missing meetingId, unknown
     flag, --open without --format html, --open with --out
     <non-"-">) with exit 64.
  2. resolve VECHE_HOME; instantiate FileMeetingStore (read-only).
  3. loadMeeting -> on miss exit 3 with `meeting <id> not found`.
  4. body collection:
     - --raw absent: page through readMessagesSince in 500-message
       batches until hasMore=false; concatenate ordered Messages.
     - --raw present: readAllEvents(meetingId) and use the full
       event stream verbatim.
  5. render via selected format:
     - text: header key/value lines + `── Round N ──` rules +
       `[r<N> <author> <kind>] <text>` body; system messages as
       `⚠ system: <text>` indented to round; ANSI colours on TTY
       unless --no-color/NO_COLOR.
     - html: single self-contained HTML5 document per CTR-004
       (one <style>, no <script>, no remote refs, escape-then-
       transform Markdown for speech bubbles, deterministic
       participant colours, generator footer).
     - markdown: GFM with metadata yaml header, `### Round N`,
       `**<author>**` blockquote per speech, `_<author> passed._`,
       horizontal rule + `> ⚠ <text>` for system events.
     - json: `{ meeting, participants, jobs, messages,
       generatedAt }` pretty-printed with stable key order.
  6. resolve destination:
     - --open + --format html: write to
       `${os.tmpdir()}/veche-<meetingId>.html`; spawn opener
       (`open` / `xdg-open` / `start`); on opener failure log
       warning and still exit 0.
     - --out <path> (not '-'): atomic write `<path>.tmp-<pid>-<ts>`
       then rename.
     - --out '-' or absent: write to stdout.
  7. exit 0. On any write failure during step 6 exit 2.
negative_cases:
  - bad/missing meetingId / contradictory flags    => UsageError, exit 64
  - meetingId not found                            => MeetingNotFound, exit 3
  - VECHE_HOME missing / corrupt                   => StoreUnavailable, exit 2
  - file write failure                             => WriteFailed, exit 2
  - opener missing (--open path)                   => OpenerUnavailable warning, exit 0 (file written)
  - any unhandled exception                        => InternalError, exit 1
out_of_scope:
  - syntax-highlighting fenced code blocks (no JS allowed in HTML)
  - rendering env / secrets (env is never rendered in any format)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(meetingId,format,raw)"
  time_source: external
  reason: generatedAt comes from ClockPort
data_scope: all_data
policy_refs:
  - meeting:POL-001
  - meeting:POL-002
  - meeting:POL-003
test_obligation:
  predicate: |
    For each format, output is deterministic given a frozen Clock
    and id (snap tests). HTML output passes the no-remote-refs and
    one-inline-script-zero regex probes; the speech bubbles use
    htmlBody from src/shared/markdown.ts; --raw expands to the
    event stream. --out path writes atomically. Exit codes match
    the table above.
  test_template: integration
  boundary_classes:
    - text on TTY
    - html with --open
    - html written via --out
    - markdown
    - json
    - --raw
    - missing meetingId (exit 3)
    - bad flag (exit 64)
  failure_scenarios:
    - non-atomic write leaves a half-file
    - HTML embeds remote font / image
    - env value leaks into output
---
```

### Contracts (meeting)

```yaml
---
id: meeting:CTR-001
type: Contract
lifecycle:
  status: proposed
partition_id: meeting
title: MCP tool inputs and outputs (the seven veche/* tools)
surface_ref: meeting:SUR-001
schema:
  description: |
    Input / output / error-mapping for each MCP tool. Errors are
    JSON-RPC envelopes with one of the documented MCP codes;
    domain error class -> MCP code mapping is part of the Surface.
    The wire schemas are also serialised by
    src/adapters/inbound/mcp/schemas.ts (Zod) — that file is the
    operational source of truth.
  start_meeting_input: |
    { title: string(1..200 trimmed),
      facilitator: { id?: string, displayName?: string },
      members: Member[1..8],
      defaultMaxRounds?: integer(1..VECHE_MAX_ROUNDS_CAP) }
    Member: { id: string,
              profile?: string,
              adapter?: 'codex-cli'|'claude-code-cli',
              model?: string,
              systemPrompt?: string(<= 8 KiB),
              workdir?: string,
              extraFlags?: string[<=16],
              env?: Record<string,string>(<=32 entries; keys ^[A-Z_][A-Z0-9_]*$; forbidden CODEX_API_KEY/HOME/PATH/CLAUDE_BIN/CODEX_BIN) }
  start_meeting_output: |
    { meetingId, title, createdAt, participants[], defaultMaxRounds, cursor }
  send_message_input: |
    { meetingId, text: string(1..32 KiB UTF-8 non-empty-after-trim),
      maxRounds?: integer(1..VECHE_MAX_ROUNDS_CAP),
      turnTimeoutMs?: integer(10000..3_600_000),
      addressees?: ParticipantId[] }
  send_message_output: |
    { jobId, meetingId, cursor }
  get_response_input: |
    { jobId, cursor?: string, limit?: integer(1..500), waitMs?: integer(0..60000) }
  get_response_output: |
    { jobId, meetingId, status, terminationReason, error,
      messages: Message[], nextCursor, hasMore }
  get_transcript_input: |
    { meetingId, cursor?: string, limit?: integer(1..500) }
  get_transcript_output: |
    { meetingId, status, messages, nextCursor, hasMore }
  list_meetings_input: |
    { status?: 'active'|'ended'|'all', createdAfter?: Instant,
      createdBefore?: Instant, limit?: integer(1..100), cursor?: string }
  list_meetings_output: |
    { summaries: MeetingSummary[], nextCursor: string|null }
  end_meeting_input: |
    { meetingId, cancelRunningJob?: boolean }
  end_meeting_output: |
    { meetingId, status: 'ended', endedAt, cancelledJobId: JobId|null }
  cancel_job_input: |
    { jobId, reason?: string(1..200) }
  cancel_job_output: |
    { jobId, status: 'cancelled', cancelledAt, lastSeq }
  error_mapping: |
    InvalidInput / DuplicateParticipantId / WorkdirUnavailable /
      ProfileNotFound / ProfileAdapterMismatch /
      AdapterFlagNotAllowed / AdapterConfigInvalid /
      CursorInvalid / AddresseeNotFound -> invalid_params
    MeetingNotFound / JobNotFound -> not_found
    MeetingAlreadyEnded / NoActiveMembers / MeetingBusy /
      JobAlreadyTerminal -> failed_precondition
    AdapterNotAvailable -> unavailable
    StoreUnavailable / InternalError -> internal_error
preconditions:
  - the MCP server validates inputs via Zod schemas before calling
    the use case
  - branded ids (MeetingId / JobId / ParticipantId / MessageId)
    are serialised as plain strings on the wire
postconditions:
  - >-
    tools never partially mutate state across error returns; a
    failed start_meeting either creates the Meeting (success
    path) or rolls back via endMeeting (failure path)
external_identifiers:
  - "tool names: start_meeting, send_message, get_response, get_transcript, list_meetings, end_meeting, cancel_job"
  - field names listed in each schema block above
  - error class names + MCP code strings listed in error_mapping
compatibility_rules:
  - renaming a tool                              => major bump on SUR-001
  - removing a tool                              => major bump
  - renaming any input / output / error field    => major bump
  - tightening optional input field to required => major bump
  - widening MCP code per error class            => major bump (clients exhaustively switch)
  - adding a new optional input or output field  => minor bump
  - adding a new tool                            => minor bump (existing clients ignore unknown tools)
  - adding a new domain-error mapping            => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_wire_shapes
  reason: per-call concurrency lives on the BEH blocks, not on the schema record
data_scope: all_data
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    For each tool, the Zod schema in
    src/adapters/inbound/mcp/schemas.ts accepts every documented
    happy-path input and rejects each documented violation.
    end-to-end MCP stdio tests
    (src/adapters/inbound/mcp/__tests__/e2e.stdio.test.ts) round-
    trip a representative payload per tool and assert the error
    code mapping.
  test_template: contract
  boundary_classes:
    - one happy-path payload per tool
    - one rejection per documented validation rule
    - one error-class -> MCP-code mapping per row
  failure_scenarios:
    - tool drift unbumped
    - error class silently mapped to a different MCP code
---
```

```yaml
---
id: meeting:CTR-002
type: Contract
lifecycle:
  status: proposed
partition_id: meeting
title: Meeting / Participant / Job / Message domain shapes (wire-stable subset)
surface_ref: meeting:SUR-001
schema:
  description: |
    The wire-stable subset of the Meeting aggregate fields
    surfaced through MCP tool outputs and the read-only CLI. The
    persisted on-disk subset is owned by persistence (CTR-002 /
    CTR-004); this Contract pins what consumers of MCP / CLI
    receive, including key order in the json renderer.
  meeting: |
    Meeting {
      id: MeetingId; title: string;
      status: 'active'|'ended';
      createdAt: Instant; endedAt: Instant|null;
      participants: Participant[]; defaultMaxRounds: integer
    }
  participant: |
    Participant {
      id: ParticipantId;
      role: 'facilitator'|'member';
      adapter: 'codex-cli'|'claude-code-cli'|null;
      profile: string|null;
      systemPrompt: string|null;
      workdir: string|null;
      model: string|null;
      extraFlags: string[];
      status: 'active'|'dropped';
      droppedAt: Instant|null;
      droppedReason: string|null
    }
    NB: env is intentionally absent from the wire shape — see
    INV-005 (no secrets surfaced).
  job: |
    Job {
      id: JobId;
      meetingId: MeetingId;
      status: 'queued'|'running'|'completed'|'failed'|'cancelled';
      createdAt: Instant; startedAt: Instant|null;
      finishedAt: Instant|null;
      maxRounds: integer; lastSeq: integer; rounds: integer;
      terminationReason: 'all-passed'|'max-rounds'|'no-active-members'|'cancelled'|null;
      error: { code: string, message: string }|null;
      cancelReason: string|null
    }
  message: |
    Message {
      id: MessageId;
      meetingId: MeetingId;
      seq: integer; round: integer;
      author: ParticipantId|'system';
      kind: 'speech'|'pass'|'system';
      text: string;
      createdAt: Instant
    }
  message_dto_html_extension: |
    Through both the `show --format=html` renderer and the
    web-viewer SSE channel, every speech Message gains an
    additional field htmlBody: string produced by the shared
    escape-then-transform Markdown converter
    (src/shared/markdown.ts). pass / system Messages carry
    htmlBody=null. htmlBody is NOT part of the MCP wire shape.
preconditions:
  - branded ids serialise as plain strings on the wire
  - Instant is ISO-8601 (RFC 3339) with millisecond precision
postconditions:
  - consumers never see a Participant with role=facilitator and adapter != null
  - consumers never see a Job with status=completed and terminationReason=null (terminationReason is non-null on every clean termination)
external_identifiers:
  - field names in each shape above
  - role enum: facilitator, member
  - kind enum: speech, pass, system
  - status enums on Meeting / Participant / Job
  - terminationReason enum
compatibility_rules:
  - renaming any field                            => major bump on SUR-001
  - widening any closed enum                      => major bump
  - tightening optional field to required         => major bump
  - adding a new optional field                   => minor bump (consumers ignore unknowns)
  - removing the env-omission rule (surfacing env) => major bump (security regression)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_record_shapes
  reason: per-call concurrency lives on the BEH blocks
data_scope: all_data
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    For each entity, a representative MCP tool response (or CLI
    json output) parses against the schema. Participant.env is
    never emitted to any wire channel. Adding a new
    terminationReason value forces a compile error in every
    consumer switch (Meeting partition + show renderers + SPA).
  test_template: contract
  boundary_classes:
    - happy snapshot per entity
    - participant with env (env is omitted from output)
    - job in each terminal status
    - non-exhaustive switch fails to compile after enum widen
  failure_scenarios:
    - env leaks to output
    - new terminationReason silently ignored
---
```

```yaml
---
id: meeting:CTR-003
type: Contract
lifecycle:
  status: proposed
partition_id: meeting
title: veche list / show CLI argv shapes and exit codes
surface_ref: meeting:SUR-002
schema:
  description: |
    The argv shapes accepted by `veche list` and `veche show` and
    their exit-code semantics. Stable across minor versions.
  list_argv: |
    veche list
      [--status active|ended|all]
      [--limit 1..100]
      [--format text|json]
      [--no-color]
      [--home <abs-path>]
  show_argv: |
    veche show <meetingId>
      [--format text|html|markdown|json]
      [--out <path>|-]
      [--open]                  (only with --format html; mutually exclusive with --out <non-->)
      [--raw]
      [--no-color]
      [--home <abs-path>]
  exit_codes: |
    0   success / opener-warn-only
    1   InternalError (any unhandled exception)
    2   StoreUnavailable / WriteFailed / SkillSourceMissing-equiv (`show` only on file-write failure)
    3   MeetingNotFound (`show` only)
    64  UsageError (unknown flag, bad value, contradictory combo)
external_identifiers:
  - command names: list, show
  - flag names: --status, --limit, --format, --no-color, --home, --out, --open, --raw
  - format enum strings: text, json, html, markdown
  - exit code integers: 0, 1, 2, 3, 64
compatibility_rules:
  - renaming a flag                                => major bump on SUR-002
  - removing a flag                                => major bump
  - widening exit-code semantics                   => major bump
  - adding a new flag (default-off, optional)      => minor bump
  - adding a new format value                      => minor bump
  - adding a new exit code                         => minor bump (existing scripts treat unknown as failure)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
data_scope: all_data
policy_refs:
  - meeting:POL-002
test_obligation:
  predicate: |
    cli.integration.test.ts exercises (a) every documented
    happy-path argv at least once, (b) one rejection per UsageError
    rule, (c) the exit-3 path on missing meetingId, (d) the exit-2
    path on a missing VECHE_HOME (synthetic).
  test_template: integration
  boundary_classes:
    - list happy paths
    - show happy paths per format
    - bad flag rejection
    - missing meetingId
    - missing VECHE_HOME
  failure_scenarios:
    - exit code drift unbumped
    - unknown format silently rendered
---
```

```yaml
---
id: meeting:CTR-004
type: Contract
lifecycle:
  status: proposed
partition_id: meeting
title: HTML / Markdown rendering pipeline (escape-then-transform + inline-tag allowlist)
surface_ref: meeting:SUR-002
schema:
  description: |
    The escape-then-transform pipeline backing both
    `show --format=html` and the web-viewer's MessageDto.htmlBody.
    Lives in src/shared/markdown.ts; consumers must not implement
    a second copy.
  pipeline: |
    1. HTML-escape every character of the source text (&, <, >, ", ').
    2. Apply the small in-tree Markdown converter (idempotent on
       the escaped string), introducing only the tags it produces.
       Supported subset:
         - **bold** / __bold__   -> <strong>
         - *italic* / _italic_   -> <em>
         - `inline`              -> <code>
         - ```lang\n...\n```     -> <pre><code class="lang-...">...</code></pre>
                                    (fences allow 0..3 leading spaces)
         - # / ## / ### Heading  -> <h1>..<h3>
         - bullet list (- / * / +) -> <ul><li>...</li></ul>
         - ordered list (1.)     -> <ol><li>...</li></ol>
         - > quote               -> <blockquote>
         - --- / ___ on its own line -> <hr>
         - [label](url)          -> <a href="url"> when url matches ^(https?:|mailto:); else literal
         - GFM table             -> <table><thead><tbody>
         - blank line            -> paragraph break
       Anything outside the subset is rendered as escaped literal
       text.
    3. Un-escape a fixed inline-tag allowlist (open + close, no
       attributes): b, strong, i, em, u, s, del, ins, code, sub,
       sup, kbd, mark, small, abbr. Void tags allowed: br, hr.
    4. Tags inside <code> / <pre> are NOT un-escaped (they stay
       literal so fenced code blocks preserve angle brackets).
    5. Tags outside the allowlist (e.g. <script>, <iframe>,
       <a> with attributes, <img>) stay escaped.
  applies_to: |
    - `speech` Messages rendered into the static HTML report
      (`show --format=html`).
    - `MessageDto.htmlBody` field returned by the web-viewer's
      JSON / SSE channels for `speech` Messages.
    Does NOT apply to `pass` / `system` Messages (rendered as
    pills / dividers via textContent).
external_identifiers:
  - module path: src/shared/markdown.ts
  - inline-tag allowlist members
  - URL scheme allowlist: http, https, mailto
compatibility_rules:
  - removing an entry from the inline-tag allowlist          => major bump on SUR-002
  - adding a new entry to the inline-tag allowlist           => minor bump
  - widening URL scheme allowlist                            => major bump (security regression review required)
  - swapping the order of escape/transform steps             => major bump
  - introducing a second converter implementation            => contract violation (single source of truth)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: pure_function_no_side_effects
  reason: converter is a string-to-string transform
data_scope: all_data
policy_refs:
  - meeting:POL-003
test_obligation:
  predicate: |
    src/adapters/inbound/cli/__tests__/renderers.test.ts asserts
    every documented Markdown branch round-trips, every URL scheme
    outside the allowlist stays escaped, every disallowed inline
    tag stays escaped, and a regex probe confirms no remote
    `href`/`src` reaches the output.
  test_template: contract
  boundary_classes:
    - one input per Markdown branch
    - mixed inline-tag allowlist (allowed + disallowed)
    - URL with javascript: scheme rejected
    - fenced block preserves angle brackets verbatim
  failure_scenarios:
    - <script> tag un-escaped by accident
    - URL allowlist widened silently
    - second converter implementation in the SPA
---
```

```yaml
---
id: meeting:CTR-005
type: Contract
lifecycle:
  status: proposed
partition_id: meeting
title: --out atomic write semantics (`show --out <path>` writes via tmp + rename)
surface_ref: meeting:SUR-002
schema:
  description: |
    File-write semantics for `veche show --out <path>` and the
    --open temp-file branch. Mirrors the persistence partition's
    manifest-rewrite pattern (INV-005 there).
  procedure: |
    1. write payload to `<path>.tmp-<pid>-<ts>`
    2. fsync the tmp fd
    3. rename(<tmp>, <path>) — atomic on POSIX within the same FS
    4. on rename failure, attempt to delete the tmp file
    The reader (a downstream tool) never observes a partial /
    truncated file at <path>.
  applies_to: |
    - `veche show --out <abs-path>` with format html|markdown|json
    - `veche show --open` writing to ${os.tmpdir()}/veche-<id>.html
external_identifiers:
  - tmp suffix template: .tmp-<pid>-<ts>
  - rename atomicity assumption (within same filesystem)
compatibility_rules:
  - changing the tmp suffix template      => minor bump (downstream tools should not depend on tmp filename)
  - dropping the tmp + rename pattern (e.g. direct write)   => major bump (security / robustness regression)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: tmp suffix uses Date.now()-equivalent via Clock for determinism in tests
data_scope: all_data
policy_refs:
  - meeting:POL-002
test_obligation:
  predicate: |
    With a synthetic write target, a reader looping
    `readFile(target)` during many concurrent `show --out` calls
    never observes a partial file. A failed rename leaves no
    `<path>.tmp-*` orphan in the parent directory.
  test_template: integration
  boundary_classes:
    - happy path
    - rename failure (cleanup)
    - reader during write
  failure_scenarios:
    - reader observes truncated file
    - tmp orphan on rename failure
---
```

### Invariants (meeting)

```yaml
---
id: meeting:INV-001
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: at most one Job per Meeting in {queued, running}
always: |
  At any instant, the set of Jobs for a given Meeting contains at
  most one Job whose status is in {queued, running}. The store
  enforces this on createJob (raises JobStateTransitionInvalid
  surfaced as MeetingBusy by SendMessageUseCase). EndMeetingUseCase
  honours it via the cancelRunningJob branch in BEH-006.
scope: meeting (entire partition)
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
  reason: enforced by per-Meeting store-level serialisation
negative_cases:
  - second Job created while first is queued/running   => MeetingBusy
out_of_scope:
  - multi-Meeting concurrency (each Meeting has its own bound)
test_obligation:
  predicate: |
    Two concurrent send_message invocations on the same Meeting
    -> exactly one returns success, the other raises MeetingBusy.
    end_meeting with cancelRunningJob=false on a busy Meeting
    raises MeetingBusy.
  test_template: integration
  boundary_classes:
    - sequential second send_message (rejected)
    - concurrent send_message (one rejected)
    - end_meeting on busy Meeting
  failure_scenarios:
    - two Jobs in {queued,running} at the same time
---
```

```yaml
---
id: meeting:INV-002
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: send_message returns within the MCP tool-call SLA
always: |
  SendMessageUseCase.execute completes within the MCP transport's
  tool-call SLA (operationally bounded at < 2 s wall-clock under
  normal disk + adapter probe latency). The use case performs only
  validation, MeetingBusy guard, createJob, appendMessage(round 0),
  updateJob(running), and the fire-and-forget hand-off to the
  JobRunner. It MUST NOT await the first Round, the first
  message.posted from a Member, or any subprocess spawn.
scope: meeting (entire partition)
evidence: operational_signal
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: the SLA is measured against ClockPort in tests; production wall-clock latency is the externally observable witness
negative_cases:
  - send_message awaits Round 1 completion           => contract violation (defeats async hand-off)
  - send_message awaits the first message.posted      => contract violation
out_of_scope:
  - the actual end-to-end Job duration (bounded by maxRounds * turnTimeoutMs + overhead)
test_obligation:
  predicate: |
    With a fake JobRunner that hangs forever in Round 1,
    send_message still returns within the 2 s budget, the Job is
    persisted with status=running, and the Round-1 hang is
    observable only via subsequent get_response calls.
  test_template: integration
  boundary_classes:
    - happy path with fast adapter
    - hung Round 1 (send_message still returns)
  failure_scenarios:
    - send_message blocks until Round 1 completes
---
```

```yaml
---
id: meeting:INV-003
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: Meeting.status is monotonic (active -> ended; never the other way)
always: |
  Once a Meeting reaches status='ended', no code path returns it
  to status='active'. EndMeetingUseCase appends meeting.ended
  exactly once; subsequent operations (send_message, end_meeting,
  cancel_job on a non-existent in-flight Job) raise the documented
  MeetingAlreadyEnded / JobNotFound errors. The Transcript remains
  queryable indefinitely.
scope: meeting (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_aggregate_lifecycle
  reason: state transition rule, not a runtime concurrency property
negative_cases:
  - new tool reopens an ended Meeting        => contract violation
  - second meeting.ended event for the same Meeting => persistence-side StoreUnavailable
out_of_scope:
  - resurrecting an ended Meeting via direct event log surgery (out of v1)
test_obligation:
  predicate: |
    After end_meeting, every other tool returns the documented
    error or the read-only success path. A second end_meeting
    raises MeetingAlreadyEnded with no new event appended.
  test_template: integration
  boundary_classes:
    - end_meeting then send_message (rejected)
    - end_meeting then end_meeting (rejected)
    - end_meeting then get_transcript (succeeds)
  failure_scenarios:
    - second end_meeting silently succeeds
    - new write tool accepted on ended Meeting
---
```

```yaml
---
id: meeting:INV-004
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: CLI commands never call MeetingStorePort write methods
always: |
  The `veche list` and `veche show` commands MUST NOT invoke any
  of: createMeeting, appendMessage, appendSystemEvent,
  markParticipantDropped, createJob, updateJob, endMeeting,
  watchNewEvents. They use only the read methods (loadMeeting,
  listMeetings, readMessagesSince, readAllEvents). The integration
  test injects a mock store whose write methods throw and asserts
  the CLI never trips them.
scope: meeting (CLI sub-tree only)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: none
  reason: CLI is read-only; safe to run alongside the writing MCP server
negative_cases:
  - any CLI code path calls a write method         => contract violation
out_of_scope:
  - the install command's write surface (lives in the install partition)
test_obligation:
  predicate: |
    cli.integration.test.ts injects a throwing mock for every
    write method and asserts the list / show flows complete
    without tripping any. A regex probe over the source confirms
    no `\.createMeeting\(`, `\.appendMessage\(`,
    `\.appendSystemEvent\(`, `\.markParticipantDropped\(`,
    `\.createJob\(`, `\.updateJob\(`, `\.endMeeting\(`,
    `\.watchNewEvents\(` calls in src/adapters/inbound/cli/.
  test_template: integration
  boundary_classes:
    - list path
    - show path per format
  failure_scenarios:
    - CLI unwittingly calls a write method
---
```

```yaml
---
id: meeting:INV-005
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: secrets (env, raw API keys) never reach output channels
always: |
  Participant.env and Profile.env are NEVER rendered in any
  output: not in MCP tool responses (CTR-002 omits env from
  Participant on the wire), not in CLI text/html/markdown/json
  formats, not in the web-viewer SSE / JSON channels, not in log
  lines emitted by use cases. systemPrompt IS rendered (it is the
  task instruction, not a credential) but is visually
  de-emphasised in html/text. Tool inputs containing forbidden env
  keys are rejected at validation time (CTR-001).
scope: meeting (entire partition + the web-viewer DTO mapper that consumes it)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_redaction_rule
  reason: redaction is a per-render property, not a runtime concurrency one
negative_cases:
  - env leaks via list --format=json          => contract violation
  - env leaks via show --format=html          => contract violation
  - structured log line includes a token      => contract violation
out_of_scope:
  - filtering systemPrompt content (operators are responsible for not embedding secrets there)
test_obligation:
  predicate: |
    For each format / channel, a Participant with env={ TEST_KEY:
    'shouldnotleak' } yields output that does not contain the
    string 'shouldnotleak' anywhere. CLI integration tests +
    renderer unit tests + (cross-partition) web-viewer SPA tests
    enforce this property.
  test_template: contract
  boundary_classes:
    - list json
    - show text / html / markdown / json
    - logs (structured)
  failure_scenarios:
    - env value found in output
    - env keys leaked even with empty values
---
```

```yaml
---
id: meeting:INV-006
type: Invariant
lifecycle:
  status: proposed
partition_id: meeting
title: HTML output document is self-contained and loads zero remote resources
always: |
  The HTML produced by `show --format=html` MUST satisfy: zero
  `<script>` elements (web-viewer's SPA has its own one-script
  allowance — that is a different artefact); zero
  `<link rel="stylesheet">`; zero `<img src=…>` referencing remote
  URLs (data: scheme is permitted); zero web fonts; zero `<iframe>`
  / `<object>` / `<embed>`. CSS is inlined in a single `<style>`
  block. A regex probe in renderers.test.ts asserts the property
  on every render branch.
scope: meeting (show CLI, html format only)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_html_property
  reason: rendering is a pure function over the Meeting aggregate
negative_cases:
  - <script src="…"> appears in output         => contract violation
  - <link rel="stylesheet" href="…">           => contract violation
  - remote <img src="http://…">                => contract violation
out_of_scope:
  - allowing inline `<script>` elements (the SPA partition relaxes this with one inline block; show stays at zero)
test_obligation:
  predicate: |
    For every snapshot input fixture in renderers.test.ts, the
    rendered HTML matches /^<!doctype html>/i, contains no
    `<script` substring, and a custom probe rejects any remote
    href / src.
  test_template: contract
  boundary_classes:
    - empty Meeting (no Messages)
    - Meeting with code blocks
    - Meeting with images-in-text (escaped)
  failure_scenarios:
    - inline `<script>` block appears
    - remote font / stylesheet referenced
---
```

### Policies (meeting)

```yaml
---
id: meeting:POL-001
type: Policy
lifecycle:
  status: proposed
partition_id: meeting
title: meeting use cases delegate I/O to MeetingStorePort and AgentAdapterPort exclusively
policy_kind: io_scope
applicability:
  applies_to: |
    every BEH in the meeting partition's MCP tool layer
    (BEH-001..007). Excludes the CLI sub-tree (covered by POL-002)
    and the renderer pipeline (POL-003).
predicate: |
  - The MCP-tool BEHs perform I/O ONLY through MeetingStorePort
    (read + write methods) and AgentAdapterPort (openSession /
    closeSession; sendTurn is owned by committee-protocol). They
    do NOT open the filesystem, spawn subprocesses, or open
    network sockets directly.
  - The Facilitator never has an open Session.
  - Tool-input validation happens BEFORE any side effect; failures
    return without persisting anything.
  - StartMeetingUseCase rolls back partial state on any
    openSession failure (closes opened Sessions + endMeeting).
negative_test_obligations:
  - inject a throwing mock for AgentAdapterPort.sendTurn into
    StartMeetingUseCase / EndMeetingUseCase / CancelJobUseCase
    paths and assert no use case invokes it directly
  - inject a throwing MeetingStorePort.<write> into pre-validation
    phases and assert the validation error fires first
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - StartMeeting rollback path
    - SendMessage with pre-validation failure
    - EndMeeting closeSession-failure logged
  failure_scenarios:
    - tool call directly opens a filesystem path
    - tool call spawns a subprocess outside the adapter boundary
---
```

```yaml
---
id: meeting:POL-002
type: Policy
lifecycle:
  status: proposed
partition_id: meeting
title: CLI commands restrict store access to the read-only port subset
policy_kind: io_scope
applicability:
  applies_to: |
    BEH-008 (list) and BEH-009 (show) and the helper modules they
    invoke (renderers, opener, packageRoot).
predicate: |
  - CLI commands MUST NOT call MeetingStorePort.{createMeeting,
    appendMessage, appendSystemEvent, markParticipantDropped,
    createJob, updateJob, endMeeting, watchNewEvents}.
  - CLI commands write to the filesystem ONLY via
    `show --out <path>` (atomic tmp+rename per CTR-005) or
    `show --open` (atomic tmp+rename to ${os.tmpdir()}). Stdout /
    stderr writes are not filesystem writes for this rule.
  - CLI commands spawn ONE process: the platform opener
    (`open` / `xdg-open` / `start`), and only when --open is
    requested. No other binary is spawned.
  - CLI commands read $VECHE_HOME, optionally $HOME (to derive
    default), and accept --home as a single override. They read
    NO_COLOR for color decisions. They MUST NOT read CODEX_API_KEY
    / CLAUDE_BIN / CODEX_BIN.
negative_test_obligations:
  - "throwing mock store: every documented CLI happy path passes"
  - >-
    argv capture: only `open` / `xdg-open` / `start "" <path>` are
    spawned, only on --open, only with the documented argv
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - list against throwing-write mock store
    - show against throwing-write mock store
    - --open spawns exactly one platform-opener subprocess
  failure_scenarios:
    - CLI calls a write method on the store
    - CLI spawns a binary other than the opener
---
```

```yaml
---
id: meeting:POL-003
type: Policy
lifecycle:
  status: proposed
partition_id: meeting
title: HTML rendering MUST escape every interpolated string and apply the inline-tag allowlist
policy_kind: security_boundary
applicability:
  applies_to: |
    every code path that produces HTML for `show --format=html`
    or for the web-viewer's MessageDto.htmlBody (consumed by both
    the static report and the SPA via innerHTML).
predicate: |
  - All strings originating from messages, participant ids,
    titles, and error text MUST pass through the HTML escaper
    BEFORE any tag interpolation.
  - Speech-bubble bodies MUST go through the escape-then-transform
    Markdown pipeline (CTR-004). Raw HTML in agent text is
    impossible by construction — only allow-listed tags survive
    the un-escape pass.
  - Attribute values use double-quote delimiters; the escaper
    handles `"`, `&`, `<`, `>`, and `'` consistently.
  - URL attributes are filtered to the scheme allowlist
    (http, https, mailto). Other schemes (`javascript:`, `data:`,
    `file:`, `vbscript:`) are rejected and the link is rendered
    as escaped literal text.
negative_test_obligations:
  - input containing `<script>alert(1)</script>` renders as
    escaped text, never as a live tag
  - input containing `<a href="javascript:alert(1)">` renders as
    escaped literal
  - input containing `<img src="http://evil/x.png">` renders as
    escaped literal (no live <img>)
test_obligation:
  predicate: same as negative_test_obligations + parity check
    between the static renderer and the web-viewer DTO mapper
    (single source of truth in src/shared/markdown.ts)
  test_template: contract
  boundary_classes:
    - script injection
    - javascript: URL
    - remote image
    - allowed inline tag (e.g. <kbd>)
    - disallowed inline tag (e.g. <iframe>)
  failure_scenarios:
    - new converter implementation introduced in the SPA
    - allowlist widened without major bump
---
```

### Constraints (meeting)

```yaml
---
id: meeting:CST-001
type: Constraint
lifecycle:
  status: proposed
partition_id: meeting
constraint: |
  The CLI (`veche list`, `veche show`, `veche watch`, `veche
  install`) hand-rolls argv parsing using `node:util` /
  `process.argv`. Third-party argv parsers (`yargs`, `commander`,
  `minimist`, `meow`) are NOT permitted. The wire stack uses only
  Node built-ins on both sides (`node:http`, `node:url`,
  `node:crypto`, `node:fs/promises`, `EventSource`). Frameworks
  (Express, Fastify, Koa) are forbidden.
rationale: |
  Each CLI command's flag set is small enough to parse by hand,
  the argv quirks of `claude` / `codex` (variadic flags, `=`
  separators) demand exact control over emitted argv that
  third-party libraries make harder, and the read-only HTTP
  surface in web-viewer is small enough to serve from `node:http`
  directly. The Constraint preserves this invariant against
  drive-by additions.
test_obligation:
  predicate: |
    package.json `dependencies` of the project contain none of:
    yargs, commander, minimist, meow, express, fastify, koa,
    hapi. Importing src/adapters/inbound/cli/VecheCli.ts or
    src/adapters/inbound/web/WatchServer.ts and traversing the
    import graph yields only first-party files and Node built-ins.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a forbidden dependency appears in a future PR
---
```

### Implementation bindings (meeting)

```yaml
---
id: meeting:IMP-001
type: ImplementationBinding
lifecycle:
  status: proposed
partition_id: meeting
target_ids:
  - meeting:BEH-001
  - meeting:BEH-002
  - meeting:BEH-003
  - meeting:BEH-004
  - meeting:BEH-005
  - meeting:BEH-006
  - meeting:BEH-007
  - meeting:BEH-008
  - meeting:BEH-009
  - meeting:CTR-001
  - meeting:CTR-002
  - meeting:CTR-003
  - meeting:CTR-004
  - meeting:CTR-005
  - meeting:INV-001
  - meeting:INV-002
  - meeting:INV-003
  - meeting:INV-004
  - meeting:INV-005
  - meeting:INV-006
binding:
  feature_slice:
    root: src/features/meeting
    application:
      - src/features/meeting/application/StartMeetingUseCase.ts
      - src/features/meeting/application/SendMessageUseCase.ts
      - src/features/meeting/application/GetResponseUseCase.ts
      - src/features/meeting/application/GetTranscriptUseCase.ts
      - src/features/meeting/application/ListMeetingsUseCase.ts
      - src/features/meeting/application/EndMeetingUseCase.ts
      - src/features/meeting/application/CancelJobUseCase.ts
      - src/features/meeting/application/JobRunner.ts
      - src/features/meeting/application/constants.ts
    domain:
      - src/features/meeting/domain/Meeting.ts
      - src/features/meeting/domain/Participant.ts
      - src/features/meeting/domain/Message.ts
      - src/features/meeting/domain/Job.ts
      - src/features/meeting/domain/Cursor.ts
      - src/features/meeting/domain/errors.ts
      - src/features/meeting/domain/index.ts
    barrel: src/features/meeting/index.ts
  inbound_adapters:
    mcp:
      root: src/adapters/inbound/mcp
      server: src/adapters/inbound/mcp/VecheMcpServer.ts
      schemas: src/adapters/inbound/mcp/schemas.ts
      error_mapping: src/adapters/inbound/mcp/errorMapping.ts
      e2e_tests: src/adapters/inbound/mcp/__tests__/e2e.stdio.test.ts
    cli:
      list: src/adapters/inbound/cli/commands/list.ts
      show: src/adapters/inbound/cli/commands/show.ts
      renderers:
        - src/adapters/inbound/cli/renderers/text.ts
        - src/adapters/inbound/cli/renderers/html.ts
        - src/adapters/inbound/cli/renderers/markdown.ts
        - src/adapters/inbound/cli/renderers/json.ts
        - src/adapters/inbound/cli/renderers/helpers.ts
        - src/adapters/inbound/cli/renderers/types.ts
      lib:
        - src/adapters/inbound/cli/lib/opener.ts
        - src/adapters/inbound/cli/lib/packageRoot.ts
      tests:
        - src/adapters/inbound/cli/__tests__/cli.integration.test.ts
        - src/adapters/inbound/cli/__tests__/renderers.test.ts
        - src/adapters/inbound/cli/__tests__/fixtures.ts
  shared_markdown:
    - src/shared/markdown
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/features/meeting/application/__tests__/committee.integration.test.ts,
  src/adapters/inbound/mcp/__tests__/e2e.stdio.test.ts (MCP
  surface), src/adapters/inbound/cli/__tests__/cli.integration.test.ts
  (CLI surface), and renderers.test.ts (CTR-004 / INV-006). Tests
  that close a Test obligation carry an `// @covers meeting:<ID>`
  marker.
---
```

### Open questions (meeting)

```yaml
---
id: meeting:OQ-001
type: Open-Q
lifecycle:
  status: proposed
partition_id: meeting
question: |
  Should an MCP server crash mid-Job recover the in-flight Job on
  next startup (replay until the last persisted event, resume the
  loop), or stay with v1's "classify as failed with
  InterruptedByShutdown" policy?
options:
  - id: a
    label: keep_failed_on_restart_v1
    consequence: |
      v1 stays as-is. A Job whose process died is observed on next
      startup as `failed` with error.code='InterruptedByShutdown'.
      Operators must re-issue send_message manually. Simple;
      matches current code; deterministic.
  - id: b
    label: introduce_resume_on_restart_v1
    consequence: |
      Add a startup recovery path that re-creates the
      DiscussionRunner against the captured state. Requires
      durable per-Job snapshots beyond the event log,
      provider-side conversation continuity surviving a process
      restart (Codex thread persists, Claude Code session may not),
      and a policy for partial Round outcomes. New Behavior plus
      Migration on the persistence event log.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

```yaml
---
id: meeting:OQ-002
type: Open-Q
lifecycle:
  status: proposed
partition_id: meeting
question: |
  Should `list_meetings` expose cursor pagination through the
  CLI (`veche list --cursor`), or remain capped at --limit per
  invocation in v1?
options:
  - id: a
    label: keep_cli_no_pagination_v1
    consequence: |
      CLI stays single-page. Operators with > 100 Meetings use
      `--format json | jq` plus `--createdBefore` shifting.
      Simple; matches current code; doc'd in README.
  - id: b
    label: introduce_cli_cursor_v1
    consequence: |
      Add `--cursor` and `--next-cursor` output to the CLI. Minor
      bump on SUR-002; new Test obligation for round-trip;
      backwards-compat for existing scripts that ignore unknown
      output lines is operator-side concern.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (meeting)

```yaml
---
id: meeting:ASM-001
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: meeting
assumption: |
  The MCP tool-call SLA (the bound used by INV-002) is
  operationally < 2 s under normal disk + adapter probe latency.
  Hosts (Claude Code, Codex CLI) impose their own per-call
  budget; v1 does not negotiate it. If a host tightens the budget
  below ~1 s, validation + createJob + appendMessage +
  updateJob + JobRunner registration may breach it on slow
  filesystems.
source_open_q: meeting:OQ-001
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/features/meeting/application/__tests__/committee.integration.test.ts § "send_message returns under 2 s with hung first round"
---
```

```yaml
---
id: meeting:ASM-002
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: meeting
assumption: |
  An operator's filesystem is local (not NFS / SMB). The CLI's
  atomic `--out` write semantics (CTR-005) and the MCP server's
  manifest tmp+rename pattern (persistence:INV-005) both rely on
  rename(2) atomicity within the same filesystem. Operators
  pointing $VECHE_HOME at a networked mount are unsupported.
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/features/persistence/adapters/file/FileMeetingStore.test.ts § "atomic manifest rewrite under high concurrency"
---
```

### Out of scope (meeting)

The following are explicitly **outside** the meeting partition's
gate and contract surface:

- The on-disk JSONL / manifest format and the cursor encoding —
  owned by persistence (CTR-001..005 there).
- The committee-protocol discussion loop semantics, retry policy,
  and termination evaluation — owned by committee-protocol.
- The Adapter argv shapes, error taxonomy, and Recursion Guard —
  owned by agent-integration.
- Multi-tenancy / authentication on the MCP surface — v1 has no
  auth at the MCP boundary; the host (Claude Code / Codex)
  enforces locality of access.
- Cross-machine clustering of $VECHE_HOME (see persistence:OQ-*).
- Live updates over the MCP wire (clients poll via get_response;
  push semantics are owned by web-viewer over SSE, a separate
  partition).
- Renaming / re-binding the `mcp__veche__*` tool prefix — owned by
  the install partition (which pins the prefix at registration).

---

## Partition: web-viewer

> Migrated from `spec/features/web-viewer/*.md`. Owns the live
> browser-based viewer (`veche watch`).

### Context (web-viewer)

The `web-viewer` partition is a second read-only inbound adapter
on top of the same `MeetingStorePort` exposed by persistence. It
runs as its own process (independent of the MCP server that writes
to `${VECHE_HOME}`) and serves a self-contained SPA + two SSE
channels (Meeting list + per-Meeting transcript) on a loopback
HTTP listener. Cross-process change detection uses 750-ms
polling, never `watchNewEvents`.

Boundaries:

- It does NOT introduce any new MCP tool, NOT extend the public
  storage Surface, NOT mutate the event log.
- It re-uses the meeting partition's domain entities and the
  shared escape-then-transform Markdown converter
  (`src/shared/markdown.ts`) — single source of truth across the
  static HTML report (meeting:CTR-004) and the SPA's
  MessageDto.htmlBody.

### Glossary (web-viewer)

- **`WatchServer`** — Node `http.Server` wrapper that owns
  routing, lifecycle (start/stop), SPA serving, and the set of
  active `SseChannel` instances.
- **`SseChannel`** — Per-connection wrapper around an `http`
  response carrying SSE writes; tracks an `isOpen` flag and the
  `lastEventId` cursor.
- **`MeetingPoller`** — The diff-poll loop owning a `prev/next`
  snapshot per channel and emitting `meeting.added` /
  `meeting.updated` deltas.
- **`StreamApi`** — The handler for `GET /api/stream` and
  `GET /api/stream/:id` that wires `MeetingPoller` /
  per-Meeting drain to one `SseChannel` per request.
- **`MeetingsApi`** — The handler for the JSON endpoints
  (`/api/meetings`, `/api/meetings/:id`,
  `/api/meetings/:id/messages`).
- **`MessageDto`** — Wire shape consumed by both REST and SSE; for
  `kind === 'speech'` it carries `htmlBody: string` (computed
  server-side via the shared converter); for `pass` / `system`
  the `htmlBody` field is `null`.
- **`WATCH_POLL_MS`** — Constant `750` ms between successive
  per-channel polls.
- **`KEEPALIVE_MS`** — Constant `15_000` ms; SSE comment line
  emitted whenever no event has flowed in that window.
- **`MAX_BACKOFF_MS`** — Constant `8_000` ms; cap for the
  exponential backoff on poll errors.

### Partition record (web-viewer)

```yaml
---
id: web-viewer
type: Partition
partition_id: web-viewer
owner_team: cyberash
gate_scope:
  - web-viewer
dependencies_on_other_partitions:
  - persistence
  - meeting
default_policy_set:
  - web-viewer:POL-001
id_namespace: web-viewer
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (web-viewer)

```yaml
---
id: web-viewer:BL-001
type: BrownfieldBaseline
lifecycle:
  status: proposed
partition_id: web-viewer
discovery_scope:
  - src/adapters/inbound/web
  - src/adapters/inbound/cli/commands/watch.ts
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: 1c39614d02627bfc4fae858e916f4deed1023fe57f6d5ff36e479d8724e1e2cc
    note: |
      Token covers the watch CLI command (commands/watch.ts) and
      the entire inbound web adapter sub-tree: WatchServer,
      SseChannel, MeetingPoller, MeetingsApi, StreamApi, dto, the
      single-file SPA module (spa/index.html.ts), and the
      __tests__ directory. Cross-cutting CLI infrastructure
      (VecheCli.ts) and the shared Markdown converter
      (src/shared/markdown) are intentionally excluded — the
      former is unowned, the latter is owned by the meeting
      partition's BL-001.
freshness_token: 1c39614d02627bfc4fae858e916f4deed1023fe57f6d5ff36e479d8724e1e2cc
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner
  records an approval_record via `sdd approve`.
---
```

### Surfaces (web-viewer)

```yaml
---
id: web-viewer:SUR-001
type: Surface
lifecycle:
  status: proposed
partition_id: web-viewer
name: veche/watch-http
version: "0.1.0"
boundary_type: api
members:
  - web-viewer:CTR-001
  - web-viewer:CTR-002
  - web-viewer:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  HTTP + SSE Surface served by `veche watch`. Consumers: the
  bundled SPA (same-origin) and any operator tooling that points
  curl / a browser at the loopback URL. Renaming an endpoint,
  removing a query param, or changing an SSE event name / payload
  shape is a major bump. Adding a new endpoint or a new optional
  query param is a minor bump.
---
```

```yaml
---
id: web-viewer:SUR-002
type: Surface
lifecycle:
  status: proposed
partition_id: web-viewer
name: veche/watch-cli
version: "0.1.0"
boundary_type: cli
members:
  - web-viewer:CTR-004
consumer_compat_policy: semver_per_surface
notes: |
  CLI Surface for `veche watch`. Renaming a flag, removing one,
  or changing exit-code semantics is a major bump. Adding a new
  flag (default-off) is a minor bump.
---
```

### Behaviors (web-viewer)

```yaml
---
id: web-viewer:BEH-001
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: veche watch CLI binds the listener, optionally opens a browser, runs until SIGINT/SIGTERM
given: |
  - $VECHE_HOME (or --home override) is readable
when: operator invokes `veche watch [--port N] [--host H] [--no-open] [--no-color] [--home P]`
then: |
  1. parse argv per CTR-004; reject unknown flags / invalid
     values with exit code 64.
  2. resolve VECHE_HOME via --home || $VECHE_HOME || $HOME/.veche.
  3. instantiate FileMeetingStore (read-only) + StructuredLogger.
  4. instantiate WatchServer({ store, clock, logger, host, port })
     and call start(). On `EADDRINUSE` / any other listen error,
     log to stderr and exit 2.
  5. print listening banner to stderr; if the bound host is non-
     loopback, print the security warning per Rule.
  6. unless --no-open: resolve a platform opener and spawn it
     once; on opener failure log warning and continue serving.
  7. install SIGINT / SIGTERM handlers (once each) that call
     WatchServer.stop() and resolve the main promise.
  8. await main promise; on resolution print shutdown banner; exit 0.
negative_cases:
  - bad flag / invalid port                 => UsageError, exit 64
  - listen rejected (EADDRINUSE etc.)       => BindFailed, exit 2
  - VECHE_HOME unreadable                   => StoreUnavailable, exit 2
  - opener missing (--no-open absent)       => OpenerUnavailable warning, exit 0 (server keeps running)
  - any unhandled handler exception          => InternalError, 500 to client, exit 0 (server keeps serving)
out_of_scope:
  - hot-reload of VECHE_HOME (process restart required)
  - daemonising into the background (use systemd / launchd at the OS level)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: SSE keepalive / poll cadence measured against ClockPort; SIGINT semantics owned by Node runtime
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    cli.integration.test.ts exercises the SIGINT-graceful-exit
    (exit 0) and bad-flag (exit 64) paths. A unit test asserts
    exit 2 on a synthetic EADDRINUSE.
  test_template: integration
  boundary_classes:
    - happy SIGINT path
    - --port out of range (exit 64)
    - port already bound (exit 2)
  failure_scenarios:
    - second SIGINT bypasses graceful shutdown (default Node behaviour) — out of scope but documented
    - server keeps writing to stdout (stdout MUST stay empty)
---
```

```yaml
---
id: web-viewer:BEH-002
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: GET /api/meetings returns a single page of MeetingSummary records
given: |
  - WatchServer is listening
when: client issues `GET /api/meetings?status=…&limit=…&cursor=…`
then: |
  the server:
    1. validates and clamps `status` (active|ended|all default
       all), `limit` (1..200 default 100, server cap 200), and
       `cursor` (opaque round-trip).
    2. calls MeetingStorePort.refresh() (when present), then
       MeetingStorePort.listMeetings({ status, limit, cursor }).
    3. responds 200 application/json with `{ summaries[],
       nextCursor: string|null }`.
  Branded ids are serialised as plain strings; Instant as
  ISO-8601. `Content-Type: application/json; charset=utf-8`,
  `X-Content-Type-Options: nosniff`, no CORS headers.
negative_cases:
  - "schema-violating query string => 400 with `{ error: invalid_params }` (or 404 if route does not match)"
  - "store error => 500 application/json `{ error: store unavailable }`"
out_of_scope:
  - server-side filtering by participants
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(filter,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    For each documented status / limit / cursor combination, the
    response shape and HTTP headers match. The DNS-rebind guard
    (INV-001) is honoured. CORS headers absent.
  test_template: integration
  boundary_classes:
    - default (status=all, limit=100)
    - status=active
    - cursor round-trip
  failure_scenarios:
    - CORS header leaks
    - branded id serialised as object
---
```

```yaml
---
id: web-viewer:BEH-003
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: GET /api/meetings/:id returns the Meeting snapshot or 404
given: |
  - the route :id segment matches asMeetingId
when: client issues `GET /api/meetings/<id>`
then: |
  1. validate :id; on parse failure 404 `{ error: "meeting not
     found", meetingId: "<id>" }`.
  2. refresh + loadMeeting; on miss 404; on store error 500.
  3. respond 200 with `{ meeting, participants, openJobs,
     lastSeq }`. Wire-stable shapes per meeting:CTR-002.
negative_cases:
  - unknown id                                  => 404
  - store error                                 => 500
out_of_scope:
  - returning the Transcript on this endpoint (use /messages or /stream/:id)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(meetingId)"
  time_source: none
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    Happy path returns the documented shape with no env field on
    Participant. Unknown id returns 404 with the documented
    payload (single source of truth for the error message).
  test_template: integration
  boundary_classes:
    - happy path
    - unknown id
    - store error
  failure_scenarios:
    - env leaked in Participant
    - 404 payload shape drift
---
```

```yaml
---
id: web-viewer:BEH-004
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: GET /api/meetings/:id/messages returns one page of speech/pass/system Messages
given: |
  - the Meeting exists
  - cursor (if any) round-trips per persistence:CTR-005
when: client issues `GET /api/meetings/<id>/messages?cursor=…&limit=…`
then: |
  1. validate cursor (forwarded opaquely) + limit (1..500 default
     200, server cap 500).
  2. refresh + readMessagesSince({ meetingId, cursor, limit }).
  3. project the page into MessageDto[]: same fields as
     meeting:CTR-002 plus `htmlBody: string|null` (htmlBody set
     for kind='speech' via the shared converter; null otherwise).
  4. respond 200 with `{ messages[], nextCursor, hasMore }`.
negative_cases:
  - unknown meeting                            => 404 (per BEH-003 shape)
  - "cursor invalid => 500 `{ error: store unavailable }` (CursorInvalid is folded into the generic store-unavailable response in v1)"
out_of_scope:
  - server-side filtering by author
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(meetingId,cursor)"
  time_source: none
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    Happy path returns the documented shape; htmlBody is non-null
    only for speech kind; cursor pagination round-trips. Unknown
    meeting returns 404.
  test_template: integration
  boundary_classes:
    - empty Meeting (messages [])
    - mixed kinds (htmlBody present only on speech)
    - cursor pagination
  failure_scenarios:
    - htmlBody emitted on pass / system
    - non-shared converter used (drift from meeting:CTR-004)
---
```

```yaml
---
id: web-viewer:BEH-005
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: GET /api/stream emits the Meeting-list snapshot then meeting.added/updated diffs at WATCH_POLL_MS
given: |
  - WatchServer is listening
when: client issues `GET /api/stream` (text/event-stream)
then: |
  1. write status 200 + SSE headers (Content-Type, no-cache,
     keep-alive, X-Accel-Buffering: no, X-Content-Type-Options:
     nosniff).
  2. emit `event: hello`, `data: { summaries: [...] }` with the
     full snapshot (refresh + listMeetings). `id:` is the max
     `lastSeq` across the snapshot (0 for empty).
  3. enter a polling loop with cadence WATCH_POLL_MS. Each
     iteration: refresh → listMeetings → diff vs prev →
     emit `meeting.added` and `meeting.updated` per the diff
     rules (CTR-003) → keepalive comment line every
     KEEPALIVE_MS when no other event has been emitted in that
     window.
  4. on req.on('close'), abort the channel's AbortController and
     drop the channel from the active set.
  5. on a poll error, emit `event: error` with `{ code, message }`
     then close the SSE response. The client's EventSource will
     reconnect automatically; the server applies exponential
     backoff up to MAX_BACKOFF_MS on subsequent attempts of the
     same channel.
negative_cases:
  - "DNS-rebind path: Host header outside the loopback allowlist => 421 `{ error: wrong host }`"
  - "store unavailable on first listMeetings => emit `event: error`, close"
out_of_scope:
  - meeting.removed (sidebar entries are append-only in v1)
  - tracking per-client state across reconnects
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: keepalive + poll cadence measured against ClockPort
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    Happy path: the first emitted frame is `hello`; subsequent
    appends in another process surface as `meeting.added` /
    `meeting.updated` within a 750 ms+epsilon window. Idle channel
    receives a keepalive within 15 s. req.close() aborts the
    channel and frees memory.
  test_template: integration
  boundary_classes:
    - hello on connect
    - meeting.added detected
    - meeting.updated on status / lastSeq / openJobCount change
    - keepalive at 15 s idle
    - 421 wrong host
  failure_scenarios:
    - meeting.removed emitted (out of scope)
    - DNS-rebind succeeds
    - channel survives client disconnect
---
```

```yaml
---
id: web-viewer:BEH-006
type: Behavior
lifecycle:
  status: proposed
partition_id: web-viewer
title: GET /api/stream/:id streams the Transcript with hello + message.posted + meeting.updated
given: |
  - the Meeting exists
when: client issues `GET /api/stream/<id>` (text/event-stream)
then: |
  1. validate :id; on miss emit `event: error` with `{ code:
     "not_found", message: "meeting not found" }` then close.
  2. handle Last-Event-ID: parse as integer; if valid and <=
     current lastSeq, resume — emit a `hello` whose `messages`
     array is empty and whose `lastSeq` matches the resumed seq.
     Otherwise emit a fresh full `hello` (drain readMessagesSince
     in 500-batch loop until hasMore=false).
  3. enter polling loop at WATCH_POLL_MS:
     - refresh + readMessagesSince({ meetingId, cursor: <last>,
       limit: 200 }) in a drain loop until hasMore=false; each
       new Message yields one `event: message.posted` frame with
       MessageDto (htmlBody for speech).
     - secondary read of the Meeting summary; on
       (status, lastSeq, openJobCount) change emit
       `event: meeting.updated`.
     - keepalive at KEEPALIVE_MS idle.
  4. backpressure: SSE writes await `drain` if the TCP buffer is
     full; meeting.updated frames may coalesce (only the latest
     pending update is emitted post-drain), but message.posted
     frames are NEVER coalesced (each message exactly once).
  5. on req close → abort channel.
  6. on poll error → emit `event: error`, close, exponential
     backoff per BEH-005 step 5 (per-channel state).
negative_cases:
  - malformed Last-Event-ID                       => ignored, fresh full hello path
  - store unavailable                              => `event: error`, close
out_of_scope:
  - server-side filtering by author / round
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: poll cadence + keepalive against ClockPort
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    Cross-process cross-process refresh test
    (CrossProcessRefresh.test.ts) appends in process A and
    observes message.posted in process B's SSE within 750 ms +
    epsilon. Resume with Last-Event-ID skips already-delivered
    messages. backpressure / drain test asserts message.posted is
    never coalesced.
  test_template: integration
  boundary_classes:
    - fresh connect (full hello)
    - resume with Last-Event-ID
    - meeting.updated on status flip
    - drain backpressure
    - poll error -> event: error -> close
  failure_scenarios:
    - message.posted duplicated on reconnect
    - message.posted coalesced under backpressure
    - meeting.updated emitted with stale tuple
---
```

### Contracts (web-viewer)

```yaml
---
id: web-viewer:CTR-001
type: Contract
lifecycle:
  status: proposed
partition_id: web-viewer
title: HTTP routing and JSON endpoints
surface_ref: web-viewer:SUR-001
schema:
  description: |
    Method/URL routing table. Anything outside the table is 404.
    No path-to-file resolution is reachable; the SPA is the only
    static asset and is built in-memory at server start.
  routes: |
    GET  /                                          -> 200 text/html (SPA)
    GET  /api/meetings?status=&limit=&cursor=       -> 200 application/json { summaries[], nextCursor }
    GET  /api/meetings/:id                          -> 200 application/json { meeting, participants, openJobs, lastSeq }
    GET  /api/meetings/:id/messages?cursor=&limit=  -> 200 application/json { messages[], nextCursor, hasMore }
    GET  /api/stream                                -> 200 text/event-stream (Meeting list channel)
    GET  /api/stream/:id                            -> 200 text/event-stream (Transcript channel)
    *                                               -> 404 application/json { error: "not found" }
  common_response_rules: |
    - JSON: Content-Type application/json; charset=utf-8;
      pretty-printed with 2-space indentation; stable key order.
    - SSE: Content-Type text/event-stream; charset=utf-8;
      Cache-Control no-cache, no-transform; Connection
      keep-alive; X-Accel-Buffering no.
    - Every response: X-Content-Type-Options: nosniff.
    - No Access-Control-Allow-* headers (single-origin loopback).
external_identifiers:
  - route paths and the literal segments (/api/meetings, /api/stream)
  - JSON response field names
  - HTTP status codes (200, 404, 421, 500)
compatibility_rules:
  - renaming a route or query param           => major bump on SUR-001
  - changing a status code                    => major bump
  - adding a new optional query param         => minor bump
  - adding a new endpoint                     => minor bump
  - adding `Access-Control-Allow-*`           => major bump (security regression review)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(method,path,query)"
  time_source: none
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    StreamApi.test.ts and MeetingsApi.test.ts exercise every
    documented route + every common-response-rule header. Unknown
    routes yield the documented 404 payload. CORS headers are
    absent on every response.
  test_template: integration
  boundary_classes:
    - one happy path per route
    - unknown route (404)
    - HEAD / POST on a GET route (404)
  failure_scenarios:
    - CORS header leak
    - 404 payload shape drift
---
```

```yaml
---
id: web-viewer:CTR-002
type: Contract
lifecycle:
  status: proposed
partition_id: web-viewer
title: SSE event names, payloads, and Last-Event-ID semantics
surface_ref: web-viewer:SUR-001
schema:
  description: |
    The two SSE channels' event types and payload shapes.
  list_channel: |
    GET /api/stream
      hello           { summaries: MeetingSummary[] }                first frame, full snapshot
      meeting.added   { summary: MeetingSummary }                    new id seen
      meeting.updated { summary: MeetingSummary }                    (status, lastSeq, openJobCount) tuple changed
      error           { code: string, message: string }              followed by close()
    keepalive: ":keepalive\\n\\n" every KEEPALIVE_MS=15000 ms when idle
    Last-Event-ID resume: server emits a fresh hello (informational id only)
  transcript_channel: |
    GET /api/stream/:id
      hello           { meeting, participants, openJobs, lastSeq, messages: MessageDto[] }
      message.posted  { message: MessageDto }                        new speech/pass/system; id: <seq>
      meeting.updated { summary: MeetingSummary }                    summary tuple changed
      error           { code: string, message: string }              followed by close()
    Last-Event-ID resume: integer parse; if valid and <= current
    lastSeq, hello.messages = [], lastSeq = parsed; otherwise
    full hello path
  message_dto_extension: |
    MessageDto = Message + { htmlBody: string|null }
    htmlBody:
      - kind='speech' -> server runs src/shared/markdown.ts on
        message.text and embeds the result
      - kind='pass'   -> null
      - kind='system' -> null
external_identifiers:
  - SSE event names: hello, meeting.added, meeting.updated, message.posted, error
  - constants: KEEPALIVE_MS=15000, WATCH_POLL_MS=750, MAX_BACKOFF_MS=8000
compatibility_rules:
  - renaming an event name                    => major bump on SUR-001
  - changing payload shape                    => major bump
  - adding a new event name                   => minor bump
  - widening Last-Event-ID parser             => minor bump
  - introducing meeting.removed               => minor bump (consumers ignore unknown event names per EventSource semantics)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: cadence + keepalive measured against ClockPort
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    Cross-process refresh test asserts message.posted ordering
    and exactly-once semantics. Last-Event-ID resume yields an
    empty messages array on the resumed hello. Backpressure test
    confirms meeting.updated may coalesce while message.posted
    never coalesces.
  test_template: integration
  boundary_classes:
    - fresh hello
    - resume with valid Last-Event-ID
    - resume with stale Last-Event-ID
    - meeting.updated on every documented tuple change
  failure_scenarios:
    - message.posted duplicated on resume
    - meeting.removed emitted on a deleted Meeting
---
```

```yaml
---
id: web-viewer:CTR-003
type: Contract
lifecycle:
  status: proposed
partition_id: web-viewer
title: SPA structure (one inline script, one inline style, no remote refs)
surface_ref: web-viewer:SUR-001
schema:
  description: |
    The HTML5 document served at GET /. Built in-memory at
    server start; pure function of build version + a fixed CSS
    palette. No per-request interpolation.
  invariants: |
    - Exactly one inline <script> block (consumes EventSource).
    - Exactly one inline <style> block.
    - No <script src="…">, no <link rel="stylesheet">,
      no <link rel="preload" as="…">, no <img src="http…">,
      no web fonts. A small inline SVG favicon via
      <link rel="icon" href="data:image/svg+xml,…"> is allowed.
    - Store-derived strings reach the DOM via textContent /
      attribute setters EXCEPT MessageDto.htmlBody for speech
      Messages, which is assigned via innerHTML (safe because
      htmlBody is the output of the escape-then-transform
      converter).
    - Static skeleton contains no interpolation of dynamic data.
    - Layout is CSS Grid (sidebar + transcript pane) with
      deterministic participant colours (sha1(participantId) →
      HSL hue, saturation 60%, lightness 86%; facilitator
      neutral #ededed).
external_identifiers:
  - count rules: ≤ 1 inline <script>, ≤ 1 inline <style>, 0 remote href/src
  - colour function: hue = sha1(participantId)[0..3] % 360, saturation 60, lightness 86
compatibility_rules:
  - widening to two inline <script> blocks         => major bump on SUR-001
  - introducing a remote href/src                  => major bump
  - swapping the colour function                   => major bump (visual contract; static report has the same)
  - adding a CSS Grid breakpoint                   => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: schema_describes_static_html_property
  reason: SPA is a pure function of build state
data_scope: all_data
policy_refs:
  - web-viewer:POL-002
test_obligation:
  predicate: |
    spa.test.ts asserts the count rules (regex probe over the
    output: at most one `<script` substring; zero
    `<script src=`; zero `<link rel="stylesheet"`; zero remote
    href / src). Determinism test: two consecutive renders with
    the same build version produce byte-identical output.
  test_template: contract
  boundary_classes:
    - first build (cold)
    - cached build (reuse)
  failure_scenarios:
    - second inline <script> appears
    - remote font referenced
    - colour function drifts from the static report
---
```

```yaml
---
id: web-viewer:CTR-004
type: Contract
lifecycle:
  status: proposed
partition_id: web-viewer
title: veche watch CLI argv shapes and exit codes
surface_ref: web-viewer:SUR-002
schema:
  description: |
    The argv shapes accepted by `veche watch` and their exit-code
    semantics.
  argv: |
    veche watch
      [--port 0..65535]            (default 0 = ephemeral)
      [--host <host>]              (default 127.0.0.1)
      [--no-open]                  (skip browser auto-open)
      [--no-color]                 (suppress ANSI on stderr)
      [--home <abs-path>]
  exit_codes: |
    0   graceful shutdown (SIGINT/SIGTERM); opener-warning path
    2   BindFailed / StoreUnavailable
    64  UsageError
    (1 and 3 unused — `watch` does not look up a single Meeting at startup)
external_identifiers:
  - command name: watch
  - flag names: --port, --host, --no-open, --no-color, --home
  - exit code integers: 0, 2, 64
compatibility_rules:
  - renaming a flag                                => major bump on SUR-002
  - widening exit-code semantics                   => major bump
  - adding a default-off flag                      => minor bump
  - changing default --host away from loopback     => major bump (security regression)
  - changing default --port away from ephemeral 0  => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
data_scope: all_data
policy_refs:
  - web-viewer:POL-001
test_obligation:
  predicate: |
    cli.integration.test.ts exercises the SIGINT-graceful path
    (exit 0) and the bad-flag path (exit 64); a unit test
    triggers exit 2 on a synthetic EADDRINUSE.
  test_template: integration
  boundary_classes:
    - default --host (loopback)
    - --no-open suppresses opener
    - bad --port (exit 64)
    - port already bound (exit 2)
  failure_scenarios:
    - default --host changed to 0.0.0.0
    - exit code drift unbumped
---
```

### Invariants (web-viewer)

```yaml
---
id: web-viewer:INV-001
type: Invariant
lifecycle:
  status: proposed
partition_id: web-viewer
title: loopback-only by default + DNS-rebind guard for loopback bindings
always: |
  When `--host` is unspecified, the server binds 127.0.0.1.
  When the bound address is in 127.0.0.0/8 or [::1], every HTTP
  request whose `Host:` header is not in the loopback allowlist
  (`localhost`, `localhost:<port>`, `127.0.0.1`,
  `127.0.0.1:<port>`, `[::1]`, `[::1]:<port>`) is rejected with
  `421 application/json { "error": "wrong host" }`. When the
  operator explicitly binds to a non-loopback address, the
  DNS-rebind guard is disabled (the operator has accepted the
  threat model) and a stderr warning is emitted at startup.
scope: web-viewer (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: none
  reason: per-request guard; no runtime state mutation
negative_cases:
  - default bind on 0.0.0.0                       => contract violation
  - loopback bind without DNS-rebind guard        => contract violation
out_of_scope:
  - operator-owned non-loopback bind (the warning is the contract)
test_obligation:
  predicate: |
    WatchServer.test.ts exercises Host header variants (allowed,
    spoofed `evil.example.com`, IPv6 brackets) and asserts the
    expected 200 / 421 outcomes. Default bind without --host
    yields 127.0.0.1.
  test_template: integration
  boundary_classes:
    - allowed Host: localhost
    - allowed Host: 127.0.0.1
    - allowed Host: [::1]
    - spoofed Host -> 421
    - non-loopback --host (guard disabled, warning printed)
  failure_scenarios:
    - DNS-rebind succeeds despite loopback bind
    - default bind on a non-loopback address
---
```

```yaml
---
id: web-viewer:INV-002
type: Invariant
lifecycle:
  status: proposed
partition_id: web-viewer
title: no use of MeetingStorePort.watchNewEvents; cross-process changes are observed via 750ms polling
always: |
  The watch path MUST NOT call MeetingStorePort.watchNewEvents.
  Cross-process change detection happens via a per-SSE-channel
  loop that calls refresh() (when present) followed by
  listMeetings (list channel) or readMessagesSince (transcript
  channel) every WATCH_POLL_MS = 750 ms. The cadence is not user-
  tunable; introducing a flag requires updating CTR-002.
scope: web-viewer (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: none
  time_source: external
  reason: cadence is measured against ClockPort
negative_cases:
  - any code path in src/adapters/inbound/web/ calls watchNewEvents => contract violation (recurses on the wrong notion of "process")
out_of_scope:
  - in-process adapters that emit watcher resolution (handled by persistence:INV-009; this partition is exclusively cross-process)
test_obligation:
  predicate: |
    Source-level grep over src/adapters/inbound/web/ finds zero
    occurrences of `watchNewEvents`. CrossProcessRefresh.test.ts
    appends in a separate FileMeetingStore instance and confirms
    the SSE channel sees the new event within 750 ms+epsilon.
  test_template: contract
  boundary_classes:
    - cross-process append observed within budget
    - keepalive after idle period
  failure_scenarios:
    - watchNewEvents reintroduced
    - cadence configurable via --poll-ms (out of contract)
---
```

```yaml
---
id: web-viewer:INV-003
type: Invariant
lifecycle:
  status: proposed
partition_id: web-viewer
title: same source-of-truth Markdown converter as the static HTML report
always: |
  MessageDto.htmlBody for kind='speech' is produced by the same
  module (src/shared/markdown.ts) consumed by the
  `show --format=html` renderer. The web-viewer's DTO mapper
  imports that module; it MUST NOT re-implement, fork, or wrap
  the conversion. The SPA assigns htmlBody via innerHTML; safety
  rests on the converter being escape-then-transform.
scope: web-viewer + meeting (cross-partition single-source-of-truth invariant)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_module_dependency
  reason: it is a static import-graph property
negative_cases:
  - SPA implements its own JS-side Markdown converter           => contract violation
  - DTO mapper inlines the converter without importing the shared module => contract violation
out_of_scope:
  - syntax highlighting (no JS allowed in the static report; the SPA inherits the same constraint via the same htmlBody)
test_obligation:
  predicate: |
    Source-level check: the only call site of
    src/shared/markdown.ts is the static HTML renderer + the
    web-viewer DTO mapper. Snapshot test: a fixed Message text
    yields byte-identical htmlBody from both call sites (modulo
    color rounding which lives elsewhere).
  test_template: contract
  boundary_classes:
    - parity snapshot
    - import-graph check
  failure_scenarios:
    - second converter introduced
    - import path forks
---
```

```yaml
---
id: web-viewer:INV-004
type: Invariant
lifecycle:
  status: proposed
partition_id: web-viewer
title: no Access-Control-Allow-* headers; same-origin loopback by design
always: |
  The server emits ZERO CORS headers on every response. The SPA
  is served from the same origin it queries; cross-origin
  browsers cannot read the responses. Adding any
  `Access-Control-Allow-*` header is a contract violation and
  requires a major bump on SUR-001 plus a security review.
scope: web-viewer (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_response_header_set
  reason: per-response property; no runtime concurrency dimension
negative_cases:
  - any response includes Access-Control-Allow-Origin     => contract violation
out_of_scope:
  - hosted multi-origin mode (would require a separate Surface; out of v1)
test_obligation:
  predicate: |
    Every response captured in StreamApi.test.ts /
    MeetingsApi.test.ts has zero `Access-Control-Allow-*`
    headers and zero `Vary: Origin` header.
  test_template: contract
  boundary_classes:
    - JSON happy path
    - SSE happy path
    - 404 path
    - 421 path
  failure_scenarios:
    - CORS header introduced silently
---
```

### Policies (web-viewer)

```yaml
---
id: web-viewer:POL-001
type: Policy
lifecycle:
  status: proposed
partition_id: web-viewer
title: web-viewer is read-only against the store and bounded to documented HTTP I/O
policy_kind: io_scope
applicability:
  applies_to: |
    every BEH in this partition (BEH-001..006). Includes the
    WatchServer / SseChannel / MeetingPoller / handlers /
    spa/index.html.ts modules.
predicate: |
  - The partition MUST NOT call MeetingStorePort.{createMeeting,
    appendMessage, appendSystemEvent, markParticipantDropped,
    createJob, updateJob, endMeeting, watchNewEvents}.
  - I/O surfaces: bind a TCP listener on <host>:<port>; spawn at
    most one platform-opener subprocess (`open`/`xdg-open`/`start`)
    per `start()` call when --no-open is absent; emit logs to
    stderr only.
  - The partition MUST NOT serve files from disk other than the
    SPA built in-memory at server start. There is no path-to-file
    resolution, so `..`-traversal is unreachable.
  - No env values are surfaced in headers, logs, or response
    bodies (carries forward meeting:INV-005 to the SSE / JSON
    channels).
negative_test_obligations:
  - inject a throwing mock for every store write method; assert
    no BEH path trips one
  - assert the only spawned binary is the platform opener (and
    only on --no-open absent)
  - regex probe over the SPA + JSON / SSE responses confirms no
    env value or VECHE_HOME path is leaked
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - happy path (read-only)
    - opener missing (warning path)
    - throwing-write mock store
  failure_scenarios:
    - any write method invoked
    - second platform binary spawned
    - env value found in any response
---
```

```yaml
---
id: web-viewer:POL-002
type: Policy
lifecycle:
  status: proposed
partition_id: web-viewer
title: SPA + JSON / SSE responses preserve the escape-then-transform invariant
policy_kind: security_boundary
applicability:
  applies_to: |
    BEH-002..006 + the SPA module (spa/index.html.ts).
predicate: |
  - The SPA assigns store-derived strings to the DOM via
    `textContent` / attribute setters EXCEPT
    MessageDto.htmlBody for kind='speech', which is assigned via
    `innerHTML`. Safety rests on htmlBody coming from the
    shared escape-then-transform converter (meeting:CTR-004).
  - The DTO mapper imports `src/shared/markdown.ts` and uses it
    verbatim — no second implementation, no client-side
    mirror.
  - HTTP responses set `X-Content-Type-Options: nosniff` so the
    browser does not type-sniff JSON / SSE payloads into HTML.
  - URL fields in payload bodies are not transformed by this
    partition; they passed through the shared converter (or are
    emitted as plain strings in JSON, where the browser does not
    auto-link them).
negative_test_obligations:
  - SPA test injects a Message containing
    `<script>alert(1)</script>` and asserts the rendered DOM
    contains zero <script> nodes
  - DTO mapper test confirms speech htmlBody equals the static
    report's htmlBody for the same input fixture
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - script-injection in speech text
    - parity with static HTML report
    - URL with disallowed scheme stays escaped
  failure_scenarios:
    - SPA introduces JS-side Markdown
    - second copy of converter under src/adapters/inbound/web/
---
```

### Constraints (web-viewer)

```yaml
---
id: web-viewer:CST-001
type: Constraint
lifecycle:
  status: proposed
partition_id: web-viewer
constraint: |
  The HTTP server uses `node:http` directly. No framework
  (Express, Fastify, Koa, hapi, h3) and no SSE library. The SPA
  uses `EventSource`, the DOM, and built-in CSS only — no
  bundler, no framework, no CSS preprocessor. Speech bubbles use
  the shared converter from src/shared/markdown.ts.
rationale: |
  The HTTP API is small (six routes) and the SSE handling needs
  exact control over headers, keepalives, and backpressure that
  most frameworks abstract away. A framework would also pull in
  middleware that accidentally adds CORS / cookies / sniffable
  responses — exactly what INV-004 forbids. Keeping the stack at
  Node built-ins makes the dependency graph trivial and the
  threat model auditable.
test_obligation:
  predicate: |
    package.json `dependencies` contain none of: express,
    fastify, koa, hapi, h3, polka, restify, sse-pubsub,
    eventsource-polyfill. Importing
    src/adapters/inbound/web/WatchServer.ts and traversing the
    import graph yields only first-party files and Node built-ins.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a forbidden dependency appears in a future PR
---
```

### Implementation bindings (web-viewer)

```yaml
---
id: web-viewer:IMP-001
type: ImplementationBinding
lifecycle:
  status: proposed
partition_id: web-viewer
target_ids:
  - web-viewer:BEH-001
  - web-viewer:BEH-002
  - web-viewer:BEH-003
  - web-viewer:BEH-004
  - web-viewer:BEH-005
  - web-viewer:BEH-006
  - web-viewer:CTR-001
  - web-viewer:CTR-002
  - web-viewer:CTR-003
  - web-viewer:CTR-004
  - web-viewer:INV-001
  - web-viewer:INV-002
  - web-viewer:INV-003
  - web-viewer:INV-004
binding:
  feature_slice:
    root: src/adapters/inbound/web
    server: src/adapters/inbound/web/WatchServer.ts
    sse: src/adapters/inbound/web/SseChannel.ts
    poller: src/adapters/inbound/web/MeetingPoller.ts
    apis:
      - src/adapters/inbound/web/MeetingsApi.ts
      - src/adapters/inbound/web/StreamApi.ts
    dto: src/adapters/inbound/web/dto.ts
    spa: src/adapters/inbound/web/spa/index.html.ts
    cli: src/adapters/inbound/cli/commands/watch.ts
    tests:
      - src/adapters/inbound/web/__tests__/WatchServer.test.ts
      - src/adapters/inbound/web/__tests__/SseChannel.test.ts
      - src/adapters/inbound/web/__tests__/MeetingPoller.test.ts
      - src/adapters/inbound/web/__tests__/MeetingsApi.test.ts (covers via StreamApi.test.ts)
      - src/adapters/inbound/web/__tests__/StreamApi.test.ts
      - src/adapters/inbound/web/__tests__/CrossProcessRefresh.test.ts
      - src/adapters/inbound/web/__tests__/dto.test.ts
      - src/adapters/inbound/web/__tests__/spa.test.ts
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by the named
  tests. Tests that close a Test obligation carry an
  `// @covers web-viewer:<ID>` marker.
---
```

### Open questions (web-viewer)

```yaml
---
id: web-viewer:OQ-001
type: Open-Q
lifecycle:
  status: proposed
partition_id: web-viewer
question: |
  Should the watch server expose an authenticated multi-user mode
  (token-based or OAuth) so it can be safely bound to a non-
  loopback host without warning, or stay loopback-only-by-default
  with operators-on-the-hook for non-loopback exposure?
options:
  - id: a
    label: keep_loopback_only_v1
    consequence: |
      v1 stays as-is. Operators who want remote access tunnel via
      ssh -L. Simple; matches current code; trivially secure.
  - id: b
    label: introduce_token_auth_v1
    consequence: |
      Add a bearer-token gate (token printed at startup). New
      Surface (auth header), new threat model (token leakage in
      shell history / `ps`), new tests. Major bump on SUR-001.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (web-viewer)

```yaml
---
id: web-viewer:ASM-001
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: web-viewer
assumption: |
  Operator browsers honour SSE keepalives at 15 s and EventSource
  reconnect-on-close. v1 supports the latest two stable releases
  of Chrome, Firefox, and Safari; older browsers may receive
  delayed `meeting.added` notifications if intermediary proxies
  buffer SSE.
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/adapters/inbound/web/__tests__/StreamApi.test.ts § "keepalive at 15 s idle"
---
```

### Out of scope (web-viewer)

The following are explicitly **outside** the web-viewer
partition's gate and contract surface:

- Hosted multi-user mode with auth (OQ-001).
- Server-side aggregation (per-author summaries, search). The SPA
  filters client-side over the snapshot it receives.
- Pushing events back to the MCP server (the viewer is read-only;
  any "send a Facilitator message from the browser" feature would
  cross into meeting partition's MCP write tools and require its
  own Surface).
- Multi-machine clustering / shared `${VECHE_HOME}` across hosts
  (carried forward from persistence:OutOfScope).
- WebSocket transport (SSE is sufficient; a WS transport would be
  a separate Surface with its own back-pressure semantics).

---

## Partition: install

> Migrated from `spec/features/install/*.md`. Owns the `veche
> install` deployment helper, the canonical skill artefact, and
> the bootstrap user-config template.

### Context (install)

The `install` partition wires the `veche` MCP server and its
companion skill into Claude Code and Codex hosts, and seeds a
default `${VECHE_HOME}/config.json` so the operator has a working
Profile starting point. It is a deployment helper — read-only
against any meeting data.

Boundaries:

- It does NOT extend the MCP tool surface.
- It MAY write under `${VECHE_HOME}` exactly one file
  (`config.json`) and only when absent or `--force` is supplied.
- Host MCP-server registration goes through the host's own CLI
  (`claude mcp …`, `codex mcp …`); this partition NEVER edits
  `~/.claude.json` or `~/.codex/config.toml` directly.

### Glossary (install)

- **Skill artefact** — Markdown document at
  `<package-root>/skills/<mcp-name>/SKILL.md`; copied byte-
  identically to `<host-skills-root>/<mcp-name>/SKILL.md` per
  requested host.
- **Host CLI** — `claude` (Claude Code) or `codex` (Codex). The
  install command spawns ONLY these two binaries and the
  `--version` probe.
- **`mcp-name`** — The MCP server name registered with each host
  AND the directory name under `<host-skills-root>/`. Default
  `veche`. Pattern `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`.
- **`<server-bin>`** — Absolute path to the MCP server entry
  (`<package-root>/dist/bin/veche-server.js` by default;
  overridable via `--server-bin <abs-path>`).
- **Atomic write template** — `<path>.tmp-<pid>-<ts>` then
  `rename(<tmp>, <path>)`. Mode `0o600` for both `SKILL.md` and
  `config.json`.
- **`runConfigBootstrap`** — Subroutine that seeds
  `${VECHE_HOME}/config.json` from
  `<package-root>/examples/config.json.example`. Skipped under
  `--skip-config`. Preserves an existing file unless `--force`.
- **HostTarget** — Per-host record `{ host, skillsRoot, cli,
  argvAdd, argvList?, argvRemove? }`. Built from `--for`.

### Partition record (install)

```yaml
---
id: install
type: Partition
partition_id: install
owner_team: cyberash
gate_scope:
  - install
dependencies_on_other_partitions:
  - meeting             # mcp-name pin must match the MCP tool prefix
  - agent-integration   # config.json shape is the Profile contract
default_policy_set:
  - install:POL-001
id_namespace: install
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (install)

```yaml
---
id: install:BL-001
type: BrownfieldBaseline
lifecycle:
  status: proposed
partition_id: install
discovery_scope:
  - src/adapters/inbound/cli/commands/install.ts
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts
  - skills/veche/SKILL.md
  - examples/config.json.example
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: __FRESHNESS_TOKEN_INSTALL__
    note: |
      Token covers the install CLI command + its unit tests, the
      canonical skill artefact, and the canonical user-config
      template. The CLI shell (VecheCli.ts) and the package
      entrypoints (bin/) are intentionally excluded — they are
      cross-cutting CLI infrastructure not owned by any single
      partition. The bootstrap config-bootstrap subroutine
      (`runConfigBootstrap`) and the `--skip-config` / `--home`
      flags described in the legacy spec are present in the
      working tree at the point this baseline is recorded; the
      operator MUST commit those changes before recomputing the
      freshness_token (sdd check otherwise reports baseline-dirty).
freshness_token: __FRESHNESS_TOKEN_INSTALL__
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner
  records an approval_record via `sdd approve`.
---
```

### Surfaces (install)

```yaml
---
id: install:SUR-001
type: Surface
lifecycle:
  status: proposed
partition_id: install
name: veche/install-cli
version: "0.1.0"
boundary_type: cli
members:
  - install:CTR-001
  - install:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
  CLI Surface for `veche install`. Renaming a flag, removing a
  default value, or changing exit-code semantics is a major bump.
  Adding a new flag (default-off) or a new opt-in argument is a
  minor bump. The host-CLI argv templates (CTR-002) are part of
  this Surface — operators script around them.
---
```

```yaml
---
id: install:SUR-002
type: Surface
lifecycle:
  status: proposed
partition_id: install
name: veche/skill-artefact
version: "0.1.0"
boundary_type: generated_published_artifact
members:
  - install:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  Published artefact: the canonical
  `<package-root>/skills/<mcp-name>/SKILL.md` shipped via npm
  `files`. Both Claude Code and Codex consume byte-identical
  copies. A semantic-breaking diff (e.g. removing the front-matter
  `name` field, retiring an MCP tool reference) is a major bump
  on this Surface AND requires a coordinated bump on
  meeting:SUR-001.
---
```

### Behaviors (install)

```yaml
---
id: install:BEH-001
type: Behavior
lifecycle:
  status: proposed
partition_id: install
title: install parses argv, resolves package paths, runs the deploy plan in order
given: |
  - operator invokes `veche install` with optional flags
when: caller invokes `runInstall(cmd, deps)`
then: |
  1. validate flags per CTR-001 (mutually-exclusive --skills-only
     /--mcp-only; --mcp-name regex; --server-bin absolute and
     existing; --for in {claude-code, codex, both} default both).
  2. resolve canonical sources:
     - skill: <package-root>/skills/<mcp-name>/SKILL.md (exit 2
       on miss)
     - server-bin: --server-bin || <package-root>/dist/bin/veche-server.js
       (exit 2 on miss)
     - config template: <package-root>/examples/config.json.example
       (exit 2 on miss when --skip-config absent)
  3. run config bootstrap (BEH-002) — host-agnostic; runs once
     per invocation.
  4. expand `--for` into a HostTarget list (declaration order:
     claude-code first, codex second on `both`).
  5. for each target, in declaration order, do BEH-003 (skill
     write) followed by BEH-004 (MCP register), each individually
     skippable via `--mcp-only` / `--skills-only`. Log
     `[<host>] ok` after both steps requested for that target
     finished.
  6. on missing host CLI without --force: exit 2 after the
     completed targets log; with --force: log warning and
     continue.
  7. on host CLI non-zero exit: log host stderr verbatim, exit 2,
     do NOT attempt the next host.
  8. on success across all targets, print `done.` to stderr and
     exit 0.
  All output goes to stderr; stdout is reserved for future
  machine-readable output and is unused in v1.
negative_cases:
  - bad flag / contradictory combo                   => UsageError, exit 64
  - skill source missing                              => SkillSourceMissing, exit 2
  - config source missing (without --skip-config)     => ConfigSourceMissing, exit 2
  - server-bin missing                                => ServerBinMissing, exit 2
  - host CLI missing without --force                  => HostCliMissing, exit 2
  - host CLI non-zero exit                            => HostCliFailed, exit 2
  - skill / config write failure                      => WriteFailed, exit 2
  - any unhandled exception                           => InternalError, exit 1
out_of_scope:
  - hot-reload of the skill on a running host (operators restart the host CLI)
  - migrating an existing legacy hand-edited entry (operators delete + re-run)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(mcp-name,host)"
  time_source: external
  reason: tmp suffix uses Clock-supplied timestamp for deterministic tests
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts exercises every documented exit code, the
    --dry-run no-op path, the --skills-only / --mcp-only mutual
    exclusion, and the --force "continue past missing host CLI"
    behaviour.
  test_template: integration
  boundary_classes:
    - default --for=both happy path
    - --for=claude-code only
    - --for=codex only
    - --skills-only
    - --mcp-only
    - --dry-run
    - missing host CLI without --force (exit 2)
    - missing host CLI with --force (skip + continue)
    - host CLI non-zero exit
    - skill write failure
    - skill source missing in package
  failure_scenarios:
    - skill source missing silently succeeds
    - host CLI non-zero exit ignored
    - config bootstrap overwrites existing file without --force
---
```

```yaml
---
id: install:BEH-002
type: Behavior
lifecycle:
  status: proposed
partition_id: install
title: config bootstrap seeds ${VECHE_HOME}/config.json once, preserves on subsequent runs
given: |
  - --skip-config is absent
  - the config template
    (<package-root>/examples/config.json.example) exists
when: caller invokes `runConfigBootstrap(cmd, deps)`
then: |
  1. resolve VECHE_HOME via cmd.homeOverride || env.VECHE_HOME ||
     `${homedir()}/.veche`.
  2. compute target = `<vecheHome>/config.json`.
  3. if --dry-run: log `(dry-run) writing config file → <target>`
     and skip; return outcome=ok.
  4. else if `--force` is NOT set AND target exists: log
     `(exists) config file → <target>`; return outcome=skipped.
  5. else: atomic write of the template to target via
     `<target>.tmp-<pid>-<ts>` mode 0o600 then rename; create
     parent dirs as needed (`mkdir -p` semantics with default
     mode); log `writing config file → <target>`; return
     outcome=ok.
  6. on read failure of the template: log `config source not
     found at <source>`; return outcome=error,
     message='config-source-missing'. The caller (BEH-001 step 3)
     converts this to exit 2 and does NOT proceed to host steps.
  This subroutine emits NO `[<host>]` prefix because the config
  is host-agnostic.
negative_cases:
  - template missing                                 => exit 2 with config-source-missing
  - write failure (permissions / disk full)          => exit 2 with WriteFailed; no host step runs
out_of_scope:
  - migrating an existing config file (the operator's content is the source of truth)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(vecheHome,configPath)"
  time_source: external
  reason: tmp suffix uses Clock for tests
data_scope: new_writes_only
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    First run with no existing config writes the template
    byte-identically to the destination with mode 0o600. Second
    run preserves the file (line `(exists) config file → …`).
    Second run with --force overwrites. --skip-config skips the
    step entirely. --dry-run logs but performs no I/O.
  test_template: integration
  boundary_classes:
    - first run (write)
    - second run (preserve)
    - second run + --force (overwrite)
    - --skip-config (no I/O)
    - --dry-run (log only)
    - template missing in package
    - write failure
  failure_scenarios:
    - existing config silently overwritten without --force
    - --dry-run touches the filesystem
    - mode != 0o600
---
```

```yaml
---
id: install:BEH-003
type: Behavior
lifecycle:
  status: proposed
partition_id: install
title: skill artefact placement is atomic per host
given: |
  - target host is selected by --for
  - --mcp-only is absent
when: install runs the skill-write step for one HostTarget
then: |
  1. compute path = `<skillsRoot>/<mcp-name>/SKILL.md` where
     skillsRoot is `${HOME}/.claude/skills` for claude-code or
     `${HOME}/.codex/skills` for codex.
  2. mkdir -p the parent directory.
  3. atomic write: write to `<path>.tmp-<pid>-<ts>` mode 0o600;
     fsync; rename to `<path>`.
  4. log `[<host>] writing skill file → <path>` to stderr.
  5. on write failure: best-effort delete of the .tmp file; log
     `[<host>] error: cannot write <path>: <message>`; return
     exit 2 from the orchestrator (BEH-001 step 7 routes).
negative_cases:
  - parent dir not creatable (e.g. permissions)      => WriteFailed, exit 2
  - rename fails (cross-FS / collision)              => WriteFailed, exit 2
out_of_scope:
  - merging with an existing skill file (overwrite semantics; operator manages history out of band)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(host,mcp-name)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - install:POL-001
  - install:POL-002
test_obligation:
  predicate: |
    Happy path produces a destination file byte-identical to the
    canonical source under skills/. Mode is 0o600. A reader
    polling the destination during repeated installs never
    observes a partial / truncated file. Failed rename leaves no
    `<path>.tmp-*` orphan in the parent directory.
  test_template: integration
  boundary_classes:
    - first install
    - re-install (overwrite)
    - permission failure on parent
    - rename failure (cleanup)
  failure_scenarios:
    - half-written SKILL.md visible to a host
    - mode wider than 0o600
    - tmp orphan after rename failure
---
```

```yaml
---
id: install:BEH-004
type: Behavior
lifecycle:
  status: proposed
partition_id: install
title: "MCP register: claude-code probes-then-removes-then-adds; codex single-add (overwrites)"
given: |
  - target host is selected
  - --skills-only is absent
when: install runs the MCP-register step for one HostTarget
then: |
  Claude Code path:
    1. spawn `<claude> mcp list` (no --scope; the row test is
       sufficient for the user-scope namespace).
    2. parse stdout line by line; if any line begins with
       `<mcp-name>:`, spawn
       `<claude> mcp remove <mcp-name> --scope user`. Ignore
       remove non-zero exits ONLY when stderr says "not found";
       otherwise propagate as exit 2.
    3. spawn
       `<claude> mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>`.
       Non-zero exit -> exit 2.
    4. log `[claude-code] mcp register: <argv joined by space>`
       BEFORE spawning step 3; log `[claude-code] ok` AFTER both
       skill+register requested steps finished for this target.
  Codex path:
    1. spawn
       `<codex> mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>`.
       Codex `mcp add` overwrites natively, so no probe is needed.
       Non-zero exit -> exit 2.
    2. log lines as above.
  Probe step (BEFORE step 1 of either path):
    - spawn `<host-cli> --version`. ENOENT classifies the host
      CLI as missing (BEH-001 step 6 routes to exit 2 or skip
      under --force).
  Argv MUST be constructed in code; no user-supplied string is
  interpolated unquoted. The mcp-name is validated against
  `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` before any subprocess uses it.
  --dry-run skips both the probe and the register subprocess.
negative_cases:
  - host CLI missing (ENOENT on probe)               => HostCliMissing
  - non-zero exit from list / remove / add           => HostCliFailed, exit 2
  - mcp-name failed regex (CT-001 violation)         => UsageError, exit 64 (caught at parse)
out_of_scope:
  - editing host config files directly (NEVER done; both hosts expose CLI subcommands)
  - removing the MCP entry on uninstall (no `veche uninstall` in v1)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(host,mcp-name)"
  time_source: none
data_scope: new_writes_only
policy_refs:
  - install:POL-001
  - install:POL-002
test_obligation:
  predicate: |
    install.test.ts exercises (a) the probe-list-remove-add
    sequence on Claude Code with an existing entry, (b) the
    single-add path on Codex, (c) the missing-CLI path with and
    without --force, (d) the non-zero-exit path on each host CLI.
    Captured argv match the documented templates; no user input
    leaks into the spawned argv unquoted.
  test_template: integration
  boundary_classes:
    - claude-code with no prior entry
    - claude-code with prior entry (probe -> remove -> add)
    - codex single-add
    - --dry-run (probe + register skipped)
    - host CLI missing without --force
    - host CLI missing with --force
    - non-zero exit on remove (not "not found")
  failure_scenarios:
    - argv shape drift unbumped
    - direct edit of ~/.claude.json or ~/.codex/config.toml
    - mcp-name interpolated unquoted into argv
---
```

### Contracts (install)

```yaml
---
id: install:CTR-001
type: Contract
lifecycle:
  status: proposed
partition_id: install
title: veche install CLI argv shape and exit codes
surface_ref: install:SUR-001
schema:
  description: |
    The argv shape accepted by `veche install` and its exit-code
    semantics.
  argv: |
    veche install
      [--for claude-code|codex|both]            (default both)
      [--mcp-name <name>]                       (default 'veche'; ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$)
      [--server-bin <abs-path>]                 (default <package-root>/dist/bin/veche-server.js)
      [--skills-only]                           (mutually exclusive with --mcp-only)
      [--mcp-only]                              (mutually exclusive with --skills-only)
      [--force]
      [--skip-config]
      [--dry-run]
      [--no-color]
      [--home <abs-path>]
  exit_codes: |
    0   success / opener-warn-only
    1   InternalError (any unhandled exception)
    2   SkillSourceMissing / ConfigSourceMissing /
        ServerBinMissing / HostCliMissing / HostCliFailed /
        WriteFailed
    64  UsageError (unknown flag, bad value, contradictory combo)
external_identifiers:
  - "command name: install"
  - flag names listed in argv
  - "default values: both, veche, VECHE_LOG_LEVEL=info"
  - "exit code integers: 0, 1, 2, 64"
compatibility_rules:
  - renaming a flag                                => major bump on SUR-001
  - widening exit-code semantics                   => major bump
  - changing default --for, default --mcp-name, or default --server-bin path => major bump
  - adding a default-off flag                      => minor bump
  - adding a new --for value                       => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts asserts every documented exit-code branch
    and every flag's positive + negative validation rule. The
    cli.integration.test.ts covers the bad-flag (exit 64) path.
  test_template: integration
  boundary_classes:
    - default flags
    - --for=claude-code
    - --for=codex
    - --skills-only
    - --mcp-only
    - --dry-run
    - bad --mcp-name
    - --skills-only + --mcp-only (rejected)
  failure_scenarios:
    - flag rename unbumped
    - exit code drift unbumped
---
```

```yaml
---
id: install:CTR-002
type: Contract
lifecycle:
  status: proposed
partition_id: install
title: host-CLI argv templates (`claude mcp …`, `codex mcp …`)
surface_ref: install:SUR-001
schema:
  description: |
    The exact argv shapes that install spawns. Operators script
    around these when wiring multi-environment provisioning
    (e.g. dotfiles bootstrap pipelines).
  claude_code: |
    probe   : claude --version
    list    : claude mcp list
    remove  : claude mcp remove <mcp-name> --scope user
    add     : claude mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>
  codex: |
    probe   : codex --version
    add     : codex mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>
  binary_resolution: |
    claude binary: env CLAUDE_BIN || PATH('claude')
    codex  binary: env CODEX_BIN  || PATH('codex')
  forbidden: |
    install MUST NOT spawn any binary outside { <claude>, <codex>,
    <opener> for show --open path which is owned by the meeting
    partition }. install never spawns an opener.
  argv_construction_rules: |
    - mcp-name validated against ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$ BEFORE
      it appears in any argv
    - server-bin validated as absolute and existing BEFORE it
      appears in any argv
    - no shell interpolation: argv is passed as an array to
      child_process.spawn; no `bash -c`, no `sh -c`, no template
      strings into a shell
external_identifiers:
  - "argv literals: mcp, list, add, remove, --scope, user, -e, --env, --, node"
  - "env literal: VECHE_LOG_LEVEL=info"
  - "host-binary discovery env vars: CLAUDE_BIN, CODEX_BIN"
compatibility_rules:
  - renaming a literal in the argv (e.g. dropping `--`)         => major bump on SUR-001
  - changing the env-pass form (-e vs --env across hosts)       => major bump
  - widening allowed binaries beyond { claude, codex }          => major bump (security regression)
  - changing VECHE_LOG_LEVEL default                            => major bump (operator scripts may grep logs)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    Captured argv during install.test.ts paths matches the
    documented templates byte-for-byte (modulo placeholder
    substitution). A regex probe over the source rejects any
    occurrence of `bash -c` / `sh -c` / `child_process.exec(` in
    install.ts (only spawn-with-array forms are allowed).
  test_template: contract
  boundary_classes:
    - claude-code happy
    - codex happy
    - probe argv
  failure_scenarios:
    - shell interpolation introduced
    - additional binary spawned
---
```

```yaml
---
id: install:CTR-003
type: Contract
lifecycle:
  status: proposed
partition_id: install
title: SKILL.md artefact (front-matter + body shape)
surface_ref: install:SUR-002
schema:
  description: |
    The canonical skill file shipped under
    skills/<mcp-name>/SKILL.md and copied byte-identically to
    each host. Both hosts expect a Markdown document with a YAML
    front-matter envelope.
  front_matter: |
    ---
    name: veche
    description: |
      Convene a symmetric committee meeting between Codex and a
      fresh Claude Code instance on a single question, then
      report each participant's stance and the consensus.
    triggers:
      - "second opinion"
      - "convene a committee"
      - "hold a meeting"
    ---
  body_summary: |
    The body documents the seven veche/* MCP tools (start_meeting,
    send_message, get_response, get_transcript, list_meetings,
    end_meeting, cancel_job), the Profile system, and operator
    expectations. Both hosts surface the front-matter `name` +
    `description` to the user agent; the body is consumed when
    the agent invokes the skill.
external_identifiers:
  - "front-matter field names: name, description, triggers"
  - >-
    the literal `name: veche` (the `name` MUST equal the `mcp-name`
    flag default to keep the host-agent invocation aligned with the
    `mcp__<mcp-name>__*` tool prefix)
compatibility_rules:
  - removing a front-matter field                  => major bump on SUR-002
  - renaming a triggered phrase                    => minor bump (host agent matches loosely)
  - retiring a referenced MCP tool                 => major bump on SUR-002 + meeting:SUR-001
  - swapping the `name` value away from the default mcp-name => major bump (operator scripts may break)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: artefact_describes_static_markdown
  reason: file is published once per release, copied per install
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts asserts the destination SKILL.md is
    byte-identical to the package source, the front-matter
    parses, and `name === 'veche'` (or the supplied --mcp-name).
  test_template: contract
  boundary_classes:
    - default mcp-name
    - operator override --mcp-name=foo
  failure_scenarios:
    - destination drifts from source
    - front-matter rename unbumped
---
```

### Invariants (install)

```yaml
---
id: install:INV-001
type: Invariant
lifecycle:
  status: proposed
partition_id: install
title: install never opens MeetingStorePort and never reads ${VECHE_HOME}/meetings/
always: |
  The install command MUST NOT instantiate MeetingStorePort, MUST
  NOT read or write any path under `${VECHE_HOME}/meetings/`, and
  MUST NOT inspect existing meeting data. The only permitted
  touch under `${VECHE_HOME}` is the bootstrap `config.json`
  write performed by `runConfigBootstrap` (BEH-002). Tests inject
  a mock store whose every method throws and assert the install
  command never trips it.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_io_scope_negation
  reason: rule about which I/O the partition is forbidden to perform
negative_cases:
  - install instantiates FileMeetingStore           => contract violation
  - install reads ${VECHE_HOME}/meetings/             => contract violation
out_of_scope:
  - the bootstrap config.json write (covered by BEH-002 + POL-001)
test_obligation:
  predicate: |
    install.test.ts injects a throwing mock for every store
    method and asserts the entire install flow (every flag combo)
    completes without tripping any. A regex probe over
    install.ts confirms no `MeetingStore`, `meetings/`,
    `events.jsonl`, or `manifest.json` reference.
  test_template: integration
  boundary_classes:
    - default flags
    - --skills-only
    - --mcp-only
    - --dry-run
  failure_scenarios:
    - install reaches into the meeting store
---
```

```yaml
---
id: install:INV-002
type: Invariant
lifecycle:
  status: proposed
partition_id: install
title: only allow-listed binaries are spawned with fixed argv shapes
always: |
  install spawns ONLY `<claude>` and `<codex>` (resolved via
  CLAUDE_BIN / CODEX_BIN env or PATH). It NEVER spawns `bash`,
  `sh`, `npm`, `node` (other than as the `node <server-bin>`
  argv tail forwarded to a host CLI), or any other binary. Argv
  is constructed in code as a string array; no user input is
  interpolated unquoted; no shell is invoked.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_spawn_set
  reason: rule about which binaries may appear at child_process.spawn
negative_cases:
  - install spawns `bash -c "claude mcp …"`         => contract violation
  - install spawns `npm run …`                      => contract violation
out_of_scope:
  - the host CLIs spawning their own subprocesses (out of our control)
test_obligation:
  predicate: |
    install.test.ts captures every spawn invocation and asserts
    argv[0] is in the documented set { '<claude>', '<codex>' }.
    A regex probe over install.ts rejects `child_process.exec(`,
    `bash -c`, `sh -c`, `cmd.exe /c`.
  test_template: integration
  boundary_classes:
    - claude-code path (probe + list + remove + add)
    - codex path (probe + add)
    - --dry-run (no spawn)
  failure_scenarios:
    - shell interpolation introduced
    - bash invocation
---
```

```yaml
---
id: install:INV-003
type: Invariant
lifecycle:
  status: proposed
partition_id: install
title: filesystem writes are bounded to two paths and atomic
always: |
  install writes ONLY to:
    - `<host-skills-root>/<mcp-name>/SKILL.md` per requested host
    - `${VECHE_HOME}/config.json` (only when absent or --force)
  Every write uses `<path>.tmp-<pid>-<ts>` mode 0o600 followed
  by `rename`; on rename failure the .tmp file is best-effort
  removed. Host config files (`~/.claude.json`,
  `~/.codex/config.toml`) are NEVER edited directly.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: new_writes_only
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: tmp suffix uses Clock-supplied timestamp for determinism in tests
negative_cases:
  - install writes to ~/.claude.json directly       => contract violation
  - install writes to a path outside the two allow-listed targets => contract violation
out_of_scope:
  - host CLI's own writes (the host's `mcp add` writes its own
    config; install delegates and never reads or asserts on it)
test_obligation:
  predicate: |
    install.test.ts captures every fs.writeFile / fs.rename call
    and asserts the destination path matches one of the two
    allow-listed templates. Mode is 0o600 on both kinds.
  test_template: integration
  boundary_classes:
    - SKILL.md write
    - config.json first write
    - rename failure cleanup
  failure_scenarios:
    - direct edit of ~/.claude.json
    - mode wider than 0o600
    - tmp orphan after rename failure
---
```

```yaml
---
id: install:INV-004
type: Invariant
lifecycle:
  status: proposed
partition_id: install
title: install is idempotent across runs with the same flags
always: |
  Running `veche install` with the same flags twice produces the
  same end state:
    - SKILL.md is overwritten in place; the byte-for-byte content
      matches the package source.
    - Claude Code MCP entry: probe-then-remove-then-add path
      converges to a single user-scope entry named `<mcp-name>`
      pointing at the current `<server-bin>`.
    - Codex MCP entry: `mcp add` overwrites natively; the latest
      `<server-bin>` wins.
    - `${VECHE_HOME}/config.json`: written exactly once on the
      first run; preserved on every subsequent run unless `--force`.
  The server-bin path picked up on the second run reflects the
  current installation, so re-running after `npm i -g <newer>`
  updates the registration.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(mcp-name,host)"
  time_source: external
  reason: idempotency is verified across two consecutive Clock-stamped runs
negative_cases:
  - second run leaves two entries on Claude Code   => contract violation (duplicate)
  - second run silently overwrites config.json without --force => contract violation
out_of_scope:
  - rolling back partial state from a failed first run (operator re-runs)
test_obligation:
  predicate: |
    install.test.ts runs the install flow twice with the same
    flags and asserts: (a) the SKILL.md content is identical,
    (b) `claude mcp list` invoked between runs would show
    exactly one `<mcp-name>:` row, (c) `${VECHE_HOME}/config.json`
    content is unchanged after run 2 unless --force was passed.
  test_template: integration
  boundary_classes:
    - two consecutive default runs
    - second run with --force
    - server-bin path changed between runs (registration refresh)
  failure_scenarios:
    - duplicate Claude Code entry after run 2
    - config.json silently overwritten
---
```

### Policies (install)

```yaml
---
id: install:POL-001
type: Policy
lifecycle:
  status: proposed
partition_id: install
title: install I/O is bounded to documented files, host CLIs, and stderr
policy_kind: io_scope
applicability:
  applies_to: |
    every BEH in this partition (BEH-001..004). Includes the
    helper modules under src/adapters/inbound/cli/lib used by
    install.
predicate: |
  - Filesystem writes ONLY to the two allow-listed targets per
    INV-003.
  - Filesystem reads MAY include the canonical skill source,
    canonical config template, server-bin existence check, and
    target-existence checks for the bootstrap config. Reading
    `${VECHE_HOME}/meetings/` is FORBIDDEN per INV-001.
  - Subprocesses ONLY: `<claude>` (Claude Code path) and
    `<codex>` (Codex path), with the documented argv from
    CTR-002. No other binary.
  - Logs to stderr ONLY. Stdout is unused in v1.
  - Env: reads VECHE_HOME, HOME (default derivation), CLAUDE_BIN,
    CODEX_BIN, NO_COLOR. MUST NOT read CODEX_API_KEY.
negative_test_obligations:
  - >-
    throwing mock store: every install path completes without
    tripping any store method
  - >-
    argv capture: only documented binaries spawned with documented
    argv shapes
  - stdout-empty assertion across every documented path
  - "regex probe: no `process.env.CODEX_API_KEY` in install.ts"
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - all documented flag combos
  failure_scenarios:
    - install writes to stdout
    - install reads CODEX_API_KEY
    - install touches the meeting store
---
```

```yaml
---
id: install:POL-002
type: Policy
lifecycle:
  status: proposed
partition_id: install
title: argv to host CLIs is constructed in code; no shell, no string interpolation
policy_kind: security_boundary
applicability:
  applies_to: |
    BEH-004 + the helper that resolves HostTarget records.
predicate: |
  - All host-CLI invocations use child_process.spawn with an
    argv array. No `child_process.exec`, no `bash -c`, no
    `sh -c`, no `cmd.exe /c`.
  - The `mcp-name` is validated against the documented regex
    BEFORE it appears in any argv.
  - The `server-bin` is validated as an absolute path to an
    existing file BEFORE it appears in any argv.
  - The default env value (`VECHE_LOG_LEVEL=info`) is constant
    and not derived from operator input.
  - The Claude Code remove-then-add path treats stderr "not
    found" as the only acceptable non-zero outcome on remove;
    every other failure is propagated.
negative_test_obligations:
  - >-
    regex probe over install.ts: zero `child_process.exec(`,
    `bash -c`, `sh -c`, `cmd.exe /c`
  - >-
    argv capture: every spawn argv equals the documented template
    byte-for-byte modulo `<mcp-name>` and `<server-bin>`
test_obligation:
  predicate: same as negative_test_obligations
  test_template: contract
  boundary_classes:
    - claude-code argv
    - codex argv
    - probe argv
  failure_scenarios:
    - shell interpolation introduced
    - argv shape drift unbumped
---
```

### Constraints (install)

```yaml
---
id: install:CST-001
type: Constraint
lifecycle:
  status: proposed
partition_id: install
constraint: |
  install uses ONLY Node built-ins (`node:fs/promises`, `node:os`,
  `node:path`, `node:child_process`, `node:url`). No third-party
  dependency may be introduced for argv parsing, subprocess
  management, or filesystem I/O.
rationale: |
  The flag set is small; the host-CLI argv shapes have specific
  requirements (the `--` argv separator, scoped --scope flags)
  that benefit from exact control. A third-party process library
  could also re-introduce shell interpolation that POL-002
  forbids.
test_obligation:
  predicate: |
    package.json `dependencies` contain no entries other than
    Node built-ins for the install path. Importing
    src/adapters/inbound/cli/commands/install.ts and traversing
    its imports yields only first-party files and Node built-ins.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a third-party process library appears in a future PR
---
```

### Implementation bindings (install)

```yaml
---
id: install:IMP-001
type: ImplementationBinding
lifecycle:
  status: proposed
partition_id: install
target_ids:
  - install:BEH-001
  - install:BEH-002
  - install:BEH-003
  - install:BEH-004
  - install:CTR-001
  - install:CTR-002
  - install:CTR-003
  - install:INV-001
  - install:INV-002
  - install:INV-003
  - install:INV-004
binding:
  command: src/adapters/inbound/cli/commands/install.ts
  tests:
    - src/adapters/inbound/cli/commands/__tests__/install.test.ts
  artefacts:
    skill_source: skills/veche/SKILL.md
    config_template: examples/config.json.example
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/adapters/inbound/cli/commands/__tests__/install.test.ts
  with FakeSubprocessRunner and a tmp-dir-based filesystem.
  Tests that close a Test obligation carry an
  `// @covers install:<ID>` marker.
---
```

### Open questions (install)

```yaml
---
id: install:OQ-001
type: Open-Q
lifecycle:
  status: proposed
partition_id: install
question: |
  Should install ship a `veche uninstall` command that removes
  the skill file and the host MCP entry, or stay install-only in
  v1 and document operator-side cleanup in the README?
options:
  - id: a
    label: keep_install_only_v1
    consequence: |
      v1 stays as-is. Operators run `claude mcp remove veche --scope user`
      and `codex mcp remove veche` themselves; SKILL.md is
      deleted manually. Simple; matches current code.
  - id: b
    label: introduce_uninstall_v1
    consequence: |
      Add `veche uninstall` mirroring the install flag set
      (--for, --skip-config). New BEH + CT, new tests for the
      "no entry to remove" path. Minor bump on SUR-001 (new
      command) plus on SUR-002 if the skill artefact's
      compatibility-action is widened.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

```yaml
---
id: install:OQ-002
type: Open-Q
lifecycle:
  status: proposed
partition_id: install
question: |
  Should install detect a Claude Code `mcp list` output schema
  drift (new column ordering, JSON output mode) and switch to a
  resilient parser, or stay with the line-prefix heuristic
  (`<mcp-name>:`)?
options:
  - id: a
    label: keep_line_prefix_v1
    consequence: |
      Stay with the simple heuristic. Risk: a Claude Code release
      that re-orders the row format silently breaks the probe.
      Mitigated by the integration test snapshot.
  - id: b
    label: switch_to_json_mode_v1
    consequence: |
      Use `claude mcp list --json` (if/when the host adds it).
      More robust; introduces a hard dependency on a specific
      Claude Code version. Minor bump on SUR-001 (new behaviour)
      and a new ASSUMPTION about the JSON schema.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (install)

```yaml
---
id: install:ASM-001
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: install
assumption: |
  The host CLIs (`claude`, `codex`) honour the documented
  `mcp add` / `mcp list` / `mcp remove` argv shapes across minor
  version bumps. Drift surfaces in install.test.ts (which uses a
  FakeSubprocessRunner) only after the test fixtures are
  refreshed; an end-to-end smoke test against a real `claude` /
  `codex` is run on a dev machine before release cuts.
source_open_q: install:OQ-002
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts § "claude mcp list output parsing"
---
```

```yaml
---
id: install:ASM-002
type: ASSUMPTION
lifecycle:
  status: proposed
partition_id: install
assumption: |
  Operators run `veche install` from the same machine where the
  MCP server will execute. Cross-machine deployment (write skill
  to one host, run the server on another) is out of v1 — the
  bootstrap relies on the resolved `--server-bin` path being
  reachable by the host CLI invoking it.
blocking: no
review_by: 2026-12-01
default_if_unresolved: keep_assumption
tests:
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts § "server-bin resolution"
---
```

### Out of scope (install)

The following are explicitly **outside** the install partition's
gate and contract surface:

- Uninstall flow (OQ-001).
- Updating an existing config.json (operators edit by hand).
- Installing into hosts other than Claude Code and Codex.
- Cross-machine provisioning (the resolved server-bin must be
  reachable from the host CLI's process).
- Migrating an existing skill file from a previous version
  (overwrite is the policy).
- Generating a per-host SKILL.md variant (the artefact is
  byte-identical across hosts; divergent variants require a spec
  change introducing a per-host template).

---
