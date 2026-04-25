# Use Case: file-store

## Actor

Internal — `FileMeetingStore` implements `MeetingStorePort` against the local filesystem. Default adapter when `VECHE_STORE=file`.

## Input

Every `MeetingStorePort` method (see [persistence](./persistence.md)).

## Output

Port-conformant responses backed by JSONL files on disk.

## Flow

### On-disk layout

Root directory is `${VECHE_HOME}` (default `${HOME}/.veche`). The adapter creates it on first use with mode `0700`.

```
${VECHE_HOME}/
├── config.json                                   # user config (Profiles). Read-only to the adapter.
├── meetings/
│   └── <meetingId>/
│       ├── manifest.json                         # denormalised Meeting aggregate (status, title, participants, jobs index)
│       └── events.jsonl                          # append-only Event log, one JSON per line
└── jobs/                                         # secondary index for O(1) loadJob
    └── <jobId>.json                              # { meetingId, jobId } pointer
```

- `manifest.json` is a **derived** snapshot. It is rewritten after every state transition (job status change, participant drop, meeting end). Crash recovery rebuilds it by folding `events.jsonl`.
- `events.jsonl` is the authoritative source. Every writable operation appends exactly one line before updating `manifest.json`.

### Line format (`events.jsonl`)

Each line is a UTF-8 JSON object followed by `\n`:

```
{"seq":0,"type":"meeting.created","at":"2026-04-24T20:30:00.000Z","payload":{...}}
{"seq":1,"type":"participant.joined","at":"...","payload":{...}}
{"seq":2,"type":"job.started","at":"...","payload":{...}}
{"seq":3,"type":"message.posted","at":"...","payload":{...}}
...
```

- `seq` is monotonic per Meeting starting from 0. The adapter computes it from the current file length: on startup (or when the Meeting is first touched in-process), it scans the last line to recover `lastSeq`.
- `payload` shape is documented in [persistence](./persistence.md)'s Event table.

### Write path

1. Acquire the in-memory lock for the Meeting (`Mutex<MeetingId>`).
2. Open `events.jsonl` with `O_APPEND | O_CREAT | O_WRONLY` (`fs.promises.open(path, 'a')`).
3. Compose the event object including `seq = cachedLastSeq + 1`.
4. Stringify to JSON + `\n`. `write(buf)`.
5. `fsync` the file descriptor. Close.
6. Update `cachedLastSeq`.
7. Rewrite `manifest.json` atomically:
   - 7a. Write to `manifest.json.tmp`.
   - 7b. `fsync` the tmp file.
   - 7c. `rename` over `manifest.json` (atomic on POSIX).
8. Resolve any watchers for this Meeting.

For `createJob`: additionally write `jobs/<jobId>.json` using the same atomic tmp-then-rename dance *before* step 7.

For `endMeeting`: the `meeting.ended` event is appended; `manifest.status` becomes `ended`; subsequent writes are rejected.

### Read path

- `loadMeeting`:
  - 1. Read `manifest.json` if present and non-empty.
  - 2. If absent or malformed → rebuild by folding `events.jsonl` (cold path).
- `loadJob`:
  - 1. Read `jobs/<jobId>.json`. If missing → `JobNotFound`.
  - 2. Read that Meeting's `manifest.json` and extract the Job record.
- `readMessagesSince`:
  - 1. Decode cursor. Cursor is `{ seq: integer, byteOffset: integer }` base64-encoded.
  - 2. Open `events.jsonl` read-only.
  - 3. If `byteOffset` is valid and the file byte at that offset starts a JSON line, seek there; otherwise scan from the beginning (self-healing).
  - 4. Iterate lines, filter `type === 'message.posted'`, collect up to `limit`.
  - 5. Construct `nextCursor = { seq, byteOffset: position-after-last-scanned-line }`.
- `listMeetings`:
  - 1. `readdir('meetings/')`.
  - 2. Read each `manifest.json` (skip entries that fail to parse; emit a `warn` log).
  - 3. Filter and sort as in the in-memory adapter.
  - 4. Paginate via an in-memory slice of the sorted list (cursor carries sort key).

### Watcher / `watchNewEvents`

- Backed by `fs.watch` on `events.jsonl`. On every change event, the adapter re-reads the tail and resolves watchers whose cursor has been passed.
- A safety poll runs at `1 second` cadence to cover missed `fs.watch` notifications (some filesystems coalesce).

### Cursor encoding

```
base64url(JSON.stringify({ seq: number, byteOffset: number }))
```

`byteOffset` is advisory. Implementations MUST fall back to a byte-position scan when the cached offset does not land on a line start.

## Errors

As per [persistence](./persistence.md), plus file-system mappings:

| Underlying error | Mapped to |
|------------------|-----------|
| `ENOENT` on `events.jsonl` for a declared Meeting | `MeetingNotFound` (only if the directory is also missing — otherwise surface as `StoreUnavailable`). |
| `EACCES` | `StoreUnavailable`. |
| `ENOSPC` | `StoreUnavailable` with `code: 'fs-no-space'`. |
| Malformed JSON line | `StoreUnavailable` with `code: 'fs-corrupt-log'`. The server logs the offending line index and aborts the current operation. |

## Side Effects

- Creates and appends to files under `${VECHE_HOME}`.
- Creates `meetings/<id>/` directories with mode `0700`.
- Never deletes anything. Operators prune manually.

## Rules

- **Append-only events file.** Rewriting or truncating `events.jsonl` outside of this store is unsupported; the store detects a shrinking file on re-read and raises `StoreUnavailable { code: 'fs-log-regressed' }`.
- **Crash recovery.** On startup, each Meeting's `manifest.json` is regenerated from `events.jsonl` if missing, corrupt, or older than the last event timestamp.
- **Single-writer per process.** The application guarantees one running Job per Meeting, and the in-process Mutex guarantees one append at a time. Running two MCP servers against the same `${VECHE_HOME}` is explicitly unsupported; a file lockfile is NOT provided in v1.
- **`fsync` on every append.** Durability matters more than throughput — Meetings are small and slow by nature.
- **No event log rotation in v1.** A Meeting's `events.jsonl` grows unbounded. Operators pruning old Meetings delete the whole `meetings/<id>/` directory.
- **Atomic manifest updates.** Always tmp-then-rename. A reader that observes `manifest.json` always sees a complete snapshot.
- **Backwards compatibility.** Every event includes `type` and `payload`; new event types may be added in future versions; readers skip unknown types rather than failing.
- **Cursor ordering.** Cursors are total-ordered within a Meeting by `seq`. A cursor from Meeting A is never valid for Meeting B; cross-meeting use returns `CursorInvalid`.
