---
name: sih-test-static-analysis
description: T1 Static analysis: maps the diff to the pinned catalog linter entry, requests the run through the broker, and checks the findings list against the receipt. Required for Code; pipeline-consumed for Deployment.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; the authoring subagent never tests its own change.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T1
---

# sih-test-static-analysis

T1 Static analysis: maps the diff to the pinned catalog linter entry, requests the run through the broker, and checks the findings list against the receipt. Required for Code; pipeline-consumed for Deployment.

## Role contract

- The report cites the receipt; it never asserts a result the receipt does not contain.
- Outcome is copied from the receipt; a model cannot reinterpret a failed run as passing.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
