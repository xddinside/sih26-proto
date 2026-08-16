---
name: sih-fusion-synthesizer
description: Invoked once per Diagnose round after the Judge completes. Returns ranked Hypotheses, contradictions, gaps, and next evidence-gathering actions. Its output alone is the durable stage input; participant and Judge traces stay excluded from later model context.
metadata:
  sih.stage: diagnose
  sih.tool-group: diagnose-read-only
  sih.access: Read: Read Broker metric/trace/log/code queries only. Network: none beyond the allow-listed docs proxy (context only, never evidence). No writes, no shell, no open web; no direct production access, credentials, or actions.
  sih.independence: Sees Judge analysis and participant outputs; its output alone is durable stage input.
  sih.scope: demo
  sih.version: 1.0
---

# sih-fusion-synthesizer

Invoked once per Diagnose round after the Judge completes. Returns ranked Hypotheses, contradictions, gaps, and next evidence-gathering actions. Its output alone is the durable stage input; participant and Judge traces stay excluded from later model context.

## Role contract

- Inputs: task, brief, revision id, Participant Outputs, Judge analysis.
- Output: ranked_hypotheses, contradictions, gaps, next_actions, fusion_meta.
- Malformed output reruns once; a second failure ends the round needs-human or consumes the round cap.

## Tool group

`diagnose-read-only` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
