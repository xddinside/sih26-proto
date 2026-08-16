---
name: sih-review-recovery-point
description: R8 Rollback/Recovery Point review: the Recovery Point covers every changed surface, names exact rollback commands in order with preconditions and timeouts, and its validation result is current. Required for every class except Emergency.
metadata:
  sih.stage: verify
  sih.tool-group: review-read-only
  sih.access: Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions.
  sih.independence: One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
  sih.role-code: R8
---

# sih-review-recovery-point

R8 Rollback/Recovery Point review: the Recovery Point covers every changed surface, names exact rollback commands in order with preconditions and timeouts, and its validation result is current. Required for every class except Emergency.

## Role contract

- An uncovered changed surface is a named Recovery Point gap; it blocks unless the gap carries human approval.

## Tool group

`review-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
