---
name: sih-test-unit
description: T3 Unit: maps changed packages to unit targets from the pinned catalog, requests the run through the broker or the CI runner, and checks the per-test summary against the receipt. Required for Code.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; runs after the build layer; parallel test classes share no mutable fixtures.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T3
---

# sih-test-unit

T3 Unit: maps changed packages to unit targets from the pinned catalog, requests the run through the broker or the CI runner, and checks the per-test summary against the receipt. Required for Code.

## Role contract

- A test that mutates shared state is a defective test and its result does not count.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
