# C4 Model — Veche Server

Three diagrams describe the system at the Context, Container, and Component levels.

## Level 1 — Context

```mermaid
C4Context
    title Veche Server — System Context
    Person(orch, "Orchestrator Agent", "External agent that drives meetings via MCP tool calls (Claude Code, IDE extension, custom agent)")
    System(ams, "Veche Server", "Hosts multi-party committee meetings between LLM agents")
    System_Ext(codex, "Codex CLI", "OpenAI Codex CLI binary ('codex exec')")
    System_Ext(claude, "Claude Code CLI", "Anthropic Claude Code CLI binary ('claude -p')")
    System_Ext(fs, "Local Filesystem", "Hosts event log and user config under $VECHE_HOME")
    Rel(orch, ams, "Invokes MCP tools", "MCP over stdio")
    Rel(ams, codex, "Spawns subprocess per Turn", "exec resume --json")
    Rel(ams, claude, "Spawns subprocess per Turn", "-p --session-id --output-format json")
    Rel(ams, fs, "Reads config, appends event log", "POSIX fs")
```

## Level 2 — Container

```mermaid
C4Container
    title Veche Server — Containers
    Person(orch, "Orchestrator Agent")
    System_Boundary(ams_boundary, "Veche Server") {
        Container(ams, "veche-server", "Node.js 20 + TypeScript", "MCP over stdio. Hosts meetings, runs committee protocol, spawns adapter subprocesses, persists events.")
    }
    System_Ext(codex, "Codex CLI")
    System_Ext(claude, "Claude Code CLI")
    System_Ext(fs, "Local Filesystem")
    Rel(orch, ams, "Tool calls", "MCP / stdio")
    Rel(ams, codex, "Turn dispatch", "child_process spawn")
    Rel(ams, claude, "Turn dispatch", "child_process spawn")
    Rel(ams, fs, "Config + event log", "read/append")
```

## Level 3 — Component (veche-server)

```mermaid
C4Component
    title veche-server — Components (Vertical Slices)
    Container_Boundary(server, "veche-server") {
        Component(mcp_inbound, "MCP Inbound Adapter", "TypeScript", "Registers MCP tools, validates input with zod, dispatches to feature use cases")
        Component(meeting, "meeting (slice)", "Domain + application", "Meeting aggregate, 7 MCP-facing use cases (start/send/get/list/transcript/end/cancel)")
        Component(committee, "committee-protocol (slice)", "Application", "Round-based discussion loop, pass signal parsing, drop handling, termination")
        Component(agents, "agent-integration (slice)", "Port + adapters", "AgentAdapter port, CodexCliAgentAdapter, ClaudeCodeCliAgentAdapter, dispatch-turn")
        Component(persistence, "persistence (slice)", "Port + adapters", "MeetingStore port, InMemoryStore, FileStore")
        Component(infra, "Infra / Bootstrap", "TypeScript", "DI wiring, SystemClock, UuidIdGen, Logger, config loader")
    }
    System_Ext(codex, "Codex CLI")
    System_Ext(claude, "Claude Code CLI")
    System_Ext(fs, "Local Filesystem")
    Rel(mcp_inbound, meeting, "Invokes use cases")
    Rel(meeting, committee, "Hands off Job to discussion loop")
    Rel(committee, agents, "sendTurn per Member")
    Rel(agents, codex, "child_process", "codex exec")
    Rel(agents, claude, "child_process", "claude -p")
    Rel(meeting, persistence, "MeetingStorePort")
    Rel(committee, persistence, "MeetingStorePort")
    Rel(persistence, fs, "Read/append", "events.jsonl, manifest.json")
    Rel(infra, mcp_inbound, "Wires stdio transport")
    Rel(infra, meeting, "Injects ports")
    Rel(infra, committee, "Injects ports")
    Rel(infra, agents, "Injects ports")
    Rel(infra, persistence, "Selects adapter")
```

## Cross-component sequence — `send_message` → Committee → `get_response`

The following sequence complements the component diagram by showing the temporal flow across components for the headline happy path.

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant MCP as MCP Inbound
    participant M as meeting
    participant CP as committee-protocol
    participant AI as agent-integration
    participant P as persistence
    participant Codex as Codex CLI
    participant Claude as Claude Code CLI
    Orch->>MCP: send_message(meetingId, text)
    MCP->>M: SendMessageUseCase
    M->>P: createJob / appendMessage(round=0)
    M->>P: updateJob(running)
    M-->>Orch: { jobId, cursor }
    M-)CP: start discussion loop
    loop until terminate
        CP->>P: appendSystemEvent(round.started)
        par per Member
            CP->>AI: dispatchTurn(participant=codex-*)
            AI->>Codex: codex exec resume ...
            Codex-->>AI: JSONL + final text
            AI-->>CP: TurnResult
        and
            CP->>AI: dispatchTurn(participant=claude-*)
            AI->>Claude: claude -p --session-id ...
            Claude-->>AI: JSON result
            AI-->>CP: TurnResult
        end
        CP->>P: appendMessage per outcome
        CP->>P: appendSystemEvent(round.completed)
    end
    CP->>P: updateJob(completed) + appendSystemEvent(job.completed)
    Orch->>MCP: get_response(jobId, cursor)
    MCP->>M: GetResponseUseCase
    M->>P: readMessagesSince + loadJob
    M-->>Orch: { status, messages[], nextCursor }
```
