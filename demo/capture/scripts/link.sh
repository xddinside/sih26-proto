#!/usr/bin/env bash
# Symlink the workspace @sih packages into demo/capture so the capture driver
# can import the real Control Plane, brokers, contracts, and Pi skills sources.
# demo/capture is intentionally not a workspace member (root package.json is
# owned by other issues); the links replicate the workspace resolution bun
# creates inside workspace packages.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DIR/node_modules/@sih"
ln -sfn ../../../../packages/contracts      "$DIR/node_modules/@sih/contracts"
ln -sfn ../../../../packages/brokers        "$DIR/node_modules/@sih/brokers"
ln -sfn ../../../../apps/control-plane      "$DIR/node_modules/@sih/control-plane"
ln -sfn ../../../../packages/pi-skills      "$DIR/node_modules/@sih/pi-skills"
echo "[link] demo/capture node_modules/@sih linked to workspace packages"
