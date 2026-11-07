#!/usr/bin/env bash
# rotn-lead's CI-gated merge. Usage: lead-merge-one.sh <pr> <reviewedSHA>. Do not delete (lead tool).
# Update the branch from develop, wait for CI on the new head, check the new head is a
# merge of the old head and develop, then squash-merge at that exact SHA.
set -u
p=$1
reviewed=${2:-}
cd "$(git rev-parse --show-toplevel)" || exit 1
# Usage now: lead-merge-one.sh <pr> <reviewedSHA>. Refuses if the author changed anything since review other than
# merging develop in (and the agents' own STATUS files while resolving that merge).
[ -n "$reviewed" ] || { echo "#$p STOP: give the reviewed head SHA as the 2nd argument"; exit 4; }
cur=$(gh pr view "$p" --json headRefOid --jq .headRefOid)
[ -n "$cur" ] || { echo "#$p STOP: could not read the PR head"; exit 4; }
git fetch -q origin "pull/$p/head" develop || { echo "#$p STOP: fetch failed"; exit 4; }
git cat-file -e "$reviewed^{commit}" 2>/dev/null || { echo "#$p STOP: reviewed SHA $reviewed not found"; exit 4; }
git cat-file -e "$cur^{commit}" 2>/dev/null || { echo "#$p STOP: head $cur not found after fetch (moved?)"; exit 4; }
git merge-base --is-ancestor "$reviewed" "$cur" || { echo "#$p STOP: reviewed SHA is not an ancestor of the head (rewritten?)"; exit 4; }
# New non-merge commits since the review are allowed only if develop already has them (an author's merge of
# develop brings develop's squash commits along). Anything else needs a new review.
extra=$(git log --oneline --no-merges "$reviewed..$cur" ^origin/develop) || { echo "#$p STOP: git log failed"; exit 4; }
[ -z "$extra" ] || { echo "#$p STOP: commits added since review:"; echo "$extra"; exit 4; }
# A develop merge is resolved by hand, so rebuild what it should give: merge the reviewed head into the develop
# commit the head contains, and require the head's tree to equal that, byte for byte, in every path except the
# five agents' STATUS files (their resolution is status text). A conflict outside them, or any extra or changed
# line (whitespace included) anywhere else, including coord/tools/ and coord/NEEDS-HUMAN.md, stops here; then a
# reviewer re-confirms the head and the lead passes it as the reviewed SHA.
STATUS_FILES=(':(exclude)coord/STATUS-rotn-lead.md' ':(exclude)coord/STATUS-net-forge.md' ':(exclude)coord/STATUS-rotn-data.md'
  ':(exclude)coord/STATUS-skills-rotn.md' ':(exclude)coord/STATUS-harness-ops.md')
if [ "$cur" != "$reviewed" ]; then
  dev=$(git merge-base origin/develop "$cur") || { echo "#$p STOP: no merge-base with develop"; exit 4; }
  expected=$(git merge-tree --write-tree "$dev" "$reviewed" | head -1)
  [ -n "$expected" ] || { echo "#$p STOP: could not rebuild the expected merge"; exit 4; }
  git diff --quiet "$expected" "$cur" -- . "${STATUS_FILES[@]}" || {
    echo "#$p STOP: the head differs from reviewed + develop outside the STATUS files; re-confirm ${cur:0:7}"
    git diff --stat "$expected" "$cur" -- . "${STATUS_FILES[@]}" | tail -5; exit 4; }
fi
old=$cur
gh pr update-branch "$p" >/dev/null 2>&1 || echo "#$p update-branch: no change or failed"
new=$old
for i in $(seq 1 20); do
  new=$(gh pr view "$p" --json headRefOid --jq .headRefOid)
  [ "$new" != "$old" ] && break
  [ "$(gh pr view "$p" --json mergeStateStatus --jq .mergeStateStatus)" = CLEAN ] && \
    git fetch -q origin "pull/$p/head" develop && git merge-base --is-ancestor origin/develop "$old" && break
  sleep 3
done
echo "#$p old=${old:0:7} new=${new:0:7}"
if [ "$new" != "$old" ]; then
  for i in $(seq 1 10); do
    git fetch -q origin "pull/$p/head" develop
    git cat-file -e "$new^{commit}" 2>/dev/null && break
    sleep 2
  done
  parents=$(git rev-list --parents -n1 "$new" | cut -d' ' -f2-)
  case " $parents " in *" $old "*) ;; *) echo "#$p STOP: new head is not a merge on top of the old head"; exit 3;; esac
  other=$(echo "$parents" | tr ' ' '\n' | grep -v "^$old$")
  git merge-base --is-ancestor "$other" origin/develop || { echo "#$p STOP: other parent not on develop"; exit 3; }
fi
for i in $(seq 1 40); do
  n=$(gh api "repos/JQDAW/mindcraft-RotN/commits/$new/check-runs" --jq '.total_count' 2>/dev/null || echo 0)
  [ "${n:-0}" -gt 0 ] && break
  sleep 5
done
gh pr checks "$p" --watch --interval 15 >/dev/null 2>&1
res=$(gh api "repos/JQDAW/mindcraft-RotN/commits/$new/check-runs" --jq '[.check_runs[] | (.conclusion // "pending")] | join(",")')
echo "#$p checks on ${new:0:7}: $res"
# Allowlist: every check run must have concluded success, skipped or neutral (a pending run has conclusion null).
bad=$(echo "$res" | tr "," "
" | grep -vxE "success|skipped|neutral" | head -1)
{ [ -n "$res" ] && [ -z "$bad" ]; } || { echo "#$p STOP: CI not green ($res)"; exit 4; }
cur=$(gh pr view "$p" --json headRefOid --jq .headRefOid)
[ "$cur" = "$new" ] || { echo "#$p STOP: head moved again to ${cur:0:7}"; exit 5; }
gh pr merge "$p" --squash --match-head-commit "$new" 2>&1 | tail -1
gh pr view "$p" --json state,mergeCommit --jq '"#'"$p"' \(.state) \(.mergeCommit.oid[0:7])"'
