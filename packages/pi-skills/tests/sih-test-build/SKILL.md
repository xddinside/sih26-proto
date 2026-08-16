---
name: sih-test-build
description: T2 Schema/lint/build: selects the build target and validation command from the pinned catalog, requests the run, and verifies the artifact digest against the receipt. Required for Code.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; dependent layers run in dependency order (build before unit).
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T2
---

# sih-test-build

T2 Schema/lint/build: selects the build target and validation command from the pinned catalog, requests the run, and verifies the artifact digest against the receipt. Required for Code.

## Role contract

- The artifact digest in the receipt binds the built candidate to the candidate hash.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
