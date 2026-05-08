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
- **Participant** — Aggregate part `{ id, role, participantKind,
  discussionRole, isHumanParticipationEnabled, adapter, profile,
  systemPrompt, workdir, model, extraFlags, env, status, droppedAt,
  droppedReason }`.
- **Job** — Aggregate part `{ id, meetingId, status, createdAt,
  startedAt, finishedAt, maxRounds, lastSeq, rounds, error,
  cancelReason, terminationReason }`.
- **Human Turn** — A pause after a model Round where an enabled
  Human Participant can submit `agree`, `skip`, or `steer`
  feedback for the current Job. First valid submission for a
  `requestId` wins.
- **Synthesis** — A final facilitator-authored result stored after a
  Job reaches a terminal status. It is rendered separately from
  the Transcript and is not a Message.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
name: veche/mcp-tools
version: "0.2.0"
boundary_type: api
members:
  - meeting:CTR-001
  - meeting:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
    Public MCP tool API: the ten tools (start_meeting,
    send_message, get_response, get_transcript, list_meetings,
    end_meeting, cancel_job, submit_human_turn,
    set_human_participation, submit_synthesis) advertised by the MCP server, plus the
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
name: veche/cli-readonly
version: "0.2.0"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  2. for each Member entry, resolve participantKind (omitted
     means `model`). Human Members MUST NOT carry adapter/profile/
     model execution fields; they get adapter=null, sessionId=null,
     participantKind='human', and a default Discussion Role unless
     overridden.
  3. for each Model Member entry, resolve via
     ProfileResolver.resolve; surface ProfileNotFound /
     ProfileAdapterMismatch / AdapterFlagNotAllowed. The resolved
     Discussion Role comes from the Member override, the Profile,
     or the default model role.
  4. for each Model Member with workdir, verify it is absolute, exists,
     and is readable; otherwise WorkdirUnavailable.
  5. for each Model Member, verify the resolved adapter's capabilities
     match (supportsWorkdir if workdir set; supportsSystemPrompt
     if systemPrompt set); else AdapterConfigInvalid.
  6. assemble the Meeting aggregate with status='active', new
     MeetingId from IdGenPort, createdAt from ClockPort,
     facilitator first, members in input order. Each Model Member
     carries a fresh sessionId from IdGenPort.newParticipantSessionId;
     Human Members carry sessionId=null and
     isHumanParticipationEnabled=true at creation.
  7. call MeetingStorePort.createMeeting; the store appends
     meeting.created at seq=0 then participant.joined at seq=1..K
     (one per Participant including the Facilitator).
  8. for each Model Member (NOT the Facilitator), call
     AgentAdapterPort.openSession with the resolved configuration
     and the pre-allocated sessionId. Human Members are skipped.
  9. on any AdapterNotAvailable / AdapterConfigInvalid from
     openSession, roll back: closeSession every Session opened so
     far; MeetingStorePort.endMeeting(meetingId, at: Clock.now)
     so the partial Meeting is marked ended (it remains visible in
     the event log but is excluded by the default `status=active`
     filter). Surface the original error.
  10. return { meetingId, title, createdAt, participants[],
     defaultMaxRounds, cursor } where cursor points past the last
     participant.joined event.
negative_cases:
  - schema violation                        => InvalidInput (invalid_params)
  - profile name unknown                    => ProfileNotFound (invalid_params)
  - profile adapter mismatch                => ProfileAdapterMismatch (invalid_params)
  - duplicate participant id                => DuplicateParticipantId (invalid_params)
  - Human Member includes adapter execution field => InvalidInput (invalid_params)
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
    profile+override; Human Member; custom Discussion Role) the
    Meeting is persisted with the correct Participant order, every
    Model Member has an open Session, every Human Member has no
    Session, and the returned cursor decodes to seq = K (number of
    Participants plus zero-based meeting.created index = K). For each
    rollback path, the Meeting ends up with status=ended, all opened
    Sessions are closed, and the original error class is surfaced.
  test_template: integration
  boundary_classes:
    - 1 member, no overrides
    - 1 human member with default role metadata
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
title: send_message creates a Job, appends Round 0 Message, hands off to committee-protocol
given: |
  - the Meeting exists with status=active
  - no other Job for this Meeting is queued, running, or waiting_for_human
  - text passes the 1..32 KiB UTF-8 / non-empty-after-trim check
when: caller invokes `SendMessageUseCase.execute({ meetingId, text, maxRounds?, turnTimeoutMs?, addressees? })`
then: |
  1. validate input per CTR-001 (text 1..32 KiB; maxRounds 1..VECHE_MAX_ROUNDS_CAP;
     turnTimeoutMs 10000..3_600_000; addressees subset of non-dropped Members).
  2. loadMeeting -> if absent MeetingNotFound; if status=ended MeetingAlreadyEnded.
  3. compute effective active-Member set; if empty NoActiveMembers.
  4. createJob with status=queued, maxRounds, turnTimeoutMs,
     addressees (or null), createdAt=Clock.now. Store enforces
     "at most one Job in {queued,running,waiting_for_human} per Meeting" and raises
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
  - all Model Members dropped or addressees empty => NoActiveMembers
  - other Job queued/running/waiting_for_human => MeetingBusy
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
    first Job is queued/running/waiting_for_human raises MeetingBusy.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
     Jobs in `waiting_for_human` return immediately so callers can
     surface the pending Human Turn.
  4. read the next page: readMessagesSince({ meetingId, cursor,
     limit }).
  5. reload the Job snapshot for the latest status /
     terminationReason / error.
  6. compose { jobId, meetingId, status, terminationReason,
     error, messages: <speech|pass|system messages from page>,
     humanTurn, synthesis, nextCursor, hasMore }. round.started /
     round.completed and job.* events are NOT surfaced through this
     tool. humanTurn is non-null only for the latest unsubmitted
     Human Turn for this Job while the Human Participant is enabled.
     synthesis is non-null after submit_synthesis stores a result.
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
    (within tolerance). Jobs in waiting_for_human and terminal Jobs
    (completed/failed/cancelled) return immediately regardless of
    waitMs. round.* events are excluded from the messages array.
    Cross-meeting cursor reuse is rejected. Pending Human Turns and
    stored Synthesis records are surfaced in their dedicated fields.
  test_template: integration
  boundary_classes:
    - terminal Job (waitMs ignored)
    - waiting_for_human Job (waitMs ignored, humanTurn returned)
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
     status in {queued,running,waiting_for_human} (computed by the
     store; no N+1 reads).
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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

```yaml
---
id: meeting:BEH-010
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
title: submit_human_turn accepts the first valid Human Turn submission
given: |
  - a Job is in status waiting_for_human
  - a human.turn.requested event exists for requestId
  - no accepted human.turn.submitted event exists for requestId
when: caller invokes `SubmitHumanTurnUseCase.execute(command)`
then: |
  The use case validates that the request belongs to the supplied
  Meeting and Job and that the Human Participant is still enabled.
  It appends one Transcript Message authored by the Human Participant:
  agree yields a readable speech Message naming the target and
  strength; skip yields a pass Message with `<PASS/>`; steer yields a
  speech Message with the supplied text. It then appends
  human.turn.submitted with the same requestId and the submitted
  action. The first valid submission by event seq is authoritative.
negative_cases:
  - request unknown / stale                    => HumanTurnNotFound
  - duplicate submission                       => HumanTurnAlreadySubmitted
  - agree without valid target or strength     => InvalidInput
  - steer without non-empty text               => InvalidInput
out_of_scope:
  - dispatching Human Participants through AgentAdapterPort
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "exactly_once_with_key:(requestId)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    Integration tests cover agree, skip, steer, stale request
    rejection, duplicate rejection, and the emitted Message plus
    control-event pair.
  test_template: integration
  boundary_classes:
    - agree
    - skip
    - steer
    - duplicate request
  failure_scenarios:
    - second submission accepted
    - Human Turn stored without transcript Message
---
```

```yaml
---
id: meeting:BEH-011
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
title: set_human_participation toggles Human Participant availability
given: |
  - a Meeting exists
  - participantId names a Human Member in that Meeting
when: caller invokes `SetHumanParticipationUseCase.execute({ meetingId, participantId, enabled })`
then: |
  The use case appends human.participation.set with the supplied
  enabled value and returns { participantId, enabled }. Disabling
  during a pending Human Turn causes the discussion runner to auto-skip
  that request on its next poll. Model Participants cannot be toggled
  through this use case.
negative_cases:
  - meeting unknown                            => MeetingNotFound
  - participant unknown or not human           => ParticipantNotFound
out_of_scope:
  - changing a Participant's participantKind after Meeting creation
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(meetingId,participantId,enabled)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    Integration tests toggle a Human Participant off during a pending
    request and observe the runner auto-skip; toggling a Model
    Participant is rejected.
  test_template: integration
  boundary_classes:
    - enable
    - disable while waiting
    - model participant rejection
  failure_scenarios:
    - disabled Human Turn blocks forever
---
```

```yaml
---
id: meeting:BEH-012
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
title: submit_synthesis stores the final facilitator synthesis
given: |
  - a Job exists and is terminal
when: caller invokes `SubmitSynthesisUseCase.execute({ jobId, text })`
then: |
  The use case appends synthesis.submitted with the Job id and text.
  The stored Synthesis is rendered separately from Transcript Messages
  by get_response, show, and the web-viewer. It does not mutate the Job
  terminal state and does not create a Message.
negative_cases:
  - job unknown                                => JobNotFound
  - job non-terminal                           => InvalidInput
  - synthesis already submitted for Job        => JobAlreadyTerminal
  - text empty after trim                      => InvalidInput
out_of_scope:
  - invoking a hidden summarizer model inside the server
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: read_your_writes
  idempotency: "at_least_once_with_key:(jobId)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - meeting:POL-001
test_obligation:
  predicate: |
    Integration tests store a Synthesis for a terminal Job and assert
    renderers expose it as a separate section, not a Message.
  test_template: integration
  boundary_classes:
    - completed job
    - failed job
    - non-terminal job rejected
  failure_scenarios:
    - synthesis appears as a speech Message
---
```

### Contracts (meeting)

```yaml
---
id: meeting:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: meeting
title: MCP tool inputs and outputs (the ten veche/* tools)
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
      facilitator: { id?: string, displayName?: string, discussionRole?: DiscussionRole },
      members: Member[1..8],
      defaultMaxRounds?: integer(1..VECHE_MAX_ROUNDS_CAP) }
    Member: { id: string,
              participantKind?: 'model'|'human',
              discussionRole?: DiscussionRole,
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
      messages: Message[], humanTurn: HumanTurn|null,
      synthesis: Synthesis|null, nextCursor, hasMore }
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
  submit_human_turn_input: |
    { jobId, requestId,
      action: 'agree'|'skip'|'steer',
      targetParticipantId?: ParticipantId,
      strength?: 1|2|3,
      text?: string(1..32 KiB trimmed) }
  submit_human_turn_output: |
    { jobId, requestId, accepted: true, messageId }
  set_human_participation_input: |
    { meetingId, participantId, enabled: boolean, jobId?: JobId }
  set_human_participation_output: |
    { meetingId, participantId, enabled }
  submit_synthesis_input: |
    { jobId, text: string(1..32 KiB trimmed) }
  submit_synthesis_output: |
    { jobId, stored: true }
  error_mapping: |
    InvalidInput / DuplicateParticipantId / WorkdirUnavailable /
      ProfileNotFound / ProfileAdapterMismatch /
      AdapterFlagNotAllowed / AdapterConfigInvalid /
      CursorInvalid / AddresseeNotFound -> invalid_params
    MeetingNotFound / JobNotFound -> not_found
    MeetingAlreadyEnded / NoActiveMembers / MeetingBusy /
      JobAlreadyTerminal / HumanTurnNotFound /
      HumanTurnAlreadySubmitted -> failed_precondition
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
  - "tool names: start_meeting, send_message, get_response, get_transcript, list_meetings, end_meeting, cancel_job, submit_human_turn, set_human_participation, submit_synthesis"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
      participantKind: 'model'|'human';
      discussionRole: { name: string; description: string; weight: number };
      isHumanParticipationEnabled: boolean;
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
      status: 'queued'|'running'|'waiting_for_human'|'completed'|'failed'|'cancelled';
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
  human_turn: |
    HumanTurn {
      requestId: string;
      round: integer;
      participant: { id: ParticipantId; displayName: string; discussionRole: DiscussionRole };
      agreeTargets: { id: ParticipantId; displayName: string; discussionRole: DiscussionRole }[];
      strengths: [1, 2, 3];
      canSkip: true;
      canSteer: true
    }
  synthesis: |
    Synthesis {
      jobId: JobId;
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
  - participantKind enum: model, human
  - kind enum: speech, pass, system
  - status enums on Meeting / Participant / Job
  - human turn action enum: agree, skip, steer
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  - meeting:BEH-010
  - meeting:BEH-011
  - meeting:BEH-012
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
      - src/features/meeting/application/SubmitHumanTurnUseCase.ts
      - src/features/meeting/application/SetHumanParticipationUseCase.ts
      - src/features/meeting/application/SubmitSynthesisUseCase.ts
      - src/features/meeting/application/humanTurnState.ts
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.519Z
    change_request: update old behavior
    scope: first-time-approval
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

