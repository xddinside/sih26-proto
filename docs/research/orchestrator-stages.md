# Orchestrator stage contracts and Incident state model

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#5](https://github.com/xddinside/sih26-proto/issues/5), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Blocked by (all closed): [#2 incident intake](https://github.com/xddinside/sih26-proto/issues/2), [#3 worker isolation](https://github.com/xddinside/sih26-proto/issues/3), [#4 release, Watch, and recovery](https://github.com/xddinside/sih26-proto/issues/4)

Prerequisite reports: [incident-intake.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/incident-intake.md), [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md), [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md)

Researched: 2026-08-15

## Decision

The Control Plane is the single writer of all Incident and Incident Run state. The Intake Normalizer, the Orchestrator, and humans can only request transitions that policy permits. An Incident owns serial Incident Runs; each Run is one attempt with fixed stages Detect, Diagnose, Repair, Verify, Release, and Watch. Every stage has a fixed input contract, sealed output artifact, evidence rule, completion gate, failure result, retry bound, and owner. The Orchestrator freely chooses its subagent graph inside those contracts.

The Worker is disposable, so every stage transition and artifact is journaled to the Control Plane before the stage counts as done. Crashes, pauses, and human review all resume from the journal into a fresh Worker for the same attempt. Diagnose uses Fusion Diagnosis rounds without freezing participant count or models. Execution flows through one of two deterministic gates: the Release Gate for code merge and deploy, and the Action Gate for typed direct operational Remediations. Reaching the Attempt Limit produces a concise Incident Report and closes the Incident.

## State model

### Ownership rule

The Control Plane executes every state write. It validates each requested transition against policy, the current state, and the requestor's lease, then appends the transition to the journal. Actors are:

- **Intake Normalizer:** creates or updates an Incident from an IncidentTrigger.
- **Orchestrator:** proposes stage entries and completions, run outcomes, evidence additions, and next-attempt requests.
- **Human:** pauses, resumes, cancels, approves, denies, closes, and changes policy.
- **Control Plane timers:** heartbeat expiry, lease expiry, Watch confirmation windows, and the Attempt Limit.

A Worker never writes durable state directly; it streams proposals through brokers, and the Control Plane records the result. Model judgment can change the content of a proposal, never the legality of a transition.

### Incident

An Incident is the long-lived record. States:

| State | Meaning | Terminal |
| --- | --- | --- |
| `open` | Active Incident. Runs allowed. | No |
| `resolved` | A verified Remediation is deployed and Watch confirmed recovery. Retains Recovery Point and extended-Watch link. | No |
| `closed` | Final record. `closure_reason` required. | Yes |

Legal transitions, all executed by the Control Plane:

- `open` → `open`: append evidence from a new firing trigger or a finished Run. No state change.
- `open` → `resolved`: a Run completes with outcome `verified-remediation`.
- `open` → `closed`: reason `symptom-cleared` (Watch confirmation window passed with no recurrence), `attempt-limit` (Incident Report written), or `human-closed`.
- `resolved` → `open`: the same detector fires again during the confirmation window. Same Incident, attempts continue.
- `resolved` → `closed`: confirmation window and retention requirements met; or human closes.

After `closed`, a new firing for the same `incident_key` creates a new Incident and records the closed one as related, per [incident-intake.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/incident-intake.md). This makes re-opening `resolved` cheap (same Incident, prior evidence intact) while a long-closed Incident never silently absorbs a new failure.

Fields: `incident_key`, delivery history, `detector_state` (`firing` or `resolved`, not an Incident state), severity, scope, Attempt Limit, attempts used, related Incident links, open-run pointer, and closure reason. Detector flapping changes `detector_state` only; the Incident state moves on evidence gates.

### Incident Run

One Run is one attempt: one Worker hosting one Pi Orchestrator and its subagents. States:

| State | Meaning | Terminal |
| --- | --- | --- |
| `queued` | Attempt accepted, Worker not started. | No |
| `running` | Worker holds a live lease and executes a stage. | No |
| `paused` | Human or policy pause; Worker terminated, checkpoint sealed. | No |
| `awaiting-human` | A gate returned `needs-human` or policy requires review; Worker terminated, checkpoint sealed. | No |
| `interrupted` | Worker crash, heartbeat loss, timeout, or Control Plane restart. Reconciliation pending. | No |
| `completed` | All required stages finished. `outcome` required. | Yes |
| `failed` | A stage gate failed or the attempt became unrecoverable. `failure_reason` required. | Yes |
| `cancelled` | Human cancelled the attempt. | Yes |

`completed` outcomes: `verified-remediation` (Watch passed), `symptom-cleared` (symptom verified gone without Remediation), `diagnosis-only` (Observe Mode or an `observe-only` disposition; Incident stays `open` for a human or a mode change), `handoff` (a `prohibited` disposition recorded a human handoff; Incident stays `open` for the human).

`failed` reasons include: `undiagnosable`, `no-hypothesis`, `hypothesis-invalidated`, `no-remediation`, `verification-failed`, `gate-failed`, `rollback-required`, `unstable-worker`, and `interrupted-unrecoverable`.

Transitions:

- `queued` → `running`: Control Plane spawns the Worker; the Worker exchanges its projected token for a run lease.
- `running` → `paused`, `awaiting-human`, `interrupted`, `completed`, `failed`, `cancelled`.
- `paused` or `awaiting-human` → `running`: resume with a fresh Worker on the same attempt.
- `interrupted` → `running`: after reconciliation, same attempt. → `failed`: reconciliation found an unsafe gap or the Worker restart cap was hit.
- Any non-terminal state → `cancelled`: human.

Only one active Run per Incident exists at a time. Attempts are serial; no concurrent Runs race on one Incident.

### Stage field

Each Run carries `current_stage` in `{Detect, Diagnose, Repair, Verify, Release, Watch}` and a per-stage status: `entered`, `in-progress`, `completed`, `failed`, or `skipped` with reason. Stage order is fixed. `skipped` is recorded when a stage is legitimately not run: Repair, Verify, and Release on `symptom-cleared`; Repair onward in Observe Mode or on an `observe-only` or `prohibited` Remediation disposition; Detect and Diagnose are never skipped. The only backward move inside one attempt is the bounded Repair-to-Verify candidate-revision loop defined under Verify: a changed candidate returns to Repair with a new candidate hash and reruns Verify from the top. Any other backward move ends the attempt, and evidence that invalidates the accepted Hypothesis requires a new Diagnose attempt.

### Idempotency

- The `delivery_key` from intake deduplicates triggers before any state write.
- Transition records carry a unique transition command or event idempotency key plus the expected state and version; the journal stays append-only and ordered, and replaying a command whose key is already applied is a no-op.
- Stage artifacts are sealed by content hash and schema version; sealing the same content twice records once.
- External actions use per-action idempotency keys and reconcile unknown outcomes before retry, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md).
- Resume replays the journal from the checkpoint; the last record for each key wins.

### Leases

- **Run lease:** Control Plane-signed, bound to company, Incident, attempt, stage, Authority Mode, Automation Policy version, and expiry. The Worker renews it by heartbeat; brokers check server-side state, not the lease's own claims, per [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md).
- **Release lease:** one mutator per target service and environment for both release and direct-action execution, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md). A second Incident's action on the same target waits or fails stale.
- **Release permit:** short-lived, one-use, bound to candidate hash and target, consumed by the Action Broker.

### Crash recovery

Worker crash, lost heartbeat, or timeout: the Control Plane marks the Run `interrupted`, stops lease issuance, revokes permits, then reconciles every external action without a final receipt before anything else proceeds. If reconciliation is clean and the Worker restart cap for this attempt (2) is not exhausted, the Run resumes in a fresh Worker with the last sealed artifacts and journal checkpoint. The restart cap prevents a crash-loop from consuming the Attempt Limit invisibly; exceeding it fails the attempt as `unstable-worker`.

Control Plane restart: the durable journal is the source of truth. On boot, the Control Plane marks every Run whose lease expired as `interrupted`, resumes `queued` Runs, reconciles in-flight external actions, and resumes or fails each Run. In-memory Control Plane state is never authoritative.

## Stage contracts

Common envelope for every stage transition: `{run, attempt, stage, from, to, actor, policy_version, lease_id, time, artifact_ref}`. Every artifact is schema-versioned, sealed by content hash, and journaled before the next stage can start. The Orchestrator owns proposal content; the Control Plane owns legality and recording. The stage tool table in [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md) is normative for what each stage may touch.

### Detect

- **Purpose:** confirm the symptom from live evidence and produce the starting context.
- **Entry:** Run `queued` from a firing IncidentTrigger or a reopened Incident.
- **Inputs:** IncidentTrigger v1, intake evidence snapshot, service catalog, current Authority Mode and Automation Policy version, related Incidents, and the read snapshot.
- **Allowed tools:** Read Broker reads only. No writes, no local mutations beyond evidence notes.
- **Output:** Incident Brief v1: scope, severity, symptom statement, initial Evidence Set references, service topology, known limits, and the policy version in force.
- **Evidence:** the live metric or trace snapshot taken now, verification queries, and any gap between the trigger and current reality.
- **Completion gate:** symptom confirmed present and consistent with the trigger, or the symptom is verified absent with data (which takes the `symptom-cleared` path through Watch confirmation). A stale trigger is recorded, never assumed.
- **Failure result:** unable to verify within bounded reads → one retry → `failed: undiagnosable`.
- **Retries:** one full re-verification; deeper problems belong to Diagnose.
- **Owner:** Orchestrator proposes; Control Plane records.

### Diagnose

- **Purpose:** produce ranked, evidence-backed Hypotheses through Fusion Diagnosis.
- **Entry:** Detect gate passed.
- **Inputs:** Incident Brief, current Evidence Set, read snapshot, policy limits on rounds and model use.
- **Allowed tools:** Read Broker for the Orchestrator's evidence gathering; Fusion participants get read-only research tools (read, grep, find, ls, known-URL fetch), never writes or a shell. This mirrors the local Research Fusion Mode tool policy.
- **Output:** Diagnosis Report v1: ranked Hypotheses with cited evidence, contradictions, missing evidence, next actions, the round records, and the Remediation disposition recorded after the Hypothesis gate passes.
- **Evidence:** every causal claim cites Evidence Set items; round records are retained inspectable but excluded from later model context.
- **Completion gate:** the deterministic Hypothesis acceptance gate accepts one top Hypothesis. The gate's criteria live in the Evidence Set contract (issue [#6](https://github.com/xddinside/sih26-proto/issues/6)); this stage fixes that model confidence alone cannot pass it and that the accepted Hypothesis must carry a reproducible test or distinguishing-evidence plan. After acceptance, the Orchestrator records the deterministic Remediation disposition (`allowed`, `approval-required`, `observe-only`, or `prohibited`), which Repair consumes.
- **Failure result:** no accepted Hypothesis after the Fusion-round cap where one is configured (production default 3) → `failed: no-hypothesis`. In Observe Mode the Run ends `completed: diagnosis-only` with the Diagnosis Report; no Remediation is sealed.
- **Retries:** production configures a Fusion-round cap per attempt (default 3); the Demo Profile has no round cap. Each round gets fresh shared context and accumulated evidence. More rounds need new evidence or a narrowed task; looping on the same input is not allowed.
- **Owner:** Orchestrator runs the rounds and proposes the gate result; participants, Judge, and Synthesizer are models inside the stage.

### Repair

- **Purpose:** turn the accepted Hypothesis into a safe, reversible Remediation proposal.
- **Entry:** accepted Hypothesis with a Remediation disposition of `allowed` or `approval-required`. Disposition `observe-only` skips Repair onward; `prohibited` records a human handoff and cannot enter execution.
- **Inputs:** Diagnosis Report, Remediation disposition (issue [#6](https://github.com/xddinside/sih26-proto/issues/6)), action-risk classification (issue [#7](https://github.com/xddinside/sih26-proto/issues/7)), Authority Mode, code snapshot, Recovery Point draft.
- **Allowed tools:** per-agent copy-on-write worktrees, local build and test tools, and, through the Action Broker, creating or updating a Remediation PR (code path) or submitting a typed action plan (direct operations). No merge, deploy, or production action; Observe Mode may not enter.
- **Output:** Remediation Proposal v1: change description, diff or typed action plan, citations linking each change to the Hypothesis, test plan, Recovery Point for every changed surface, blast radius, deterministic action-risk class (`safe`, `guarded`, `barred`), and the execution path (code merge/deploy or typed direct operation).
- **Evidence:** the diff, local test output, and the change-to-Hypothesis citation map.
- **Completion gate:** the proposal covers the accepted Hypothesis's causal chain and records its deterministic action-risk class and Remediation disposition. `safe` proceeds; `guarded` proceeds only with its required approval applied at the execution gate; `barred` stops with a recorded handoff and no execution. The Recovery Point covers all changed surfaces or the gap is flagged for human approval.
- **Failure result:** no safe or guarded proposal within bounded revision → `failed: no-remediation`. A `barred` class or `prohibited` disposition is not this failure; it records a human handoff (and an Incident Report when the Attempt Limit is exhausted) and never executes.
- **Retries:** bounded internal revisions; every journal submission is a new candidate hash.
- **Owner:** Orchestrator with Repair subagents. Preparing and creating or updating a merge-ready Remediation PR happens before final human review; approval is required before merge, production deployment, pipeline mutation, or direct production action. Prepare Mode stops at the PR; Repair Mode may merge or deploy only after every later gate and the required approval pass, per [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md).

### Verify

- **Purpose:** prove the candidate works and is safe before any release request.
- **Entry:** sealed Remediation Proposal.
- **Inputs:** candidate hash, proposal, review contract (issue [#8](https://github.com/xddinside/sih26-proto/issues/8)), current policy.
- **Allowed tools:** reads; isolated CI or test runs through the broker only. No merge or deploy.
- **Output:** Verification Report v1: test results, independent review results, checklist completion, and the candidate hash.
- **Evidence:** test and review output with source identifiers.
- **Completion gate:** every required check passed per the review contract; the candidate hash is unchanged since sealing; reviews are recorded with identities.
- **Failure result:** a required check fails and no fixable patch defect remains within the revision cap → `failed: verification-failed`; the failed evidence joins the Evidence Set. Evidence that invalidates the accepted Hypothesis → `failed: hypothesis-invalidated`.
- **Retries:** a fixable patch defect runs a bounded Repair-to-Verify candidate-revision loop inside this attempt: the candidate returns to Repair with a new candidate hash, then reruns all Verify checks from the top. The loop is capped by policy (default 2 revisions). Evidence that invalidates the accepted Hypothesis fails the attempt as `hypothesis-invalidated` and requires a new Diagnose attempt. Release or Watch failure never loops back inside the same attempt.
- **Owner:** Orchestrator proposes; required reviewers and the company's CI decide.

### Release

- **Purpose:** put a fully verified Remediation through its deterministic execution gate — the Release Gate for code merge and deploy, or the Action Gate for typed direct operational Remediations — and, only via brokers and adapters, into the staged rollout or the direct action.
- **Entry:** Verify gate passed.
- **Inputs:** Verification Report, Remediation Proposal (with its action-risk class and execution path), Recovery Point, Authority Mode, Automation Policy version, target and expected version.
- **Allowed tools:** submit a release request (merge/deploy) or a typed direct-action request (config, flag, restart, scale, traffic, infrastructure) to the journal. The Orchestrator never executes either; the Action Broker and the matching adapter do, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md) and the action-risk contract (issue [#7](https://github.com/xddinside/sih26-proto/issues/7)). Emergency Mode substitutes only pre-approved recovery actions through the Action Gate; new code is barred.
- **Output:** sealed execution candidate; Release Gate or Action Gate result; one-use permit; adapter receipts; and the Release record (merge/deploy) or direct-action record (typed operation).
- **Evidence:** gate inputs and result, approvals, rollout state for releases, and pre/post state for direct actions.
- **Completion gate:** the matching gate returns `pass`. Both gates run outside the Orchestrator and cannot be waived by a model; a `guarded` action also needs its required approval recorded at the gate.
- **Failure result:** `fail` → `failed: gate-failed`. `needs-human` → Run `awaiting-human`; resume continues from the gate, never around it. A severe regression after execution takes the rollback path and fails the attempt as `rollback-required`, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md).
- **Retries:** no silent retry; a changed candidate is a new hash and a new gate run.
- **Owner:** Orchestrator submits; the matching gate decides; the Action Broker executes through the release or direct-action adapter.

### Watch

- **Purpose:** compare the promoted change against the frozen plan and decide the Incident's fate.
- **Entry:** a permitted release or Emergency action is executing (release record or direct-action record), or the `symptom-cleared` path requires a confirmation window.
- **Inputs:** frozen Watch plan (fixed queries, limits, windows, minimum samples), the release record or direct-action record, staged rollout state, Recovery Point; for the `symptom-cleared` path, the symptom baseline and absence checks instead of a rollout plan.
- **Allowed tools:** reads of Signals and deployment state; propose rollback through the Action Broker only.
- **Output:** Watch Report v1 per rollout stage (releases) or per direct-action step: queries, baseline and candidate cohorts where a rollout exists, pre/post state for direct actions, time ranges, sample counts, values, limits, and outcomes; plus the final run outcome.
- **Evidence:** every gate result with data, never absence-as-health.
- **Completion gate:** all required gates pass with enough data → Run `completed: verified-remediation` and Incident `resolved`. On the `symptom-cleared` path, the confirmation window passes with no recurrence or regression sentinel → Run `completed: symptom-cleared` and Incident `closed: symptom-cleared`. Severe regression → pre-approved rollback, Incident stays `open`, Run `failed: rollback-required`. Conflicting or missing data → `needs-human`.
- **Failure result:** rollback failure pages a human and keeps the Incident `open`.
- **Retries:** per-step bounded re-sampling; promotion only on pass; time alone never promotes.
- **Owner:** Orchestrator proposes outcomes; Control Plane validates; Action Broker executes the rollback.

## Incident Trigger behavior

The Intake Normalizer and Control Plane handle triggers as decided in [incident-intake.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/incident-intake.md). This report fixes the state effects:

- A **firing** trigger with no active Incident for its `incident_key` creates an `open` Incident and queues its first Run.
- A **firing** trigger for an `open` or `resolved` Incident appends evidence and extends the trigger window; it never spawns a second concurrent Run. A `resolved` Incident returns to `open` and continues the attempt count.
- A **duplicate** delivery (`delivery_key` seen) is a no-op at every level.
- A **resolved** trigger sets `detector_state: resolved`, feeds the active Run as evidence, and starts or restarts the Watch confirmation window. If no Run is active and no Remediation exists, the Control Plane can close with `symptom-cleared` only after that window passes without recurrence or regression sentinel.
- A firing after `closed` creates a new Incident with a related link to the prior one.

## Fusion rounds in Diagnose

The stage contract fixes the round shape, not the panel. Frozen:

- **Shared starting context:** one diagnosis task from the Incident Brief plus the cited Evidence Set; binding decisions are marked as such, mirroring Fusion's Brief Authority Levels.
- **Independence:** every participant gets the same task and context, runs in parallel with its own scratchpad, and cannot see other participants' work. Judge input is participant outputs only, never their tool traces.
- **Judge output schema:** agreement, contradictions, blind spots, and uniquely useful findings; no winner picked by vote.
- **Synthesizer output schema:** ranked Hypotheses, supporting and opposing evidence, open gaps, and next evidence-gathering actions.
- **Round cap and stop rules:** production may configure a round cap per attempt (default 3); the Demo Profile has none. The gate is the only exit into Repair.

Not frozen: participant count (at least two, chosen per Run within policy bounds), the models themselves (resolved through the Model Gateway; the local Fusion configuration requires at least two participants and a Judge, with the Synthesizer defaulting to the primary model), and evidence-gathering between rounds. This matches [docs/agents/fusion.md](https://github.com/xddinside/sih26-proto/blob/main/docs/agents/fusion.md) and the live Fusion harness: `resolveFusionConfiguration` enforces participants ≥ 2 and a Judge; participants and Judge get read-only tools; participant and Judge traces plus Fusion Run Artifacts persist for inspection but remain excluded from future model context, while the synthesized result is the only normal conversation turn.

## Attempts, pause, resume, cancellation, review, policy, staleness, concurrency

- **Attempts:** serial. An attempt is consumed when its Run reaches `completed` or `failed`. After a `failed` Run with attempts remaining, the Control Plane auto-queues the next attempt only when the Automation Policy permits unattended continuation (always-autonomous) and the failure class is safe (no severe regression, irreversible-effect flag, or `needs-human`); a human-review policy leaves the Incident `open` for a human, and a scheduled-hybrid policy auto-queues only during its autonomous window, though a human approval lets the next attempt start at any time. Exhausting the Attempt Limit writes the concise Incident Report (Evidence Set, Hypotheses, actions, results) and closes the Incident `attempt-limit`.
- **Pause and resume:** pause revokes the run lease so brokers stop issuing new actions immediately; an already-running external call is never torn down mid-flight and reconciles when it settles. The Worker terminates gracefully, its checkpoint seals, and the Run waits. Resume spawns a fresh Worker for the same attempt; it does not consume a new attempt.
- **Cancellation:** a human cancels a Run; the Control Plane revokes the run lease so no new broker action starts, then reconciles outstanding external actions. The Incident stays `open` until a human closes it or another attempt finishes.
- **Human review:** every `needs-human` outcome parks the Run in `awaiting-human`. Approvals and denials are recorded with human identity, policy version, and evidence. Approval is required before merge, production deployment, pipeline mutation, or direct production action; preparing and creating or updating a merge-ready Remediation PR happens before that approval. Human-review policies require approval at every such point; always-autonomous policies never park except on a `needs-human` gate; scheduled-hybrid policies require approval outside their autonomous window, and a human approval then lets the Run proceed immediately rather than waiting for the next window. All three use the same `awaiting-human` state.
- **Policy changes:** policies are versioned. A stricter change stops new broker actions immediately at enforcement time by revoking the run lease; in-flight actions still reconcile. Sealed artifacts stay pinned to the policy version that created them, while current permissions are always rechecked against the live policy before any action. The execution gate (Release Gate or Action Gate) always re-checks the current policy and mode, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md).
- **Stale state:** triggers carry timestamps and receive windows; leases expire; every external mutation checks the expected current version. A stale target or expired permit fails the gate as `needs-human` rather than acting.
- **Concurrent Incidents:** distinct Incidents may run concurrently, bounded per company. Mutations to one target serialize through the release lease; a Run that loses that race re-checks the expected version at its next gate. One Incident's Signals and rollback evidence are readable by another's Diagnose as context.

## Durable state outside the Worker

Everything the Incident Workspace renders lives outside the Worker:

- the append-only Incident journal in the Control Plane: triggers, transitions, policy decisions, broker requests and results, model-use records, artifact hashes, receipts, lease events, approvals, and human actions;
- sealed artifacts in company-scoped object storage by content hash: Incident Briefs, Diagnosis Reports, Remediation Proposals, Verification Reports, Release and direct-action records, Recovery Points, Watch Reports, and the Incident Report;
- the run summary: state, stage history, outcomes, and restart counts.

The Pi JSONL session is retained as supporting evidence only; the Workspace is built from the journal and sealed artifacts, per [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md). The Recovery Point is retained through the company's rollback and backup window, per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md).

## Demo Profile

The Demo Profile runs the same state machines, journal schema, artifact schemas, stage order, and gate code. It changes only the operating layer:

- Workers are rootless local Docker containers instead of Kubernetes Jobs with gVisor, per [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md).
- Brokers are local processes pointed at the local Astronomy Shop.
- No Fusion-round, evidence-action, wall-time, token, or model-cost cap. Attempt Limit, stage order, both execution gates, Authority Modes, Automation Policies, release lease, Recovery Point, host limits, and cleanup controls all apply unchanged.
- The demo operator plays the human. A `needs-human` pause becomes an operator prompt; saved Demo Runs show the `awaiting-human` state and its recorded approval.

Saved Demo Runs therefore replay the full state and evidence contract in the Incident Workspace, marked as saved runs. The two planned Demo Runs (one verified remediation, one severe-regression rollback) from [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md) exercise both terminal paths of this state model.

## Edge cases and failures

| Case | Required behavior |
| --- | --- |
| Trigger arrives while a Run is active | Evidence append; no second Run; the active Run's next stage sees the new evidence. |
| Duplicate trigger delivery | `delivery_key` no-op at intake and Control Plane. |
| Resolved then immediately re-firing detector | Watch confirmation window restarts; `detector_state` tracks the flapping without moving Incident state. |
| Symptom already gone at Detect | `symptom-cleared` path through the Watch confirmation window; no Remediation sealed. |
| Worker crashes mid-external-action | `interrupted`; reconcile by target inspection before resume or fail; no blind retry. |
| Worker crashes before a stage completes | Stage status stays `in-progress`; fresh Worker re-runs that stage from its checkpoint, not from scratch artifacts that were never sealed. |
| Crash loop | Restart cap per attempt (2); beyond it `failed: unstable-worker`; human decides. |
| Attempt Limit hit mid-stage | The current stage finishes or fails, then the Incident Report is written and the Incident closes `attempt-limit`. |
| Control Plane restarts mid-Run | Journal replay; expired leases mark Runs `interrupted`; reconciliation before anything proceeds. |
| Policy changes mid-Run | Stricter change revokes the run lease and stops new broker actions immediately; sealed artifacts stay pinned to their creating policy version; live permissions rechecked before every action. |
| Two Incidents target one service | Release lease serializes mutations; loser re-checks expected version and may fail stale. |
| Verify finds a fixable patch defect | Bounded Repair-to-Verify revision loop: new candidate hash, full Verify rerun. Hypothesis-invalidating evidence fails the attempt instead. |
| Model Gateway or broker down mid-stage | The stage cannot seal; the Run parks `interrupted` or `awaiting-human` rather than proceeding on missing evidence. |
| Human cancels during a rollout | Run lease revoked; no new broker action; in-flight release reconciled by adapter; Incident stays `open`. |
| Re-fire after Attempt Limit closure | New Incident with related link; fresh Attempt Limit. |

## Rejected choices

- **Let the Orchestrator write Incident state:** rejected because the Worker is disposable and untrusted; the Control Plane is the single writer.
- **Concurrent Runs per Incident:** rejected because attempts would race on the same Evidence Set and target; serial attempts keep the causal chain readable.
- **Resume counts as a new attempt:** rejected because attempts measure diagnosis-remediation cycles, not infrastructure restarts; the Worker restart cap covers crash loops instead.
- **Freezing participant count or models in the Diagnose contract:** rejected because the Fusion configuration is policy and runtime choice; only the round shape is fixed.
- **A model-passable execution gate:** rejected per [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md); both the Release Gate and the Action Gate return `needs-human` as their only flexible outcome.
- **Automatic close on a resolved trigger:** rejected because symptoms can return; only the Watch confirmation window closes `symptom-cleared`.
- **Merging `resolved` into `closed`:** rejected because a re-fire during `resolved` should reopen the same Incident with its evidence, while a re-fire after `closed` must start a new one.
- **Skipping Detect because the detector already fired:** rejected because triggers go stale; the Orchestrator must re-verify against live evidence.
- **Letting Observe Mode seal Remediation proposals:** rejected because Observe permits diagnosis and reporting only.

## Why this fits the SIH rubric

- **Problem and impact:** the state machine shows exactly who may do what and when, which is the product's core claim about safe autonomy.
- **Technical excellence:** durable single-writer state, journaled stages, leases, and deterministic gates sit outside model judgment; Fusion rounds are inspectable evidence.
- **Feasibility and scale:** the same machines run in production Kubernetes and a local Docker demo; saved Demo Runs replay the real contract.
- **Solution quality and proof:** the Incident Workspace can show every transition, artifact hash, and gate result, which the rubric's evidence checks reward.

## Test strategy

- **State machine unit tests:** every legal transition listed here executes; every illegal one is rejected with a policy error.
- **Idempotency tests:** replaying triggers, deliveries, transition commands, and seals applies once; repeated pause→resume→pause sequences produce distinct ordered events, not suppressed replays.
- **Crash tests:** kill the Worker at each stage boundary, mid-action, and mid-heartbeat; assert `interrupted`, reconciliation, and correct resume or fail. Restart the Control Plane mid-Run and assert journal replay.
- **Policy tests:** change Authority Mode and Automation Policy at each stage boundary and gate; assert immediate lease revocation stops new broker actions, sealed artifacts stay pinned to their creating policy version, and both the Release Gate and the Action Gate re-check live policy.
- **Gate tests:** a code Remediation clears the Release Gate and a typed direct operation clears the Action Gate; a `guarded` action fails without its recorded approval; a `barred` or `prohibited` action never executes.
- **Concurrency tests:** two Incidents on one target; assert release-lease serialization and stale-version failures.
- **Attempt tests:** drive each `failed` reason; assert attempt accounting, the restart cap, the Incident Report at the limit, auto-queue behavior against policy, and the bounded Repair-to-Verify revision loop with full Verify reruns.
- **Demo end-to-end:** produce the two saved Demo Runs and assert the Workspace replays all stages, states, and evidence from the journal alone.

## Acceptance checks

The design is ready to implement when tests show that:

1. every Incident and Run transition above is legal only from its listed source states, with a recorded owner and policy version;
2. a Worker crash, heartbeat loss, or Control Plane restart never loses a sealed artifact, duplicates an external action, or re-runs a completed stage;
3. replaying any trigger, transition command, or seal is a no-op, and a repeated pause→resume→pause sequence still yields distinct ordered events;
4. every stage artifact matches its schema and is content-hashed before the next stage can start;
5. no Orchestrator action skips the Release Gate or the Action Gate, and a model cannot change a gate result or an Authority Mode limit; a stricter policy, pause, cancellation, or lease revocation stops new broker actions immediately;
6. Fusion Diagnose produces a Diagnosis Report with round records after at least two independent participants and a Judge, and stops at the configured round cap (where one exists) or the acceptance gate; participant and Judge traces plus Fusion Run Artifacts persist for inspection but stay out of future model context;
7. pause, resume, cancellation, `needs-human`, policy change, and Attempt Limit behave exactly as specified above, and the bounded Repair-to-Verify revision loop reruns all Verify checks on a new candidate hash while hypothesis-invalidating evidence fails the attempt;
8. the Incident Report contains the Evidence Set, Hypotheses, actions, and results, and closes the Incident `attempt-limit`;
9. the Demo Profile passes the same checks as the Solution Contract while only dropping Fusion-round, evidence-action, time, token, and model-cost caps.

## Primary evidence

- Local Fusion Agent Harness at `/home/xdd/dev/sandbox/fusion`, inspected 2026-08-15 at commit `6e27998b6d11a76574e59cfdce8a1c9766b3fabc`: `CONTEXT.md` (independence, Judge input, Synthesizer output, scratchpad rules), `packages/coding-agent/src/core/fusion/model-configuration.ts` (participants ≥ 2, Judge required, Synthesizer defaults to primary model), `packages/coding-agent/src/core/fusion/research-fusion.ts` (parallel participants, judge before synthesis, abort and failure finalization), `packages/coding-agent/src/core/fusion/prompts.ts` (shared starting context and judge output schema), `packages/coding-agent/src/core/fusion/tool-policy.ts` (read-only participant and judge tools).
- [docs/agents/fusion.md](https://github.com/xddinside/sih26-proto/blob/main/docs/agents/fusion.md) for the SIH Fusion adaptation rules.
- The three prerequisite reports cited inline above: intake, Worker isolation, and release/recovery.
- Pi security and containerization boundaries as cited in [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md); Kubernetes Job lifecycle and lease behavior as cited in that report and [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md).
- Issue [#5](https://github.com/xddinside/sih26-proto/issues/5) and map [#1](https://github.com/xddinside/sih26-proto/issues/1) for scope and binding decisions.
