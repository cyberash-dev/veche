#!/usr/bin/env bash
# Batch-approve every typed normative ID minted by the spec-migration
# of the five new partitions (agent-integration, committee-protocol,
# meeting, web-viewer, install). Each partition is approved as a
# single change_request via `sdd approve` (Step 1: pending attestation
# in a plan-namespace artefact) followed by `sdd finalize` (Step 2:
# atomic flip + graph validation).
#
# Persistence is NOT included — it was approved in a prior run and
# its IDs already carry approval_record blocks.
#
# Run from the repository root. Requires:
#   - working tree clean for `sdd ready`
#   - install partition's source paths committed (otherwise install BL
#     freshness_token must be recomputed via `sdd refresh` first)
#
# Usage:
#   ./scripts/sdd-approve-batch.sh
#
# Self-approval ban: sdd refuses --approver values that look like
# bot identities. Override APPROVER if the default 'cyberash' is not
# you.

set -euo pipefail

APPROVER="${APPROVER:-cyberash}"
OWNER_ROLE="${OWNER_ROLE:-tech-lead}"
SCOPE="${SCOPE:-first-time-approval}"

PARTITIONS=(
  agent-integration
  committee-protocol
  meeting
  web-viewer
  install
)

for P in "${PARTITIONS[@]}"; do
  PLAN="${P}-v1"
  CR="local/spec-migration-${P}-v1"
  echo
  echo "=== ${P}: sdd approve --plan ${PLAN} ==="
  sdd approve \
    --id "${P}:*" \
    --approver "${APPROVER}" \
    --owner-role "${OWNER_ROLE}" \
    --change-request "${CR}" \
    --scope "${SCOPE}" \
    --plan "${PLAN}"

  echo
  echo "=== ${P}: sdd finalize --plan ${PLAN} ==="
  sdd finalize --plan "${PLAN}"
done

echo
echo "=== sdd lint ==="
sdd lint

echo
echo "=== sdd ready ==="
sdd ready || true   # uncovered violations are expected (Stage 3, separate work)
