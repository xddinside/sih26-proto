---
name: sih-repair-planner
description: Invoked once per attempt after the accepted Hypothesis and Remediation disposition are recorded. Turns the accepted Hypothesis into a Remediation Proposal draft with the change-to-Hypothesis citation map, Recovery Point draft, blast radius, test plan, and declared action and changed surfaces.
metadata:
  sih.stage: repair
  sih.tool-group: repair-planner
  sih.access: Read: broker reads. Write: scratch only. Network: Control Plane and broker endpoints plus the allow-listed docs proxy. No direct production access, credentials, or actions.
  sih.independence: Never reviews or tests its own plan; one planner per attempt; the authoring subagent never reviews.
  sih.scope: demo
  sih.version: 1.0
---

# sih-repair-planner

Invoked once per attempt after the accepted Hypothesis and Remediation disposition are recorded. Turns the accepted Hypothesis into a Remediation Proposal draft with the change-to-Hypothesis citation map, Recovery Point draft, blast radius, test plan, and declared action and changed surfaces.

## Role contract

- Inputs: accepted Hypothesis, Remediation disposition, the risk table and adapter declarations, Authority Mode and policy versions, code snapshot, Recovery Point draft inputs, service catalog.
- Proposes the action and surfaces; the Control Plane computes the deterministic action-risk class from the sealed proposal and adapter declarations only after the proposal exists.
- Failure: bounded internal revisions; each journal submission is a new candidate hash; no proposal -> failed: no-remediation.

## Tool group

`repair-planner` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
