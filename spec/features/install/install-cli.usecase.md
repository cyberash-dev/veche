# Use Case: install-cli

## Actor

Human Operator (or an automated provisioning script) running `veche install` from a terminal — typically once after `npm i -g veche`, or any time the canonical skill text has been updated and needs to land in the host config.

## Input

Positional: none.

Flags:

| Flag | Type | Validation |
|------|------|------------|
| `--for` | `claude-code` \| `codex` \| `both` | Optional. Default `both`. Selects which host(s) to install into. |
| `--mcp-name` | string | Optional. Default `veche`. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. The MCP server name registered with the host **and** the directory name under `skills/`. Renaming is supported but unusual. |
| `--server-bin` | absolute path | Optional. Default: the absolute path to `dist/bin/veche-server.js` resolved from `import.meta.url` of the install module. Override required only when the package is being installed from a non-standard location (e.g. from a tarball before extraction). |
| `--skills-only` | boolean | Optional. Skip MCP registration. Only copy the skill file. Mutually exclusive with `--mcp-only`. |
| `--mcp-only` | boolean | Optional. Skip skill copy. Only register the MCP server. Mutually exclusive with `--skills-only`. |
| `--force` | boolean | Optional. Two effects: (a) when the host CLI is missing, log an error and proceed with the other host instead of aborting; (b) overwrite an existing `$VECHE_HOME/config.json` instead of preserving it. Without `--force`, a missing host CLI returns exit 2 and an existing `config.json` is preserved. |
| `--skip-config` | boolean | Optional. Skip the `$VECHE_HOME/config.json` bootstrap step. Use when the operator manages the config file manually or out-of-band. |
| `--dry-run` | boolean | Optional. Print every action that would be taken on stderr without performing it. Always exits 0 (or 64 on usage errors). |
| `--no-color` | boolean | Optional. Disables ANSI color in stderr output. Same semantics as the other CLI commands. |
| `--home` | absolute path | Optional. Override for `$VECHE_HOME`. Resolution order: `--home` value → `process.env.VECHE_HOME` → `~/.veche`. Used to locate the destination for the bootstrap `config.json`. |

`--skills-only` and `--mcp-only` together are a usage error (exit 64).

## Output

All operator-visible output is on stderr. Stdout is reserved for future machine-readable output and is not used in v1. Exit code `0` on success.

The command emits one line per high-level step in this order, prefixed by the host (`[claude-code]` / `[codex]`):

```
writing config file → /Users/<u>/.veche/config.json
[claude-code] writing skill file → /Users/<u>/.claude/skills/veche/SKILL.md
[claude-code] mcp register: claude mcp add veche --scope user -e VECHE_LOG_LEVEL=info -- node /abs/path/to/dist/bin/veche-server.js
[claude-code] ok
[codex] writing skill file → /Users/<u>/.codex/skills/veche/SKILL.md
[codex] mcp register: codex mcp add veche --env VECHE_LOG_LEVEL=info -- node /abs/path/to/dist/bin/veche-server.js
[codex] ok
done.
```

When a step is skipped (`--skills-only` / `--mcp-only` / `--skip-config` / `--dry-run`), the line is prefixed with `(skipped)` or `(dry-run)` respectively. When `$VECHE_HOME/config.json` already exists and `--force` is not set, the line is prefixed with `(exists)` and the file is preserved as-is.

## Flow

1. Parse argv. Reject unknown flags / contradictions with exit `64` and a one-line stderr message.
   - `--for` outside the allowed set → `64`.
   - `--mcp-name` not matching the regex → `64`.
   - `--server-bin` provided but not absolute / not pointing at an existing `*.js` file → `64`.
   - `--skills-only` and `--mcp-only` both set → `64`.
2. Resolve the **canonical skill source**: `<package-root>/skills/<mcp-name>/SKILL.md`. The package root is derived from `import.meta.url` of the install module. If the file is missing, exit `2` with `skill source not found at <path>` (this should never happen in a correct package).
3. Resolve the **server bin**: `--server-bin` if given, else `<package-root>/dist/bin/veche-server.js`. Exit `2` if the resolved path does not exist.
4. Resolve the **canonical config template**: `<package-root>/examples/config.json.example`. If the file is missing and `--skip-config` was not supplied, exit `2` with `config source not found at <path>` (this should never happen in a correct package).
5. **Config bootstrap** (skipped if `--skip-config`):
   - Resolve `$VECHE_HOME` as: `--home` value → `process.env.VECHE_HOME` → `~/.veche` (mirrors `loadConfig`).
   - Compute the destination: `<veche-home>/config.json`.
   - If `--dry-run`: log `(dry-run) writing config file → <path>` and skip.
   - Else if the destination exists and `--force` is **not** set: log `(exists) config file → <path>` and skip.
   - Else: atomic write of the template (`<path>.tmp-<pid>-<ts>` mode `0o600`, `rename`). Create the parent directory as needed. Log `writing config file → <path>`.
   - This step runs **once** per `veche install` invocation regardless of `--for`. The line has no `[<host>]` prefix because the config is host-agnostic.
6. Build the host plan from `--for`: a list of one or two `HostTarget` records (`claude-code`, `codex`). Each target carries the host name, the skills root (`~/.claude/skills` for claude-code, `~/.codex/skills` for codex), the host CLI command (`claude` / `codex`), the `mcp add` argv template, and the `mcp list` / `mcp remove` argv (claude only).
7. For each target, in declaration order, do:
   - 7a. **Skill file** (skipped if `--mcp-only`):
     - Compute `<skills-root>/<mcp-name>/SKILL.md`.
     - Atomic write: write to `<path>.tmp-<pid>-<ts>` (mode `0o600`), `fsync`, `rename` to the final path. Create parent dirs as needed (`mkdir -p` semantics).
     - Log `[<host>] writing skill file → <path>`.
   - 7b. **MCP register** (skipped if `--skills-only`):
     - Probe the host CLI: spawn `<cli> --version`. If it fails with `ENOENT`, this counts as "host CLI missing" — see step 8.
     - Claude Code path:
       - Spawn `claude mcp list` (Claude's `mcp list` does NOT accept `--scope` and lists all scopes; the `<mcp-name>:` row test is sufficient because the user-scope name namespace is unique enough for the install flow). Parse stdout line-by-line. If a row begins with `<mcp-name>:`, spawn `claude mcp remove <mcp-name> --scope user`. Ignore non-zero exits from remove only when stderr says "not found"; otherwise propagate.
       - Spawn `claude mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>`. Non-zero exit → step 8.
     - Codex path:
       - Spawn `codex mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>`. Non-zero exit → step 8. (Codex `mcp add` overwrites; no probe needed.)
     - Log `[<host>] mcp register: <argv joined by space>` before spawning, and `[<host>] ok` after both 7a and 7b finished successfully (or whichever was requested).
8. Error handling:
   - **Host CLI missing (`ENOENT` on probe).** Without `--force`: log `[<host>] error: <cli> not found on PATH; install <cli> first or pass --force to skip this host`, exit `2` after recording any earlier successful targets. With `--force`: log the same line plus `[<host>] skipped` and continue.
   - **Host CLI returned non-zero.** Log the host's stderr verbatim, prefix with `[<host>] error: `, exit `2`. Do not attempt the other host afterwards (avoid leaving half-installed state without a clear signal).
   - **Skill write failed.** Atomic write rolls back (the `.tmp` file is removed). Log `[<host>] error: cannot write <path>: <message>`, exit `2`.
   - **Config write failed.** Atomic write rolls back. Log `error: cannot write <path>: <message>`, exit `2`. Host steps do not run.
9. After the last target finishes, print `done.` to stderr and exit `0`.

In `--dry-run` mode, every step that would touch the filesystem or spawn a process is logged with the `(dry-run)` prefix instead of being executed. Probing the host CLI is also skipped (so `--dry-run` works on a machine without `claude` / `codex` installed).

## Errors

| Error | When | Exit code | Stream |
|-------|------|-----------|--------|
| `UsageError` | Unknown flag, invalid `--for`, invalid `--mcp-name`, non-absolute `--server-bin`, `--skills-only` and `--mcp-only` together. | `64` | stderr |
| `SkillSourceMissing` | The canonical `skills/<mcp-name>/SKILL.md` is not present in the package. | `2` | stderr |
| `ConfigSourceMissing` | The canonical `examples/config.json.example` is not present in the package and `--skip-config` was not supplied. | `2` | stderr |
| `ServerBinMissing` | The resolved `--server-bin` does not exist. | `2` | stderr |
| `HostCliMissing` | `claude` / `codex` not on PATH and `--force` was NOT supplied. | `2` | stderr |
| `HostCliFailed` | The host CLI returned a non-zero exit during `mcp list/remove/add`. | `2` | stderr |
| `WriteFailed` | The skill file or `$VECHE_HOME/config.json` could not be written (permissions, disk full, parent dir creation failed). | `2` | stderr |
| `InternalError` | Any other unhandled exception. | `1` | stderr |

## Side Effects

- Writes one `SKILL.md` per requested host under `~/.claude/skills/<mcp-name>/` and/or `~/.codex/skills/<mcp-name>/`. Atomic write (`<path>.tmp-<pid>-<ts>` + `rename`). Mode `0o600`.
- Writes `$VECHE_HOME/config.json` exactly once per invocation, only when the file is absent or `--force` is set. Atomic write, mode `0o600`. Source: byte-identical copy of `<package-root>/examples/config.json.example`. Skipped under `--skip-config` and `--dry-run`.
- Spawns the following whitelisted commands (and ONLY these):
  - `claude --version`
  - `claude mcp list`
  - `claude mcp remove <mcp-name> --scope user`
  - `claude mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>`
  - `codex --version`
  - `codex mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>`
- Each host CLI in turn writes to its own user-config file. The install command does NOT touch `~/.claude.json` or `~/.codex/config.toml` directly.
- Logs JSON / structured lines to stderr via the same `StructuredLogger` the rest of the CLI uses. Stdout is unused.

## Rules

- **No event-log access.** The install command never instantiates `MeetingStorePort`, never reads from or writes to `$VECHE_HOME/meetings/`, and never reads any existing meeting data. Writing the bootstrap `$VECHE_HOME/config.json` is the only permitted touch under `$VECHE_HOME`. Tests inject a throwing mock store and assert no method is invoked.
- **Bounded subprocess surface.** Only `claude` and `codex` are spawned. The argv for each invocation is fixed by this spec — no user input is interpolated into the argv unquoted. The `mcp-name` is validated against the regex above before any subprocess uses it.
- **Bounded write surface.** Filesystem writes go ONLY to (a) `<host-skills-root>/<mcp-name>/SKILL.md`, (b) `$VECHE_HOME/config.json`. A test verifies that no `fs.writeFile` / `fs.rename` happens outside those paths.
- **Atomic writes.** Both `SKILL.md` and `config.json` are written via `<path>.tmp-<pid>-<ts>` then `rename`. Mirrors the existing `show --out` pattern. Readers (Claude Code / Codex / `loadConfig`) never see a half-written file.
- **Config bootstrap is non-destructive by default.** The install command MUST NOT overwrite an existing `$VECHE_HOME/config.json` unless the operator passes `--force`. The default behaviour preserves any hand-edited profiles; the operator's source of truth wins over the package template.
- **Override env vars are honoured.** `CLAUDE_BIN` and `CODEX_BIN` are read from the environment and used when set, mirroring the same vars used by [agent-integration](../agent-integration/agent-integration.md) when spawning members. The install command does not introduce new env vars.
- **Idempotent across runs.** Re-running with the same flags is safe: the skill file is overwritten atomically; the Claude Code MCP entry is removed-then-added (because `claude mcp add` rejects duplicates); the Codex entry is overwritten by `codex mcp add` natively; the bootstrap `config.json` is written once and then preserved on every subsequent run (unless `--force` is set). The server bin path picked up on the second run reflects the *current* installation, so re-running after `npm i -g <newer-version>` updates the registration to the new path automatically.
- **No new npm dependencies.** Only Node built-ins (`node:fs/promises`, `node:os`, `node:path`, `node:child_process`, `node:url`).
- **Exit codes are part of the contract.** `0` success · `1` unhandled exception · `2` setup error (CLI missing, server bin missing, host CLI failed, write failed, skill source missing, config source missing) · `64` usage error. `cli.integration.test.ts` exercises `0`, `64`, and the missing-CLI path.
- **`--dry-run` is a contract.** It MUST NOT spawn any subprocess and MUST NOT touch the filesystem. The output lines are stable enough for a test to snap on.
