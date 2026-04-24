# Use Case: list-meetings

## Actor

Orchestrator Agent calling MCP tool `list_meetings`.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `status` | `active` \| `ended` \| `all` | Optional. Default `active`. |
| `createdAfter` | `Instant` (ISO-8601) | Optional. |
| `createdBefore` | `Instant` (ISO-8601) | Optional. |
| `limit` | integer | Optional. 1–100. Default `50`. |
| `cursor` | string | Optional. Opaque pagination cursor from a prior call. |

## Output

**Success:**

```
{
  summaries: {
    meetingId: MeetingId,
    title: string,
    status: 'active' | 'ended',
    createdAt: Instant,
    endedAt: Instant | null,
    participants: {
      id: ParticipantId,
      role: 'facilitator' | 'member',
      adapter: 'codex-cli' | 'claude-code-cli' | null,
      status: 'active' | 'dropped'
    }[],
    lastSeq: integer,
    openJobCount: integer
  }[],
  nextCursor: string | null
}
```

**Failure:** See *Errors*.

## Flow

1. Validate Input. Reject `createdAfter > createdBefore` as `InvalidInput`.
2. Normalise `status = 'all'` to the absence of a status filter at the store level.
3. `MeetingStorePort.listMeetings({ status, createdAfter, createdBefore, limit, cursor })`.
4. For each Summary, derive `openJobCount` by inspecting the store's Job index (Jobs with `status ∈ { queued, running }`). The store exposes this count as part of `MeetingSummary` to avoid N+1 reads from callers.
5. Return the page. `nextCursor` is `null` when the store reports no more entries.

## Errors

| Error | When | MCP code |
|-------|------|----------|
| `InvalidInput` | Schema violation or inverted time range. | `invalid_params` |
| `CursorInvalid` | Unparseable or foreign `cursor`. | `invalid_params` |
| `StoreUnavailable` | Store error. | `internal_error` |

## Side Effects

None.

## Rules

- Ordering is **newest `createdAt` first**, with ties broken by `meetingId` ascending.
- Summaries do not include Transcript content — callers use [get-transcript](./get-transcript.usecase.md) or [get-response](./get-response.usecase.md) for that.
- A Meeting created inside this same process is visible immediately — stores guarantee read-your-writes consistency for a single server instance.
- The default filter (`status = active`) hides Meetings ended for any reason, including startup-failed Meetings from [start-meeting](./start-meeting.usecase.md).
