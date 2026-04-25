# Use Case: watch-server

## Actor

Human Operator invoking the `ai-meeting watch` CLI command from a terminal. The command starts a long-lived local HTTP server that serves a self-contained SPA and two Server-Sent Events (SSE) channels. The Operator interacts with the server through a web browser (auto-opened on start) until the process is interrupted (Ctrl-C / SIGTERM).

## Input

Positional: none.

Flags:

| Flag | Type | Validation |
|------|------|------------|
| `--port` | integer 0..65535 | Optional. Default `0` (kernel-assigned ephemeral port). The chosen port is printed to stderr after `listen` succeeds. |
| `--host` | host string | Optional. Default `127.0.0.1`. Accepts any value `node:http`'s `server.listen({ host })` accepts. Binding to a non-loopback address requires the operator to set this explicitly — a warning is printed to stderr (see *Rules*). |
| `--no-open` | boolean | Optional. Suppresses the auto-open browser step. The URL is still printed to stderr. Implicit when stdout is not a TTY or when the platform opener is unavailable. |
| `--no-color` | boolean | Optional. Disables ANSI colors in the stderr log lines (URL banner, lifecycle messages). Implicit when stderr is not a TTY or when `NO_COLOR` is set. |
| `--home` | absolute path | Optional. Override for `$AI_MEETING_HOME`. Same semantics as in [show-meeting-cli](../meeting/show-meeting-cli.usecase.md). |

## Output

The command produces no stdout output during normal operation. All operator-visible output is on stderr:

- On `listen` success: a single banner line `listening on http://<host>:<port>/  (Ctrl-C to stop)`.
- On opener spawn (when `--no-open` is absent and a platform opener is found): `opened http://<host>:<port>/`. On opener failure: `opener failed; URL is http://<host>:<port>/`.
- On graceful shutdown (SIGINT / SIGTERM): `shutting down…` followed by `bye.`
- On non-fatal store-poll errors (cross-process race, transient I/O): `warn: store poll failed: <message>` at most once per minute (rate-limited).

The HTTP server's payload contracts are documented under *HTTP API* below.

Exit code `0` on graceful shutdown.

## HTTP API

```
GET  /                                         → 200 text/html        (SPA)
GET  /api/meetings?status=…                    → 200 application/json { summaries: MeetingSummary[] }
GET  /api/meetings/:id                         → 200 application/json { meeting, participants, openJobs, lastSeq }
GET  /api/meetings/:id/messages?cursor=&limit= → 200 application/json { messages, nextCursor, hasMore }
GET  /api/stream                               → 200 text/event-stream (Meeting list channel)
GET  /api/stream/:id                           → 200 text/event-stream (transcript channel)
*                                              → 404 application/json { error: "not found" }
```

Common response rules:

- All JSON responses are UTF-8 encoded with `Content-Type: application/json; charset=utf-8` and pretty-printed with 2-space indentation.
- All SSE responses set `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- All responses include `X-Content-Type-Options: nosniff`.
- The server emits no `Access-Control-Allow-*` headers — it is a single-origin loopback service. Cross-origin requests from a browser are blocked by the same-origin policy by design.

### `GET /` — SPA

Serves the generated HTML document. The body shape is described under *SPA structure* below. Cached on the client only via the SSE channels' `Last-Event-ID` mechanism — the document itself is sent with `Cache-Control: no-cache` so a fresh viewer always gets the current schema.

### `GET /api/meetings`

Query parameters:

| Param | Values | Default | Effect |
|-------|--------|---------|--------|
| `status` | `active` \| `ended` \| `all` | `all` | Forwarded to `MeetingStorePort.listMeetings({ status?: … })`. `all` omits the filter. |
| `limit` | integer 1..200 | `100` | Forwarded to `listMeetings`. The server caps at 200 regardless of the request. |
| `cursor` | opaque string | absent | Round-tripped from a previous `nextCursor`. |

Response: `{ "summaries": MeetingSummary[], "nextCursor": string | null }`. Each summary uses the [`MeetingSummary` shape from persistence](../persistence/persistence.md) — branded ids serialized as plain strings, `Instant` values as ISO-8601 strings.

### `GET /api/meetings/:id`

Path parameter:

| Param | Validation |
|-------|------------|
| `:id` | non-empty string accepted by `asMeetingId`. Lookup against the store. |

Response: `{ meeting, participants, openJobs, lastSeq }`. All four fields come straight from `MeetingStorePort.loadMeeting`. Errors:

- Unknown id → `404 application/json { "error": "meeting not found", "meetingId": "<id>" }`.
- Store unavailable / corrupt → `500 application/json { "error": "store unavailable" }` (see [persistence](../persistence/persistence.md) for the underlying error contract).

### `GET /api/meetings/:id/messages`

Query parameters:

| Param | Values | Default | Effect |
|-------|--------|---------|--------|
| `cursor` | opaque string | absent | Forwarded to `readMessagesSince`. |
| `limit` | integer 1..500 | `200` | Capped at 500 server-side. |

Response: a direct projection of `MessagePage` — `{ "messages": Message[], "nextCursor": string, "hasMore": boolean }`. Used by the SPA only as a fallback if the SSE stream cannot establish; in normal operation the SSE channel covers both initial snapshot and deltas.

### `GET /api/stream` — Meeting list channel

A long-lived SSE stream that delivers the current sidebar state and announces every change.

Events:

| `event:` | Payload | When |
|----------|---------|------|
| `hello` | `{ summaries: MeetingSummary[] }` | First frame after connect. Always full snapshot. |
| `meeting.added` | `{ summary: MeetingSummary }` | A meeting id appeared that was not in the previous diff snapshot. |
| `meeting.updated` | `{ summary: MeetingSummary }` | A previously-seen meeting changed `status` (`active → ended`), `lastSeq`, or `openJobCount`. Other field changes do not emit an event. |
| `error` | `{ code: string, message: string }` | Unrecoverable poll error. Followed by `close()`. |

Each delta event carries an `id:` line equal to the maximum `lastSeq` observed across the snapshot at emission time (string form). On reconnect, `EventSource` sends `Last-Event-ID`; the server uses it only as a hint that the client has already seen events up to that snapshot generation — the server still emits a fresh `hello` because list state is not append-only and a delta replay is not meaningful.

Heartbeat: `:keepalive\n\n` every 15 seconds when no other event has been emitted in that window. Keepalives are SSE comment lines (no event name, no payload) and are silently swallowed by the `EventSource` API.

`meeting.removed` is not emitted in v1. The store does not delete meetings; nothing in the store can transition out of the sidebar.

### `GET /api/stream/:id` — Transcript channel

A long-lived SSE stream that delivers the transcript of one Meeting.

Path parameter: `:id` — same validation as `/api/meetings/:id`.

Events:

| `event:` | Payload | When |
|----------|---------|------|
| `hello` | `{ meeting, participants, openJobs, lastSeq, messages: Message[] }` | First frame after connect. The server pages `readMessagesSince(meetingId, undefined, 500)` until `hasMore === false` and packs the full transcript into the snapshot. The snapshot's `lastSeq` is the maximum message `seq` observed (or `-1` for an empty transcript). |
| `message.posted` | `{ message: Message }` | A new `speech`/`pass`/`system` message appeared with `seq > lastEmitted`. The event's `id:` is the message's `seq`. |
| `meeting.updated` | `{ summary: MeetingSummary }` | The meeting's own summary changed (status flip, openJobCount, lastSeq). Lets the SPA update the transcript header without resubscribing. |
| `error` | `{ code: string, message: string }` | Unknown id (404 for the channel — emitted before close), unrecoverable poll error. Followed by `close()`. |

`Last-Event-ID` resume on this channel is honoured: the server treats the header value as the seq of the last `message.posted` the client received and resumes by passing the corresponding cursor into `readMessagesSince`. The fresh `hello` frame is replaced by a `hello` whose `messages` array is empty and whose `lastSeq` matches the resumed seq, so the client does not duplicate already-rendered messages. A malformed `Last-Event-ID` (non-integer, negative, or larger than the current `lastSeq`) is ignored and the server falls back to the full-snapshot path.

### `404` payload

Anything outside the table above produces `404 application/json { "error": "not found" }`. The server MUST NOT serve files from disk other than the SPA document; in particular, no `..`-traversal is reachable because there is no path-to-file resolution.

## Flow

1. Parse argv. Reject unknown flags / invalid values with exit code `64` on stderr.
   - `--port` outside `0..65535` → `64`.
   - `--port` non-integer → `64`.
   - `--host` empty → `64`.
2. Call `loadConfig()` to resolve `$AI_MEETING_HOME` (override from `--home` honoured).
3. Instantiate `FileMeetingStore` pointed at that root.
4. Instantiate `WatchServer({ store, clock, logger, host, port })` and call `start()`.
   - 4a. `EADDRINUSE` / any other `listen` error → stderr `failed to bind <host>:<port>: <message>`, exit code `2`.
5. Print the listening banner to stderr. If the bound host is non-loopback, also print the warning described in *Rules*.
6. Unless `--no-open`, resolve a platform opener and spawn it with the URL. On failure, fall through with the `opener failed` line; the server keeps running.
7. Install SIGINT and SIGTERM handlers that call `WatchServer.stop()` and resolve the main promise. The signals are listened for once each — a second SIGINT bypasses graceful shutdown via Node's default behavior.
8. Idle until the main promise resolves. Print the shutdown banner. Exit `0`.

The HTTP request lifecycle inside `WatchServer`:

1. Method/URL routing per the *HTTP API* table. Unknown route → 404.
2. For SSE handlers, immediately write status + headers and send the `hello` frame. From this point the connection is held open and a 750 ms polling loop emits deltas until either (a) the client disconnects (`req.on('close')` fires) or (b) the loop encounters an unrecoverable store error and emits `error` + `close()`.
3. For JSON handlers, run the store query, serialize the result, write status + headers + body, end the response.
4. On uncaught handler exception: log to stderr, respond `500 application/json { "error": "internal" }` if the response has not started yet; otherwise close the SSE channel with `error`.

## Cross-process change detection

The watch server is a separate process from the `ai-meeting-server` (MCP) process that writes to the store. `MeetingStorePort.watchNewEvents` is implemented as an in-process, in-memory watcher set; it does NOT observe writes performed by another process. Therefore the watch server MUST NOT call `watchNewEvents`. Instead, every active SSE channel runs a polling loop:

- **Cadence**: 750 ms between successive polls per channel. This is the smallest interval that comfortably outperforms typical agent turn pacing without saturating the filesystem on macOS / Linux when many channels are open.
- **What is polled**:
  - List channel: `listMeetings({ status: undefined, limit: 200 })`. The server diffs the result against the previous snapshot using `meetingId` as the key and emits `meeting.added` / `meeting.updated` per *Diff rules* below.
  - Transcript channel: `readMessagesSince({ meetingId, cursor: <last>, limit: 200 })` in a drain loop until `hasMore === false`, advancing `cursor` between calls. After the drain, also fetch a refreshed `MeetingSummary` from `listMeetings({ status: undefined, limit: 1, … })` keyed by id (or via a cheap secondary read of `loadMeeting`) and emit `meeting.updated` if it changed.
- **Backoff**: on any thrown error from the store, the next sleep is doubled up to a cap of 8 s. The next successful poll resets the backoff to 750 ms.
- **Stop conditions**: `req.on('close')` aborts the channel's `AbortController`; the loop drops out, `clearInterval`/`clearTimeout` runs, and the server forgets the channel from its `Set<SseChannel>`. `WatchServer.stop()` aborts every channel before closing the listener.

`fs.watch` and `fs.watchFile` are explicitly NOT used: their cross-platform behaviour (case sensitivity on macOS, recursive directory semantics on Linux, file-handle reuse on Windows) adds more code and platform branches than the polling loop, with no observable end-to-end latency win at this cadence.

### Diff rules

Two `MeetingSummary` snapshots `prev` and `next` (both keyed by `meetingId`):

- For each `meetingId` in `next` not in `prev`: emit `meeting.added`.
- For each `meetingId` in both: emit `meeting.updated` IFF the tuple `(status, lastSeq, openJobCount)` differs.
- For each `meetingId` in `prev` not in `next`: ignored. (Sidebar entries are append-only in v1; this case occurs only when the store rotates / drops data outside the spec — out of scope.)
- Emission order: `meeting.added` first (sorted by `createdAt` ascending), then `meeting.updated` (sorted by `meetingId` ascending). Order within a single poll is deterministic so SPA tests can snap.

The `lastEventId` cursor for the list channel is the max `lastSeq` across the emitted snapshot, encoded as a decimal string. It is informational — `Last-Event-ID` resume on this channel always emits a fresh `hello`.

## SPA structure

`GET /` returns one self-contained HTML5 document. The document MUST satisfy:

- Exactly one inline `<script>` block. No `<script src=…>`. No `<link rel="stylesheet">`, no `<style src=…>`. No `<img src="http…">`. No web fonts. No favicons referencing remote URLs (a small inline SVG `<link rel="icon" href="data:image/svg+xml,…">` is allowed).
- Exactly one inline `<style>` block.
- Store-derived strings reach the DOM via `textContent` or attribute setters, **except** for `Message.htmlBody` of `speech` messages — those are assigned via `innerHTML` because the server-side escape-then-transform Markdown converter (see *Markdown rendering* below) makes raw-HTML injection impossible. No other field uses `innerHTML`. The static skeleton emitted by the server contains no interpolation of dynamic data.

Layout (CSS Grid, two columns):

- Left column: sidebar with the Meeting list. Each card shows a status dot (green for `active`, grey for `ended`), the truncated title (≤ 32 chars), a second line `<idPrefix>… · Nm · Jj` (member count, open-job count), and a fade-in animation for newly-added cards. The currently-selected card has a left-border accent. A non-selected card that receives a `message.posted` event shows a small unread badge with a 700 ms pulse animation; the badge is cleared when the user clicks the card.
- Right column: transcript pane. Header shows the meeting title, id, status pill, created/ended timestamps, and participants. Body is a vertical stack of round dividers and chat bubbles. Bubbles use the same deterministic palette as `renderers/html.ts` — `hue = sha1(participantId)[0..3] % 360`, `saturation = 60%`, `lightness = 86%`, facilitator neutral `#ededed`. Member bubbles alternate left/right by member index; the facilitator's opening bubble is centered full-width. `pass` renders as a small grey pill `passed`; `system` renders as a centered `⚠` divider with the incident text.
- A toggle pinned to the top-right of the transcript pane: `auto-scroll on/off`. Default `on`. With `on`, the transcript scrolls to the bottom whenever a new `message.posted` is appended; with `off`, the scroll position is preserved.

Rounds are NOT collapsible (`<details>` would conflict with live appends). The transcript renders all rounds inline with `── Round N ──` separator rows.

The SPA receives initial state and deltas via two `EventSource` subscriptions:

1. On load: open `EventSource('/api/stream')`. Render sidebar from `hello`. Append cards on `meeting.added`; update existing card content on `meeting.updated`.
2. On click of a sidebar card: close the current `EventSource('/api/stream/:id')` if any, open a new one for the clicked meeting. Render header + transcript from `hello`. Append bubbles on `message.posted`. Update the header on `meeting.updated`.

The SPA performs no `fetch()` calls in v1. The SSE channels carry both bootstrap and deltas. The JSON endpoints are documented for tooling and tests, not consumed by the SPA itself.

### Markdown rendering — parity with `show --format=html`

Speech-bubble bodies render the **same Markdown subset and inline-HTML allowlist** as the static report produced by [show-meeting-cli](../meeting/show-meeting-cli.usecase.md) → *Markdown rendering*. That subset (bold, italic, inline code, fenced code blocks with `lang-…` class, h1–h3, ordered/unordered lists, blockquotes, horizontal rules, GFM tables, links restricted to `https?:` / `mailto:`) is the single source of truth; the watch viewer references that table verbatim and does NOT add or drop transforms.

Conversion happens **server-side**, not in the browser, so the same converter that backs `show --format=html` is reused. Concretely:

- Every `Message` with `kind === "speech"` carries an additional field `htmlBody: string` in its `MessageDto` payload (over both REST and SSE). `htmlBody` is the result of running the shared escape-then-transform Markdown pipeline against the message's `text`. It is `null` for `pass` and `system` messages.
- The pipeline lives in a single source-of-truth module (`src/shared/markdown.ts`). Both the static HTML renderer (`src/adapters/inbound/cli/renderers/helpers.ts`) and the watch server's DTO mapper consume it. There is no second implementation in the SPA.
- The SPA assigns `htmlBody` to the bubble body via `element.innerHTML = message.htmlBody`. This is safe because the converter is **escape-then-transform**: every character of the source text is HTML-escaped first, then the small in-tree converter introduces a fixed allowlist of tags it produces itself. Raw HTML in agent text is therefore impossible — the converter only adds tags it produces. Pre-existing tests in `renderers.test.ts` enforce this property and remain authoritative.
- `pass` bodies remain a non-Markdown grey pill `<author> passed`. `system` bodies remain plain `⚠ <text>` set via `textContent` (Markdown is NOT applied to system events).
- The bubble container uses `white-space: normal`; block-level Markdown elements (`<p>`, `<pre>`, `<ul>`, etc.) handle their own whitespace, matching the HTML report.

This ties the watch viewer to the static HTML report as a single rendering contract: a user can open `ai-meeting show <id> --format=html` while a meeting is live in the watch viewer and see byte-identical bubble bodies (modulo color rounding).

## Errors

| Error | When | Exit code | Stream |
|-------|------|-----------|--------|
| `UsageError` | Unknown flag, invalid `--port`, empty `--host`, contradictory flag combo. | `64` | stderr |
| `BindFailed` | `server.listen` rejected (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`, …). | `2` | stderr (`failed to bind <host>:<port>: <message>`) |
| `StoreUnavailable` | `loadConfig` failed, `$AI_MEETING_HOME` unreadable, or the first store call after `start()` threw. | `2` | stderr |
| `OpenerUnavailable` | `--no-open` absent, no platform opener available. | `0` (warn only) | stderr (`opener failed; URL is …`) |
| `InternalError` | Any unhandled exception in a request handler. | `0` (continues serving) | 500 to client; stderr log |

Per-channel SSE errors do NOT affect the exit code. They close the affected stream with `event: error`; the client's `EventSource` reconnects automatically.

## Side Effects

- Reads `$AI_MEETING_HOME/meetings/<meetingId>/events.jsonl` and per-meeting `manifest.json` files via `MeetingStorePort`. No writes.
- Binds a TCP listener on `<host>:<port>` until shutdown.
- With opener spawn enabled and a platform opener available, spawns a detached child process: `open <url>` (macOS), `xdg-open <url>` (Linux), `cmd.exe /c start "" <url>` (Windows). The child is detached and not awaited.
- Logs JSON lines to stderr (using the same `StructuredLogger` instance as the rest of the CLI). No log goes to stdout.

## Rules

- **Read-only against the store.** The viewer MUST NOT call `createMeeting`, `appendMessage`, `appendSystemEvent`, `markParticipantDropped`, `createJob`, `updateJob`, or `endMeeting`. The integration test injects a mock store that throws on these methods and asserts no SSE channel or JSON handler trips them.
- **No use of `watchNewEvents`.** Cross-process notification is incorrect with that primitive (see *Cross-process change detection*). Reviewers should reject any PR that wires `watchNewEvents` into the watch path.
- **Loopback-only by default.** When `--host` is unspecified, the server binds `127.0.0.1`. When the operator passes a non-loopback `--host`, the server prints `warn: binding to <host>; this exposes the unauthenticated viewer beyond loopback` to stderr and continues. v1 has no auth — exposing the port wider is the operator's explicit choice.
- **DNS rebind guard.** When the bound address is loopback (`127.0.0.0/8`, `::1`), every HTTP request is rejected with `421 application/json { "error": "wrong host" }` unless its `Host:` header is `localhost`, `localhost:<port>`, `127.0.0.1`, `127.0.0.1:<port>`, `[::1]`, or `[::1]:<port>`. This blocks DNS-rebind attacks against a browser tab on the same machine. When the operator binds to a non-loopback address, the guard is disabled (the operator has already accepted the threat model).
- **No CORS.** The server emits no `Access-Control-Allow-*` headers. The SPA is served from the same origin it queries — cross-origin browsers cannot read the responses.
- **No new npm dependencies.** The server uses `node:http`, `node:url`, `node:crypto`, `node:child_process` (for the opener only). The SPA uses `EventSource`, the DOM, and built-in CSS — no bundler, no framework. Extending the SPA with a JS framework requires its own spec PR.
- **Atomic SPA emission.** The SPA HTML is built once at server startup (or lazily on first `GET /`) and reused for every request. Its content is a pure function of the build version + a fixed CSS palette; no per-request interpolation that could allow header / cookie injection.
- **Deterministic participant colours.** Same SHA-1→HSL function as `renderers/html.ts` (`hue = sha1(participantId)[0..3] % 360`, saturation 60%, lightness 86%, facilitator neutral). The SPA implements it client-side so colors line up with the static HTML report a user might open via `ai-meeting show --format=html`.
- **Exit codes are part of the contract.** `0` graceful · `2` bind / store error · `64` usage error. (`1` and `3` are not used by `watch` because it does not look up a single meeting at startup.) `cli.integration.test.ts` exercises `0` (SIGINT path) and `64` (bad `--port`); a unit test asserts `2` on synthetic `EADDRINUSE`.
- **Polling cadence is not user-tunable.** `WATCH_POLL_MS = 750` is a constant in the implementation. If a future ticket needs per-deployment tuning, that ticket adds a flag *and* updates this spec.
- **Backpressure.** SSE writes go through `res.write(...)`. If the client TCP buffer is full, the loop awaits the `drain` event before issuing the next write. Server poll continues (state is buffered as a single "pending event" pointer per channel — only the latest snapshot per type is delivered after a long pause; intermediate `meeting.updated` ticks may coalesce). `message.posted` events are NOT coalesced — each message is delivered exactly once.
- **Headers contain no secrets.** No env-derived values, no auth tokens, no `$AI_MEETING_HOME` path. The SPA itself contains the build version and nothing else.
