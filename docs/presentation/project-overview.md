# Autonomous Incident Remediation — SIH 2026 Project Overview

This document describes the Autonomous Incident Remediation project for the SIH 2026 internal hackathon. It covers the problem, the system design, the current implementation status, and the roadmap.

## In this document

1. [Overview](#overview)
2. [Problem statement](#problem-statement)
3. [Architecture](#architecture)
4. [Incident workflow](#incident-workflow)
5. [Safety model](#safety-model)
6. [Demonstration](#demonstration)
7. [Implementation status](#implementation-status)
8. [Technology stack](#technology-stack)
9. [Frequently asked questions](#frequently-asked-questions)
10. [Evaluation criteria](#evaluation-criteria)

---

## Overview

The system uses live operational evidence to diagnose incidents, perform permitted recovery work, and verify the result. Evidence is telemetry from the running system: traces, metrics, logs, security findings, and deployment events.

**Product summary.** Signals from a running system are converted into signed incident triggers. A Control Plane manages the incident lifecycle. One short-lived Worker per attempt hosts agent work: a Fusion diagnosis, a repair proposal, verification, and release. Deterministic gates and receipts decide acceptance, verification, and release. Model judgment does not. Humans control the system through an Incident Workspace and through authority and policy settings.

Key properties of the system:

- Every decision is recorded in an append-only journal and can be replayed later.
- Every test, review, gate, and release decision binds to the candidate content hash.
- Workers have no credentials and no direct production access.
- The presentation replays saved runs. Nothing runs live during the presentation.

## Problem statement

Incident response has a high mean time to repair. Diagnosis is the slow part: evidence is scattered across monitoring tools, hypotheses are formed by judgment, fixes are applied manually, and the reasoning behind a fix is not recorded. Incidents recur because the record of what happened is incomplete.

AI coding agents do not address this directly. They produce patches, but confidence is not correctness. In production, a wrong patch has the same blast radius as the original incident. Agents also lack an audit trail: after the fact, no one can verify what the agent saw or did.

The system separates the two concerns:

- **Agents** investigate evidence, form hypotheses, and propose remediations.
- **Deterministic contracts** — gates, receipts, and journals — decide whether a proposal ships.

Beneficiaries are platform and site-reliability teams and any organization operating 24/7 services. The incident workflow, the safety model, and the evidence replay are the product.

## Architecture

The system has four lanes: intake, run, decide, and surface.

### Intake

| Step | Component | Behavior |
|---|---|---|
| 1 | Signals | OTel traces, metrics, logs, security findings, deployment events from the running system |
| 2 | Incident Detector | Prometheus-compatible rule; fires above a pinned threshold with a traffic floor |
| 3 | Intake Normalizer | HMAC-signs an IncidentTrigger v1 with incident_key, delivery_key, scope, window, and evidence refs |
| 4 | Control Plane | Deduplicates, opens or updates the incident, queues one serial run per attempt |

### Run

| Step | Component | Behavior |
|---|---|---|
| 1 | Worker | One per attempt; short-lived container; incident-scoped reads; no credentials |
| 2 | Orchestrator | Owns the stage workflow, delegates bounded work, chooses the next permitted step |
| 3 | Specialist subagents | Fusion participants, Judge, Synthesizer, repair planner and implementer, reviewers R1–R9, test layers T1–T13 |
| 4 | Brokers and tools | Read-only data, isolated CI, candidate deployment ring; every call is leased and receipted |

### Decide

| Step | Component | Behavior |
|---|---|---|
| 1 | Hypothesis Gate | Eight fixed checks on cited evidence; accepts one hypothesis |
| 2 | Release Gate | Eight non-optional facts before merge or deploy |
| 3 | Action Gate | Typed operations only; one-use permit; risk class and authority mode check |
| 4 | Watch Gates G1–G6 | Frozen queries, limits, sample floors, missing-data rules; severe regression takes the rollback path |

### Surface

| Step | Component | Behavior |
|---|---|---|
| 1 | Incident Workspace | List, detail, panels 1–12, artifact viewer; every number cites a receipt or saved row |
| 2 | Append-only journal | Transitions, policy verdicts, approvals, leases, broker calls, Watch results, actor identity |
| 3 | Sealed artifacts | Content-hashed, schema-versioned; replay verifies the bundle and rejects tampering |
| 4 | Recovery Point | Recorded state needed to reverse a remediation; rollback restores service, not every effect |

> **Ownership rule.** Agents own proposals and evidence gathering. The Control Plane and deterministic tools own transitions, gates, receipts, candidate identity, and verdicts. A model cannot forge a receipt, re-scope applicability, reinterpret a failure, or replace a gate.

## Incident workflow

One attempt is one Orchestrator-led run through six stages in fixed order. Reaching the attempt limit (3 by default) writes an Incident Report and closes the incident with the `attempt-limit` closure reason.

| Stage | Behavior | Owner of pass/fail |
|---|---|---|
| 1. Detect | Confirm the symptom from live evidence; seal the Incident Brief. One retry, then `failed: undiagnosable`. | The brief is sealed before any agent runs. |
| 2. Diagnose | Fusion Diagnosis: two or more independent participants inspect the same task, brief, and Evidence Set. A Judge compares outputs without picking a winner. A Synthesizer returns ranked hypotheses, gaps, and next actions. The Hypothesis Gate accepts one. | The gate checks cited coverage, causal edges, contradictions, alternative elimination, reproducible test, scope, freshness, and telemetry coverage. Table-driven, not model confidence. |
| 3. Repair | Planner and implementer produce a Remediation Proposal v1: citation map, Recovery Point draft, declared surfaces, PR-shaped record. No merge or deploy. | Disposition (safe, guarded, barred) and class come from fixed rules. The Recovery Point covers every changed surface before the first mutation. |
| 4. Verify | The applicability resolver selects required, conditional, and not-applicable checks. Each review role R1–R9 and test layer T1–T13 runs in its own skilled subagent. Results bind to the candidate hash. | The verdict function returns pass, fail, or needs-human. Consolidation rules: maximum severity, contradictions go to needs-human, no majority vote. Receipts own test facts. |
| 5. Release | Code merges and deploys only past the Release Gate. Typed direct operations pass the Action Gate with a one-use permit. The Orchestrator submits; the Action Broker executes. | Eight fixed facts: reviewed commit, CI and security and regression checks, target version, mode and policy fit, frozen Watch plan, tested Recovery Point, no barred action, pipeline and approval rules. |
| 6. Watch | A frozen plan runs per rollout stage: fixed queries, limits, sample floors, missing-data rules. Promotion only on pass. The confirmation window then closes the incident. | G1–G6 gate queries. Absence never counts as health. Severe regression freezes promotion and takes the pre-approved Recovery Point rollback path. |

## Safety model

### Authority modes

Authority modes are the capability ceiling. Only an operator can change them.

| Mode | Permitted work |
|---|---|
| Observe | Diagnosis and reporting only. No remediation. |
| Prepare | Ends at a merge-ready Remediation PR. No merge, no deploy. |
| Repair | Approved classes of remediation may merge and deploy after all gates pass. |
| Emergency | Pre-approved allow-list harm reduction only: rollback, restart, scale, reroute, disable. No new code, no general shell. |

### Automation policies

Automation policies decide when a human must approve. Values:

- **Review at all times.** Every action waits for a recorded human approval.
- **Autonomous at all times.** No approval needed within the mode's ceiling.
- **Scheduled hybrid.** IANA timezone plus weekly windows, evaluated at execution time. Policy and tzdb versions are recorded per verdict. Run 1 uses this policy.

### Action-risk classes

Companies may tighten a class; they cannot loosen a default.

- **safe** — reversible; the Recovery Point covers every changed surface; no approval beyond policy.
- **guarded** — always needs a recorded human approval in every policy and mode; the mode may still deny it.
- **barred** — the product never executes; a human acts outside it.

### Worker isolation

- Short-lived container per attempt (gVisor Job in production, rootless Docker in the demo).
- Incident-scoped reads. No credentials, no direct production access.
- The model API key is held only by the Model Gateway. Workers receive a streaming transport.
- Tools are allow-listed per role. Diagnose roles have no filesystem, shell, write, or web access.

### Audit and replay

- One append-only journal records proposals, policy verdicts, approvals, leases, broker calls, Watch results, and human overrides, each with actor identity and credential scope.
- Secrets never enter the journal.
- Every result binds to the candidate hash. Stale or unbound results are invalid.
- Separation of duties: the approver differs from the executing service account; the policy editor cannot be the sole approver of a guarded action.
- Replay verifies manifest hashes, journal sequence, schema, redaction, and freshness. Saved-run commands are rejected.

### Budgets

| Limit | Production default | Demo Profile |
|---|---|---|
| Attempts per incident | 3 | 3 (kept) |
| Wall time per attempt | 30 minutes | removed |
| Tokens and cost per attempt | capped at the Model Gateway | removed |
| Fusion rounds | 3 | removed |
| Revisions | 2 | 2 (kept) |
| Worker restarts | 2 | 2 (kept) |
| Approval expiry | 30 min (5 min – 8 h configurable) | same |

The Demo Profile also keeps both gates, approvals, leases, cancel, cleanup, and host safety limits.

## Demonstration

The full pipeline runs against the Astronomy Shop OpenTelemetry demo at a pinned commit, in Docker Compose. Two incidents were captured live and exported as saved bundles: real signals, real seeded code defects, real test tools, and real gates. The presentation replays the bundles in the Incident Workspace. Nothing runs live on stage.

### Run 1 — verified code remediation

Seed S1 inverts one line in the Payment service's card-type check (`card.js`). Every charge fails. The detector rule fires above the 0.20 threshold; the recorded error ratio is ≥ 0.9. The system diagnoses, proposes, verifies, deploys behind a hybrid-window approval, and watches the ratio fall below 0.05 across three consecutive samples. The incident resolves, then closes after the confirmation window. 93 journal events.

- real OTel signals
- four hypotheses; gate eliminated three
- one-line fix
- hybrid approval recorded
- probe ring 20/20
- error ratio 0.9 → <0.05

### Run 2 — deterministic failed verification

The same incident, seed S2: the card-type inversion plus a silently removed Luhn guard. The system writes the same correct one-line fix. Verify rejects it: R1 records a `major` reachability finding, and the scoped T5 regression suite fails deterministically on the "Luhn-failing Visa is rejected" case. Nothing ships. The incident stays open with 2 attempts remaining. 69 journal events.

- correct fix written
- reviewer found adjacent defect
- regression test failed
- Release Gate never ran
- failed evidence joins the set

### Presentation kit

- Incident Workspace: list, detail, panels 1–12 (intake, evidence, hypotheses, fusion, remediation, verify, gates, approvals, watch, policy, attempts, telemetry), audit tail, artifact viewer with provenance strips and disabled saved controls.
- Replay verification: the saved bundle is verified in memory before rendering — manifest hashes, journal sequence, schema, redaction, freshness — and reports named integrity errors.
- Twelve screenshots and two timed rehearsals (171 s each) against the captured bundle. A 2–3 minute script and an evidence kit live in `docs/presentation/`.
- Accessibility and responsive checks pass: keyboard-only, 200% zoom, reduced motion, 1280 px and 390 px viewports.

## Implementation status

### Built

| Milestone | Delivered |
|---|---|
| Research reports (#2–#12) | Eleven settled reports: intake, orchestrator stages, Evidence Set and Hypothesis gate, review and verification matrix, worker isolation, authority and risk and budgets, company integration, Pi skill catalog, workspace, demo runs. |
| Contracts and fixtures (#16) | JSON Schema and TypeScript wire contracts, hashing, journal rules, saved-bundle verifier, byte-accurate fixture suite. |
| Frontend scaffold (#14), routes (#21), panels (#17) | TanStack Start + shadcn/ui; list, detail, and artifact routes; panels 1–12 with saved-truth rendering. |
| Demo environment (#18) | Compose overlay on the pinned Astronomy Shop commit; behavior-preserving `card.js` seam; seeds S1 and S2; pinned detector rule; reset scripts. |
| Control Plane, brokers, CI (#20) | State machine, append-only journal, trigger dedup, Policy Service, Hypothesis and Release and Action gates, HMAC webhooks, leases and permits, PostgreSQL and artifact store, Read and Action Brokers, local CI runner, git adapter. |
| Pi skills (#15) | Core: orchestrator, Fusion participant (×2), judge, synthesizer, repair planner and implementer. Reviews R1–R4, R8. Tests T1–T5, T7, T9, T10, T12, T13. |
| Release, Watch, capture (#19) | Two-step probe ring, frozen Watch plan G1–G6, capture and export pipeline, two live captured runs. |
| Replay, accessibility, rehearsal (#22) | Strict replay checks, keyboard and zoom and reduced-motion and responsive passes, twelve screenshots, two 171 s rehearsals, offline presentation. |
| Agents 1/9 (#24) | One Pi role proven end-to-end through the Model Gateway and Brokers. |

### In progress — real Pi agents during capture (#23, #25–#32)

The two saved runs prove the deterministic pipeline with canned model-role inputs: Fusion receives structured responses, repair returns canned plans, and review and test artifacts are assembled directly. The current phase replaces those inputs with real Pi Agent Core sessions against a real model, under the same contracts, gates, and trust boundary. Agents investigate, propose, and invoke permitted tools. They do not become the authority for transitions, gates, test outcomes, receipts, or release decisions.

Pinned: `@earendil-works/pi-agent-core` and `pi-ai` 0.79.4, OpenCode Go provider, `deepseek-v4-flash`, reasoning `high`.

| Issue | Scope | State |
|---|---|---|
| #23 Spec | Real-agent execution path in the Demo Profile; role-session abstraction; typed terminal tools; model-use records; Model Gateway owns the key. | spec open |
| #25 Agents 2/9 | Persist and replay agent sessions: ordered pipeline calls with pending, running, succeeded, failed, or aborted status; no secrets, no hidden chain-of-thought. | open |
| #26 Agents 3/9 | Complete Fusion Diagnosis with real Pi participants, Judge, Synthesizer. | open |
| #27 Agents 4/9 | Repair planning and implementation with Pi agents in a copy-on-write worktree. | open |
| #28 Agents 5/9 | Verification with Pi reviewers (R1–R4, R8) and Test Agents (T1–T5, T7, T9, T10, T12, T13). | open |
| #29 Agents 6/9 | Pi Orchestrator and frozen-evidence rehearsals. | open |
| #30 Agents 7/9 | Both scenarios complete through real Pi agents: Run 1 reaches verified remediation; Run 2 is blocked safely and never enters Release. | open |
| #31 Agents 8/9 | Enforce presentation capture selection and freeze. | open |
| #32 Agents 9/9 | Capture the accepted real-model presentation runs. Failed or imperfect runs remain honest, inspectable runs; canned output never replaces a failed run. | open |

### Solution Contract scope (pitch-only)

Fixed in the research reports and described in the Workspace as documentation. Not executed or claimed as implemented by the demo.

| Surface | Scope |
|---|---|
| Production deployment | Company-hosted Helm chart and `sihctl` CLI; gVisor-isolated Jobs; mTLS and cert-manager; OIDC roles; multi-region gateways; workload identity; production budgets enforced at the Model Gateway. |
| Adapters | GitHub App / GitLab, company CI/CD, approval systems, on-call and chat notifications. |
| Missing capability surface | Real rollback execution via recorded Recovery Points; reviews R5, R6, R7, R9; test layers T6, T8, T11; live controls (approve, deny, pause, cancel); live event stream (SSE); policy editor; audit search; budget editor; Emergency allow-list as a live control; tenancy, billing, retention, compliance, regional data rules. |

## Technology stack

| Layer | Choice |
|---|---|
| Runtime and toolchain | Bun, Turbo, Vite, TypeScript 6. Every dependency pinned in one lockfile. A fresh clone passes typecheck, lint, build, and tests. |
| Frontend | TanStack Start + shadcn/ui (Sera style, Mist theme, DM Sans and Raleway, Tabler icons, Base UI). |
| Signals | OpenTelemetry traces and span metrics, Prometheus-compatible ruler, Alertmanager, OpenFeature / flagd. |
| Runtime environment | Docker Compose overlay on the pinned Astronomy Shop commit; one rootless Docker container per attempt. |
| Agents | Pi Agent Core / Pi AI 0.79.4 (pinned), OpenCode Go provider, `deepseek-v4-flash`, reasoning high. The Model Gateway owns the API key. |
| Contracts and integrity | JSON Schema and TypeScript wire contracts, SHA-256 content hashing, sealed artifact envelopes, append-only journal. |
| Deterministic controls | Hypothesis Gate (8 checks), Release Gate (8 facts), Action Gate (one-use permits), Watch G1–G6, verdict functions. |

Monorepo layout: `apps/web` (Workspace), `apps/control-plane` (state machine, journal, gates), `packages/contracts` (schemas, hashing, verifier), `packages/pi-skills` (core, reviews, tests), `packages/ui`, `demo/` (compose, seeds, capture, ci, saved-runs, replay, fixtures), `docs/` (research reports, ADRs, presentation kit).

## Frequently asked questions

**Did the demo run live?**

No. Two runs were captured live earlier. The presentation replays the saved journal and sealed artifacts in the Incident Workspace. Nothing runs live on stage.

**How is this different from a coding agent or an auto-patching tool?**

Coding agents produce code. This system adds a workflow and safety layer around them. Agents propose; deterministic gates decide. Every claim is a receipt bound to a content hash. Every external action is a typed, leased, one-use permit. Every decision is in an append-only journal. Run 2 demonstrates the difference: the AI wrote a correct patch and the system refused to ship it.

**What stops the AI from causing damage?**

Six layers: a short-lived worker with no credentials and no production access; authority modes that cap what can be attempted; action-risk classes, where barred actions never execute; three deterministic gates; Recovery Points recorded before any mutation with a pre-approved rollback path; and mandatory human approval for guarded, irreversible, or weakly recoverable changes.

**What happens when the diagnosis is wrong?**

A wrong diagnosis fails the Hypothesis Gate's eight checks. If one passes, Verify still runs every applicable review and test against the candidate hash. Run 2 shows a correct hypothesis being blocked because the surrounding code was unsafe. After 3 attempts, the Incident Report records the evidence, hypotheses, actions, and results, and the incident closes with the `attempt-limit` reason.

**Where do humans fit?**

Humans set authority modes and policies, approve guarded and out-of-window actions, inspect everything in the Workspace, and handle barred actions. The system does not replace engineers; it compresses mean time to repair for evidence-led cases and leaves a replayable record.

**How would a company adopt this?**

As a company-hosted Helm chart and `sihctl` inside its own Kubernetes. It consumes the company's pipeline, CI/CD, approvals, and deployment environments as authoritative records through adapters. Telemetry enters through the product's OTel path or an existing gateway. The Workspace is an evidence and control surface, not a replacement for Grafana, Jaeger, or CI.

**How do we know the evidence is real?**

Every artifact is content-hashed and schema-versioned. Every number on screen cites a saved row or receipt. The replay verifier checks manifest hashes, journal sequence, redaction, and freshness before rendering anything, and saved controls cannot submit. Receipts come from brokers and deterministic tools, not from the model.

**What is left to do?**

Two scopes. Now: replace the canned model-role inputs in the two captured runs with real Pi agents end-to-end (issues #25–#32; the first role is proven at #24). After the hackathon: the Solution Contract — production deployment, real adapters, real rollback execution, the remaining review and test skills, and live controls.

**Which claims should the team not make?**

No live agent on stage. No rollback demo run; automatic rollback is contract scope only. No percentage-based canary; the demo uses a two-step probe ring. No production installation, adapters, or `sihctl`. The saved runs are deterministic-pipeline captures; the real-agent captures are the current open phase.

## Evaluation criteria

The project addresses the four SIH evaluation parameters as follows.

| Parameter (weight) | Evidence |
|---|---|
| Problem Understanding & Impact (25%) | The bottleneck is scoped to diagnosis time and judgment rather than fix time. Two saved runs show both the fix path and the safety path. The audit and replay story addresses recurring incidents and knowledge loss. |
| Innovation & Technical Excellence (30%) | Fusion Diagnosis (independent participants, non-voting Judge, Synthesizer); deterministic gates and receipts that remove AI authority; content-hashed sealed artifacts with tamper-evident replay; risk-classed actions with one-use permits; authority-mode and policy dials. |
| Feasibility, Practicability & Scalability (25%) | The system runs on the real Astronomy Shop stack today. The production path — Helm, gVisor, adapters, budgets — is designed in detail. Isolation and budgets cap cost per incident. The company pipeline remains authoritative, so adoption does not replace existing controls. |
| Solution Quality & Presentation (20%) | Working prototype with two captured runs, offline replay, twelve screenshots, two rehearsed 2–3 minute scripts. Every number is receipt-backed. Contract scope is never claimed as built. Accessibility and responsive checks pass. |

---

*Sources: `docs/research/`, `docs/build-handoff.md`, `docs/presentation/`, and the open issue tracker. Status as of 2026-08-18.*
