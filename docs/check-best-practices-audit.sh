#!/usr/bin/env bash
# Checks docs/best-practices-audit.md against the repo. Run from the repo root:
#   bash docs/check-best-practices-audit.sh
#
# 1. the doc exists and has its sections;
# 2. one C-row per line of the vault's PWA checklist (counted from the vault file when it
#    is there, else the 28 it had on 2026-10-09), plus R-rows for the rules added that day;
# 3. every row has a status (pass, fail, n/a) and evidence; every fail row has a fix and a size;
# 4. every file:line cited in a row exists in this checkout (the file, and the line within it);
# 5. at most 10 ranked fix stories, each with an acceptance check in backticks;
# 6. the docs index links the audit; the branch changes only docs/.
set -u
DOC=docs/best-practices-audit.md
CHECKLIST=${CHECKLIST:-$HOME/millwright-vault/seats/builder/pwa-best-practices/checklist.md}
EXPECTED_C=28
fail=0
bad() { echo "FAIL: $*"; fail=1; }

[ -f "$DOC" ] || { echo "FAIL: $DOC does not exist"; exit 1; }

for h in "Checklist" "Rules added 2026-10-09" "Ranked fix stories"; do
  grep -qE "^## $h\$" "$DOC" || bad "missing section '## $h'"
done

# Rows: | ID | line | status | evidence | fix | size |
rows=$(grep -E '^\| [CR][0-9]+ \|' "$DOC")
crows=$(printf '%s\n' "$rows" | grep -cE '^\| C[0-9]+ \|')
rrows=$(printf '%s\n' "$rows" | grep -cE '^\| R[0-9]+ \|')
echo "rows: $crows checklist, $rrows rules"

want=$EXPECTED_C
if [ -f "$CHECKLIST" ]; then
  want=$(grep -c '^\[ \]' "$CHECKLIST")
  i=0
  while IFS= read -r line; do
    i=$((i + 1))
    label=${line#\[ \] }; label=${label%%:*}
    printf '%s\n' "$rows" | grep -E "^\| C$(printf '%02d' $i) \|" | grep -qF "$label" \
      || bad "row C$(printf '%02d' $i) does not name the checklist line '$label'"
  done < <(grep '^\[ \]' "$CHECKLIST")
else
  echo "note: $CHECKLIST not found; counting against $EXPECTED_C"
fi
[ "$crows" -eq "$want" ] || bad "$crows checklist rows, checklist has $want lines"
[ "$rrows" -ge 6 ] || bad "only $rrows rule rows (the six placed 2026-10-09 are required)"

# Status, evidence, fix, size.
while IFS= read -r row; do
  id=$(printf '%s' "$row" | awk -F'|' '{gsub(/ /,"",$2); print $2}')
  ncell=$(printf '%s' "$row" | awk -F'|' '{print NF}')
  [ "$ncell" -eq 8 ] || { bad "$id: $((ncell - 2)) cells, expected 6"; continue; }
  status=$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')
  evidence=$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$5); print $5}')
  fix=$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$6); print $6}')
  size=$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$7); print $7}')
  case "$status" in pass|fail|n/a) ;; *) bad "$id: status '$status' is not pass, fail or n/a" ;; esac
  [ -n "$evidence" ] || bad "$id: no evidence"
  if [ "$status" = fail ]; then
    [ -n "$fix" ] && [ "$fix" != "-" ] || bad "$id: fail row has no fix"
    case "$size" in S|M|L) ;; *) bad "$id: fail row size '$size' is not S, M or L" ;; esac
  fi
done <<< "$rows"

# Every file:line named in a row exists.
n=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  n=$((n + 1))
  file=${ref%%:*}; lines=${ref#*:}; last=${lines##*-}
  if [ ! -f "$file" ]; then bad "cited file does not exist: $ref"; continue; fi
  total=$(wc -l < "$file")
  [ "$last" -le "$total" ] || bad "cited line past the end ($total lines): $ref"
done < <(printf '%s\n' "$rows" | grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx|css|html|json|yml|sh|md|svg|js):[0-9]+(-[0-9]+)?' | sort -u)
echo "checked $n file:line citations"

# Ranked fix stories.
ranked=$(awk '/^## Ranked fix stories$/{on=1; next} /^## /{on=0} on&&/^[0-9]+\. /' "$DOC")
nr=$(printf '%s\n' "$ranked" | grep -c '^[0-9]')
[ "$nr" -ge 1 ] && [ "$nr" -le 10 ] || bad "$nr ranked fix stories (need 1 to 10)"
while IFS= read -r item; do
  [ -n "$item" ] || continue
  printf '%s' "$item" | grep -qE 'Check: `[^`]+`' || bad "ranked item without a runnable check: ${item:0:60}"
done <<< "$ranked"
echo "ranked stories: $nr"

# Index link and docs-only change.
grep -q 'best-practices-audit.md' docs/README.md 2>/dev/null || bad "docs/README.md does not link best-practices-audit.md"
base=${BASE:-$(git merge-base HEAD main 2>/dev/null || echo HEAD)}
outside=$(git diff --name-only "$base" | grep -v '^docs/' || true)
[ -z "$outside" ] || bad "changes outside docs/: $outside"

[ $fail -eq 0 ] && echo "OK: best-practices audit checks pass" || { echo "best-practices audit checks FAILED"; exit 1; }
