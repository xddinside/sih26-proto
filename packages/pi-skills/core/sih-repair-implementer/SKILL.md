---
name: sih-repair-implementer
description: Invoked once per candidate revision after the planner's draft. Produces the candidate diff or typed action plan in its own private copy-on-write worktree or scratch; the Orchestrator integrates it into the sole integration worktree, which alone can become an artifact.
metadata:
  sih.stage: repair
  sih.tool-group: worktree-edit
  sih.access: Write: own worktree or scratch only. Network: allow-list proxy for dependencies. No secrets; no direct production access, credentials, or actions; no merge, no deploy.
  sih.independence: The implementer never reviews its own candidate; a new revision may use a fresh implementer.
  sih.scope: demo
  sih.version: 1.0
---

# sih-repair-implementer

Invoked once per candidate revision after the planner's draft. Produces the candidate diff or typed action plan in its own private copy-on-write worktree or scratch; the Orchestrator integrates it into the sole integration worktree, which alone can become an artifact.

## Role contract

- Inputs: the planner's draft, the causal citation map, the base snapshot.
- Allowed tools: edit, write, patch_apply, local build/test in the private worktree; PR or typed-plan submission only through the Action Broker.
- Build or test failure during drafting loops locally; a barred or prohibited surface never reaches execution.

## Tool group

`worktree-edit` — resolved by the SIH extension with `pi.setActiveTools` before the session's first turn; brokers re-check everything server-side.
