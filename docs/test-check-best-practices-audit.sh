#!/usr/bin/env bash
# Regression test for the docs-only guard in docs/check-best-practices-audit.sh.
# Run from the repo root:  bash docs/test-check-best-practices-audit.sh
# Works in a throwaway clone of HEAD (this checkout's script is copied in), so
# nothing is committed or pushed in the real repo.
#
# The audit script has other checks (the vault checklist's length, the rows in
# the audit doc) that can fail for their own reasons, so this test looks only at
# the guard's own line, "changes outside docs/", not at the exit status.
set -u
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q "$root" "$tmp/c" || { echo "FAIL: clone"; exit 1; }
cd "$tmp/c" || exit 1
git config user.email t@example.com; git config user.name t
cp "$root/docs/check-best-practices-audit.sh" docs/check-best-practices-audit.sh
base=$(git rev-parse HEAD)   # the audit's range starts here, as the guard sees it
fail=0
# expect <name> <pass|fail> : run the check from $base; the guard must (not) complain
expect() {
  out=$(BASE=$base bash docs/check-best-practices-audit.sh 2>&1)
  if printf '%s\n' "$out" | grep -q '^FAIL: changes outside docs/'; then got=fail; else got=pass; fi
  if [ "$got" = "$2" ]; then echo "ok: $1"
  else echo "FAIL: $1 (guard $got, wanted $2)"; printf '%s\n' "$out" | tail -4; fail=1; fi
}
bump() { # a version-bump commit like mw's: version-only edit of the two files
  sed -i '0,/"version": "[^"]*"/s//"version": "9.9.9"/' package.json
  sed -i '0,/"version": "[^"]*"/s//"version": "9.9.9"/' package-lock.json
  git commit -qam "Version 9.9.9 (mw-test)"
}

expect "no commits in range" pass
git commit -q --allow-empty -m "docs: note"; echo >> docs/README.md; git commit -qam "docs: tweak"
expect "docs-only commit passes" pass
bump
expect "mw version bump after the docs commit passes" pass
echo "// x" >> src/main.tsx; git commit -qam "src: change"
expect "a src change in range fails" fail
git reset -q --hard HEAD~1
echo "x" >> package.json; git commit -qam "chore: touch package.json"
expect "a non-bump package.json change fails" fail
git reset -q --hard HEAD~1
echo "// y" >> src/main.tsx
expect "an uncommitted src change fails" fail

# The row check: one C-row per line of the vault's checklist, each naming its line.
# Needs the vault's current checklist; says so and skips when it is not on this host.
cd "$root" || exit 1
checklist=${CHECKLIST:-$HOME/millwright-vault/seats/builder/pwa-best-practices/checklist.md}
if [ -f "$checklist" ]; then
  out=$(CHECKLIST=$checklist bash docs/check-best-practices-audit.sh 2>&1)
  if printf '%s\n' "$out" | grep -qE '^FAIL: (row C[0-9]+ does not name|[0-9]+ checklist rows)'; then
    echo "FAIL: the audit's C-rows do not match the vault checklist"
    printf '%s\n' "$out" | grep -E '^FAIL: (row C|[0-9]+ checklist rows)' | head -4; fail=1
  else echo "ok: the audit's C-rows match the vault checklist"; fi
else
  echo "note: $checklist not found; skipped the row check"
fi
exit $fail
