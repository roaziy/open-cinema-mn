#!/usr/bin/env bash
# Prints the version after $1 (e.g. v0.1.3), given the commit subjects since it on stdin.
# Breaking (`type!:`) bumps the major from 1.0 on and the minor before it; `feat:` bumps the
# minor; anything else the patch. Exits 1 when there are no commits to release.
set -euo pipefail

IFS=. read -r major minor patch <<<"${1#v}"
subjects=$(cat)
[ -n "$subjects" ] || exit 1

if grep -qE '^[a-z]+(\([^)]*\))?!:' <<<"$subjects"; then
  if [ "$major" -ge 1 ]; then major=$((major + 1)); minor=0; else minor=$((minor + 1)); fi
  patch=0
elif grep -qE '^feat(\([^)]*\))?:' <<<"$subjects"; then
  minor=$((minor + 1)); patch=0
else
  patch=$((patch + 1))
fi
echo "v$major.$minor.$patch"
