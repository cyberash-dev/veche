# Feature: committee-protocol

## Purpose

Execute the multi-party discussion triggered by a Facilitator Message. Runs a sequence of broadcast Rounds until every active Member declines to add anything (Pass Signal) or `max_rounds` is reached. Appends every Member response, every drop incident, and the termination marker to the Meeting Transcript.

## Domain Entities

### RoundPlan

Ephemeral, in-memory only. Drives a single Round execution.

| Field | Type | Rules |
|-------|------|-------|
| `number` | integer ≥ 1 | The Round index this plan executes. |
| `activeMembers` | `ParticipantId[]` | Non-dropped, non-passing Members to dispatch this Round. Order irrelevant (parallel dispatch). |
| `transcriptCursor` | `Cursor` | Upper bound of visible Transcript when the Round started. |

### TurnOutcome

Result of one Adapter dispatch within a Round.

| Field | Type | Rules |
|-------|------|-------|
| `participantId` | `ParticipantId` | — |
| `kind` | `speech` \| `pass` \| `failure` | Mutually exclusive. |
| `text` | `string` \| `null` | Non-null when `kind = speech` or `kind = failure` (failure carries the error message). |
| `error` | `{ code: string, message: string }` \| `null` | Non-null when `kind = failure`. |

### DiscussionState

Ephemeral. Aggregates RoundPlans for a single Job.

| Field | Type | Rules |
|-------|------|-------|
| `jobId` | `JobId` | — |
| `meetingId` | `MeetingId` | — |
| `maxRounds` | integer | From the Job. |
| `roundNumber` | integer ≥ 0 | Incremented before each Round; starts at 0 after the Facilitator Message. |
| `pendingPass` | `Set<ParticipantId>` | Members that emitted `<PASS/>` in the current Round. Cleared whenever a non-pass `speech` is appended. |
| `droppedThisJob` | `Set<ParticipantId>` | Members dropped during this Job. Cumulative for the remainder of the Meeting. |
| `terminationReason` | `all-passed` \| `max-rounds` \| `cancelled` \| `no-active-members` \| `null` | Set when the discussion ends. |

## Ports

### AgentAdapterPort

Re-used from [agent-integration](../agent-integration/agent-integration.md). Methods consumed here: `openSession`, `sendTurn`, `closeSession`.

### MeetingStorePort

Re-used from [persistence](../persistence/persistence.md). Methods consumed here: `appendMessage`, `updateJob`, `markParticipantDropped`, `readMessagesSince`, `loadMeeting`, `loadJob`.

### ClockPort

Used to stamp system Messages (drop incidents, termination markers) and to enforce per-Turn wall-clock timeouts.

## Use Cases

- [run-round](./run-round.usecase.md) — Dispatch one Round and append its TurnOutcomes.
- [parse-pass-signal](./parse-pass-signal.usecase.md) — Deterministically classify an Adapter response as `speech` or `pass`.
- [handle-agent-failure](./handle-agent-failure.usecase.md) — Drop a failing Participant and emit the corresponding Transcript event.
- [terminate-discussion](./terminate-discussion.usecase.md) — Finalise a Job when any termination condition fires.

## Rules

- **Round 0 is the Facilitator Message.** It is appended by [send-message](../meeting/send-message.usecase.md) before the first invocation of this feature.
- **Rounds 1..N are Member broadcasts.** Every active Member receives the Transcript snapshot taken at Round start and produces at most one Message. Rounds proceed strictly in order; Round N does not start before every Turn in Round N−1 has reached a terminal state (speech, pass, or failure).
- **Parallel within a Round.** All Turns inside a single Round are dispatched concurrently. No Member sees another Member's Round-N Message before Round N+1.
- **Pass resets.** `pendingPass` holds Members that passed this Round. If any Member emits a `speech` in this Round, every other Member's prior pass is *still* counted for this Round — but in the next Round the set resets, so a Member that passed earlier may speak again once the Transcript has grown.
- **Termination conditions.** The Job terminates when any of the following holds, evaluated at the end of a Round:
  1. Every Member whose `status` is `active` emitted `<PASS/>` in the just-finished Round → `all-passed`.
  2. `roundNumber >= maxRounds` → `max-rounds`.
  3. No Members are `active` (all dropped) → `no-active-members`.
  4. An external cancellation is observed → `cancelled`.
- **Dropped Members are skipped for the rest of the Meeting.** A Participant whose `status` becomes `dropped` during any Job stays dropped for subsequent Jobs in the same Meeting.
- **Transcript writes are append-only.** Once a Message is appended, its fields are immutable. A retraction is modeled as a new `system` Message, not a mutation.
- **`<PASS/>` and `speech` are mutually exclusive.** A response containing both is recorded as `speech` (see [parse-pass-signal](./parse-pass-signal.usecase.md) for the exact rules).
- **Bounded round-delta per Turn.** Every Member receives, on each Turn, the Messages from rounds the Member has not yet seen — specifically every `speech`/`pass`/`system` Message with `round >= lastRound[member]`, excluding the Member's own messages. `lastRound[member]` is the round in which this Member most recently spoke (or `-1` before any). On Round 1 this is exactly the facilitator's opening Message; on Round N+1 it is every other Member's Message from Round N. The prefix is symmetric — every Member sees the same set of peer Messages from the just-finished round, regardless of intra-round dispatch order. Older context — including the Member's own past responses and prior peer Messages it has already seen — is retained by the adapter's provider session (Codex `thread_id`, Claude Code `--resume`); the protocol depends on this session continuity to keep prompts compact. Construction of the prefix is documented in [dispatch-turn](../agent-integration/dispatch-turn.usecase.md).
