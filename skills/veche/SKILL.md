---
name: veche
description: Convene a symmetric committee meeting between the profiles declared in ~/.veche/config.json on a single question, then report each participant's stance and the consensus. Use when the user wants a second opinion, wants to stress-test a decision against another model, or asks to "hold a meeting" / "convene a committee" / "get the committee to discuss X".
trigger: /veche
---

# /veche

Stands up a short committee meeting via the `veche` MCP server:

- **Facilitator:** `facilitator` (this session — you are the orchestrator).
- **Members:** every Profile declared in `~/.veche/config.json` (or the subset selected via `--profiles`). All members are independent agents of equal standing — the skill does not assign coder/reviewer roles. Optionally a Human Participant joins as an extra member with id `human`.
- **Rounds:** inherited from the server default unless the caller passes `--rounds N`. The server enforces the upper bound (`VECHE_MAX_ROUNDS_CAP`).
- **Per-turn timeout:** 300 seconds.

Drives the discussion to termination, persists a synthesis, reports the transcript grouped by member, and closes the meeting. Does NOT write files or run other commands — this is a reasoning tool.

## Arguments

```
/veche                                     # ask for the question + launch options
/veche <question>                          # runs on the supplied question
/veche --rounds N <question>               # override maxRounds; server validates against VECHE_MAX_ROUNDS_CAP
/veche --title "<title>" <question>        # override meeting title
/veche --profiles a,b <question>           # restrict members to the named profiles (comma-separated)
/veche --human <question>                  # include a Human Participant; preselects "yes" in the launch question
/veche --no-human <question>               # skip the Human Participant; preselects "no"
/veche --custom-roles <question>           # opens the per-launch role override flow
/veche --default-roles <question>          # use config-declared roles verbatim; preselects "no" in the role question
```

Everything after flags is the question. If the user wrote `/veche` with no prompt, ask them one concise question ("What do you want the committee to decide?") via `AskUserQuestion`, then proceed.

`--human` / `--no-human` and `--custom-roles` / `--default-roles` are mutually exclusive within each pair. If both are given, the last one wins; do not error.

## Preflight

1. Check that `mcp__veche__start_meeting` is available in this session. If not:

   > The `veche` MCP server is not connected. Make sure `veche` is present in `~/.claude.json` under `mcpServers` and that the Claude Code session was restarted after adding it.

2. Read `~/.veche/config.json` via the `Read` tool. Validate:
   - File exists and parses as JSON.
   - Top-level `profiles` is a non-empty array.
   - Each profile has a `name` matching `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$` (the participant-id regex enforced by `start_meeting`).
   - After applying `--profiles` (if present), at least one profile remains and at most 8 (server limit; the optional Human Participant counts toward the 8).
   - No profile is named `human` — that id is reserved for the Human Participant. If the config uses it, stop and report.

   If any check fails, stop and report the exact problem (missing file, parse error, empty roster, invalid name, out-of-range count, unknown profile in `--profiles`, reserved name `human`). Do not invent profiles or fall back to a hardcoded roster.

Do not fall back to asking Codex or another Claude instance directly — the whole point of this skill is the committee protocol. Stop and report.

## Flow

Execute in order. Do not skip steps.

### 1. Parse args

- If no positional args: use `AskUserQuestion` to collect `question` (single free-form field). Keep `title` = first 60 chars of the question and leave `rounds` unset.
- If `--rounds N`: parse a positive integer. Pass it through verbatim — the server validates against `VECHE_MAX_ROUNDS_CAP` and returns an error if it is out of range; surface that error to the user as-is rather than pre-filtering here.
- If `--title "..."`: use as meeting title. Otherwise derive from the question.
- If `--profiles a,b,c`: split on comma, trim, dedupe; every entry must exist in the config (case-sensitive). Otherwise the roster is every profile in the config in declared order.
- Record the resolved values for the three launch options below: `human ∈ {true, false, unset}`, `customRounds ∈ {true (–rounds given), false (no preference)}`, `customRoles ∈ {true, false, unset}`.

### 2. Launch options

Ask only the launch options the flags did not already settle. Use a single `AskUserQuestion` call with all open questions; do not ask one-by-one.

- **Human Participant** — if `human` is `unset`, ask: "Include a Human Participant?" (yes / no, default no). The human pauses the discussion after each model round (`waiting_for_human`); skip if you do not plan to interject.
- **Round budget** — if `customRounds` is `false`, ask: "Use the server default round budget, or set a custom one?" (default / custom). If "custom", collect a positive integer and treat it as `--rounds N`.
- **Roles** — if `customRoles` is `unset`, ask: "Customize roles for this launch?" (no / yes, default no). If "yes", show the per-profile defaults (`discussionRole.{name, description, weight}` and `systemPrompt`) from `~/.veche/config.json` for every selected profile, then for each profile collect optional overrides for `discussionRole.description`, `discussionRole.weight`, and `systemPrompt`. Empty answers keep the config default. These overrides apply only to this meeting and are not written back to the config file. The Human Participant has its own server-side default discussion role; offer the same override fields if the user chose to include the human.

### 3. Build the member roster

For each selected profile, build a Member entry:

```json
{
  "id": "<profile.name>",
  "profile": "<profile.name>"
}
```

If the user supplied per-launch role overrides for that profile, also include any of:

- `"discussionRole": { "name": "<config name>", "description": "<override>", "weight": <override> }` — name is always the config value; description and weight fall back to config when not overridden.
- `"systemPrompt": "<override>"` — only if the user provided a non-empty override.

Do **not** copy `adapter`, `model`, `extraFlags`, or `env` into the call — the server resolves those from the named Profile. The Pass Signal (`<PASS/>`) instruction is appended by the server's dispatch-turn use case on every round, not by this skill.

If the Human Participant is enabled, append exactly one extra member at the end:

```json
{ "id": "human", "participantKind": "human" }
```

A human member must not carry `profile`, `adapter`, `model`, `systemPrompt`, `workdir`, `extraFlags`, or `env` — `start_meeting` rejects those. If the user supplied a per-launch override for the human's `discussionRole` (description / weight), include it; otherwise omit the field and the server applies its built-in default.

### 4. Start the meeting

Call `mcp__veche__start_meeting` with:

```json
{
  "title": "<title>",
  "facilitator": { "id": "facilitator" },
  "members": [ /* the roster from step 3 */ ]
}
```

If the user supplied `--rounds N` (or chose a custom budget in step 2), add `"defaultMaxRounds": <N>`. Otherwise omit the field — the server applies its own default.

Capture `meetingId` and the initial `cursor`.

On error: stop and report the error code + message verbatim. Do not retry silently. Common cases worth surfacing as-is: `ProfileNotFound` (config drifted between read and call), `ProfileAdapterMismatch` (should not happen with this skill since we never set `adapter` — if it does, report it), `ValidationError` (e.g. roster size, reserved id, human member with adapter fields).

### 5. Send the question

Call `mcp__veche__send_message` with:

```json
{
  "meetingId": "<meetingId>",
  "text": "<question>",
  "turnTimeoutMs": 300000
}
```

If the user supplied `--rounds N` (or chose a custom budget), add `"maxRounds": <N>`. Otherwise omit.

Capture `jobId` and the updated `cursor`.

### 6. Poll until terminal

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
- If `humanTurn` is non-null, run the **Human turn** sub-flow below before polling again.
- Stop when `status` is `completed`, `failed`, or `cancelled`.
- After stop, drain: call `get_response` once with `waitMs: 0`; if `messages[].length > 0` append them and repeat until empty.

**Budget:** do not poll for more than 15 minutes wall-clock (excluding time the user is answering a human-turn prompt). If model rounds drag, call `mcp__veche__cancel_job` with `reason: "skill-budget-exceeded"` and report a partial result.

#### Human turn sub-flow

When `humanTurn` is non-null in a poll response, the job is paused on `waiting_for_human` and will not progress until you submit. Capture `humanTurn.requestId`, `humanTurn.round`, `humanTurn.agreeTargets[]`, `humanTurn.strengths` (always `[1, 2, 3]`).

Use one `AskUserQuestion` call to collect:

- **action** — `agree` / `skip` / `steer`.
- if `action = agree`: **target** (one of `agreeTargets[].id`) and **strength** (1, 2, or 3).
- if `action = steer`: free-form **text** (required, non-empty).
- if `action = skip`: nothing else.

Then call `mcp__veche__submit_human_turn` with the captured `jobId`, `requestId`, `action`, and the conditional fields (`targetParticipantId`, `strength`, `text`). Resume polling with the cursor you last received. Do not call `set_human_participation` from this flow — it only changes future-pause behavior, not the pending request.

If the user wants to disable further human pauses for the rest of this run, call `mcp__veche__set_human_participation` with `{ "meetingId": "<meetingId>", "participantId": "human", "enabled": false, "jobId": "<jobId>" }` *after* submitting the current turn. The job continues without further human pauses.

### 7. Persist the synthesis

After the job reaches a terminal status (`completed` / `failed` / `cancelled`), compose the synthesis paragraph you will show in the report (2–4 sentences — see step 9). Then call `mcp__veche__submit_synthesis`:

```json
{ "jobId": "<jobId>", "text": "<your synthesis paragraph>" }
```

This stores the synthesis on the persisted transcript so `veche show <meetingId>` renders it alongside the messages. Skip this step only if the job's `terminationReason` is `cancelled` and you produced no synthesis. If `submit_synthesis` raises (e.g. job not terminal yet — race against drain), do not retry forever; report the error and continue to close the meeting.

### 8. Close the meeting

Call `mcp__veche__end_meeting` with:

```json
{ "meetingId": "<meetingId>", "cancelRunningJob": false }
```

If it raises `MeetingBusy`, the job didn't terminate despite step 6; retry with `cancelRunningJob: true` and note this in the final report.

### 9. Report to the user

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

### human
<each `agree` / `skip` / `steer` submission rendered compactly: round N — agree(target, strength) | skip | steer: "<first ~200 chars>". Omit section if no human was present or the human submitted nothing.>

### Dropouts / system events
<any system messages (drops, cancellations, spawn-blocked failures). Omit section if empty.>

### Synthesis
<The same 2-4 sentences you submitted in step 7. Treat all members as peers — do NOT frame any one as proposer or reviewer; either may have introduced any given point. If they largely disagreed and you cannot pick, say so explicitly. Reflect the human's contribution if one was made.>
```

End the report with one line pointing at the persisted transcript:

```
> Full transcript: `veche show <meetingId>` (text) · `veche show <meetingId> --format html --open` (HTML in browser)
```

- Participant headings MUST match the actual member ids the meeting used (profile names from the config, plus `human` if applicable).
- Do not print raw `<PASS/>` tokens — they are signal, not content.
- Do not show the full JSON envelope from `get_response`.
- Do not include cursors or seqs.
- Truncate any single quoted passage to ~500 characters with `…` — the user can ask for more if needed.
- Do not invent a coder/reviewer dichotomy. The protocol treats all members as symmetric peers.

## Failure modes to surface verbatim

- `claude-runtime` with `"Not logged in"` → tell the user to run `claude login` on the host. The affected member will have been dropped; the meeting may still have completed with the rest.
- `claude-spawn-blocked` / `codex-spawn-blocked` → the OS refused to launch the binary (EPERM/EACCES — sandbox, missing executable bit, antivirus). Non-retryable; the affected member is dropped. Suggest checking the binary path / permissions; on macOS it is often Gatekeeper or a corporate MDM.
- `codex-generic` repeated → the affected member is dropped; suggest `codex login` or setting `CODEX_API_KEY`.
- `MeetingBusy` on `send_message` → another meeting's job is still running. Offer to cancel the other job by its id (shown in the error) via `mcp__veche__cancel_job`.
- `terminationReason: max-rounds` → the members genuinely disagreed. Include this in the Synthesis — don't pretend there was consensus.
- `ProfileNotFound` from `start_meeting` → the config was edited between preflight and call; re-read and report which name is now missing.
- `HumanTurnNotFound` / `HumanTurnAlreadySubmitted` from `submit_human_turn` → the request id from `humanTurn` does not match the current pending turn (race against drain or a prior submission). Re-poll `get_response` once to see whether the job has already moved on; surface the error if it persists.

## Tool surface used by this skill

`start_meeting`, `send_message`, `get_response`, `submit_human_turn`, `set_human_participation`, `submit_synthesis`, `end_meeting`, `cancel_job`. The skill does not call `list_meetings` or `get_transcript` — both are read-only and not needed for a single discussion.

## Do not

- Do not spawn more than one meeting per invocation.
- Do not chain `/veche` back-to-back on the same question hoping for a different answer; if the committee hit max-rounds, that is the answer.
- Do not hardcode adapter/model in the `start_meeting` call. The roster lives in `~/.veche/config.json`; per-launch overrides cover only `discussionRole` and `systemPrompt`. If the user wants a persistently different roster, they edit the config — not this skill.
- Do not write per-launch role overrides back to `~/.veche/config.json`.
- Do not synthesize the user's words for them in the human-turn flow — pass their `steer` text through verbatim.
- Do not call `submit_synthesis` before the job is terminal — it will reject.
- Do not write any files. The transcript is persisted by the MCP server under `~/.veche/`; point the user at `veche show <meetingId>` for a rendered view if they want the full record.
