# Fusion diagnosis

## Source of truth

The local Fusion Agent Harness lives at `/home/xdd/dev/sandbox/fusion`. It is a Pi-derived harness in active development, not a generic name for several agents discussing an answer.

Before changing the SIH Diagnose stage, Hypothesis gate, Pi workflow, or diagnosis skills, inspect these live sources:

1. `/home/xdd/dev/sandbox/fusion/CONTEXT.md`
2. `/home/xdd/dev/sandbox/fusion/docs/prototypes/fusion-research-mode.md`
3. `/home/xdd/dev/sandbox/fusion/packages/coding-agent/src/core/fusion/research-fusion.ts`
4. `/home/xdd/dev/sandbox/fusion/packages/coding-agent/src/core/fusion/prompts.ts`

Treat the live files as the source of truth because Fusion can change. Read its worktree without editing it unless the assigned task includes Fusion itself. If the path is unavailable, record that limit instead of inventing a Fusion contract.

## What Fusion is

Fusion sends one task and one shared context to two or more participant models. They work independently and return separate outputs. A Judge Model compares those outputs for agreement, conflict, blind spots, and useful unique findings. A Synthesizer Model then produces one result.

The current local Research Fusion Mode:

- creates a compact context brief when the current conversation contains needed context;
- gives each participant the same task and starting context;
- runs participants in parallel with read-only research tools;
- asks the Judge to analyse participant outputs rather than choose a winner;
- asks the Synthesizer to produce the final answer;
- keeps participant and judge work outside later conversation context while saving inspectable run details.

## SIH adaptation

Use the Fusion pattern during Diagnose. Do not copy its `/fusion` user command or assume its current read-only tool policy is the whole Incident workflow.

1. The Orchestrator creates one diagnosis task from the Incident Trigger, Evidence Set, service scope, policy, and known limits.
2. Two or more participants receive the same starting task and evidence. They investigate independently and cite every causal claim.
3. The Judge compares their proposed Hypotheses, causal links, conflicts, missing evidence, and suggested tests. It does not pick a winner by vote.
4. The Synthesizer returns ranked Hypotheses, supporting and opposing evidence, open gaps, and the next evidence-gathering actions.
5. The Orchestrator applies the deterministic Hypothesis acceptance gate. Model confidence alone cannot pass it.
6. When evidence remains weak or contradictory, the Orchestrator gathers more evidence or starts another bounded Fusion round until a Hypothesis passes or the Attempt Limit ends the Incident Run.

Fusion supports diagnosis; it does not own the Incident state machine, Remediation, Release Gate, production authority, or rollback.

## Completion check

A Fusion-related SIH spec is complete only when it names:

- the shared starting context;
- participant count and independence rules;
- participant tools and access;
- Judge inputs and required comparison output;
- Synthesizer output;
- the evidence-based acceptance gate;
- retry and stop conditions;
- what remains under Orchestrator and Control Plane control.
