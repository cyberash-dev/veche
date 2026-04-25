# Feature: web-viewer

## Purpose

Give the Human Operator a live, browser-based view of every Meeting under `$VECHE_HOME`: a sidebar of all Meetings that updates as new ones are created or change status, and a transcript pane that updates as Messages are appended. The Operator can switch between Meetings without restarting anything. The viewer is a second read-only inbound adapter (alongside the existing `list` and `show` CLI commands) and runs as its own process — independent of any `veche-server` (MCP) process writing to the same store.

This slice does NOT add a new MCP tool, does NOT introduce a new transport for the Orchestrator Agent, and does NOT modify the event log model. It is purely a new surface over the existing `MeetingStorePort` queries.

## Domain Entities

This slice introduces no new domain entities. It consumes existing types from the [meeting](../meeting/meeting.md) and [persistence](../persistence/persistence.md) slices:

- `Meeting`, `Participant`, `Message`, `Job` — see [meeting](../meeting/meeting.md).
- `MeetingSummary`, `MeetingSnapshot`, `MessagePage`, `Cursor` — see [persistence](../persistence/persistence.md).

## Ports

### MeetingStorePort

Documented in [persistence](../persistence/persistence.md). This feature uses a strict subset — read-only methods only:

| Method | Purpose |
|--------|---------|
| `listMeetings(filter)` | Power the sidebar list and detect new Meetings via diff polling. |
| `loadMeeting(meetingId)` | Power the transcript header (meeting metadata, participants, open jobs, lastSeq). |
| `readMessagesSince(meetingId, cursor, limit)` | Page the transcript and feed live deltas via diff polling. |
| `readAllEvents(meetingId)` | Optional. Used when the sidebar/transcript needs the full event stream (debug surface; not in v1). |

The viewer MUST NOT call `createMeeting`, `appendMessage`, `appendSystemEvent`, `markParticipantDropped`, `createJob`, `updateJob`, `endMeeting`, or `watchNewEvents`. The first six are write methods (forbidden by the read-only invariant); `watchNewEvents` is rejected because it is an in-process notification primitive — it cannot observe writes performed by a different process (e.g. the MCP server). See *Cross-process change detection* under [watch-server](./watch-server.usecase.md).

### ClockPort

| Method | Input | Output |
|--------|-------|--------|
| `now` | — | `Instant` |

Used to stamp the SPA generator footer and SSE `event: error` payloads.

## Use Cases

### Web viewer (Human Operator)

Run-on demand server that renders the dialog of every Meeting in real time.

- [watch-server](./watch-server.usecase.md) — Start a local HTTP server that serves a self-contained SPA and two SSE channels (one for the Meeting list, one per selected Meeting transcript).

The slice has a single use case in v1. Additional surfaces (e.g. a live filter / search, a hosted multi-user mode with auth) require their own use case file under this slice and a corresponding update to *Key Decisions* in [system.md](../../system.md).

## Dependencies

- [meeting](../meeting/meeting.md) — consumed via `MeetingStorePort.loadMeeting` for the transcript header.
- [persistence](../persistence/persistence.md) — owns `MeetingStorePort`. The viewer is bound to the same `FileMeetingStore` instance type the CLI uses (`bin/veche.ts`).

## Invariants

- **Read-only against the store.** Same invariant as the [meeting / list-meetings-cli](../meeting/list-meetings-cli.usecase.md) and [show-meeting-cli](../meeting/show-meeting-cli.usecase.md) use cases. Tested by injecting a mock store whose write methods throw and asserting the viewer never trips them.
- **Loopback-only by default.** The HTTP server binds to `127.0.0.1`. Exposing it on another interface requires an explicit `--host` flag and is out of scope for v1's threat model (no auth).
- **No new npm dependencies.** The viewer uses only Node built-ins (`node:http`, `node:crypto`, `node:url`) on the server side and only browser built-ins (`EventSource`, `fetch`, the DOM) on the client side. The SPA is a single self-contained HTML document with one inline `<script>` and one inline `<style>` block.
- **No remote network references in the SPA.** No `<script src="http…">`, no `<link rel="stylesheet">`, no `<img src="http…">`, no web fonts. The same regex probe used by the static HTML report (`renderers/html.ts`) applies, with one allowance: exactly one inline `<script>` block is permitted (the SPA needs JS to consume SSE).
- **Cross-process safe.** Multiple `veche watch` processes against the same `$VECHE_HOME` are safe because the store is read-only. A concurrent `veche-server` writing to the store is safe because reads use only `readMessagesSince` / `loadMeeting` / `listMeetings`, none of which acquire the append lock.
- **Cross-process change detection uses polling, never `watchNewEvents`.** See [watch-server](./watch-server.usecase.md) → *Cross-process change detection*.
- **HTML escaping is mandatory.** All strings originating from messages, participant ids, titles, error text MUST pass through an HTML escaper before reaching the DOM. Server-side: when the SPA is rendered, and when speech-message `htmlBody` is built via the shared escape-then-transform Markdown converter (`src/shared/markdown.ts`). Client-side: SSE payloads are interpolated into nodes via `textContent` / attribute setters, with one explicit exception — `Message.htmlBody` of `speech` messages is assigned via `innerHTML` because the server already converted the raw `text` through the safe pipeline. See [watch-server](./watch-server.usecase.md) → *Markdown rendering*.
