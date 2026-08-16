---
name: sih-review-code-quality
description: R3 Code quality review: readability, maintainability, complexity, concurrency, error handling, and test coverage of the new code. Required for the Code class; conditional for Database migration code.
metadata:
  sih.stage: verify
  sih.tool-group: review-read-only
  sih.access: Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions.
  sih.independence: One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
  sih.role-code: R3
---

# sih-review-code-quality

R3 Code quality review: readability, maintainability, complexity, concurrency, error handling, and test coverage of the new code. Required for the Code class; conditional for Database migration code.

## Role contract

- Severity scale is fixed and machine-checked: blocker, major, minor, info.
- An uncited minor or info note stays non-blocking and is marked uncited.

## Tool group

`review-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
