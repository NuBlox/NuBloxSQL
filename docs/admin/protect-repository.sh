#!/usr/bin/env bash
set -euo pipefail
REPO="NuBlox/NuBloxSQL"
ARCHIVE="archive/legacy-implementation-2026-10-16"
ARCHIVE_SHA="4ed0e35fbfe71ac110c9ec41cf62ba3355e9d56c"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="verify"
if [[ "$#" -gt 0 ]]; then MODE="$1"; fi
die() { echo "ERROR: $*" >&2; exit 1; }
eq() { [[ "$1" == "$2" ]] || die "$3: expected [$2], got [$1]"; }
[[ "$MODE" == "apply" || "$MODE" == "verify" || "$MODE" == "upgrade-main" ]] || die "Use: bash docs/admin/protect-repository.sh [apply|verify|upgrade-main]"
command -v gh >/dev/null || die "Install gh: brew install gh"
gh auth status >/dev/null 2>&1 || die "Log in: gh auth login"
eq "$(gh api "repos/$REPO" --jq '.permissions.admin')" true "Admin permission"
eq "$(gh api "repos/$REPO/branches/$ARCHIVE" --jq '.commit.sha')" "$ARCHIVE_SHA" "Archive SHA"
MAIN_SHA="$(gh api "repos/$REPO/branches/main" --jq '.commit.sha')"
eq "$(gh api "repos/$REPO/commits/$MAIN_SHA/check-runs?per_page=100" --jq '[.check_runs[]|select(.name=="docs" and .conclusion=="success")]|length')" 1 "Main docs CI"
count_named() { gh api "repos/$REPO/rulesets?per_page=100" --jq "map(select(.name==\"$1\"))|length"; }
id_named() { gh api "repos/$REPO/rulesets?per_page=100" --jq "map(select(.name==\"$1\"))|.[0].id // empty"; }
install_named() {
  local name="$1" file="$2" count
  count="$(count_named "$name")"
  if [[ "$count" == 1 ]]; then echo "Already exists: $name"; return; fi
  eq "$count" 0 "No duplicate $name"
  gh api --method POST "repos/$REPO/rulesets" --input "$file" --jq '"Created ruleset ID \(.id)"'
}
verify_named() {
  local name="$1" ref="$2" types="$3" id
  eq "$(count_named "$name")" 1 "Exactly one $name"
  id="$(id_named "$name")"
  eq "$(gh api "repos/$REPO/rulesets/$id" --jq '.enforcement')" active "$name enforcement"
  eq "$(gh api "repos/$REPO/rulesets/$id" --jq '.conditions.ref_name.include|join(",")')" "$ref" "$name ref"
  eq "$(gh api "repos/$REPO/rulesets/$id" --jq '[.rules[].type]|sort|join(",")')" "$types" "$name rules"
  eq "$(gh api "repos/$REPO/rulesets/$id" --jq '(.bypass_actors // [])|length')" 0 "$name bypass"
  echo "Verified $name (#$id)"
}
MAIN_NAME="NuBloxSQL main PR and docs CI"
ARCHIVE_NAME="NuBloxSQL immutable legacy archive"
if [[ "$MODE" == apply ]]; then
  install_named "$MAIN_NAME" "$ROOT/docs/admin/ruleset-main.json"
  install_named "$ARCHIVE_NAME" "$ROOT/docs/admin/ruleset-archive.json"
fi
verify_named "$MAIN_NAME" refs/heads/main deletion,non_fast_forward,pull_request,required_status_checks
verify_named "$ARCHIVE_NAME" "refs/heads/$ARCHIVE" deletion,non_fast_forward,update
MID="$(id_named "$MAIN_NAME")"
AID="$(id_named "$ARCHIVE_NAME")"
# Update exactly the known old main policy; refuse unexpected external edits.
if [[ "$MODE" == "upgrade-main" ]]; then
  eq "$(gh api "repos/$REPO/commits/$MAIN_SHA/check-runs?per_page=100" --jq '[.check_runs[]|select(.name=="Node 24 — Driver and Shell" and .conclusion=="success")]|length')" 1 "Live Driver and Shell check must pass"
  required="$(gh api "repos/$REPO/rulesets/$MID" --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks|map(.context)|join(",")')"
  if [[ "$required" == "docs" ]]; then
    gh api --method PUT "repos/$REPO/rulesets/$MID" --input "$ROOT/docs/admin/ruleset-main.json" --jq '"Updated main ruleset #\(.id)"'
  else
    eq "$required" "docs,Node 24 — Driver and Shell" "Unknown required-check policy; refusing overwrite"
  fi
fi
eq "$(gh api "repos/$REPO/rulesets/$MID" --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks|map(.context)|join(",")')" "docs,Node 24 — Driver and Shell" "Required CI"
eq "$(gh api "repos/$REPO/rulesets/$MID" --jq '.rules[]|select(.type=="required_status_checks")|.parameters.strict_required_status_checks_policy')" true "Strict CI"
eq "$(gh api "repos/$REPO/rulesets/$MID" --jq '.rules[]|select(.type=="pull_request")|.parameters.required_approving_review_count')" 0 "Solo maintainer approvals"
# GitHub omits update.parameters when update_allows_fetch_and_merge is false.
# The presence of the update restriction and absence of bypass actors are
# checked above. Treat only an explicit true as a disallowed exception.
eq "$(gh api "repos/$REPO/rulesets/$AID" --jq '.rules[]|select(.type=="update")|(.parameters.update_allows_fetch_and_merge // false)')" false "Archive update exception"
for target in main "$ARCHIVE"; do
  actual="$(gh api "repos/$REPO/rules/branches/$target?per_page=100" --jq '[.[].type]|unique|sort|join(",")')"
  if [[ "$target" == main ]]; then wanted="deletion non_fast_forward pull_request required_status_checks"
  else wanted="deletion non_fast_forward update"; fi
  for rule in $wanted; do
    [[ ",$actual," == *",$rule,"* ]] || die "Effective GitHub rules on $target lack $rule"
  done
done
eq "$(gh api "repos/$REPO/branches/$ARCHIVE" --jq '.commit.sha')" "$ARCHIVE_SHA" "Archive SHA unchanged"
echo "PASS: GitHub confirms live main and archive branch rules. Update issue #328 with ruleset IDs."
