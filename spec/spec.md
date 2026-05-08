# Veche — SDD Specification

This is the index. The contract is sharded by partition; one file per
partition under `spec/partitions/`. Each partition file is self-contained:
Context, Glossary, Partition record, BrownfieldBaseline, Surfaces,
Behaviours, Contracts, Invariants, Policies, Constraints, Migrations,
Deltas, Open questions, Assumptions, and Out-of-scope blocks for that
partition only.

| Partition | File |
|---|---|
| `persistence`         | [`partitions/persistence.md`](partitions/persistence.md) |
| `agent-integration`   | [`partitions/agent-integration.md`](partitions/agent-integration.md) |
| `committee-protocol`  | [`partitions/committee-protocol.md`](partitions/committee-protocol.md) |
| `meeting`             | [`partitions/meeting.md`](partitions/meeting.md) |
| `web-viewer`          | [`partitions/web-viewer.md`](partitions/web-viewer.md) |
| `install`             | [`partitions/install.md`](partitions/install.md) |

## How to navigate

- A normative ID looks like `<partition>:<TYPE>-<NNN>` (e.g.
  `meeting:BEH-007`, `install:CTR-002`). Open the matching
  `partitions/<partition>.md` and search for the ID.
- IDs are partition-scoped and never reused across partitions.
- Cross-partition references use the fully-qualified ID; the partition file
  defines the local IDs and references foreign IDs by full prefix.

## How the spec is enforced

- `sdd lint` validates each partition file independently.
- `sdd ready` evaluates each partition against its own records and the
  `@covers <partition>:<id>` markers in that partition's `test_paths` (see
  `.sdd/config.json`). No cross-partition record bleeding.
- `sdd approve` + `sdd finalize` flip `lifecycle.status` from `proposed` to
  `approved`. Self-approval by the code-gen agent is forbidden.

See `~/.claude/sdd/sdd-cli-usage.md` for the phase-to-command mapping and
`AGENTS.md` for repo conventions.
