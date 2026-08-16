---
name: sih-test-fault-recovery
description: T12 Fault/recovery: maps the changed surface to the restart/rollback/toggle/rotation/reroute drill, requests it on the isolated environment, and checks the drill receipts. Triggered when the changed surface or Recovery Point names such an action.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; drills run on the isolated environment only.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T12
---

# sih-test-fault-recovery

T12 Fault/recovery: maps the changed surface to the restart/rollback/toggle/rotation/reroute drill, requests it on the isolated environment, and checks the drill receipts. Triggered when the changed surface or Recovery Point names such an action.

## Role contract

- Drill receipts are broker receipts; the report never asserts a recovery result the receipt does not contain.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
