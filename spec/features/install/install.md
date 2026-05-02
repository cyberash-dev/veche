# Feature: install

## Purpose

Give an operator (or a fresh machine bootstrapping `veche`) a single command that wires the `veche` MCP server and its companion skill into the two supported MCP hosts: Claude Code and Codex. The command is the canonical setup path — no manual JSON / TOML editing, no copy-pasting `claude mcp add` invocations from a README.

The slice owns three artefacts:

1. The canonical skill directory `skills/veche/`, versioned with the rest of the package and shipped via npm `files`. It contains the required `SKILL.md` and optional host UI metadata under `agents/`.
2. The `veche install` CLI subcommand that places the skill file under each host's `skills/` directory and registers the MCP server with each host.
3. A small allowlist of host-CLI invocations (`claude mcp …`, `codex mcp …`) the install command is permitted to spawn.

This slice does NOT extend the MCP tool surface, does NOT modify the event log, and does NOT touch `$VECHE_HOME`. It is purely a deployment helper.

## Domain Entities

This slice introduces no new domain entities. It manipulates two host-side configurations and one filesystem layout per host:

- **Skill artefact** — a directory containing a Markdown document with YAML front-matter and optional host UI metadata. Its required on-disk path is `<host-skills-root>/<mcp-name>/SKILL.md`; optional UI metadata is installed at `<host-skills-root>/<mcp-name>/agents/openai.yaml` when present in the package.
- **MCP server registration** — a host-specific config entry (Claude Code: `~/.claude.json` `mcpServers.<name>`; Codex: `~/.codex/config.toml` `mcp_servers.<name>`) that names a stdio command + env. Both hosts expose CLI subcommands (`claude mcp add`, `codex mcp add`) that own the registration semantics; this slice never edits the config files directly.

## Use Cases

- [install-cli](./install-cli.usecase.md) — Install or refresh the skill file and MCP server registration for one or both hosts.

## Invariants

- **No store side effects.** The install command MUST NOT open `MeetingStorePort`, MUST NOT write under `$VECHE_HOME`, MUST NOT read or modify any meeting data. The CLI invariants from the existing `list` / `show` / `watch` commands continue to hold; install is read-only against the meeting store. The integration test injects a mock `MeetingStorePort` whose every method throws and asserts the install command never trips it.
- **Bounded write surface.** The only filesystem locations the install command writes to are:
  - `<host-skills-root>/<mcp-name>/SKILL.md` for each requested host.
  - `<host-skills-root>/<mcp-name>/agents/openai.yaml` for each requested host when the package contains that optional metadata file.
  - The host's own MCP config file, but only via the host CLI (`claude mcp add/remove`, `codex mcp add`). Never edited directly.
  No other path is created or modified. Atomic write (`<path>.tmp-<pid>-<ts>` → `rename`) is mandatory for the skill file, mirroring `show --out`.
- **Bounded subprocess surface.** The install command may spawn ONLY `claude` and `codex` (resolved via `CLAUDE_BIN` / `CODEX_BIN` env vars or PATH). It does not spawn any other binary, including no `bash`, no `sh`, no `npm`. Subprocess args are constructed in code; no user-supplied string is interpolated unquoted.
- **Idempotent.** Re-running `veche install` against an already-configured host produces the same end state. Concretely: the skill file is overwritten in place; for Claude Code (whose `mcp add` is not idempotent) the command first probes via `claude mcp list`, removes the existing entry if present, then adds; for Codex (whose `mcp add` overwrites natively) the command issues a single `mcp add`.
- **Single source of truth for the skill.** Both hosts receive byte-identical copies of `skills/veche/SKILL.md` and optional `skills/veche/agents/openai.yaml` from the package. There is no per-host variant of the skill file or UI metadata; if Claude Code and Codex ever need divergent skill content, that requires a spec change to introduce a per-host template.
- **Interactive launch contract.** The installed skill prompts the Orchestrator Agent to collect missing launch choices before `start_meeting`: the question, Human Participant inclusion, the round budget, and whether to use per-launch role customization. When role customization is enabled, the skill presents the default `codex` and `claude` Discussion Role metadata and system prompt, accepts per-launch overrides for role name, role description, role weight, and system prompt, and passes those overrides only in the `start_meeting` payload. The skill does not write Profiles or other persistent configuration for these overrides.

## Dependencies

- [meeting](../meeting/meeting.md) — the install command pins the `mcp-name` (default `veche`) which must match the `mcp__veche__*` tool prefix served by the MCP server. Renaming requires a coordinated change across both slices.
- External binaries: `claude` (Claude Code CLI) and `codex` (Codex CLI). The same binaries are already required by [agent-integration](../agent-integration/agent-integration.md) for committee membership, so the dependency does not widen.
