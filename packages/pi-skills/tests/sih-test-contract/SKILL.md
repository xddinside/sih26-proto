---
name: sih-test-contract
description: T4 Integration/contract: maps declared dependencies to contract checks against the isolated candidate environment, requests the run, and checks the contract receipts. Required for Code.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; the candidate instance and the stable instance stay separate.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T4
---

# sih-test-contract

T4 Integration/contract: maps declared dependencies to contract checks against the isolated candidate environment, requests the run, and checks the contract receipts. Required for Code.

## Role contract

- Contract receipts are broker receipts; a model may cite them, never create them.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
