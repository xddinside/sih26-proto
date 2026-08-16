---
name: sih-review-causal-fit
description: R2 Causal fit review: every change maps to the accepted Hypothesis's causal chain through the citation map; no change cites nothing; no part of the causal chain is left uncovered. Invoked for all classes except Emergency.
metadata:
  sih.stage: verify
  sih.tool-group: review-read-only
  sih.access: Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions.
  sih.independence: One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
  sih.role-code: R2
---

# sih-review-causal-fit

R2 Causal fit review: every change maps to the accepted Hypothesis's causal chain through the citation map; no change cites nothing; no part of the causal chain is left uncovered. Invoked for all classes except Emergency.

## Role contract

- Classifying a proposed change's surfaces and citing the Hypothesis for R2 is agent work; the citation map is sealed proposal input.
- An unrelated change that cites nothing is a major finding; a causal-chain edge the proposal leaves uncovered is a gap, not an assumed pass.

## Tool group

`review-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
