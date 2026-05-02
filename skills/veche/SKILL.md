---
name: veche
description: Convene a symmetric committee meeting between Codex and a fresh Claude Code instance on a single question, then report each participant's stance and the consensus. Use when the user wants a second opinion, wants to stress-test a decision against a different model, or asks to "hold a meeting" / "convene a committee" / "get codex + claude to discuss X"; the skill asks for launch options such as human participation, round budget, and per-launch role customization.
trigger: /veche
---

# /veche

Stands up a short committee meeting via the `veche` MCP server:

- **Facilitator:** `facilitator` (this session — you are the orchestrator).
- **Members:** `codex` (Codex CLI) + `claude` (Claude Code CLI, isolated child) — symmetric peers; the skill does not assign coder/reviewer roles. Both members are independent agents of equal standing.
- **Rounds:** ask the user whether to use the server default or a custom `--rounds N` value. The server enforces the upper bound (`VECHE_MAX_ROUNDS_CAP`).
- **Roles:** ask whether to use default peer roles or per-launch custom role metadata/system prompts. Per-launch overrides are passed to `start_meeting` only; do not write profiles or config files.
- **Per-turn timeout:** 120 seconds.

Drives the discussion to termination, reports the transcript grouped by member, and closes the meeting. Does NOT write files or run other commands — this is a reasoning tool.

## Arguments

```
/veche                              # you must ask the user for the question
/veche <question>                   # ask launch options, then run on the supplied question
/veche --rounds N <question>        # preselect maxRounds; the server validates against VECHE_MAX_ROUNDS_CAP
/veche --title "<title>" <question> # override meeting title
/veche --human <question>           # preselect Human Participant mode
/veche --no-human <question>        # preselect no Human Participant
/veche --custom-roles <question>    # preselect per-launch role customization
/veche --default-roles <question>   # preselect default peer roles
```

Everything after flags is the question. Command-line flags pre-answer the corresponding launch questions; ask the user for every missing launch choice before starting the meeting.

## Preflight

Before calling any MCP tool, check that `mcp__veche__start_meeting` is available in this session. If not:

> The `veche` MCP server is not connected. Make sure `veche` is present in `~/.claude.json` under `mcpServers` and that the Claude Code session was restarted after adding it.
> For Codex, make sure `veche` is present in `~/.codex/config.toml` under `mcp_servers` and restart the Codex / VS Code session after adding it.

Do not fall back to asking Codex or another Claude instance directly — the whole point of this skill is the committee protocol. Stop and report.

## Flow

Execute in order. Do not skip steps.

### 1. Parse args and collect launch options

Use the host's interactive question UI when available (`AskUserQuestion` in Claude Code, the Codex skill/user-input UI in Codex/VS Code). If the host has no structured prompt tool, ask concise chat questions and wait for answers. Do not call `start_meeting` until the launch options below are resolved.

Default values:

```json
{
  "modelDiscussionRole": {
    "name": "peer",
    "description": "Independent committee member.",
    "weight": 1
  },
  "humanDiscussionRole": {
    "name": "observer/contributor",
    "description": "Human participant providing steering and agreement feedback between model rounds.",
    "weight": 1
  },
  "modelSystemPrompt": "You are an independent agent in a multi-party deliberation. On each turn you will see every prior message from every other agent. Respond in 1-3 sentences with your honest, substantive perspective. If — and only if — you genuinely have nothing meaningful to add or contest, respond with exactly <PASS/> and nothing else."
}
```

- If no question was supplied, ask: "What do you want the committee to decide?"
- If `--rounds N`: parse a positive integer. Pass it through verbatim — the server validates against `VECHE_MAX_ROUNDS_CAP` and returns an error if it is out of range; surface that error to the user as-is rather than pre-filtering here.
- If no `--rounds N`: ask whether to use the server default round budget or enter a custom positive integer. Leave `rounds` unset for the server default.
- If `--title "..."`: use as meeting title. Otherwise derive from the question.
- If `--human` or `--no-human` is absent: ask whether to include a Human Participant. Default to "no" for compatibility if the user says to use defaults.
- If `--custom-roles` or `--default-roles` is absent: ask whether to customize roles for this launch. Default to "default roles" if the user says to use defaults.
- If custom roles are enabled, present the defaults above for `codex` and `claude`, then collect optional overrides for each model member:
  - `discussionRole.name`
  - `discussionRole.description`
  - `discussionRole.weight` (positive number)
  - `systemPrompt`
- If custom roles are enabled and Human Participant mode is enabled, also offer optional overrides for the Human Participant's `discussionRole.name`, `discussionRole.description`, and `discussionRole.weight`.
- Empty custom-role fields mean "use the displayed default." Do not persist overrides to `$VECHE_HOME/config.json`.

### 2. Start the meeting

Call `mcp__veche__start_meeting` with the launch settings applied:

```json
{
  "title": "<title>",
  "facilitator": { "id": "facilitator" },
  "members": [
    {
      "id": "codex",
      "adapter": "codex-cli",
      "discussionRole": {
        "name": "peer",
        "description": "Independent committee member.",
        "weight": 1
      },
      "systemPrompt": "You are an independent agent in a multi-party deliberation. On each turn you will see every prior message from every other agent. Respond in 1-3 sentences with your honest, substantive perspective. If — and only if — you genuinely have nothing meaningful to add or contest, respond with exactly <PASS/> and nothing else."
    },
    {
      "id": "claude",
      "adapter": "claude-code-cli",
      "discussionRole": {
        "name": "peer",
        "description": "Independent committee member.",
        "weight": 1
      },
      "systemPrompt": "You are an independent agent in a multi-party deliberation. On each turn you will see every prior message from every other agent. Respond in 1-3 sentences with your honest, substantive perspective. If — and only if — you genuinely have nothing meaningful to add or contest, respond with exactly <PASS/> and nothing else."
    }
  ]
}
```

Replace any displayed default `discussionRole` or `systemPrompt` field with the collected per-launch override before calling the tool.

If a custom round budget was selected, add `"defaultMaxRounds": <N>` to the call. Otherwise omit the field — the server applies its own default.

If Human Participant mode is selected, append:

```json
{
  "id": "human",
  "participantKind": "human",
  "discussionRole": {
    "name": "observer/contributor",
    "description": "Human participant providing steering and agreement feedback between model rounds.",
    "weight": 1
  }
}
```

Capture `meetingId` and the initial `cursor` from the response.

On error: stop and report the error code + message verbatim. Do not retry silently.

### 3. Send the question

Call `mcp__veche__send_message` with:

```json
{
  "meetingId": "<meetingId>",
  "text": "<question>",
  "turnTimeoutMs": 120000
}
```

If a custom round budget was selected, add `"maxRounds": <N>` to the call. Otherwise omit the field — the server inherits the meeting's default.

Capture `jobId` and the updated `cursor`.

### 4. Poll until terminal

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
- If `humanTurn` is non-null, ask the user for one concise response through the host's interactive UI. Present the available target ids and strength values. Submit `skip`, `agree` with one of the offered targets and strength `1..3`, or `steer` with their text through `mcp__veche__submit_human_turn`. Then keep polling.
- Pass the returned `nextCursor` back into the next call verbatim — do not advance it yourself.
- Stop when `status` is `completed`, `failed`, or `cancelled`.
- After stop, drain: call `get_response` one more time with `waitMs: 0`; if `messages[].length > 0` append them and repeat until empty.

**Budget:** do not poll for more than 10 minutes wall-clock. If it drags, call `mcp__veche__cancel_job` with `reason: "skill-budget-exceeded"` and report a partial result.

### 5. Close the meeting

Call `mcp__veche__end_meeting` with:

```json
{ "meetingId": "<meetingId>", "cancelRunningJob": false }
```

If it raises `MeetingBusy`, it means the job didn't terminate despite step 4; retry with `cancelRunningJob: true` and note this in the final report.

### 6. Report to the user

Render **exactly** this structure (markdown). Keep it tight.

```
## Meeting: <title>
**Terminated:** <terminationReason> after N rounds · jobId=<jobId>

### codex
<each speech from `codex`, in round order, joined by blank lines. Omit pass messages.>
<If dropped: "dropped: <reason>">

### claude
<same>

### Dropouts / system events
<any system messages (drops, cancellations). Omit section if empty.>

### Synthesis
<Your own 2-4 sentences summarising where the two agents agree, where they diverge, and your recommended call for the user. Treat them as peers — do NOT frame one as the proposer and the other as a reviewer; either may have introduced any given point. If they largely disagreed and you cannot pick, say so explicitly.>
```

After composing this Synthesis, call `mcp__veche__submit_synthesis` with `{ "jobId": "<jobId>", "text": "<synthesis>" }` so CLI and web views render it as a persisted synthesis section.

End the report with one line pointing at the persisted transcript:

```
> Full transcript: `veche show <meetingId>` (text) · `veche show <meetingId> --format html --open` (HTML in browser)
```

- The participant headings must match the actual member ids the meeting used. With the defaults above they are `### codex` and `### claude`. If the user previously customised the skill to add or rename participants, match that exactly.
- Do not print raw `<PASS/>` tokens — they are signal, not content.
- Do not show the full JSON envelope from `get_response`.
- Do not include cursors or seqs.
- Truncate any single quoted passage to ~500 characters with `…` — the user can ask for more if needed.
- Do not invent a coder/reviewer dichotomy. The protocol treats both members as symmetric peers.

## Failure modes to surface verbatim

- `claude-runtime` with `"Not logged in"` → tell the user to run `claude login` on the host. The `claude` member will have been dropped; the meeting may still have completed with just `codex`.
- `codex-generic` repeated → `codex` member is dropped; suggest `codex login` or setting `CODEX_API_KEY`.
- `MeetingBusy` on `send_message` → another meeting's job is still running. Offer to cancel the other job by its id (shown in the error) via `mcp__veche__cancel_job`.
- `terminationReason: max-rounds` → the members genuinely disagreed. Include this in the Synthesis — don't pretend there was consensus.

## Do not

- Do not spawn more than one meeting per invocation.
- Do not chain `/veche` back-to-back on the same question hoping for a different answer; if the committee hit max-rounds, that is the answer.
- Do not change the model roster on the fly. The roster is fixed to `codex` + `claude`, plus optional `human`; per-launch role metadata and system prompt overrides are allowed because they are explicit `start_meeting` fields.
- Do not write any files. The transcript is persisted by the MCP server under `~/.veche/`; point the user at `veche show <meetingId>` for a rendered view if they want the full record.
