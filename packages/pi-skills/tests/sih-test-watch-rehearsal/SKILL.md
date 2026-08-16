---
name: sih-test-watch-rehearsal
description: T13 Watch-plan rehearsal: executes the frozen Watch plan's queries, limits, and stop rules against a non-production environment to prove they run, return data with the expected labels, and are reachable. It validates operability, never production health. Required for every class ending in an execution gate with a Watch plan.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; a release never proceeds on an unrehearsed plan.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T13
---

# sih-test-watch-rehearsal

T13 Watch-plan rehearsal: executes the frozen Watch plan's queries, limits, and stop rules against a non-production environment to prove they run, return data with the expected labels, and are reachable. It validates operability, never production health. Required for every class ending in an execution gate with a Watch plan.

## Role contract

- Rehearsal receipts per query; absence never counts as a pass.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
