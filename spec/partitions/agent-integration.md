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
  env, discussionRole? }`.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
partition_id: agent-integration
name: veche/agent-adapter-port
version: "0.2.0"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
partition_id: agent-integration
name: veche/profile-config-format
version: "0.2.0"
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  - subprocess spawn fails (EPERM/EACCES — host sandbox blocks nested spawn) => failure TurnResult with error.code 'codex-spawn-blocked' or 'claude-spawn-blocked', retryable=false
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
partition_id: agent-integration
title: ProfileResolver merges Profile + Member overrides into ResolvedParticipantConfig
given: |
  - the user config file (UserConfigFile) is loaded or null
  - caller passes MemberInput { profile?, adapter?, systemPrompt?,
    model?, workdir?, extraFlags?, env?, discussionRole? }
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
       (systemPrompt, model, workdir, extraFlags, discussionRole);
       env is shallow union with input keys taking precedence.
    5. validates every effective `extraFlags` entry against the
       adapter's allow-list (regex set per adapter); raises
       AdapterFlagNotAllowed on the first mismatch.
    6. returns ResolvedParticipantConfig with the resolved values
       plus `profile: input.profile ?? null` and
       `discussionRole: input.discussionRole ?? profile.discussionRole ?? null`
       for traceability.
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
    resolver returns the documented record, including Discussion Role
    precedence, or raises the documented error.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
partition_id: agent-integration
title: claude-code-cli emits --session-id on the first spawn and --resume on every later spawn (incl. retries) per CTR-002
given: |
  - claude-code-cli adapter Session
  - sendTurn invoked; the adapter tracks `sessionCreated`
    per Session, initialised false at openSession
when: the adapter builds argv for the subprocess
then: |
  - First spawn (`sessionCreated === false`): argv contains
    `--session-id <providerRef>` (creates a new conversation).
  - Every spawn after the first (`sessionCreated === true`): argv
    contains `--resume <providerRef>` (continues the existing
    conversation).
  Every Turn unconditionally emits the Recursion Guard pair
  (`--strict-mcp-config --mcp-config '{"mcpServers":{}}'`),
  `-p`, `--output-format json`, `--input-format text`,
  `--permission-mode default`, and `--disallowedTools=<csv>` (with
  the `=` form — see CTR-002). The default disallowed list is
  `Bash,Edit,Write,NotebookEdit`; if `extraFlags` includes
  `--allowedTools` or `--disallowedTools`, the adapter omits its
  default. `--bare` is opt-in only via `extraFlags` and requires
  the operator to provide ANTHROPIC_API_KEY or apiKeyHelper.
  The adapter flips `sessionCreated = true` as soon as a subprocess
  returns an outcome (any exit code, including timeout), NOT only on
  success: `claude --session-id` registers the session on disk at
  startup, so a retry of a failed first Turn
  (committee-protocol MAX_ATTEMPTS_PER_TURN) MUST resume rather than
  re-create the session — re-using `--session-id` would fail with
  "Session ID … is already in use". `sessionCreated` is NOT flipped
  on a spawn failure (EPERM/EACCES) because no session was created.
  The system prompt is sent via `--append-system-prompt` until a Turn
  succeeds (separate `systemPromptPending` flag), so a resumed retry
  still carries the role + PASS instructions. After exit 0, if the
  parsed `session_id` does not match the supplied `providerRef`,
  returns AdapterParseError with code `claude-session-mismatch`.
negative_cases:
  - a retry of a failed first Turn uses --session-id (would fail "Session ID … is already in use")
  - any spawn after the first uses --session-id
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
    For the first spawn the argv contains `--session-id <uuid>`; for
    every later spawn it contains `--resume <uuid>`, including when
    the first Turn failed and is retried. Recursion Guard pair is
    present on every spawn. Default disallowed-tools list is emitted
    iff the operator did not override allow/disallow lists.
  test_template: integration
  boundary_classes:
    - first spawn with default tool policy
    - second spawn (resume)
    - retry after a failed first Turn resumes instead of re-creating
    - operator override of disallowedTools suppresses default
    - opt-in --bare requires ANTHROPIC_API_KEY (config-time check)
  failure_scenarios:
    - Recursion Guard absent on any Turn
    - --session-id reused on any spawn after the first
    - --session-id reused when retrying a failed first Turn
    - default disallowed list leaked despite operator override
---
```

```yaml
---
id: agent-integration:BEH-008
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
    On spawn failure with errno EPERM or EACCES (OS refuses to
    launch the binary; typically nested-Codex topology where the
    parent Codex session blocks nested `codex exec` via OS sandbox
    on Windows):
      AdapterInvocationError code 'codex-spawn-blocked',
      retryable=false. Message names the nested-Codex topology and
      directs the operator to use claude-code-cli members or run
      veche from a non-Codex host. Other errno values keep the
      pre-existing classification (ENOENT after openSession ->
      AdapterNotAvailable code 'codex-binary-not-found').
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
  - "error code strings: codex-binary-not-found, codex-session-closed, codex-generic, codex-usage, codex-parse-empty, codex-cancelled, codex-spawn-blocked, codex-exit-<N>, AdapterTurnTimeout"
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
    - spawn fails with EPERM/EACCES -> codex-spawn-blocked, retryable=false
  failure_scenarios:
    - argv string drift unbumped
    - exit 2 silently classified retryable
    - spawn EPERM surfaced as raw codex-generic instead of codex-spawn-blocked
---
```

```yaml
---
id: agent-integration:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
    On spawn failure with errno EPERM or EACCES (OS refuses to
    launch the binary; nested-host topology where the parent
    session blocks nested CLI spawn via OS sandbox):
      AdapterInvocationError code 'claude-spawn-blocked',
      retryable=false. Message names the nested-host topology.
      Other errno values keep the pre-existing classification
      (ENOENT after openSession -> AdapterNotAvailable code
      'claude-binary-not-found').
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
  - the first spawned subprocess flips sessionCreated = true (claude registers the session id on disk at startup), so every later spawn — including a retry of a failed first Turn — uses --resume
  - systemPromptPending is cleared on the first successful Turn
external_identifiers:
  - "argv strings: -p, --output-format, json, --input-format, text, --strict-mcp-config, --mcp-config, --mcp-config-payload-empty-mcpServers-object, --permission-mode, default, --disallowedTools=<csv>, --session-id, --resume, --model, --append-system-prompt, --add-dir"
  - "default disallowedTools list members: Bash, Edit, Write, NotebookEdit"
  - "error code strings: claude-binary-not-found, claude-parse-json, claude-parse-empty, claude-runtime, claude-session-mismatch, claude-usage, claude-sigint, claude-cancelled, claude-spawn-blocked, claude-exit-<N>"
compatibility_rules:
  - removing the Recursion Guard pair (`--strict-mcp-config`, `--mcp-config '{"mcpServers":{}}'`) => major bump on SUR-001 + critical-security review
  - dropping the `=` form on --disallowedTools => major bump (CLI breaks with variadic parsing)
  - swapping --session-id semantics with --resume semantics on Turn 1 => major bump
  - widening default disallowedTools list (e.g. adding 'Read') => minor bump
  - tightening default disallowedTools list (removing an entry) => major bump
  - adding a new allow-listed extraFlag => minor bump
  - adding a new error code value => minor bump
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
    Captured argv on the first spawn contains --session-id; on every
    later spawn (including a retry of a failed first Turn) it contains
    --resume. Recursion Guard pair appears on every spawn.
    --disallowedTools always uses the `=` form. JSON envelope parse
    failures map to the documented error codes.
  test_template: contract
  boundary_classes:
    - first spawn with full options
    - second spawn resume
    - retry after a failed first Turn resumes
    - operator override suppresses default disallowedTools
    - exit 0 with subtype=success
    - exit 0 with subtype=error_during_execution -> claude-runtime
    - exit 2 (usage)
    - exit 130 (sigint)
    - spawn fails with EPERM/EACCES -> claude-spawn-blocked, retryable=false
  failure_scenarios:
    - Recursion Guard missing
    - --disallowedTools without `=`
    - claude-runtime classified as non-retryable
    - spawn EPERM surfaced as raw claude-exit-<N> instead of claude-spawn-blocked
---
```

```yaml
---
id: agent-integration:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
          discussionRole:
            type: object
            required: [name, description, weight]
            properties:
              name: { type: string, minLength: 1, maxLength: 64 }
              description: { type: string, minLength: 1, maxLength: 400 }
              weight: { type: number, exclusiveMinimum: 0 }
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-06-02T16:25:37.846Z
    change_request: https://github.com/cyberash-dev/veche/releases/tag/v0.4.1
    scope: fix-claude-resume-on-retry
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

