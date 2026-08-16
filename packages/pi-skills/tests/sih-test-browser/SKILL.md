---
name: sih-test-browser
description: T10 E2E/browser: drives the broker-provisioned browser sandbox over the user-facing paths the change touches and returns Playwright-style run receipts. A triggered T10 whose browser environment is unavailable returns needs-human, never a skip.
metadata:
  sih.stage: verify
  sih.tool-group: test-run-browser
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; the Worker never runs a browser against production.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T10
---

# sih-test-browser

T10 E2E/browser: drives the broker-provisioned browser sandbox over the user-facing paths the change touches and returns Playwright-style run receipts. A triggered T10 whose browser environment is unavailable returns needs-human, never a skip.

## Role contract

- The browser runs in the broker-provisioned isolated sandbox only.

## Tool group

`test-run-browser` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
