---
name: veche
description: Convene a symmetric committee meeting between the profiles declared in ~/.veche/config.json on a single question, then report each participant's stance and the consensus. Use when the user wants a second opinion, wants to stress-test a decision against another model, or asks to "hold a meeting" / "convene a committee" / "get the committee to discuss X".
trigger: /veche
---

# /veche

Stands up a short committee meeting via the `veche` MCP server:

- **Facilitator:** `facilitator` (this session — you are the orchestrator).
- **Members:** every Profile declared in `~/.veche/config.json` (or the subset selected via `--profiles`). All members are independent agents of equal standing — the skill does not assign coder/reviewer roles.
- **Rounds:** inherited from the server default unless the caller passes `--rounds N`. The server enforces the upper bound (`VECHE_MAX_ROUNDS_CAP`).
- **Per-turn timeout:** 120 seconds.

Drives the discussion to termination, reports the transcript grouped by member, and closes the meeting. Does NOT write files or run other commands — this is a reasoning tool.

## Arguments

```
/veche                                    # you must ask the user for the question
/veche <question>                         # runs on the supplied question
/veche --rounds N <question>              # override maxRounds; the server validates against VECHE_MAX_ROUNDS_CAP
/veche --title "<title>" <question>       # override meeting title
/veche --profiles a,b <question>          # restrict members to the named profiles (comma-separated)
```

Everything after flags is the question. If the user wrote `/veche` with no prompt, ask them one concise question ("What do you want the committee to decide?") via `AskUserQuestion`, then proceed.

## Preflight

1. Check that `mcp__veche__start_meeting` is available in this session. If not:

   > The `veche` MCP server is not connected. Make sure `veche` is present in `~/.claude.json` under `mcpServers` and that the Claude Code session was restarted after adding it.

2. Read `~/.veche/config.json` via the `Read` tool. Validate:
   - File exists and parses as JSON.
   - Top-level `profiles` is a non-empty array.
   - Each profile has a `name` matching `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$` (the participant-id regex enforced by `start_meeting`).
   - After applying `--profiles` (if present), at least one profile remains and at most 8 (server limit).

   If any check fails, stop and report the exact problem (missing file, parse error, empty roster, invalid name, out-of-range count, unknown profile in `--profiles`). Do not invent profiles or fall back to a hardcoded roster.

Do not fall back to asking Codex or another Claude instance directly — the whole point of this skill is the committee protocol. Stop and report.

## Flow

Execute in order. Do not skip steps.

### 1. Parse args

- If no positional args: use `AskUserQuestion` to collect `question` (single free-form field). Keep `title` = first 60 chars of the question and leave `rounds` unset.
- If `--rounds N`: parse a positive integer. Pass it through verbatim — the server validates against `VECHE_MAX_ROUNDS_CAP` and returns an error if it is out of range; surface that error to the user as-is rather than pre-filtering here.
- If `--title "..."`: use as meeting title. Otherwise derive from the question.
- If `--profiles a,b,c`: split on comma, trim, dedupe; every entry must exist in the config (case-sensitive). Otherwise the roster is every profile in the config in declared order.

### 2. Build the member roster

For each selected profile, build a Member entry:

```json
{
  "id": "<profile.name>",
  "profile": "<profile.name>"
}
```

That is the entire entry. Do **not** copy `adapter`, `model`, `systemPrompt`, `extraFlags`, or `env` into the call — the server resolves those from the named Profile. Do **not** rewrite or wrap the profile's `systemPrompt`; if the user wants different framing, they edit `~/.veche/config.json`. The Pass Signal (`<PASS/>`) instruction is appended by the server's dispatch-turn use case, not by this skill.

### 3. Start the meeting

Call `mcp__veche__start_meeting` with:

```json
{
  "title": "<title>",
  "facilitator": { "id": "facilitator" },
  "members": [ /* the roster from step 2 */ ]
}
```

If the user supplied `--rounds N`, add `"defaultMaxRounds": <N>`. Otherwise omit the field — the server applies its own default.

Capture `meetingId` and the initial `cursor`.

On error: stop and report the error code + message verbatim. Do not retry silently. Common cases worth surfacing as-is: `ProfileNotFound` (config drifted between read and call), `ProfileAdapterMismatch` (should not happen with this skill since we never set `adapter` — if it does, report it).

### 4. Send the question

Call `mcp__veche__send_message` with:

```json
{
  "meetingId": "<meetingId>",
  "text": "<question>",
  "turnTimeoutMs": 120000
}
```

If the user supplied `--rounds N`, add `"maxRounds": <N>`. Otherwise omit.

Capture `jobId` and the updated `cursor`.

### 5. Poll until terminal

Repeatedly call `mcp__veche__get_response` with:

```json
{
  "jobId": "<jobId>",
  "cursor": "<last cursor>",
  "limit": 200,
  "waitMs": 5000
}
```

After each response:

- Accumulate `messages[]` into an ordered list keyed by `seq`.
- Pass the returned `nextCursor` back into the next call verbatim — do not advance it yourself.
- Stop when `status` is `completed`, `failed`, or `cancelled`.
- After stop, drain: call `get_response` once with `waitMs: 0`; if `messages[].length > 0` append them and repeat until empty.

**Budget:** do not poll for more than 10 minutes wall-clock. If it drags, call `mcp__veche__cancel_job` with `reason: "skill-budget-exceeded"` and report a partial result.

### 6. Close the meeting

Call `mcp__veche__end_meeting` with:

```json
{ "meetingId": "<meetingId>", "cancelRunningJob": false }
```

If it raises `MeetingBusy`, the job didn't terminate despite step 5; retry with `cancelRunningJob: true` and note this in the final report.

### 7. Report to the user

Render **exactly** this structure (markdown). Keep it tight.

```
## Meeting: <title>
**Terminated:** <terminationReason> after N rounds · jobId=<jobId>

### <profile name 1>
<each speech from that member, in round order, joined by blank lines. Omit pass messages.>
<If dropped: "dropped: <reason>">

### <profile name 2>
<same>

… one section per member in roster order …

### Dropouts / system events
<any system messages (drops, cancellations). Omit section if empty.>

### Synthesis
<Your own 2-4 sentences summarising where the members agree, where they diverge, and your recommended call for the user. Treat them as peers — do NOT frame any one as proposer or reviewer; either may have introduced any given point. If they largely disagreed and you cannot pick, say so explicitly.>
```

End the report with one line pointing at the persisted transcript:

```
> Full transcript: `veche show <meetingId>` (text) · `veche show <meetingId> --format html --open` (HTML in browser)
```

- Participant headings MUST match the actual member ids the meeting used (i.e. the profile names from the config).
- Do not print raw `<PASS/>` tokens — they are signal, not content.
- Do not show the full JSON envelope from `get_response`.
- Do not include cursors or seqs.
- Truncate any single quoted passage to ~500 characters with `…` — the user can ask for more if needed.
- Do not invent a coder/reviewer dichotomy. The protocol treats all members as symmetric peers.

## Failure modes to surface verbatim

- `claude-runtime` with `"Not logged in"` → tell the user to run `claude login` on the host. The affected member will have been dropped; the meeting may still have completed with the rest.
- `codex-generic` repeated → the affected member is dropped; suggest `codex login` or setting `CODEX_API_KEY`.
- `MeetingBusy` on `send_message` → another meeting's job is still running. Offer to cancel the other job by its id (shown in the error) via `mcp__veche__cancel_job`.
- `terminationReason: max-rounds` → the members genuinely disagreed. Include this in the Synthesis — don't pretend there was consensus.
- `ProfileNotFound` from `start_meeting` → the config was edited between preflight and call; re-read and report which name is now missing.

## Do not

- Do not spawn more than one meeting per invocation.
- Do not chain `/veche` back-to-back on the same question hoping for a different answer; if the committee hit max-rounds, that is the answer.
- Do not hardcode adapter/systemPrompt/model in the `start_meeting` call. The whole point of this revision is that the roster lives in `~/.veche/config.json`. If the user wants a different roster (different adapters, different prompts, only one model), they edit the config — not this skill.
- Do not write any files. The transcript is persisted by the MCP server under `~/.veche/`; point the user at `veche show <meetingId>` for a rendered view if they want the full record.
