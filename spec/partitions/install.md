## Partition: install

> Migrated from `spec/features/install/*.md`. Owns the `veche
> install` deployment helper, the canonical skill artefact, and
> the bootstrap user-config template.

### Context (install)

The `install` partition wires the `veche` MCP server and its
companion skill into Claude Code, Codex, and Hermes Agent hosts,
and seeds a default `${VECHE_HOME}/config.json` so the operator
has a working Profile starting point. It is a deployment helper
— read-only against any meeting data.

Boundaries:

- It does NOT extend the MCP tool surface.
- It MAY write under `${VECHE_HOME}` exactly one file
  (`config.json`) and only when absent or `--force` is supplied.
- Host MCP-server registration goes through the host's own CLI
  (`claude mcp …`, `codex mcp …`, `hermes mcp …`); this partition
  NEVER edits `~/.claude.json`, `~/.codex/config.toml`, or
  `~/.hermes/config.yaml` directly.

### Glossary (install)

- **Skill artefact** — Markdown document at
  `<package-root>/skills/<mcp-name>/SKILL.md`; copied byte-
  identically to `<host-skills-root>/<mcp-name>/SKILL.md` per
  requested host.
- **Host CLI** — `claude` (Claude Code), `codex` (Codex), or
  `hermes` (Hermes Agent). The install command spawns ONLY these
  three binaries and the `--version` probe.
- **`mcp-name`** — The MCP server name registered with each host
  AND the directory name under `<host-skills-root>/`. Default
  `veche`. Pattern `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`.
- **`<server-bin>`** — Absolute path to the MCP server entry
  (`<package-root>/dist/bin/veche-server.js` by default;
  overridable via `--server-bin <abs-path>`).
- **Atomic write template** — `<path>.tmp-<pid>-<ts>` then
  `rename(<tmp>, <path>)`. Mode `0o600` for both `SKILL.md` and
  `config.json`.
- **`runConfigBootstrap`** — Subroutine that seeds
  `${VECHE_HOME}/config.json` from
  `<package-root>/examples/config.json.example`. Skipped under
  `--skip-config`. Preserves an existing file unless `--force`.
- **HostTarget** — Per-host record `{ host, skillsRoot, cli,
  argvAdd, argvList?, argvRemove? }`. Built from `--for`. `host`
  ∈ {`claude-code`, `codex`, `hermes`}. `argvList` and
  `argvRemove` are present only on `claude-code`; `codex` and
  `hermes` rely on native overwriting `mcp add`.

### Partition record (install)

```yaml
---
id: install
type: Partition
partition_id: install
owner_team: cyberash
gate_scope:
  - install
dependencies_on_other_partitions:
  - meeting             # mcp-name pin must match the MCP tool prefix
  - agent-integration   # config.json shape is the Profile contract
default_policy_set:
  - install:POL-001
id_namespace: install
unmodeled_budget:
  current: 0
  baseline_at: "2026-05-02"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

### Brownfield baseline (install)

```yaml
---
id: install:BL-001
type: BrownfieldBaseline
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
discovery_scope:
  - src/adapters/inbound/cli/commands/install.ts
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts
  - skills/veche/SKILL.md
  - skills/veche/agents/openai.yaml
  - examples/config.json.example
coverage_evidence:
  - kind: git_tree_hash_v1
    reference: __FRESHNESS_TOKEN_INSTALL__
    note: |
      Token covers the install CLI command + its unit tests, the
      canonical skill artefact, and the canonical user-config
      template. The CLI shell (VecheCli.ts) and the package
      entrypoints (bin/) are intentionally excluded — they are
      cross-cutting CLI infrastructure not owned by any single
      partition. The bootstrap config-bootstrap subroutine
      (`runConfigBootstrap`) and the `--skip-config` / `--home`
      flags described in the legacy spec are present in the
      working tree at the point this baseline is recorded; the
      operator MUST commit those changes before recomputing the
      freshness_token (sdd check otherwise reports baseline-dirty).
freshness_token: __FRESHNESS_TOKEN_INSTALL__
baseline_commit_sha: 0c35cc4593d56f0ed632a46a7a739de98fb1f17a
mechanism: git_tree_hash_v1
notes: |
  BL-001 lifecycle remains proposed until a non-agent owner
  records an approval_record via `sdd approve`.
---
```

### Surfaces (install)

```yaml
---
id: install:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
name: veche/install-cli
version: "0.4.0"
boundary_type: cli
members:
  - install:CTR-001
  - install:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
  CLI Surface for `veche install`. Renaming a flag, removing a
  default value, or changing exit-code semantics is a major bump.
  Adding a new flag (default-off) or a new opt-in argument is a
  minor bump. The host-CLI argv templates (CTR-002) are part of
  this Surface — operators script around them.

  0.3.0 added the host-CLI binary resolution rule (PATHEXT-aware on
  Windows) and the `cmd.exe /d /s /c` wrapper-launch form for
  resolved `.cmd`/`.bat` host CLIs (npm shim shape on Windows).
  Operators get a usable Windows install flow without an explicit
  `CLAUDE_BIN`/`CODEX_BIN` override; the argv templates over the
  wire are unchanged.

  0.4.0 extends `--for` with the `hermes` value, registering Veche
  inside Hermes Agent (`~/.hermes/config.yaml` via `hermes mcp add`).
  Default `--for=both` semantics stay `{claude-code, codex}` for
  backwards compatibility; Hermes must be opted into explicitly.
---
```

```yaml
---
id: install:SUR-002
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
name: veche/skill-artefact
version: "0.2.0"
boundary_type: generated_published_artifact
members:
  - install:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  Published artefact: the canonical skill directory shipped via npm
  `files`, including `<package-root>/skills/<mcp-name>/SKILL.md`
  and optional `<package-root>/skills/<mcp-name>/agents/openai.yaml`.
  Both Claude Code and Codex consume byte-identical copies. A
  semantic-breaking diff (e.g. removing the front-matter `name`
  field, retiring an MCP tool reference) is a major bump on this
  Surface AND requires a coordinated bump on meeting:SUR-001.
---
```

### Behaviors (install)

```yaml
---
id: install:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: install parses argv, resolves package paths, runs the deploy plan in order
given: |
  - operator invokes `veche install` with optional flags
when: caller invokes `runInstall(cmd, deps)`
then: |
  1. validate flags per CTR-001 (mutually-exclusive --skills-only
     /--mcp-only; --mcp-name regex; --server-bin absolute and
     existing; --for in {claude-code, codex, hermes, both} default
     both).
  2. resolve canonical sources:
     - skill: <package-root>/skills/<mcp-name>/SKILL.md (exit 2
       on miss)
     - optional skill metadata:
       <package-root>/skills/<mcp-name>/agents/openai.yaml (copied
       when present)
     - server-bin: --server-bin || <package-root>/dist/bin/veche-server.js
       (exit 2 on miss)
     - config template: <package-root>/examples/config.json.example
       (exit 2 on miss when --skip-config absent)
  3. run config bootstrap (BEH-002) — host-agnostic; runs once
     per invocation.
  4. expand `--for` into a HostTarget list (declaration order:
     claude-code first, codex second on `both`; `hermes` is only
     selected when explicitly passed — it is NOT a member of
     `both` in v0.4).
  5. for each target, in declaration order, do BEH-003 (skill
     write) followed by BEH-004 (MCP register), each individually
     skippable via `--mcp-only` / `--skills-only`. Log
     `[<host>] ok` after both steps requested for that target
     finished.
  6. on missing host CLI without --force: exit 2 after the
     completed targets log; with --force: log warning and
     continue.
  7. on host CLI non-zero exit: log host stderr verbatim, exit 2,
     do NOT attempt the next host.
  8. on success across all targets, print `done.` to stderr and
     exit 0.
  All output goes to stderr; stdout is reserved for future
  machine-readable output and is unused in v1.
negative_cases:
  - bad flag / contradictory combo                   => UsageError, exit 64
  - skill source missing                              => SkillSourceMissing, exit 2
  - config source missing (without --skip-config)     => ConfigSourceMissing, exit 2
  - server-bin missing                                => ServerBinMissing, exit 2
  - host CLI missing on PATH without --force          => HostCliMissing, exit 2
  - host CLI resolved but spawn failed                => HostCliSpawnFailed, exit 2
  - host CLI non-zero exit                            => HostCliFailed, exit 2
  - skill / config write failure                      => WriteFailed, exit 2
  - any unhandled exception                           => InternalError, exit 1
out_of_scope:
  - hot-reload of the skill on a running host (operators restart the host CLI)
  - migrating an existing legacy hand-edited entry (operators delete + re-run)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(mcp-name,host)"
  time_source: external
  reason: tmp suffix uses Clock-supplied timestamp for deterministic tests
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts exercises every documented exit code, the
    --dry-run no-op path, the --skills-only / --mcp-only mutual
    exclusion, and the --force "continue past missing host CLI"
    behaviour.
  test_template: integration
  boundary_classes:
    - default --for=both happy path
    - --for=claude-code only
    - --for=codex only
    - --for=hermes only
    - --skills-only
    - --mcp-only
    - --dry-run
    - missing host CLI without --force (exit 2)
    - missing host CLI with --force (skip + continue)
    - host CLI non-zero exit
    - skill write failure
    - skill source missing in package
  failure_scenarios:
    - skill source missing silently succeeds
    - host CLI non-zero exit ignored
    - config bootstrap overwrites existing file without --force
---
```

```yaml
---
id: install:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: config bootstrap seeds ${VECHE_HOME}/config.json once, preserves on subsequent runs
given: |
  - --skip-config is absent
  - the config template
    (<package-root>/examples/config.json.example) exists
when: caller invokes `runConfigBootstrap(cmd, deps)`
then: |
  1. resolve VECHE_HOME via cmd.homeOverride || env.VECHE_HOME ||
     `${homedir()}/.veche`.
  2. compute target = `<vecheHome>/config.json`.
  3. if --dry-run: log `(dry-run) writing config file → <target>`
     and skip; return outcome=ok.
  4. else if `--force` is NOT set AND target exists: log
     `(exists) config file → <target>`; return outcome=skipped.
  5. else: atomic write of the template to target via
     `<target>.tmp-<pid>-<ts>` mode 0o600 then rename; create
     parent dirs as needed (`mkdir -p` semantics with default
     mode); log `writing config file → <target>`; return
     outcome=ok.
  6. on read failure of the template: log `config source not
     found at <source>`; return outcome=error,
     message='config-source-missing'. The caller (BEH-001 step 3)
     converts this to exit 2 and does NOT proceed to host steps.
  This subroutine emits NO `[<host>]` prefix because the config
  is host-agnostic.
negative_cases:
  - template missing                                 => exit 2 with config-source-missing
  - write failure (permissions / disk full)          => exit 2 with WriteFailed; no host step runs
out_of_scope:
  - migrating an existing config file (the operator's content is the source of truth)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(vecheHome,configPath)"
  time_source: external
  reason: tmp suffix uses Clock for tests
data_scope: new_writes_only
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    First run with no existing config writes the template
    byte-identically to the destination with mode 0o600. Second
    run preserves the file (line `(exists) config file → …`).
    Second run with --force overwrites. --skip-config skips the
    step entirely. --dry-run logs but performs no I/O.
  test_template: integration
  boundary_classes:
    - first run (write)
    - second run (preserve)
    - second run + --force (overwrite)
    - --skip-config (no I/O)
    - --dry-run (log only)
    - template missing in package
    - write failure
  failure_scenarios:
    - existing config silently overwritten without --force
    - --dry-run touches the filesystem
    - mode != 0o600
---
```

```yaml
---
id: install:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: skill artefact placement is atomic per host
given: |
  - target host is selected by --for
  - --mcp-only is absent
when: install runs the skill-write step for one HostTarget
then: |
  1. compute path = `<skillsRoot>/<mcp-name>/SKILL.md` where
     skillsRoot is `${HOME}/.claude/skills` for claude-code,
     `${HOME}/.codex/skills` for codex, or `${HOME}/.hermes/skills`
     for hermes.
  2. compute optional metadata path =
     `<skillsRoot>/<mcp-name>/agents/openai.yaml` when the package
     contains the canonical metadata source.
  3. mkdir -p the parent directories.
  4. atomic write: write each destination to
     `<path>.tmp-<pid>-<ts>` mode 0o600;
     fsync; rename to `<path>`.
  5. log `[<host>] writing skill file → <path>` to stderr; when
     metadata is present, log `[<host>] writing skill metadata → <path>`.
  6. on write failure: best-effort delete of the .tmp file; log
     `[<host>] error: cannot write <path>: <message>`; return
     exit 2 from the orchestrator (BEH-001 step 7 routes).
negative_cases:
  - parent dir not creatable (e.g. permissions)      => WriteFailed, exit 2
  - rename fails (cross-FS / collision)              => WriteFailed, exit 2
out_of_scope:
  - merging with an existing skill file (overwrite semantics; operator manages history out of band)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(host,mcp-name)"
  time_source: external
data_scope: new_writes_only
policy_refs:
  - install:POL-001
  - install:POL-002
test_obligation:
  predicate: |
    Happy path produces a destination file byte-identical to the
    canonical source under skills/. When metadata exists, its
    destination is byte-identical too. Mode is 0o600. A reader
    polling the destination during repeated installs never observes
    a partial / truncated file. Failed rename leaves no
    `<path>.tmp-*` orphan in the parent directory.
  test_template: integration
  boundary_classes:
    - first install
    - re-install (overwrite)
    - permission failure on parent
    - rename failure (cleanup)
  failure_scenarios:
    - half-written SKILL.md visible to a host
    - mode wider than 0o600
    - tmp orphan after rename failure
---
```

```yaml
---
id: install:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: "MCP register: claude-code probes-then-removes-then-adds; codex and hermes single-add (overwrite)"
given: |
  - target host is selected
  - --skills-only is absent
when: install runs the MCP-register step for one HostTarget
then: |
  Claude Code path:
    1. spawn `<claude> mcp list` (no --scope; the row test is
       sufficient for the user-scope namespace).
    2. parse stdout line by line; if any line begins with
       `<mcp-name>:`, spawn
       `<claude> mcp remove <mcp-name> --scope user`. Ignore
       remove non-zero exits ONLY when stderr says "not found";
       otherwise propagate as exit 2.
    3. spawn
       `<claude> mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>`.
       Non-zero exit -> exit 2.
    4. log `[claude-code] mcp register: <argv joined by space>`
       BEFORE spawning step 3; log `[claude-code] ok` AFTER both
       skill+register requested steps finished for this target.
  Codex path:
    1. spawn
       `<codex> mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>`.
       Codex `mcp add` overwrites natively, so no probe is needed.
       Non-zero exit -> exit 2.
    2. log lines as above.
  Hermes path:
    1. spawn
       `<hermes> mcp add <mcp-name> --command node --args <server-bin>`.
       Hermes `mcp add` rewrites the `mcp_servers.<mcp-name>`
       entry in `~/.hermes/config.yaml` natively, so no probe
       is needed. Non-zero exit -> exit 2.
    2. The `VECHE_LOG_LEVEL=info` env hint is NOT forwarded on
       this path: Hermes' `mcp add` argv does not have a
       documented env flag, and the install partition's
       inviolable rule is to delegate to the host CLI rather than
       editing `~/.hermes/config.yaml` directly. Operators that
       need a non-default log level edit the YAML manually.
    3. log lines as above (`[hermes] …`).
  Probe step (BEFORE step 1 of either path):
    - resolve the host CLI per CTR-002 `binary_resolution` (env
      override or PATH; PATHEXT honoured on win32).
    - spawn `<host-cli> --version` via the platform launcher
      (CTR-002 `windows_wrapper_launch` on win32 for `.cmd`/`.bat`
      wrappers; direct spawn elsewhere). Resolver returning null
      classifies the host CLI as missing on PATH (BEH-001 step 6
      routes to exit 2 or skip under --force). Spawn failure on
      a resolved path is reported separately as
      HostCliSpawnFailed (BEH-001 step 7) so the operator can
      tell PATH-miss from wrapper-launch failure.
  Argv MUST be constructed in code; no user-supplied string is
  interpolated unquoted. The mcp-name is validated against
  `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` before any subprocess uses it.
  --dry-run skips both the probe and the register subprocess.
negative_cases:
  - host CLI missing (ENOENT on probe)               => HostCliMissing
  - non-zero exit from list / remove / add           => HostCliFailed, exit 2
  - mcp-name failed regex (CT-001 violation)         => UsageError, exit 64 (caught at parse)
out_of_scope:
  - editing host config files directly (NEVER done; both hosts expose CLI subcommands)
  - removing the MCP entry on uninstall (no `veche uninstall` in v1)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(host,mcp-name)"
  time_source: none
data_scope: new_writes_only
policy_refs:
  - install:POL-001
  - install:POL-002
test_obligation:
  predicate: |
    install.test.ts exercises (a) the probe-list-remove-add
    sequence on Claude Code with an existing entry, (b) the
    single-add path on Codex, (c) the single-add path on Hermes,
    (d) the missing-CLI path with and without --force, (e) the
    non-zero-exit path on each host CLI. Captured argv match the
    documented templates; no user input leaks into the spawned
    argv unquoted.
  test_template: integration
  boundary_classes:
    - claude-code with no prior entry
    - claude-code with prior entry (probe -> remove -> add)
    - codex single-add
    - hermes single-add
    - --dry-run (probe + register skipped)
    - host CLI missing without --force
    - host CLI missing with --force
    - non-zero exit on remove (not "not found")
  failure_scenarios:
    - argv shape drift unbumped
    - direct edit of ~/.claude.json, ~/.codex/config.toml, or ~/.hermes/config.yaml
    - mcp-name interpolated unquoted into argv
---
```

### Contracts (install)

```yaml
---
id: install:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: veche install CLI argv shape and exit codes
surface_ref: install:SUR-001
schema:
  description: |
    The argv shape accepted by `veche install` and its exit-code
    semantics.
  argv: |
    veche install
      [--for claude-code|codex|hermes|both]     (default both; `both`=claude+codex, hermes opt-in only)
      [--mcp-name <name>]                       (default 'veche'; ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$)
      [--server-bin <abs-path>]                 (default <package-root>/dist/bin/veche-server.js)
      [--skills-only]                           (mutually exclusive with --mcp-only)
      [--mcp-only]                              (mutually exclusive with --skills-only)
      [--force]
      [--skip-config]
      [--dry-run]
      [--no-color]
      [--home <abs-path>]
  exit_codes: |
    0   success / opener-warn-only
    1   InternalError (any unhandled exception)
    2   SkillSourceMissing / ConfigSourceMissing /
        ServerBinMissing / HostCliMissing / HostCliSpawnFailed /
        HostCliFailed / WriteFailed
    64  UsageError (unknown flag, bad value, contradictory combo)
external_identifiers:
  - "command name: install"
  - flag names listed in argv
  - "default values: both, veche, VECHE_LOG_LEVEL=info"
  - "--for enum: claude-code, codex, hermes, both"
  - "exit code integers: 0, 1, 2, 64"
compatibility_rules:
  - renaming a flag                                => major bump on SUR-001
  - widening exit-code semantics                   => major bump
  - changing default --for, default --mcp-name, or default --server-bin path => major bump
  - adding a default-off flag                      => minor bump
  - adding a new --for value                       => minor bump
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts asserts every documented exit-code branch
    and every flag's positive + negative validation rule. The
    cli.integration.test.ts covers the bad-flag (exit 64) path.
  test_template: integration
  boundary_classes:
    - default flags
    - --for=claude-code
    - --for=codex
    - --for=hermes
    - --skills-only
    - --mcp-only
    - --dry-run
    - bad --mcp-name
    - --skills-only + --mcp-only (rejected)
  failure_scenarios:
    - flag rename unbumped
    - exit code drift unbumped
---
```

```yaml
---
id: install:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: host-CLI argv templates (`claude mcp …`, `codex mcp …`, `hermes mcp …`)
surface_ref: install:SUR-001
schema:
  description: |
    The exact argv shapes that install spawns. Operators script
    around these when wiring multi-environment provisioning
    (e.g. dotfiles bootstrap pipelines).
  claude_code: |
    probe   : claude --version
    list    : claude mcp list
    remove  : claude mcp remove <mcp-name> --scope user
    add     : claude mcp add <mcp-name> --scope user -e VECHE_LOG_LEVEL=info -- node <server-bin>
  codex: |
    probe   : codex --version
    add     : codex mcp add <mcp-name> --env VECHE_LOG_LEVEL=info -- node <server-bin>
  hermes: |
    probe   : hermes --version
    add     : hermes mcp add <mcp-name> --command node --args <server-bin>
  binary_resolution: |
    claude binary: env CLAUDE_BIN || PATH('claude')
    codex  binary: env CODEX_BIN  || PATH('codex')
    hermes binary: env HERMES_BIN || PATH('hermes')
    On Windows (process.platform === 'win32') the resolver MUST
    honour PATHEXT (e.g. .CMD, .BAT, .EXE) when the env override
    is a bare command name; it MUST also accept an absolute path
    that points directly at a `.cmd` / `.bat` / `.exe` wrapper.
    Resolution failure (no candidate accessible as a file) is the
    sole signal classified as "host CLI missing on PATH".
  windows_wrapper_launch: |
    When the resolved binary path ends with `.cmd` or `.bat` AND
    process.platform === 'win32', install MUST launch the host
    CLI via `cmd.exe /d /s /c <resolved-bin> <args...>` (Node's
    documented safe form for batch wrappers post CVE-2024-27980).
    Each argument is quoted using the standard Windows argv
    rule (double-quote wrapping, `"` -> `\"`, trailing backslash
    doubling). On non-Windows, or when the resolved binary is a
    plain executable, install spawns it directly with no shell.
    The argv content the host CLI observes is identical across
    platforms; only the launch primitive differs.
  forbidden: |
    install MUST NOT spawn any binary outside { <claude>, <codex>,
    <hermes>, <opener> for show --open path which is owned by the
    meeting partition }. install never spawns an opener. The
    single permitted use of `cmd.exe` is the wrapper-launch form
    described in `windows_wrapper_launch`; `cmd.exe /c <free-form>`
    or any shell-prefixed string is forbidden.
  argv_construction_rules: |
    - mcp-name validated against ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$ BEFORE
      it appears in any argv
    - server-bin validated as absolute and existing BEFORE it
      appears in any argv
    - no shell interpolation: argv is passed as an array to
      child_process.spawn; no `bash -c`, no `sh -c`, no template
      strings into a shell. The Windows wrapper-launch form keeps
      the same array shape (cmd.exe + fixed flags + resolved bin
      + per-argument-quoted args); no free-form shell string is
      ever constructed.
external_identifiers:
  - "argv literals: mcp, list, add, remove, --scope, user, -e, --env, --command, --args, --, node"
  - "env literal: VECHE_LOG_LEVEL=info"
  - "host-binary discovery env vars: CLAUDE_BIN, CODEX_BIN, HERMES_BIN"
compatibility_rules:
  - renaming a literal in the argv (e.g. dropping `--`)         => major bump on SUR-001
  - changing the env-pass form (-e vs --env across hosts)       => major bump
  - widening allowed binaries beyond { claude, codex, hermes }  => major bump (security regression)
  - changing VECHE_LOG_LEVEL default                            => major bump (operator scripts grep logs)
  - adding a new host with its own argv template                => minor bump (this is how 0.4.0 introduced hermes)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    Captured argv during install.test.ts paths matches the
    documented templates byte-for-byte (modulo placeholder
    substitution). A regex probe over the source rejects any
    occurrence of `bash -c` / `sh -c` / `child_process.exec(` in
    install.ts (only spawn-with-array forms are allowed).
  test_template: contract
  boundary_classes:
    - claude-code happy
    - codex happy
    - hermes happy
    - probe argv
  failure_scenarios:
    - shell interpolation introduced
    - additional binary spawned
---
```

```yaml
---
id: install:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: skill artefacts (SKILL.md + optional host UI metadata)
surface_ref: install:SUR-002
schema:
  description: |
    The canonical skill directory shipped under skills/<mcp-name>/
    and copied byte-identically to each host. SKILL.md is required.
    agents/openai.yaml is optional host UI metadata.
  front_matter: |
    ---
    name: veche
    description: |
      Convene a symmetric committee meeting between Codex and a
      fresh Claude Code instance on a single question, then
      report each participant's stance and the consensus.
    triggers:
      - "second opinion"
      - "convene a committee"
      - "hold a meeting"
    ---
  body_summary: |
    The body documents the ten veche/* MCP tools (start_meeting,
    send_message, get_response, get_transcript, list_meetings,
    end_meeting, cancel_job, submit_human_turn,
    set_human_participation, submit_synthesis), the Profile system,
    Human Participant launch choices, role customization, and operator
    expectations. Both hosts surface the front-matter `name` +
    `description` to the user agent; the body is consumed when the
    agent invokes the skill.
  optional_metadata: |
    agents/openai.yaml, when present, is copied to both host skill
    directories with byte-identical content. It contains host UI
    metadata only; SKILL.md remains the behavioural source of truth.
external_identifiers:
  - "front-matter field names: name, description, triggers"
  - "optional metadata path: agents/openai.yaml"
  - >-
    the literal `name: veche` (the `name` MUST equal the `mcp-name`
    flag default to keep the host-agent invocation aligned with the
    `mcp__<mcp-name>__*` tool prefix)
compatibility_rules:
  - removing a front-matter field                  => major bump on SUR-002
  - renaming a triggered phrase                    => minor bump (host agent matches loosely)
  - retiring a referenced MCP tool                 => major bump on SUR-002 + meeting:SUR-001
  - swapping the `name` value away from the default mcp-name => major bump (operator scripts may break)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: artefact_describes_static_markdown
  reason: file is published once per release, copied per install
data_scope: all_data
policy_refs:
  - install:POL-001
test_obligation:
  predicate: |
    install.test.ts asserts the destination SKILL.md and optional
    agents/openai.yaml are byte-identical to the package sources,
    the front-matter parses, and `name === 'veche'` (or the supplied
    --mcp-name).
  test_template: contract
  boundary_classes:
    - default mcp-name
    - operator override --mcp-name=foo
  failure_scenarios:
    - destination drifts from source
    - front-matter rename unbumped
---
```

### Invariants (install)

```yaml
---
id: install:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: install never opens MeetingStorePort and never reads ${VECHE_HOME}/meetings/
always: |
  The install command MUST NOT instantiate MeetingStorePort, MUST
  NOT read or write any path under `${VECHE_HOME}/meetings/`, and
  MUST NOT inspect existing meeting data. The only permitted
  touch under `${VECHE_HOME}` is the bootstrap `config.json`
  write performed by `runConfigBootstrap` (BEH-002). Tests inject
  a mock store whose every method throws and assert the install
  command never trips it.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_io_scope_negation
  reason: rule about which I/O the partition is forbidden to perform
negative_cases:
  - install instantiates FileMeetingStore           => contract violation
  - install reads ${VECHE_HOME}/meetings/             => contract violation
out_of_scope:
  - the bootstrap config.json write (covered by BEH-002 + POL-001)
test_obligation:
  predicate: |
    install.test.ts injects a throwing mock for every store
    method and asserts the entire install flow (every flag combo)
    completes without tripping any. A regex probe over
    install.ts confirms no `MeetingStore`, `meetings/`,
    `events.jsonl`, or `manifest.json` reference.
  test_template: integration
  boundary_classes:
    - default flags
    - --skills-only
    - --mcp-only
    - --dry-run
  failure_scenarios:
    - install reaches into the meeting store
---
```

```yaml
---
id: install:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: only allow-listed binaries are spawned with fixed argv shapes
always: |
  install spawns ONLY `<claude>`, `<codex>`, and `<hermes>`
  (resolved via CLAUDE_BIN / CODEX_BIN / HERMES_BIN env or PATH;
  PATHEXT honoured on win32). The single permitted use of
  `cmd.exe` is the Windows wrapper-launch form `cmd.exe /d /s /c
  <resolved-bin> <args...>` defined in CTR-002
  (`windows_wrapper_launch`), used only when the resolved host
  CLI is a `.cmd`/`.bat` wrapper on win32. install NEVER spawns
  `bash`, `sh`, `npm`, `node` (other than as the `node
  <server-bin>` argv tail forwarded to a Claude/Codex host CLI),
  or any other binary. Argv is constructed in code as a string
  array; no user input is interpolated unquoted; no free-form
  shell string is ever passed to a shell.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  not_applicable: invariant_describes_static_spawn_set
  reason: rule about which binaries may appear at child_process.spawn
negative_cases:
  - install spawns `bash -c "claude mcp …"`         => contract violation
  - install spawns `npm run …`                      => contract violation
out_of_scope:
  - the host CLIs spawning their own subprocesses (out of our control)
test_obligation:
  predicate: |
    install.test.ts captures every spawn invocation and asserts
    argv[0] is in the documented set { '<claude>', '<codex>',
    '<hermes>' } OR is the Windows wrapper-launch form
    `cmd.exe /d /s /c <resolved-bin>` where `<resolved-bin>` ends
    with `.cmd` or `.bat`. A regex probe over install.ts rejects
    `child_process.exec(`, `bash -c`, `sh -c`. A separate test
    (fake win32 platform + fake which resolving to
    `C:\\fake\\codex.cmd`) asserts the wrapper-launch form is
    used and that args are individually quoted.
  test_template: integration
  boundary_classes:
    - claude-code path (probe + list + remove + add)
    - codex path (probe + add)
    - hermes path (probe + add)
    - --dry-run (no spawn)
    - win32 wrapper-launch (.cmd resolved bin)
  failure_scenarios:
    - shell interpolation introduced
    - bash invocation
    - cmd.exe used with /c <free-form-string>
---
```

```yaml
---
id: install:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: filesystem writes are bounded to two paths and atomic
always: |
  install writes ONLY to:
    - `<host-skills-root>/<mcp-name>/SKILL.md` per requested host
      (where `<host-skills-root>` ∈ { `${HOME}/.claude/skills`,
      `${HOME}/.codex/skills`, `${HOME}/.hermes/skills` })
    - `<host-skills-root>/<mcp-name>/agents/openai.yaml` per
      requested host when the package contains optional metadata
    - `${VECHE_HOME}/config.json` (only when absent or --force)
  Every write uses `<path>.tmp-<pid>-<ts>` mode 0o600 followed
  by `rename`; on rename failure the .tmp file is best-effort
  removed. Host config files (`~/.claude.json`,
  `~/.codex/config.toml`, `~/.hermes/config.yaml`) are NEVER
  edited directly.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: new_writes_only
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: none
  time_source: external
  reason: tmp suffix uses Clock-supplied timestamp for determinism in tests
negative_cases:
  - install writes to ~/.claude.json directly                  => contract violation
  - install writes to ~/.hermes/config.yaml directly           => contract violation
  - install writes to a path outside the allow-listed targets  => contract violation
out_of_scope:
  - host CLI's own writes (the host's `mcp add` writes its own
    config; install delegates and never reads or asserts on it)
test_obligation:
  predicate: |
    install.test.ts captures every fs.writeFile / fs.rename call
    and asserts the destination path matches one of the allow-listed
    templates. Mode is 0o600 on all file writes.
  test_template: integration
  boundary_classes:
    - SKILL.md write
    - config.json first write
    - rename failure cleanup
  failure_scenarios:
    - direct edit of ~/.claude.json
    - mode wider than 0o600
    - tmp orphan after rename failure
---
```

```yaml
---
id: install:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: install is idempotent across runs with the same flags
always: |
  Running `veche install` with the same flags twice produces the
  same end state:
    - SKILL.md is overwritten in place; the byte-for-byte content
      matches the package source.
    - Claude Code MCP entry: probe-then-remove-then-add path
      converges to a single user-scope entry named `<mcp-name>`
      pointing at the current `<server-bin>`.
    - Codex MCP entry: `mcp add` overwrites natively; the latest
      `<server-bin>` wins.
    - Hermes MCP entry: `mcp add` rewrites
      `mcp_servers.<mcp-name>` in `~/.hermes/config.yaml`
      natively; the latest `<server-bin>` wins.
    - `${VECHE_HOME}/config.json`: written exactly once on the
      first run; preserved on every subsequent run unless `--force`.
  The server-bin path picked up on the second run reflects the
  current installation, so re-running after `npm i -g <newer>`
  updates the registration.
scope: install (entire partition)
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single_per_resource
  read_consistency: strong
  idempotency: "exactly_once_with_key:(mcp-name,host)"
  time_source: external
  reason: idempotency is verified across two consecutive Clock-stamped runs
negative_cases:
  - second run leaves two entries on Claude Code   => contract violation (duplicate)
  - second run silently overwrites config.json without --force => contract violation
out_of_scope:
  - rolling back partial state from a failed first run (operator re-runs)
test_obligation:
  predicate: |
    install.test.ts runs the install flow twice with the same
    flags and asserts: (a) the SKILL.md content is identical,
    (b) `claude mcp list` invoked between runs would show
    exactly one `<mcp-name>:` row, (c) `${VECHE_HOME}/config.json`
    content is unchanged after run 2 unless --force was passed.
  test_template: integration
  boundary_classes:
    - two consecutive default runs
    - second run with --force
    - server-bin path changed between runs (registration refresh)
  failure_scenarios:
    - duplicate Claude Code entry after run 2
    - config.json silently overwritten
---
```

### Policies (install)

```yaml
---
id: install:POL-001
type: Policy
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: install I/O is bounded to documented files, host CLIs, and stderr
policy_kind: io_scope
applicability:
  applies_to: |
    every BEH in this partition (BEH-001..004). Includes the
    helper modules under src/adapters/inbound/cli/lib used by
    install.
predicate: |
  - Filesystem writes ONLY to the allow-listed targets per
    INV-003.
  - Filesystem reads MAY include the canonical skill source,
    canonical config template, server-bin existence check, and
    target-existence checks for the bootstrap config. Reading
    `${VECHE_HOME}/meetings/` is FORBIDDEN per INV-001.
  - Subprocesses ONLY: `<claude>` (Claude Code path), `<codex>`
    (Codex path), and `<hermes>` (Hermes Agent path), with the
    documented argv from CTR-002. No other binary.
  - Logs to stderr ONLY. Stdout is unused in v1.
  - Env: reads VECHE_HOME, HOME (default derivation), CLAUDE_BIN,
    CODEX_BIN, HERMES_BIN, NO_COLOR. MUST NOT read CODEX_API_KEY.
negative_test_obligations:
  - >-
    throwing mock store: every install path completes without
    tripping any store method
  - >-
    argv capture: only documented binaries spawned with documented
    argv shapes
  - stdout-empty assertion across every documented path
  - "regex probe: no `process.env.CODEX_API_KEY` in install.ts"
test_obligation:
  predicate: same as negative_test_obligations
  test_template: integration
  boundary_classes:
    - all documented flag combos
  failure_scenarios:
    - install writes to stdout
    - install reads CODEX_API_KEY
    - install touches the meeting store
---
```

```yaml
---
id: install:POL-002
type: Policy
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
title: argv to host CLIs is constructed in code; no shell, no string interpolation
policy_kind: security_boundary
applicability:
  applies_to: |
    BEH-004 + the helper that resolves HostTarget records.
predicate: |
  - All host-CLI invocations use child_process.spawn with an
    argv array. No `child_process.exec`, no `bash -c`, no
    `sh -c`, no `cmd.exe /c`.
  - The `mcp-name` is validated against the documented regex
    BEFORE it appears in any argv.
  - The `server-bin` is validated as an absolute path to an
    existing file BEFORE it appears in any argv.
  - The default env value (`VECHE_LOG_LEVEL=info`) is constant
    and not derived from operator input.
  - The Claude Code remove-then-add path treats stderr "not
    found" as the only acceptable non-zero outcome on remove;
    every other failure is propagated.
negative_test_obligations:
  - >-
    regex probe over install.ts: zero `child_process.exec(`,
    `bash -c`, `sh -c`, `cmd.exe /c`
  - >-
    argv capture: every spawn argv equals the documented template
    byte-for-byte modulo `<mcp-name>` and `<server-bin>`
test_obligation:
  predicate: same as negative_test_obligations
  test_template: contract
  boundary_classes:
    - claude-code argv
    - codex argv
    - hermes argv
    - probe argv
  failure_scenarios:
    - shell interpolation introduced
    - argv shape drift unbumped
---
```

### Constraints (install)

```yaml
---
id: install:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
constraint: |
  install uses ONLY Node built-ins (`node:fs/promises`, `node:os`,
  `node:path`, `node:child_process`, `node:url`). No third-party
  dependency may be introduced for argv parsing, subprocess
  management, or filesystem I/O.
rationale: |
  The flag set is small; the host-CLI argv shapes have specific
  requirements (the `--` argv separator, scoped --scope flags)
  that benefit from exact control. A third-party process library
  could also re-introduce shell interpolation that POL-002
  forbids.
test_obligation:
  predicate: |
    package.json `dependencies` contain no entries other than
    Node built-ins for the install path. Importing
    src/adapters/inbound/cli/commands/install.ts and traversing
    its imports yields only first-party files and Node built-ins.
  test_template: contract
  boundary_classes:
    - dependency snapshot at build time
  failure_scenarios:
    - a third-party process library appears in a future PR
---
```

### Implementation bindings (install)

```yaml
---
id: install:IMP-001
type: ImplementationBinding
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
target_ids:
  - install:BEH-001
  - install:BEH-002
  - install:BEH-003
  - install:BEH-004
  - install:CTR-001
  - install:CTR-002
  - install:CTR-003
  - install:INV-001
  - install:INV-002
  - install:INV-003
  - install:INV-004
binding:
  command: src/adapters/inbound/cli/commands/install.ts
  tests:
    - src/adapters/inbound/cli/commands/__tests__/install.test.ts
  artefacts:
    skill_source: skills/veche/SKILL.md
    skill_metadata: skills/veche/agents/openai.yaml
    config_template: examples/config.json.example
authority: code_annotation
verification_method: |
  Each BEH-/CTR-/INV-* listed above is exercised by tests in
  src/adapters/inbound/cli/commands/__tests__/install.test.ts
  with FakeSubprocessRunner and a tmp-dir-based filesystem.
  Tests that close a Test obligation carry an
  `// @covers install:<ID>` marker.
---
```

### Open questions (install)

```yaml
---
id: install:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
question: |
  Should install ship a `veche uninstall` command that removes
  the skill file and the host MCP entry, or stay install-only in
  v1 and document operator-side cleanup in the README?
options:
  - id: a
    label: keep_install_only_v1
    consequence: |
      v1 stays as-is. Operators run `claude mcp remove veche --scope user`
      and `codex mcp remove veche` themselves; SKILL.md is
      deleted manually. Simple; matches current code.
  - id: b
    label: introduce_uninstall_v1
    consequence: |
      Add `veche uninstall` mirroring the install flag set
      (--for, --skip-config). New BEH + CT, new tests for the
      "no entry to remove" path. Minor bump on SUR-001 (new
      command) plus on SUR-002 if the skill artefact's
      compatibility-action is widened.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

```yaml
---
id: install:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
question: |
  Should install detect a Claude Code `mcp list` output schema
  drift (new column ordering, JSON output mode) and switch to a
  resilient parser, or stay with the line-prefix heuristic
  (`<mcp-name>:`)?
options:
  - id: a
    label: keep_line_prefix_v1
    consequence: |
      Stay with the simple heuristic. Risk: a Claude Code release
      that re-orders the row format silently breaks the probe.
      Mitigated by the integration test snapshot.
  - id: b
    label: switch_to_json_mode_v1
    consequence: |
      Use `claude mcp list --json` (if/when the host adds it).
      More robust; introduces a hard dependency on a specific
      Claude Code version. Minor bump on SUR-001 (new behaviour)
      and a new ASSUMPTION about the JSON schema.
blocking: no
owner: cyberash
default_if_unresolved: a
---
```

### Assumptions (install)

```yaml
---
id: install:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
assumption: |
  The host CLIs (`claude`, `codex`, `hermes`) honour the
  documented `mcp add` / `mcp list` / `mcp remove` argv shapes
  across minor version bumps. Drift surfaces in install.test.ts
  (which uses a FakeSubprocessRunner) only after the test
  fixtures are refreshed; an end-to-end smoke test against a
  real `claude` / `codex` / `hermes` is run on a dev machine
  before release cuts.
source_open_q: install:OQ-002
blocking: no
review_by: 2026-09-01
default_if_unresolved: keep_assumption
tests:
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts § "claude mcp list output parsing"
---
```

```yaml
---
id: install:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-05-08T22:39:48.324Z
    change_request: update old behavior
    scope: first-time-approval
partition_id: install
assumption: |
  Operators run `veche install` from the same machine where the
  MCP server will execute. Cross-machine deployment (write skill
  to one host, run the server on another) is out of v1 — the
  bootstrap relies on the resolved `--server-bin` path being
  reachable by the host CLI invoking it.
blocking: no
review_by: 2026-12-01
default_if_unresolved: keep_assumption
tests:
  - src/adapters/inbound/cli/commands/__tests__/install.test.ts § "server-bin resolution"
---
```

### Out of scope (install)

The following are explicitly **outside** the install partition's
gate and contract surface:

- Uninstall flow (OQ-001).
- Updating an existing config.json (operators edit by hand).
- Installing into hosts other than Claude Code, Codex, and
  Hermes Agent.
- Cross-machine provisioning (the resolved server-bin must be
  reachable from the host CLI's process).
- Migrating an existing skill file from a previous version
  (overwrite is the policy).
- Generating a per-host SKILL.md variant (the artefact is
  byte-identical across hosts; divergent variants require a spec
  change introducing a per-host template).

---
