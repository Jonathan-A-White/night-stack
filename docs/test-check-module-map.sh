#!/usr/bin/env bash
# Regression test for the docs-only guard in docs/check-module-map.sh. Run from
# the repo root:  bash docs/test-check-module-map.sh
# Works in a throwaway clone of HEAD (this checkout's script is copied in), so
# nothing is committed or pushed in the real repo.
set -u
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q "$root" "$tmp/c" || { echo "FAIL: clone"; exit 1; }
cd "$tmp/c" || exit 1
git config user.email t@example.com; git config user.name t
cp "$root/docs/check-module-map.sh" docs/check-module-map.sh
base=$(git rev-parse HEAD)   # the map's range starts here, as the guard sees it
fail=0
# expect <name> <0|1> : run the check from $base and compare its exit status
expect() {
  out=$(BASE=$base bash docs/check-module-map.sh 2>&1); rc=$?
  if [ "$rc" -eq "$2" ]; then echo "ok: $1"
  else echo "FAIL: $1 (exit $rc, wanted $2)"; printf '%s\n' "$out" | tail -4; fail=1; fi
}
bump() { # a version-bump commit like mw's: version-only edit of the two files
  sed -i '0,/"version": "[^"]*"/s//"version": "9.9.9"/' package.json
  sed -i '0,/"version": "[^"]*"/s//"version": "9.9.9"/' package-lock.json
  git commit -qam "Version 9.9.9 (mw-test)"
}

expect "no commits in range" 0
git commit -q --allow-empty -m "docs: note"; echo >> docs/README.md; git commit -qam "docs: tweak"
expect "docs-only commit passes" 0
bump
expect "mw version bump after the docs commit passes" 0
echo "// x" >> src/main.tsx; git commit -qam "src: change"
expect "a src change in range fails" 1
git reset -q --hard HEAD~1
echo "x" >> package.json; git commit -qam "chore: touch package.json"
expect "a non-bump package.json change fails" 1
git reset -q --hard HEAD~1
echo "// y" >> src/main.tsx
expect "an uncommitted src change fails" 1
exit $fail
