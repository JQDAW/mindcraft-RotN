#!/usr/bin/env bash
# rotn-lead's CI-gated merge. Usage: lead-merge-one.sh <pr> <reviewedSHA>. Do not delete (lead tool).
# Update the branch from develop, wait for CI on the new head, check the new head is a
# merge of the old head and develop, then squash-merge at that exact SHA.
set -u
p=$1
reviewed=${2:-}
cd "$(git rev-parse --show-toplevel)" || exit 1
# Usage now: lead-merge-one.sh <pr> <reviewedSHA>. Refuses if the author added non-merge commits since review, or if a
# develop merge changed the PR's own change outside coord/.
[ -n "$reviewed" ] || { echo "#$p STOP: give the reviewed head SHA as the 2nd argument"; exit 4; }
git fetch -q origin "pull/$p/head" develop
cur=$(gh pr view "$p" --json headRefOid --jq .headRefOid)
git cat-file -e "$reviewed^{commit}" 2>/dev/null || { echo "#$p STOP: reviewed SHA $reviewed not found"; exit 4; }
# New non-merge commits since the review are allowed only if develop already has them (an author's
# merge of develop brings develop's squash commits along). Anything else needs a new review.
extra=$(git log --oneline --no-merges "$reviewed..$cur" ^origin/develop)
[ -z "$extra" ] || { echo "#$p STOP: commits added since review:"; echo "$extra"; exit 4; }
# A develop merge resolves conflicts by hand, so also check that the PR's own change outside coord/
# (status files) is the same as at review time: compare patch-ids of each head against its merge-base
# with develop. Different context lines (develop edited next to the PR's hunks) also stop here; then a
# reviewer re-confirms the new head and the lead passes that head as the reviewed SHA.
ownpid() { git diff "$(git merge-base origin/develop "$1")" "$1" -- . ':(exclude)coord' | git patch-id --stable | cut -d' ' -f1; }
if [ "$cur" != "$reviewed" ] && [ "$(ownpid "$reviewed")" != "$(ownpid "$cur")" ]; then
  echo "#$p STOP: the PR's own change outside coord/ differs from the reviewed head; re-confirm ${cur:0:7}"; exit 4
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
