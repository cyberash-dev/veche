#!/usr/bin/env bash
# Approve every `unapproved` ID currently flagged by `sdd ready`, one
# partition glob at a time, then finalize.
#
# Usage:
#   scripts/sdd-approve-all.sh \
#     --approver <human-id> \
#     --owner-role <role> \
#     --change-request <url-or-token> \
#     [--scope first-time-approval] \
#     [--dry-run]
#
# Self-approval ban: <human-id> MUST be a real person, never an agent /
# bot / `sdd-cli` identity. See @sdd/sdd-cli-usage.md.

set -euo pipefail

APPROVER=""
OWNER_ROLE=""
CHANGE_REQUEST=""
SCOPE="first-time-approval"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --approver)        APPROVER="$2"; shift 2 ;;
    --owner-role)      OWNER_ROLE="$2"; shift 2 ;;
    --change-request)  CHANGE_REQUEST="$2"; shift 2 ;;
    --scope)           SCOPE="$2"; shift 2 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

[[ -z "$APPROVER"       ]] && { echo "missing --approver"       >&2; exit 64; }
[[ -z "$OWNER_ROLE"     ]] && { echo "missing --owner-role"     >&2; exit 64; }
[[ -z "$CHANGE_REQUEST" ]] && { echo "missing --change-request" >&2; exit 64; }

PLAN_TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
PLAN_SUFFIX="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5 || true)"
PLAN_ID="${PLAN_TS}-${PLAN_SUFFIX}"

# Collect every distinct partition that has at least one unapproved ID.
# `sdd ready` exits 1 when there are violations — that's the normal case
# here, so swallow that exit code without disabling errexit globally.
PARTITIONS_RAW=$(
  { npx --no-install sdd ready --format=json 2>/dev/null || true; } \
    | node -e '
        let d = "";
        process.stdin.on("data", c => d += c);
        process.stdin.on("end", () => {
          const j = JSON.parse(d);
          const parts = new Set();
          for (const v of j.violations || []) {
            if (v.kind !== "unapproved" || !v.id) continue;
            const idx = v.id.indexOf(":");
            if (idx > 0) parts.add(v.id.slice(0, idx));
          }
          for (const p of [...parts].sort()) console.log(p);
        });
      '
)

PARTITIONS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PARTITIONS+=("$line")
done <<< "$PARTITIONS_RAW"

if [[ ${#PARTITIONS[@]} -eq 0 ]]; then
  echo "nothing to approve."
  exit 0
fi

echo "plan_id     : $PLAN_ID"
echo "approver    : $APPROVER"
echo "owner-role  : $OWNER_ROLE"
echo "change-req  : $CHANGE_REQUEST"
echo "scope       : $SCOPE"
echo "partitions  : ${PARTITIONS[*]}"
echo

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

for P in "${PARTITIONS[@]}"; do
  run npx --no-install sdd approve \
    --id "${P}:*" \
    --approver "$APPROVER" \
    --owner-role "$OWNER_ROLE" \
    --change-request "$CHANGE_REQUEST" \
    --scope "$SCOPE" \
    --plan "$PLAN_ID"
done

echo
run npx --no-install sdd finalize --plan "$PLAN_ID"

echo
echo "post-finalize:"
npx --no-install sdd ready 2>&1 | tail -3 || true
