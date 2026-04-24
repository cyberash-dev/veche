# Use Case: get-transcript

## Actor

Orchestrator Agent calling MCP tool `get_transcript`.

## Input

| Field | Type | Validation |
|-------|------|------------|
| `meetingId` | `MeetingId` | Required. Must exist. |
| `cursor` | string | Optional. When absent, returns Messages from the beginning of the Transcript. |
| `limit` | integer | Optional. 1–500. Default `200`. |

## Output

**Success:**

```
{
  meetingId: MeetingId,
  status: 'active' | 'ended',
  messages: Message[],              // same shape as in get-response
  nextCursor: Cursor,
  hasMore: boolean
}
```

**Failure:** See *Errors*.

## Flow

1. Validate Input.
2. `MeetingStorePort.loadMeeting(meetingId)`. If absent → `MeetingNotFound`.
3. `MeetingStorePort.readMessagesSince({ meetingId, cursor, limit })`.
4. Return the page along with the Meeting's current `status`.

## Errors

| Error | When | MCP code |
|-------|------|----------|
| `InvalidInput` | Schema violation. | `invalid_params` |
| `MeetingNotFound` | `meetingId` unknown. | `not_found` |
| `CursorInvalid` | Cursor malformed or foreign. | `invalid_params` |
| `StoreUnavailable` | Store error. | `internal_error` |

## Side Effects

None.

## Rules

- `get_transcript` is strictly a read. It never waits for new events — callers that need blocking behaviour use [get-response](./get-response.usecase.md) with `waitMs`.
- The delivered `messages` include `speech`, `pass`, and `system` kinds. Internal Events (round-started, round-completed) are not exposed.
- Ordering is strictly ascending by `seq`.
- This tool is safe to call on ended Meetings — the Transcript remains readable indefinitely (for `FileStore`) or until the process exits (for `InMemoryStore`).
