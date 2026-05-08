## Partition: committee-protocol

> Migrated from `spec/features/committee-protocol/*.md`. Every typed
> ID below lands as `lifecycle.status: proposed`; promotion requires
> `sdd approve` from a non-agent identity.

### Context (committee-protocol)

The `committee-protocol` partition owns the deterministic
multi-party discussion loop launched by `send_message`. It runs
model broadcast Rounds until every active Model Member declines
(Pass Signal) or `maxRounds` is reached. When an enabled Human
Member is present, it pauses after each model Round for a Human
Turn before the next termination decision. It persists every Model
Member response, Human Turn response, drop incident, and termination
marker through the `MeetingStorePort`. It consumes `AgentAdapterPort` from
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
  Rounds 1..N are concurrent Model Member Turns followed by a single
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
- **Human Turn** — A pause after a model Round. The runner emits
  human.turn.requested, waits by polling/refetching the store, then
  resumes after submit_human_turn, auto-skip on disabled Human
  Participation, cancellation, or terminal state.

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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: committee-protocol
name: veche/discussion-runtime
version: "0.2.0"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: committee-protocol
title: RunRoundUseCase dispatches active Members in parallel and persists outcomes deterministically
given: |
  - DiscussionState with roundNumber=R-1 and terminationReason=null
  - at least one active, non-dropped Model Member exists
when: caller invokes `RunRoundUseCase.execute({ state, cancellationSignal, turnTimeoutMs })`
then: |
  the use case:
    1. derives `activeMembers` = Participants with role=member AND participantKind=model AND status=active AND id NOT IN droppedThisJob.
       If empty, sets state.terminationReason='no-active-members' and returns without persisting any new event.
    2. increments state.roundNumber.
    3. appends `round.started` event with payload { roundNumber, activeParticipantIds: <activeMembers> }.
    4. builds per-Member `transcriptPrefix`: every speech/pass/system Message authored by anyone OTHER than this
       Member with `round >= lastRound[member]` (where lastRound[member] is the most recent round in which the
       Member spoke, or -1 before the first Turn). On Round 1 this is exactly the facilitator's Round 0 Message.
       Each Participant-authored prompt block includes the author's Discussion Role name and weight.
    5. dispatches all Member Turns in parallel via `Promise.allSettled` over DispatchTurnUseCase.
    6. checks cancellationSignal.aborted; if set, sets state.terminationReason='cancelled' and stops persisting
       further events for this Round (the Round-completed marker is NOT appended on cancellation).
    7. processes outcomes in ascending participantId order (deterministic for replay):
       speech  -> appendMessage(round=R, author=participantId, kind=speech, text); pendingPass.delete(participantId)
       pass    -> appendMessage(round=R, author=participantId, kind=pass, text='<PASS/>'); pendingPass.add(participantId)
       failure -> delegate to HandleAgentFailureUseCase (BEH-003)
    8. appends `round.completed` event with payload { roundNumber, passedParticipantIds: [...pendingPass] }.
    9. if an enabled Human Member exists, emits human.turn.requested,
       sets the Job status to waiting_for_human, and polls/refetches the
       store until the request has a valid submission, the Human Member
       is disabled, or cancellation is observed. agree and skip preserve
       pendingPass; steer clears pendingPass so another model Round can
       run when the maxRounds cap permits it. The first valid submission
       for requestId wins.
    10. evaluates termination via TerminateDiscussionUseCase; if it returns a non-null reason, sets state.terminationReason.
    11. returns the updated state.
negative_cases:
  - StoreUnavailable from any append    => propagated (Job runner converts to job.failed StoreUnavailable)
out_of_scope:
  - retries on individual Model Member failures (BEH-002 / BEH-007 own retry semantics)
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
    one round.completed (or none if cancelled). With an enabled
    Human Member, it emits a Human Turn request after the model
    Round and resumes only after submission, toggle-off auto-skip,
    or cancellation. state.roundNumber is incremented exactly once.
    activeMembers=∅ short-circuits without any new event.
  test_template: integration
  boundary_classes:
    - all speech
    - mixed speech + pass
    - Human Member steer clears pendingPass
    - Human Member skip preserves pendingPass
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: committee-protocol
title: TerminateDiscussionUseCase decides termination using a fixed evaluation order
given: |
  - DiscussionState
  - cancellationSignal
  - activeModelMembers list
when: caller invokes `TerminateDiscussionUseCase.execute({ state, cancellationSignal, activeMembers })`
then: |
  the use case evaluates these conditions in order; the first
  match wins:
    1. cancellationSignal.aborted          => { terminationReason: 'cancelled', shouldFinalize: true }
    2. activeMembers.length === 0           => { terminationReason: 'no-active-members', shouldFinalize: true }
    3. state.roundNumber >= state.maxRounds => { terminationReason: 'max-rounds', shouldFinalize: true }
    4. every active Model Member id is present in state.pendingPass
       and no Human steering cleared that pass state => { terminationReason: 'all-passed', shouldFinalize: true }
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
    - all-passed precise (every active Model Member in pendingPass)
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
      description: "Set<ParticipantId> of Model Members that emitted <PASS/> in the most recent Round; cleared at Round start or by Human steering"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.125Z
    change_request: update old behavior
    scope: first-time-approval
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

