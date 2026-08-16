#!/usr/bin/env bash
# Apply the Demo Profile overlay and one seed to a pristine Astronomy Shop
# checkout. Deterministic and repeatable: the overlay is copied from this
# directory and the seed is applied with `git apply`. Nothing is committed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN="2e05c45b85b985a691cc75082c234e8d6ac0b2e9"

SEED=""
REPO="$(pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    S1|S2) SEED="$1"; shift ;;
    *) echo "usage: apply-seed.sh <S1|S2> [--repo <path>]" >&2; exit 2 ;;
  esac
done

if [[ -z "$SEED" ]]; then
  echo "usage: apply-seed.sh <S1|S2> [--repo <path>]" >&2
  exit 2
fi

cd "$REPO"

HEAD="$(git rev-parse HEAD)"
if [[ "$HEAD" != "$PIN" ]]; then
  echo "error: repo not at pinned commit $PIN (HEAD=$HEAD)" >&2
  exit 1
fi

if ! git diff --quiet || [[ -n "$(git status --porcelain -- src/payment)" ]]; then
  echo "error: repo is dirty; run reset.sh first" >&2
  exit 1
fi

# 1. Overlay files.
cp "$SCRIPT_DIR/card.js"                src/payment/card.js
cp "$SCRIPT_DIR/charge.js"              src/payment/charge.js
cp "$SCRIPT_DIR/card.unit.test.js"      src/payment/card.unit.test.js
cp "$SCRIPT_DIR/payment.regression.test.js" src/payment/payment.regression.test.js
cp "$SCRIPT_DIR/smoke-behavior.test.js" src/payment/smoke-behavior.test.js
cp "$SCRIPT_DIR/Dockerfile"             src/payment/Dockerfile

# 2. Seed.
case "$SEED" in
  S1)
    git apply "$SCRIPT_DIR/seeds/S1.patch"
    echo "applied overlay + S1 (card-type negation defect)"
    ;;
  S2)
    git apply "$SCRIPT_DIR/seeds/S1.patch"
    git apply "$SCRIPT_DIR/seeds/S2.patch"
    echo "applied overlay + S2 (card-type negation + missing Luhn guard)"
    ;;
esac

echo "done. Rebuild the payment image from src/payment (see demo/seeds/README.md)."
