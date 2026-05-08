## Partition: web-viewer

> Migrated from `spec/features/web-viewer/*.md`. Owns the live
> browser-based viewer (`veche watch`).

### Context (web-viewer)

The `web-viewer` partition is a second inbound adapter on top of
the same `MeetingStorePort` exposed by persistence. It
runs as its own process (independent of the MCP server that writes
to `${VECHE_HOME}`) and serves a self-contained SPA + two SSE
channels (Meeting list + per-Meeting transcript) on a loopback
HTTP listener. Cross-process change detection uses 750-ms
polling, never `watchNewEvents`. It has a bounded write surface for
Human Turn submission and Human Participation toggles only.

Boundaries:

- It does NOT introduce any new MCP tool and does NOT extend the
  public storage Surface. It mutates the event log only through the
  meeting partition's Human Turn and Human Participation use cases.
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
- **`HumanControlsApi`** — The handler for the two POST endpoints
  (`/api/meetings/:id/human-turn`,
  `/api/meetings/:id/human-participation`) that delegate to meeting
  use cases.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: web-viewer
name: veche/watch-http
version: "0.2.0"
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
  query param is a minor bump. Adding a bounded POST endpoint for
  human-control writes is a minor bump because existing read clients
  continue to operate unchanged.
---
```

```yaml
---
id: web-viewer:SUR-002
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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

```yaml
---
id: web-viewer:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: web-viewer
title: POST human-control routes submit Human Turns and participation toggles
given: |
  - WatchServer is listening on the same loopback origin as the SPA
when: client issues `POST /api/meetings/:id/human-turn` or
  `POST /api/meetings/:id/human-participation`
then: |
  The server validates Content-Type application/json and caps the body
  at 32 KiB. /human-turn delegates to SubmitHumanTurnUseCase and
  returns 200 { requestId, accepted: true } on success, 409
  { error: "human turn conflict" } for stale or duplicate requestId,
  and 400 for invalid payloads. /human-participation delegates to
  SetHumanParticipationUseCase and returns 200 { participantId,
  enabled } on success. The same Host-header DNS-rebind guard and
  no-CORS policy apply to POST routes.
negative_cases:
  - invalid JSON body                         => 400
  - body larger than 32 KiB                   => 400
  - stale or duplicate Human Turn request     => 409
  - wrong Host header on loopback binding     => 421
out_of_scope:
  - arbitrary store writes outside the two meeting use cases
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: read_your_writes
  idempotency: "exactly_once_with_key:(requestId)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - web-viewer:POL-001
  - web-viewer:POL-002
test_obligation:
  predicate: |
    WatchServer tests exercise successful Human Turn submission,
    participation toggle, malformed payload rejection, conflict
    mapping, Host-header rejection, and no CORS headers.
  test_template: integration
  boundary_classes:
    - submit Human Turn
    - toggle participation
    - conflict
    - malformed JSON
  failure_scenarios:
    - POST route bypasses Human use case
    - stale Human Turn accepted
---
```

### Contracts (web-viewer)

```yaml
---
id: web-viewer:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
    POST /api/meetings/:id/human-turn               -> 200 application/json { requestId, accepted: true }
    POST /api/meetings/:id/human-participation      -> 200 application/json { participantId, enabled }
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
    - POST routes accept Content-Type application/json and reject
      bodies larger than 32 KiB.
external_identifiers:
  - route paths and the literal segments (/api/meetings, /api/stream)
  - JSON response field names
  - HTTP status codes (200, 400, 404, 409, 421, 500)
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
      human.turn      { humanTurn: HumanTurn|null }                   pending Human Turn changed
      synthesis.submitted { synthesis: Synthesis }                    final synthesis stored
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
  - SSE event names: hello, meeting.added, meeting.updated, message.posted, human.turn, synthesis.submitted, error
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
    - With a Human Participant, the transcript includes a pinned
      bottom composer with a participation toggle and mutually
      exclusive agree / pass / steer actions. Human Participant
      bubbles are right-aligned; Model Member bubbles are left-aligned.
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: web-viewer
title: web-viewer is read-only except bounded human-control writes
policy_kind: io_scope
applicability:
  applies_to: |
    every BEH in this partition (BEH-001..007). Includes the
    WatchServer / SseChannel / MeetingPoller / handlers /
    spa/index.html.ts modules.
predicate: |
  - The partition MUST NOT call MeetingStorePort.{createMeeting,
    markParticipantDropped, createJob, updateJob, endMeeting,
    watchNewEvents}.
  - The partition is permitted to call appendMessage and appendSystemEvent only
    through SubmitHumanTurnUseCase and SetHumanParticipationUseCase.
    JSON/SSE read handlers remain read-only.
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
  - inject a throwing mock for forbidden store write methods; assert
    no BEH path trips one
  - assert Human-control POST paths reach only the two allowed use cases
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: web-viewer
title: SPA + JSON / SSE responses preserve the escape-then-transform invariant
policy_kind: security_boundary
applicability:
  applies_to: |
    BEH-002..007 + the SPA module (spa/index.html.ts).
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: web-viewer
target_ids:
  - web-viewer:BEH-001
  - web-viewer:BEH-002
  - web-viewer:BEH-003
  - web-viewer:BEH-004
  - web-viewer:BEH-005
  - web-viewer:BEH-006
  - web-viewer:BEH-007
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
      - src/adapters/inbound/web/HumanControlsApi.ts
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.715Z
    change_request: update old behavior
    scope: first-time-approval
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

