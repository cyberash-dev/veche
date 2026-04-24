# Glossary

Canonical definitions for every domain term used in this specification. All spec files reference this table; no other file redefines a term.

| Term | Definition | Used in |
|------|-----------|---------|
| AI Meeting Server | This project — an MCP server that hosts multi-party committee meetings between an orchestrator agent and one or more external LLM agents. | system.md, c4-model.md |
| Orchestrator | The external agent process that drives the meeting through MCP tool calls. Always a Participant inside the meeting (role `facilitator`). | system.md, meeting, committee-protocol |
| MCP | Model Context Protocol. The transport used by the inbound adapter; this server speaks MCP over stdio. | containers/ai-meeting-server.md, meeting |
| Meeting | A persistent committee session with a stable `meetingId`, a fixed roster of Participants, a shared Transcript, and a linear history of Jobs. | meeting, persistence |
| Participant | A named actor in a Meeting. Has an `id`, a `role` (`facilitator` or `member`), an `adapter` reference, and optional per-participant configuration (profile, system prompt, workdir, model). | meeting, agent-integration |
| Facilitator | The Participant that issues top-level messages through the MCP tools. Exactly one per Meeting. | meeting, committee-protocol |
| Member | Any non-facilitator Participant. All Members are backed by an Adapter. | meeting, agent-integration |
| Profile | A named Participant configuration stored in the user config file, referenced by name at `start_meeting` and optionally overridden. | agent-integration, containers/ai-meeting-server.md |
| Adapter | An outbound implementation of the `AgentAdapter` port. v1 ships with `codex-cli` and `claude-code-cli`. | agent-integration |
| Session | Per-Participant, per-Meeting state owned by an Adapter. Holds the external provider's conversation id (Codex `thread_id`, Claude Code `session_id`) and any adapter-local bookkeeping. | agent-integration, committee-protocol |
| Turn | One invocation of an Adapter that produces at most one Message. The Orchestrator's direct `send_message` call is not a Turn — only Adapter dispatches are. | agent-integration, committee-protocol |
| Message | An immutable entry in the Transcript. Fields: `id`, `author` (participant id or `system`), `round`, `kind` (`speech` \| `pass` \| `system`), `text`, `createdAt`. | meeting, committee-protocol |
| Round | A numbered phase of committee discussion. Round 0 contains only the Facilitator's opening Message; rounds 1..N contain responses from Members. | committee-protocol |
| Transcript | The append-only sequence of Messages for a Meeting, ordered by a monotonic integer `seq`. | meeting, persistence |
| Pass Signal | The token `<PASS/>` emitted by a Member to declare it has nothing more to add in the current Round. | committee-protocol |
| Job | An asynchronous unit of work created by `send_message`. Has a lifecycle `queued → running → completed` \| `failed` \| `cancelled`. One Job per `send_message` call. | meeting, committee-protocol |
| Cursor | A monotonic opaque token that marks a position in the Transcript. `get_response` and `get_transcript` consume and return Cursors to deliver incremental deltas. | meeting, persistence |
| Workdir | An absolute filesystem path made available to an Adapter for a Participant. Passed through `--cd` (Codex) or `--add-dir` (Claude Code). Optional per Participant. | agent-integration, security-related rules |
| Recursion Guard | The pair of CLI flags that prevent a child Claude Code process from re-entering this MCP: `--strict-mcp-config` plus `--mcp-config '{"mcpServers":{}}'`. Together they force the child to accept MCP servers only from the supplied config, and that config is empty. Default-disallowed tools (`Bash`, `Edit`, `Write`, `NotebookEdit`) further narrow the child's reach but are not part of the guard itself. | agent-integration, claude-code-cli-adapter |
| Drop | The state transition of a Participant whose Adapter fails irrecoverably during a Turn. Dropped Participants stop receiving Turns for the remainder of the Meeting. | committee-protocol |
| Max Rounds | The hard upper bound on the number of discussion Rounds for a single Job. Default `8`, configurable per `send_message`. | committee-protocol |
| MeetingStore | Outbound port for persisting Meetings, Transcripts, and Jobs. Event-append + snapshot-read model. | persistence |
| Event | A persisted record appended to the Meeting's event log. Types: `meeting.created`, `participant.joined`, `job.started`, `round.started`, `message.posted`, `participant.dropped`, `job.completed`, `job.failed`, `job.cancelled`, `meeting.ended`. | persistence |
| InMemoryStore | A `MeetingStore` adapter that keeps state only in process memory. Intended for tests and ephemeral dev use. | persistence |
| FileStore | A `MeetingStore` adapter that persists events to `$AI_MEETING_HOME` as JSONL. Survives process restarts. | persistence |
| Clock | Outbound port returning the current `Instant`. Injected into domain code to keep it time-deterministic for tests. | containers/ai-meeting-server.md |
| IdGen | Outbound port returning new `meetingId`, `jobId`, `messageId`, and UUID values. Injected to keep domain deterministic for tests. | containers/ai-meeting-server.md |
