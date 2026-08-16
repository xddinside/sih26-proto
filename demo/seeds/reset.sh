#!/usr/bin/env bash
# Reset a seeded Astronomy Shop checkout back to the pristine pinned commit.
# Removes both the overlay files and any seed applied by apply-seed.sh.
set -euo pipefail

PIN="2e05c45b85b985a691cc75082c234e8d6ac0b2e9"

REPO="$(pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    *) echo "usage: reset.sh [--repo <path>]" >&2; exit 2 ;;
  esac
done

cd "$REPO"

HEAD="$(git rev-parse HEAD)"
if [[ "$HEAD" != "$PIN" ]]; then
  echo "error: HEAD ($HEAD) is not the pinned commit $PIN; refusing to reset a diverged tree" >&2
  exit 1
fi

git checkout -- src/payment/ 2>/dev/null || git restore -- src/payment/ 2>/dev/null || true
git clean -fd src/payment/ 2>/dev/null || true

if git diff --quiet && [[ -z "$(git status --porcelain)" ]]; then
  echo "reset complete: pristine at $PIN (no changes vs upstream)"
else
  echo "warning: residual changes remain:" >&2
  git status --porcelain >&2
  exit 1
fi
