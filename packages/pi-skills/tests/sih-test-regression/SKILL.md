---
name: sih-test-regression
description: Scoped T5 Regression: confirms the resolver's ownership-map selection matches the receipt and never re-scopes the suite. Required for Code. The failing case in Demo Run 2 is fixed seed data, so the outcome stays deterministic regardless of review wording.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; scoped selection comes from the ownership map, never from the model.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T5
---

# sih-test-regression

Scoped T5 Regression: confirms the resolver's ownership-map selection matches the receipt and never re-scopes the suite. Required for Code. The failing case in Demo Run 2 is fixed seed data, so the outcome stays deterministic regardless of review wording.

## Role contract

- The report target must equal the ownership-map selection the resolver returned; a mismatch is a scoping violation, never a silent re-scope.
- If the ownership map cannot resolve the changed files, the resolver returns needs-human; the layer never runs everything or nothing.
- Outcome is copied verbatim from the receipt; a failed run stays failed in the report.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
