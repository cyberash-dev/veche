---
name: ai-meeting
description: Convene a symmetric committee meeting between Codex and a fresh Claude Code instance on a single question, then report each participant's stance and the consensus. Use when the user wants a second opinion, wants to stress-test a decision against a different model, or asks to "hold a meeting" / "convene a committee" / "get codex + claude to discuss X".
trigger: /ai-meeting
---

# /ai-meeting

Stands up a short committee meeting via the `ai-meeting` MCP server:

- **Facilitator:** `facilitator` (this session — you are the orchestrator).
- **Members:** `codex` (Codex CLI) + `claude` (Claude Code CLI, isolated child) — symmetric peers; the skill does not assign coder/reviewer roles. Both members are independent agents of equal standing.
- **Rounds:** 3 by default (bounded by `AI_MEETING_MAX_ROUNDS_CAP` = 16).
- **Per-turn timeout:** 120 seconds.

Drives the discussion to termination, reports the transcript grouped by member, and closes the meeting. Does NOT write files or run other commands — this is a reasoning tool.

## Arguments

```
/ai-meeting                              # you must ask the user for the question
/ai-meeting <question>                   # runs on the supplied question
/ai-meeting --rounds N <question>        # override maxRounds (1..16)
/ai-meeting --title "<title>" <question> # override meeting title
```

Everything after flags is the question. If the user wrote `/ai-meeting` with no prompt, ask them one concise question ("What do you want the committee to decide?") via `AskUserQuestion`, then proceed.

## Preflight

Before calling any MCP tool, check that `mcp__ai-meeting__start_meeting` is available in this session. If not:

> The `ai-meeting` MCP server is not connected. Make sure `ai-meeting` is present in `~/.claude.json` under `mcpServers` and that the Claude Code session was restarted after adding it.

Do not fall back to asking Codex or another Claude instance directly — the whole point of this skill is the committee protocol. Stop and report.

## Flow

Execute in order. Do not skip steps.

### 1. Parse args

- If no args: use `AskUserQuestion` to collect `question` (single free-form field). Keep `title` = first 60 chars of the question, `rounds` = 3.
- If `--rounds N`: parse integer 1..16. If out of range, refuse and tell the user.
- If `--title "..."`: use as meeting title. Otherwise derive from the question.

### 2. Start the meeting

Call `mcp__ai-meeting__start_meeting` with:

```json
{
  "title": "<title>",
  "facilitator": { "id": "facilitator" },
  "members": [
    {
      "id": "codex",
      "adapter": "codex-cli",
      "extraFlags": ["--skip-git-repo-check"],
      "systemPrompt": "You are an independent agent in a multi-party deliberation. On each turn you will see every prior message from every other agent. Respond in 1-3 sentences with your honest, substantive perspective. If — and only if — you genuinely have nothing meaningful to add or contest, respond with exactly <PASS/> and nothing else."
    },
    {
      "id": "claude",
      "adapter": "claude-code-cli",
      "systemPrompt": "You are an independent agent in a multi-party deliberation. On each turn you will see every prior message from every other agent. Respond in 1-3 sentences with your honest, substantive perspective. If — and only if — you genuinely have nothing meaningful to add or contest, respond with exactly <PASS/> and nothing else."
    }
  ],
  "defaultMaxRounds": <rounds>
}
```

Capture `meetingId` and the initial `cursor` from the response.

On error: stop and report the error code + message verbatim. Do not retry silently.

### 3. Send the question

Call `mcp__ai-meeting__send_message` with:

```json
{
  "meetingId": "<meetingId>",
  "text": "<question>",
  "maxRounds": <rounds>,
  "turnTimeoutMs": 120000
}
```

Capture `jobId` and the updated `cursor`.

### 4. Poll until terminal

Repeatedly call `mcp__ai-meeting__get_response` with:

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
- After stop, drain: call `get_response` one more time with `waitMs: 0`; if `messages[].length > 0` append them and repeat until empty.

**Budget:** do not poll for more than 10 minutes wall-clock. If it drags, call `mcp__ai-meeting__cancel_job` with `reason: "skill-budget-exceeded"` and report a partial result.

### 5. Close the meeting

Call `mcp__ai-meeting__end_meeting` with:

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

End the report with one line pointing at the persisted transcript:

```
> Full transcript: `ai-meeting show <meetingId>` (text) · `ai-meeting show <meetingId> --format html --open` (HTML in browser)
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
- `MeetingBusy` on `send_message` → another meeting's job is still running. Offer to cancel the other job by its id (shown in the error) via `mcp__ai-meeting__cancel_job`.
- `terminationReason: max-rounds` → the members genuinely disagreed. Include this in the Synthesis — don't pretend there was consensus.

## Do not

- Do not spawn more than one meeting per invocation.
- Do not chain `/ai-meeting` back-to-back on the same question hoping for a different answer; if the committee hit max-rounds, that is the answer.
- Do not edit the skill's member roster, flags, or timeouts on the fly. If the user asks for a different roster (e.g. "only codex"), tell them to adjust the skill file — this skill is deliberately fixed for reproducibility.
- Do not write any files. The transcript is persisted by the MCP server under `~/.ai-meeting/`; point the user at `ai-meeting show <meetingId>` for a rendered view if they want the full record.
