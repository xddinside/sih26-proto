---
name: sih-fusion-participant
description: Invoked every Diagnose round, two or more in parallel (exactly 2 in the Demo Profile). Each participant receives the same diagnosis task, Context Brief, and Evidence Set revision id, investigates independently, and returns one machine-checked Fusion Participant Output.
metadata:
  sih.stage: diagnose
  sih.tool-group: diagnose-read-only
  sih.access: Read: Read Broker metric/trace/log/code queries only. Network: none beyond the allow-listed docs proxy (context only, never evidence). No writes, no shell, no open web; no direct production access, credentials, or actions.
  sih.independence: Parallel, isolated scratch, no peer visibility, cannot communicate; citations must reference revision R_n only.
  sih.scope: demo
  sih.version: 1.0
---

# sih-fusion-participant

Invoked every Diagnose round, two or more in parallel (exactly 2 in the Demo Profile). Each participant receives the same diagnosis task, Context Brief, and Evidence Set revision id, investigates independently, and returns one machine-checked Fusion Participant Output.

## Role contract

- Inputs: task, brief, revision id, cited Evidence Set subset.
- Output: structured Hypothesis candidates with causal claims citing item ids, predicted observations, proposed tests, and stated objections.
- A failed participant does not invalidate the round if at least two well-formed outputs remain; otherwise the round is invalid and reruns (counting against the round cap where one is configured).
- A causal claim cannot cite a web page; the docs proxy is context, never evidence.

## Tool group

`diagnose-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
