# Use Case: list-meetings-cli

## Actor

Human Operator invoking the `veche list` CLI command from a terminal.

## Input

Positional: none. Flags:

| Flag | Type | Validation |
|------|------|------------|
| `--status` | `active` \| `ended` \| `all` | Optional. Default `active`. |
| `--limit` | integer | Optional. 1–100. Default `50`. |
| `--format` | `text` \| `json` | Optional. Default `text`. |
| `--no-color` | boolean | Optional. Suppresses ANSI colors in `text` format. Implicit when stdout is not a TTY. |
| `--home` | absolute path | Optional. Override for `$VECHE_HOME`. Useful for inspecting a copy of the event log. |

## Output

**Success (`text`)** — written to stdout, one row per Meeting, aligned columns:

```
MEETING-ID                            TITLE                 STATUS   CREATED (UTC)        MEMBERS  OPEN JOBS
3f0e…e6c4  Decide argparse vs click    active   2026-04-24T23:12:01  2        1
…
```

- Column widths adapt to contents; `TITLE` truncates with `…` at 32 chars.
- When stdout is a TTY and `--no-color` is absent, `STATUS` is colored (`active` green, `ended` grey) and `OPEN JOBS > 0` is bold.
- Trailing footer line: `N meetings shown (filter: status=<status>)`.

**Success (`json`)** — written to stdout, a single pretty-printed JSON object matching the `ListMeetingsResult` contract in [persistence](../persistence/persistence.md). Key order is stable (`{ summaries, nextCursor }`), summaries sorted newest-first.

Exit code `0`.

**Failure:** See *Errors*.

## Flow

1. Parse argv. Reject unknown flags with exit code `64` (EX_USAGE) and a one-line usage summary on stderr.
2. Call `loadConfig()` to resolve `$VECHE_HOME` (override honoured if `--home` is set).
3. Instantiate `FileMeetingStore` pointed at that root. Do not write anything.
4. Normalise `status`: `all` maps to no filter at the port level; otherwise passes through.
5. Call `MeetingStorePort.listMeetings({ status, limit, cursor: undefined })`.
6. If the page is empty and the filter was the default (`active`), print a one-line hint to stderr — `no active meetings; try --status all`. Still exit `0`.
7. Hand the result to the selected renderer (`text` or `json`), write to stdout.
8. Exit `0`.

## Errors

| Error | When | Exit code | Stream |
|-------|------|-----------|--------|
| `UsageError` | Unknown flag, bad value (`--limit 0`, `--status foo`). | `64` | stderr |
| `StoreUnavailable` | `$VECHE_HOME` missing, unreadable, or contains a corrupt event log. | `2` | stderr |
| `InternalError` | Any other unhandled exception; the CLI prints `error: <message>` and the stack only when `VECHE_LOG_LEVEL=debug`. | `1` | stderr |

Errors never emit partial or malformed stdout — on failure, stdout is empty.

## Side Effects

- Reads from `$VECHE_HOME`. Never writes, never holds a lock.
- May write an advisory note to stderr (see step 6).

## Rules

- **Read-only.** The CLI never takes the append lock; it is safe to run alongside a live `veche-server`.
- **Deterministic sort.** Summaries sorted by `createdAt` descending, ties broken by `meetingId` ascending (matches the port contract).
- **No secrets.** `env` fields on Participants are never printed — neither in `text` nor `json` output. The `listMeetings` port result already omits `env` from `MeetingSummary`, so this is enforced by the port shape; the CLI MUST NOT widen it.
- **No pagination in v1.** `--limit` caps the single-page fetch; pagination via cursor is not exposed in the CLI. Operators needing more than 100 meetings use `--format json | jq` on repeated invocations with shifted `createdBefore` — documented in README, not in the CLI itself.
- **Stable `json` key order.** The `json` format is meant for diffing and piping; key order is `{ summaries: [...], nextCursor }` with each summary's keys in the order declared by the port.
- **Color detection.** `process.stdout.isTTY` AND `!process.env.NO_COLOR` AND `!--no-color` → colors on. Matches the `NO_COLOR` convention (no-color.org).
