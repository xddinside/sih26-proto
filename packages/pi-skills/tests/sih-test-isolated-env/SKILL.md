---
name: sih-test-isolated-env
description: T9 Isolated environment: requests a candidate deploy with representative traffic through the broker and checks the start/serve receipts. Triggered when the class requires an isolated environment or a candidate target exists (always in the Demo Profile).
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; browser and test environments stay non-production.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T9
---

# sih-test-isolated-env

T9 Isolated environment: requests a candidate deploy with representative traffic through the broker and checks the start/serve receipts. Triggered when the class requires an isolated environment or a candidate target exists (always in the Demo Profile).

## Role contract

- The candidate instance and the stable instance stay separate; receipts prove start and serve, never production health.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
