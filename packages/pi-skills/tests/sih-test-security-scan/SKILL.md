---
name: sih-test-security-scan
description: T7 Security scanning: requests the applicable pinned scanners (secret, dependency-vulnerability, SAST) with recorded tool and database versions; a scanner that does not apply is recorded not-applicable and is not run. Scanners never replace R4.
metadata:
  sih.stage: verify
  sih.tool-group: test-run
  sih.access: Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions.
  sih.independence: One subagent per layer with its own scratch; scanners run through the pinned catalog only.
  sih.scope: demo
  sih.version: 1.0
  sih.layer: T7
---

# sih-test-security-scan

T7 Security scanning: requests the applicable pinned scanners (secret, dependency-vulnerability, SAST) with recorded tool and database versions; a scanner that does not apply is recorded not-applicable and is not run. Scanners never replace R4.

## Role contract

- Tool and database versions are recorded in the report; the receipt owns the findings list.

## Tool group

`test-run` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
