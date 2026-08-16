---
name: sih-review-correctness
description: R1 Change correctness review: the change does what the proposal claims and nothing more; no unrelated or unreported edits; the typed action plan matches the adapter's declared surface. Invoked for every class except Emergency.
metadata:
  sih.stage: verify
  sih.tool-group: review-read-only
  sih.access: Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions.
  sih.independence: One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
  sih.role-code: R1
---

# sih-review-correctness

R1 Change correctness review: the change does what the proposal claims and nothing more; no unrelated or unreported edits; the typed action plan matches the adapter's declared surface. Invoked for every class except Emergency.

## Role contract

- Inputs: candidate diff or typed action plan, base snapshot, accepted Hypothesis, citation map, disposition, service catalog, policy version, pinned Evidence Set subset, Recovery Point draft.
- Every finding cites a file and line, a check output ref, an item id, or a named Recovery Point gap. An uncited blocker or major finding reruns the role once, then needs-human.
- Scope: the candidate's own diff plus declared surfaces; a defect just outside the diff needs a cited reachability argument.
- A candidate may not add or widen a suppression for its own finding; that change is itself a blocker.

## Tool group

`review-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
