#!/usr/bin/env bash
# Checks docs/module-map.md against the repo. Run from the repo root:
#   bash docs/check-module-map.sh
#
# 1. the doc exists and has its five sections;
# 2. every backticked path in it (outside code fences) exists. New files the doc
#    proposes are written in bold, not backticks, so they are not checked;
# 3. each collision table matches `git log ... --name-only` and `wc -l` right now;
# 4. at least three proposed refactors, each with a size and a typed API block;
# 5. the docs index links the map; the map's range changes only docs/ (not counting mw's version bump).
set -u
DOC=docs/module-map.md
fail=0
bad() { echo "FAIL: $*"; fail=1; }

[ -f "$DOC" ] || { echo "FAIL: $DOC does not exist"; exit 1; }

for h in Modules Collisions "Proposed refactors" "Rule breaks" "Library candidates"; do
  grep -qE "^## $h\$" "$DOC" || bad "missing section '## $h'"
done

# Backticked paths, outside fenced blocks.
paths=$(awk '/^```/{f=!f; next} !f' "$DOC" | grep -oE '`[^`]+`' | tr -d '`' \
  | grep -E '^(src|docs|public|specs|analysis|\.github)/[A-Za-z0-9_./@-]*$' | sort -u)
n=0
for p in $paths; do
  n=$((n + 1))
  [ -e "$p" ] || bad "named path does not exist: $p"
done
echo "checked $n backticked paths"

# Collision tables. A marker line `<!-- collisions: <git log date flags | all> -->`
# precedes each table; rows are `| count | `path` | lines |`.
while IFS= read -r marker; do
  flags=${marker#*collisions: }; flags=${flags% -->}
  [ "$flags" = all ] && flags=""
  expected=$(git log $flags --name-only --format= -- src | sort | uniq -c | sort -rn | head -15)
  table=$(awk -v m="$marker" '$0==m{on=1; next} on&&/^\|/{print; seen=1; next} on&&seen&&!/^\|/{exit}' "$DOC")
  if [ -z "$expected" ]; then
    echo "note: window '$flags' is empty at this commit"
    [ -z "$(printf '%s' "$table" | grep -E '^\| [0-9]')" ] || bad "table for '$flags' has rows but git log is empty"
    continue
  fi
  while read -r count path; do
    lines=$(wc -l < "$path" 2>/dev/null || echo MISSING)
    printf '%s\n' "$table" | grep -qF "| $count | \`$path\` | $lines |" \
      || bad "window '$flags': expected row '| $count | \`$path\` | $lines |'"
  done <<< "$expected"
  rows=$(printf '%s\n' "$table" | grep -cE '^\| [0-9]')
  [ "$rows" -eq 15 ] || bad "window '$flags': table has $rows rows, expected 15"
done < <(grep -E '^<!-- collisions: .* -->$' "$DOC")
grep -qE '^<!-- collisions: ' "$DOC" || bad "no collision table markers"

# Refactors: each '### R<n>' block names a Size and has a ts fence with a signature.
refactors=$(grep -cE '^### R[0-9]+' "$DOC")
[ "$refactors" -ge 3 ] || bad "only $refactors proposed refactors (need 3+)"
[ "$refactors" -le 8 ] || bad "$refactors proposed refactors (max 8)"
sizes=$(grep -cE '^- \*\*Size:\*\*' "$DOC")
[ "$sizes" -eq "$refactors" ] || bad "$refactors refactors but $sizes Size lines"
tsfences=$(awk '/^### R[0-9]+/{r=1} /^## /&&!/^### /{r=0} r&&/^```ts$/{c++} END{print c+0}' "$DOC")
[ "$tsfences" -ge "$refactors" ] || bad "$refactors refactors but only $tsfences typed API blocks"

# Index link and docs-only change.
grep -q 'module-map.md' docs/README.md 2>/dev/null || bad "docs/README.md does not link module-map.md"
base=${BASE:-$(git merge-base HEAD main 2>/dev/null || echo HEAD)}
# mw's own version-bump commit ("Version X.Y.Z (...)", package.json and
# package-lock.json only) lands after the docs commit; it is not the map's change.
outside=$(git diff --name-only HEAD | grep -v '^docs/' || true)
for c in $(git rev-list --no-merges "$base"..HEAD); do
  files=$(git diff-tree --no-commit-id --name-only -r "$c")
  if git log -1 --format=%s "$c" | grep -qE '^Version [0-9]+\.[0-9]+\.[0-9]+' \
     && [ -z "$(printf '%s\n' "$files" | grep -vxE 'package(-lock)?\.json')" ]; then
    continue
  fi
  outside="$outside
$(printf '%s\n' "$files" | grep -v '^docs/' || true)"
done
outside=$(printf '%s\n' "$outside" | grep -v '^$' | sort -u | tr '\n' ' ' || true)
[ -z "$outside" ] || bad "changes outside docs/: $outside"

[ $fail -eq 0 ] && echo "OK: module map checks pass" || { echo "module map checks FAILED"; exit 1; }
