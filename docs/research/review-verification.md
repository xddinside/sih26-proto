# Review and verification contract

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#8](https://github.com/xddinside/sih26-proto/issues/8), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Prerequisite reports: [incident-intake.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/incident-intake.md), [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md), [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md), [orchestrator-stages.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/orchestrator-stages.md), [hypothesis-gate.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/hypothesis-gate.md), [authority-action-risk.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/authority-action-risk.md)

Researched: 2026-08-15

## Decision

Every Remediation candidate is verified against a deterministic, class-based review and test contract. The Control Plane's applicability resolver computes the exact required, conditional, and not-applicable check set from the Remediation class, the declared changed surfaces, the diff, and the action-risk class. Specialized review subagents produce nine review roles and the environment produces thirteen test layers; every result is sealed by content hash and bound to the candidate hash. A deterministic consolidation step merges parallel review reports under fixed rules with no majority voting. The Verify stage seals a Verification Report that both execution gates consume through a fixed verdict function: `pass` only when every required fact holds, `fail` on a definitive false fact, `needs-human` when evidence is missing, a tool is unavailable, reviews contradict, or an approval is outstanding. Agents choose how to run checks; only fixed policy decides which checks are required, what passes, and what fails.

## Applicability: deterministic, not a universal checklist

The project rejects the checklist that runs every expensive test on every change. Instead, one pure function decides the check set.

### Applicability resolver

The Control Plane computes, for a sealed Remediation Proposal:

```text
check_set = f(remediation_class, declared_surfaces, diff, action_risk_class, policy_version, tool_catalog)
```

Each check lands in exactly one of three buckets:

- **Required:** must run and must pass. One missing or failed required check blocks the gate.
- **Conditional:** runs only when its deterministic trigger fires on this candidate. When triggered, it behaves exactly like a required check. When not triggered, it is recorded as `not-applicable` with the trigger evaluation, never as a silent skip.
- **Not applicable:** never runs for this class; recorded as such.

No agent may add, remove, or re-bucket a check. The resolver is versioned policy code in the Control Plane; the Orchestrator requests a resolution and receives the check set it must satisfy. The resolver's inputs are the Remediation Proposal fields (class, surfaces, risk class), the diff content hashes, and the pinned tool catalog with its version and scan database versions. A new tool catalog version re-resolves the check set; already-sealed results stay pinned to the catalog that produced them, and a changed required check reruns.

### Blast-radius scoping for regression

The scoped regression suite (T5) runs by default, selected through the service or package ownership map of the changed files: a change in the Payment service selects the Payment service's regression tests, plus shared-contract tests where the change touches a published interface. The ownership map is policy data, updated by operators, not by agents. If the map cannot resolve the changed files, the resolver returns `needs-human` rather than silently running everything or nothing.

## Remediation classes

The classes below are the fixed rows of the contract. Each carries its default risk class from [authority-action-risk.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/authority-action-risk.md) and its gate path: code merge and deploy uses the Release Gate; every typed direct operation uses the Action Gate.

| Class | Scope | Default risk | Gate path |
|---|---|---|---|
| Code | Remediation PR: source changes, dependency changes shipped with code | `safe` to propose; merge and deploy follow the Release Gate | Release |
| Configuration | Helm values, runtime config, environment variables, config files | `safe` with a tested Recovery Point, else `guarded` | Action |
| Feature flags | Disable, enable, or change a rollout percentage | Disable: `safe`; enable or widen: `guarded` | Action |
| Deployment | Staged rollout of a pinned artifact through the release adapter | `safe` with a canary or preview ring and tested Recovery Point; all-at-once production release: `guarded` | Release |
| Restart / scale / traffic | Restart a workload, scale replicas, reroute, drain, switch rings | `safe`; scale-down below the redundancy floor: `guarded` | Action |
| Infrastructure | Apply a provider plan, change a long-lived resource, network or identity policy | `safe` only with provider state identifiers and a saved plan; creating or removing long-lived resources: `guarded`; destroying an unbacked resource: `barred` | Action |
| Database / data | Migration (ships with code through the Release Gate), standalone backfill or read-only query through the Action Gate | Read: `safe`; migration with a tested down path and restore drill: `guarded`; destructive migration, mutating backfill, delete rows: `barred` | Release (migration with code) or Action (standalone operation) |
| Credentials / security containment | Issue a short-lived scoped credential, rotate, revoke; quarantine a workload, isolate a namespace, block a route | Issue: `safe`; rotate, revoke: `guarded`; quarantine: `safe` | Action |
| Emergency / rollback | Pre-approved Recovery Point rollback and Emergency allow-list actions | Allow-list membership is a standing recorded approval; `barred` actions can never join | Action |

A migration attached to a code Remediation follows the Code class requirements plus the Data review and migration-test requirements below. The resolver treats the combined class as the union of the two check sets, with the Code set taking precedence where both name the same check.

## Review classes

Nine review roles exist. Each is a specialist subagent with a purpose-built skill (the skill catalog is issue [#11](https://github.com/xddinside/sih26-proto/issues/11)); this report fixes the role contracts the skills must implement.

Common review contract:

- **Inputs:** the candidate diff or typed action plan, the base snapshot, the accepted Hypothesis, the change-to-Hypothesis citation map from the Remediation Proposal, the Remediation disposition, the service catalog, the current policy version, the pinned Evidence Set subset for this Incident, the Recovery Point draft, and any check outputs already produced (build logs, test receipts).
- **Tools:** read-only: read, grep, find, and ls on the Worker's pinned read snapshot; known-URL fetch through the allow-list proxy for language and tool documentation (context only, never evidence); execution of pinned read-only analyzers in the sandbox. No project writes, no shell, no production access, no secrets.
- **Scope:** the candidate's own diff plus the declared surfaces. A reviewer may flag a defect just outside the diff only when the diff makes it reachable; such a finding must cite both lines.
- **Evidence rule:** every finding cites a file and line in the diff, a deterministic check output reference, an Evidence Set item id, or a named Recovery Point gap. An uncited `blocker` or `major` finding makes its review report incomplete: it cannot prove a fail, but that role reruns once against the same candidate hash, and if the rerun still yields an uncited or malformed finding the verdict is `needs-human`. An uncited `minor` or `info` note stays non-blocking but is marked `uncited` in the report.
- **Output:** Review Report v1 per role, sealed by content hash, holding findings with severity, citations, tool versions, and the reviewer identity.

Severity scale, fixed and machine-checked:

| Severity | Meaning | Effect |
|---|---|---|
| `blocker` | A security, safety, or data-integrity defect, a secret in the diff, a barred surface, or a change that defeats the purpose of a required check | Verify fails for this candidate |
| `major` | A real correctness or quality defect that must be resolved before the change ships | Verify fails unless the defect is fixed in a revision or the reviewer retracts it with cited evidence |
| `minor` | Worth fixing, not blocking | Recorded in the Verification Report |
| `info` | Context or a question | Recorded |

The `blocker` and `major` effects above apply to cited findings. An uncited `blocker` or `major` follows the rerun rule in the evidence rule instead of failing outright; an uncited `minor` or `info` note is marked `uncited` and stays non-blocking.

A candidate may not add or widen a suppression annotation, ignore file, or quarantine rule to silence its own finding. Such a change is itself a `blocker` finding. A reviewer retracts its own finding only by issuing a superseding Review Report revision with cited evidence (file, line, or re-run check output); another agent cannot retract a finding, and a model cannot override a finding it did not make.

### The nine roles

| Code | Role | Purpose | Required trigger | Conditional trigger |
|---|---|---|---|---|
| R1 | Change correctness | The change does what the proposal claims and nothing more; no unrelated or unreported edits; the typed action plan matches the adapter's declared surface | Code, Configuration, Feature flags, Deployment, Restart/scale/traffic, Infrastructure, Database, Credentials | — |
| R2 | Causal fit | Every change maps to the accepted Hypothesis's causal chain through the citation map; no change cites nothing; no part of the causal chain is left uncovered | All classes except Emergency; Emergency substitutes the deterministic precondition check | — |
| R3 | Code quality | Readability, maintainability, complexity, concurrency, error handling, test coverage of the new code | Code | Database (migration code) |
| R4 | Security / threat review | Threat modeling on the changed surface: injection, authentication, authorization, secret handling, exposure widening, injection through the new code path. Manual review complements scanners; scanners alone never satisfy R4 | Code, Configuration, Feature flags, Deployment, Infrastructure, Database, Credentials | Restart/scale/traffic (traffic reroute touches exposure) |
| R5 | Dependency / supply-chain | New, removed, or changed dependencies and lockfiles: known vulnerabilities, license fit, provenance of the pinned versions | — | Diff changes entries in dependency manifests or lockfiles (policy-owned path patterns) or the proposal declares a dependency surface |
| R6 | Data / migration safety | Migration direction, lock and batching behavior, backfill safety, destructive clauses, rollback path, business invariants | Database | Code (diff touches migration or schema paths, policy-owned patterns) |
| R7 | Infrastructure / policy | Manifests, IaC state, network policy, RBAC, IAM, quota changes, resource lifecycle | Infrastructure | Code, Configuration, Credentials (diff touches manifest or policy paths, or the proposal declares an infrastructure surface) |
| R8 | Rollback / Recovery Point review | The Recovery Point covers every changed surface, names exact rollback commands in order with preconditions and timeouts, and its validation result is current | Code, Configuration, Feature flags, Deployment, Restart/scale/traffic, Infrastructure, Database, Credentials | — |
| R9 | Operations / observability | Logging, metrics, alerting, runbook and Watch-plan fit; the change is observable and the frozen Watch plan can measure it | Deployment | Code, Configuration, Feature flags, Database, Credentials, Infrastructure (diff touches logging, metrics, alerting, or runbook config, or Watch queries change) |

Emergency and rollback run no fresh model reviews. Their standing artifacts — the pre-approved Recovery Point, the Emergency allow-list entry, and the pre-approved stop and Watch conditions — were reviewed and validated when prepared, and the Action Gate re-checks them deterministically at execution time.

## Test layers

Thirteen layers exist. Each names a tool class; the Orchestrator picks a pinned tool from the approved tool catalog for that layer. Every run produces a broker receipt; test results enter the Evidence Set as `test-result` items and are cited by the Verification Report. A test layer that a company pipeline already runs counts as source evidence consumed through the release adapter; the product never re-runs what the pipeline already ran, and never duplicates its authority.

| Code | Layer | Purpose | Outcome recorded |
|---|---|---|---|
| T1 | Static analysis | Language linters, complexity and anti-pattern rules on the diff and its blast radius | Findings list with rule ids |
| T2 | Schema / lint / build | For code: type check and build of the changed packages and the deployable artifact. For configuration, manifests, and plans: schema validation and linters (config linter, manifest validator, plan formatter) | Build or validation log, artifact digest |
| T3 | Unit | Unit tests of the changed packages, in the Worker's disposable sandbox | Test summary with per-test results |
| T4 | Integration / contract | Contract tests between the changed service and its declared dependencies, on the isolated candidate environment | Contract check receipts |
| T5 | Regression | Scoped regression suite selected by the ownership map, or the full suite only where policy sets it for the target | Suite summary with test selection list |
| T6 | Property / fuzz | Property-based or fuzz runs over parsing, validation, serialization, or boundary code | Counterexample or clean-run receipt |
| T7 | Security scanning | The applicable pinned scanners among secret scanning, dependency vulnerability scanning, and SAST; a scanner that does not apply to the candidate is recorded `not-applicable` and is not run | Scanner output with tool and database versions |
| T8 | Migration tests | Migration up and down on a copy of the schema, plus a backup-restore drill on the isolated environment for `guarded` migrations | Migration and drill receipts |
| T9 | Isolated environment tests | Deploy the candidate to the staging, sandbox, or preview target with representative traffic; prove it starts, serves, and behaves | Environment test receipts |
| T10 | E2E / browser checks | End-to-end checks, including real browser automation, over the user-facing paths the change touches | Playwright-style run receipts |
| T11 | Load / performance | Latency, throughput, or saturation checks where the change touches a performance-sensitive path | Benchmark results with bounds |
| T12 | Fault / recovery | Recovery drills: restart, rollback, flag toggle, rotation, or reroute, rehearsed on the isolated environment | Drill receipts |
| T13 | Watch-plan rehearsal | Execute the frozen Watch plan's queries, limits, and stop rules against a non-production environment to prove they run, return data with the expected labels, and are reachable. It validates operability, never production health | Rehearsal receipts per query |

Deterministic triggers for the conditional layers:

| Layer | Trigger |
|---|---|
| T2 | Code: type check and build. Configuration, Feature flags, Infrastructure: schema validation and lint of the changed artifact |
| T4 | Code, Configuration, Feature flags always; Deployment and Database when a contract suite covers the changed surface |
| T5 scoped | Code always; Deployment's regression evidence is consumed from the company pipeline (Release Gate fact 2); elsewhere when a regression suite covers the changed surface |
| T5 full suite | Scoped resolution returned `needs-human` and the operator set full-suite for this target, or the ownership map marks the changed files shared |
| T6 | Diff touches parsing, validation, serialization, or boundary logic AND the tool catalog holds a fuzz or property harness for the language |
| T7 | Code and Deployment always (Deployment consumes the pipeline's scan); Configuration, Infrastructure, and Credentials/containment when the plan or changed artifact can carry secret, dependency, executable policy, identity, or exposure risk. The applicable scanners run; the rest record `not-applicable` |
| T8 | R6 trigger (data surface declared or migration/schema paths changed) |
| T9 | Class in {Deployment, Database, Infrastructure} or a staging or candidate target exists for the company; in the Demo Profile the candidate instance always exists |
| T10 | Diff touches user-facing paths (frontend sources, HTML templates, browser-served API routes) or the service catalog marks the service user-facing and the pipeline holds an E2E stage |
| T11 | Diff touches a performance-sensitive path declared in the service catalog (hot paths, query plans, caches) or a performance suite exists that covers the changed path |
| T12 | The changed surface or the Recovery Point names a restart, rollback, rotation, toggle, or reroute action |
| T13 | The candidate's execution path carries a Watch plan and a rehearsable non-production environment exists; required for every class that ends in an execution gate with a Watch plan |

## The matrix

Legend: **●** required · **○** conditional · **—** not applicable · **◐** standing artifact, re-checked deterministically at the gate, no fresh model review.

| Class | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Code | ● | ● | ● | ● | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Configuration | ● | ● | — | ● | — | — | ○ | ● | ○ | — | ● | — | ● | ○ | — | ○ | — | ○ | — | — | ○ | ● |
| Feature flags | ● | ● | — | ● | — | — | — | ● | ○ | — | ● | — | ● | ○ | — | — | — | ○ | — | — | ○ | ● |
| Deployment | ● | ● | — | ● | ○ | ○ | ○ | ● | ● | ● | ● | ● | ○ | ● | — | ● | ○ | ● | ○ | ○ | ○ | ● |
| Restart / scale / traffic | ● | ● | — | ○ | — | — | — | ● | ○ | — | — | — | — | — | — | — | — | ○ | — | — | ○ | ● |
| Infrastructure | ● | ● | — | ● | — | — | ● | ● | ○ | — | ● | — | — | — | — | ○ | — | ○ | — | — | ○ | ● |
| Database / data | ● | ● | ○ | ● | — | ● | ○ | ● | ○ | — | — | — | ○ | ○ | — | — | ● | ● | — | ○ | ○ | ● |
| Credentials / containment | ● | ● | — | ● | — | — | ○ | ● | ○ | — | — | — | — | — | — | ○ | — | — | — | — | ○ | ● |
| Emergency / rollback | — | ◐ | — | ◐ | — | — | — | ◐ | — | — | — | — | — | — | — | — | — | — | — | — | ○ | ● |

Notes on the matrix:

- The Database class covers both paths. A migration attached to code inherits the Code row's checks in addition. A standalone data operation runs the Database row through the Action Gate; `barred` destructive operations never reach any gate.
- The Deployment row's T1, T2, T3, T5, and T7 are consumed as source evidence from the company pipeline through the release adapter (Release Gate fact 2); the product never re-runs them. T9 and T13 are product-run.
- T5 for non-code classes runs only when a regression suite covers the changed surface (scoped), never by default.
- The Emergency row's ◐ cells mean: the standing pre-approved Recovery Point, allow-list entry, and stop conditions carry their validation from preparation time; the Action Gate re-checks their currency deterministically. The T13 rehearsal and any recovery drill (T12 conditional) are run at preparation time and revalidated at each gate.

## Independence and separation

The contract is built on one rule: a model cannot approve its own work.

1. The Repair subagent that authored a change never reviews it. Every review role for a candidate runs in a distinct subagent instance with its own scratch directory.
2. Reviewers run in parallel where the check set allows and cannot see each other's outputs before consolidation, mirroring the Fusion participant rule. Each reviewer receives only the shared inputs listed above, never the author's reasoning or self-review. Independent test layers also run in parallel inside the Worker's sandbox; dependent layers run in dependency order (build before unit, unit before candidate-instance checks), and the check set records each layer's ordering edges.
3. The Orchestrator coordinates reviews but is not a reviewer. It cannot produce or substitute a required Review Report.
4. Reviewers never edit code or plans. Review findings are inputs; only the Repair worktrees change candidates, and only the integration worktree becomes an artifact.
5. Tool and pipeline results are broker receipts, never model restatements. A model may cite them; it cannot create them, per the anti-laundering rules in [hypothesis-gate.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/hypothesis-gate.md).
6. Human approval remains separate from model review. Under a human-review Automation Policy the system still prepares a merge-ready Remediation PR; the approval is recorded at the execution gate before merge, deployment, or direct production action, per [authority-action-risk.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/authority-action-risk.md). Model reviews can fail a candidate; they can never merge or deploy one.
7. Where the company approval service records approver identity, the approver must differ from the executing service account, as settled in the separation-of-duties rules.

## Review synthesis without majority voting

Consolidation of the parallel Review Reports into the Verification Report's review section is a deterministic Control Plane step. The merge rules are fixed policy code, not model judgment:

- **Severity takes the maximum.** One `blocker` beats any number of passing reviews. No count of approving reviewers cancels a finding.
- **Findings stand until resolved.** A finding resolves by a candidate revision (new hash, full Verify rerun) or by the originating reviewer's cited retraction. No vote removes it.
- **Contradictions are adjudicated, not voted away.** When two reviewers disagree on a required check's outcome, the Control Plane maps the disputed claim to a deterministic check when one exists and reruns that check once with pinned tool versions against the same candidate hash; otherwise it runs one fresh independent review for that same role and claim with no prior outputs. If the cited evidence still conflicts or the rerun cannot decide, the Verify stage returns `needs-human`.
- **Coverage is checked, not consensus.** The consolidation verifies that every required role returned a well-formed report and that no declared surface lacks a reviewer. A missing report is a gap, never an assumed pass.

This mirrors the Diagnose-stage rule: the Judge compares, the gate checks evidence, and no agreement count replaces facts. The consolidation is advisory bookkeeping; the verdict function below is the only thing that passes or fails a candidate.

## Verification Report

The Verify stage seals exactly one Verification Report per candidate hash. Schema:

```json
{
  "schema_version": "1.0",
  "incident_id": "...", "run_id": "...", "attempt": 1,
  "candidate_hash": "sha256:...",
  "remediation_class": "code", "action_risk_class": "safe", "gate_path": "release",
  "applicability": {
    "resolver_version": "...", "policy_version": "...",
    "required": ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
    "conditional": ["R5", "R6", "R7", "R9", "T6", "T8", "T9", "T10", "T11", "T12", "T13"],
    "triggered": {"R5": "dependency-manifest diff", "T9": "candidate target exists"},
    "not_applicable": []
  },
  "reviews": [
    {"role": "R4", "reviewer": "subagent-id", "revision": 1,
     "input_refs": ["diff-hash", "snapshot-hash", "policy-version"],
     "findings": [
       {"id": "...", "severity": "major", "claim": "...",
        "citations": [{"file": "payment/charge.go", "line": 42, "ref": "check-output-ref"}],
        "status": "open | retracted | fixed-in-revision"}
     ],
     "status": "pass | fail", "sealed_at": "..."}
  ],
  "tests": [
    {"layer": "T3", "tool": "go test", "tool_version": "...", "target": "./payment/...",
     "receipt_ref": "broker-receipt-id",
     "runs": [{"hash": "sha256:...", "result": "pass", "at": "..."}],
     "outcome": "pass | fail | flaky-pass | error | not-run", "flaky": false}
  ],
  "hash_binding": {"sealed_candidate": "sha256:...", "checked_candidate": "sha256:...", "match": true},
  "verdict": "pass | fail | needs-human",
  "verdict_reason": "...",
  "sealed_at": "...", "policy_version": "..."
}
```

### Candidate hash binding

The candidate hash is the content hash over the full change set: the diff or typed action plan, the proposal fields that define the action, and the Recovery Point. Every review report and test result records the candidate hash it ran against. The Verify completion gate and both execution gates accept a result only when its hash equals the sealed candidate hash. Any change anywhere in the change set produces a new hash, and every required check reruns from the top; a single stale result invalidates the run it belongs to.

### Deterministic verdict function

The verdict is a pure function over the sealed Verification Report and the gate inputs. It returns one of three values, and both gates share its logic in their own forms.

**`pass`** — all of these facts hold:

1. The applicability resolution is complete: every required check ran and passed; every triggered conditional check ran and passed; every check result references the sealed candidate hash.
2. No review finding is `open` at severity `blocker` or `major`, and every such finding cites evidence; every required review report is well-formed, sealed, and free of uncited `blocker` or `major` findings.
3. No required or triggered-conditional check outcome is `error`, `not-run`, or `flaky-pass`. A `flaky-pass` on any such check returns `needs-human`, regardless of how many checks are affected.
4. The Release Gate facts from [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md) all hold: artifact matches the reviewed commit; the company pipeline's CI, security, code, regression, and end-to-end checks passed; the target still runs the expected version; the action fits the active Authority Mode and Automation Policy; the rollout and Watch plans are frozen, complete, and rehearsed (T13); a tested Recovery Point covers every changed surface or the uncovered surface carries human approval; no barred action appears; the company pipeline's own branch, environment, change-management, and approval rules passed.
5. For the Action Gate, the operational form of the same facts from [authority-action-risk.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/authority-action-risk.md): the typed command matches an approved adapter and action class, the target version matches, Mode and Policy permit it, the Recovery Point covers every changed surface or the gap has human approval, the stop and Watch conditions are fixed and deterministic, and no barred action appears.
6. A `guarded` class carries a fresh, unexpired, scope-matching approval record; an Emergency action carries its standing allow-list membership for that named action and service.

**`fail`** — a gate fact is definitively false in a way no candidate revision inside this attempt fixes: a barred or irreversible action in the change set, a policy denial, an artifact that does not match the reviewed commit, a candidate hash that changed after Verify sealed, or a required check that failed after the fixable-revision cap. The failed evidence joins the Evidence Set, and the attempt ends `verification-failed` or `gate-failed` per [orchestrator-stages.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/orchestrator-stages.md).

**`needs-human`** — a fact is undecidable: a required check's tool is unavailable, its test data or fixtures are missing, a review report is missing or malformed after one rerun, an uncited `blocker` or `major` finding persists after its rerun, a required or triggered-conditional check recorded `flaky-pass`, a review contradiction survived adjudication, the target no longer runs the expected version, required evidence is redacted beyond policy, or an approval is outstanding. The Run parks in `awaiting-human`; resume continues from the gate, never around it.

A `needs-human` verdict is the only flexible outcome of either gate. No model input ever turns `fail` into `pass` or skips a required check.

## Operational rules

| Situation | Rule |
|---|---|
| Changed candidate | New hash; every required check reruns from the top. A changed candidate discovered at the Release stage fails the attempt (`gate-failed`); there is no silent re-verification at the gate. |
| Stale target | The gate re-reads the target's current version at execution. A mismatch returns `needs-human` (stale target) and the action never executes; a human re-verifies the target before any retry. |
| Flaky test | A failed check retries once on the same hash. Fail-then-pass is recorded as `flaky-pass` with both runs, the same fail-then-pass detection CI systems use to mark tests flaky. A `flaky-pass` on a required or triggered-conditional check returns `needs-human`; it never counts toward `pass`. |
| Unavailable tool | A required check whose tool is unavailable or not in the catalog returns `needs-human`. A conditional check that cannot run records the gap and does not block unless its trigger fired. |
| Missing test data or fixtures | Required check → `needs-human`. Agents do not invent fixtures; a fixture change is a candidate change and a new hash. |
| Secrets | Tests that need a secret receive a broker-issued, stage- and attempt-bound value in a memory-backed mount, masked from output, revoked after. No secret enters Worker files, environment, prompts, or the journal. A real secret found in the diff is a `blocker` and triggers the credential-exposure path: human decision, no autonomous remediation, per the irreversible-effects list. |
| Test isolation | All Verify runs happen in the Worker's disposable sandbox or broker-provisioned isolated CI. Parallel test classes share no mutable fixtures; the candidate instance and the stable instance stay separate. A test that mutates shared state is a defective test and its result does not count. |
| False positives | A reviewer or scanner may retract with a cited re-check. A candidate that adds or widens suppression for its own finding is a new `blocker`. Suppression changes go through human review. |
| Timeouts | Every check has a policy timeout. A timeout records `error`, reruns once, and a repeat escalates to `needs-human`. |
| Retries | Only two recorded retry kinds exist: the single flaky retry above and the one rerun of an errored check. There is no silent retry, and a retry never renames the first result. |
| Fixable patch defect | A failed required check or an open `blocker`/`major` finding with a cited cause inside the candidate's own diff or plan. An uncited finding is never a fixable defect; it follows the uncited-finding rerun rule. Fixable defects run the bounded Repair-to-Verify revision loop: back to Repair, new candidate hash, all Verify checks rerun from the top, revision cap from policy (default 2 per attempt). |
| Hypothesis-invalidating evidence | A test or review outcome that contradicts the accepted Hypothesis is never a fixable defect. The attempt fails `hypothesis-invalidated` and a new Diagnose attempt starts, per the stage contract. |
| Attempt Limit during the loop | The current stage finishes or fails; then the Incident Report is written and the Incident closes `attempt-limit`. |
| Emergency / rollback checks | The Action Gate re-checks the standing Recovery Point validation, allow-list membership for the named action and service, expected target version, and fixed stop conditions. A stale or uncovered surface stops and pages a human; the allow-list action does not improvise. |

## What agents decide versus what policy decides

| Fixed policy (Control Plane) | Agents (Orchestrator and subagents) |
|---|---|
| The applicability matrix, trigger predicates, and required/conditional buckets | Which subagent runs which role, within the independence rules and the graph freedom |
| The severity scale and its effect on the verdict | The wording of findings, provided they cite evidence and carry a severity |
| Candidate hash computation and binding rules | The tool picked from the pinned catalog for each layer, and the exact test command |
| Verdict function and gate outcomes | Whether to run conditional checks early; proposing additional tests beyond the required set |
| Retry, timeout, and flakiness rules | Classifying a proposed change's surfaces and citing the Hypothesis for R2 |
| The fixable-defect boundary and the revision cap | Choosing repair work and accepting `minor` findings as recorded |
| Approval requirements and their consumption | Nothing that changes a required check, a gate result, or a severity |

A model proposes; fixed policy disposes. The same discipline applies here as everywhere else in the product: the Orchestrator owns proposal content, the Control Plane owns legality.

## Demo Profile

The Demo Profile runs the identical resolver, roles, layers, hashing, verdict function, and gates as the Solution Contract. It changes the operating layer only: one rootless Docker Worker per attempt, local brokers, local Astronomy Shop and candidate instance, and no research, action, time, token, or cost caps. The configured Attempt Limit, both gates, approvals (the demo operator plays the human), and every safety control remain.

### Minimum real checks per Demo Run class

The two planned saved Demo Runs exercise both terminal paths. Their incidents stay unselected; the minima below are per class, so any of the candidate faults (payment, product catalog, or queue) satisfies them.

**Verified-remediation run (Code class, Release Gate):** real reviews R1, R2, R3, R4, and R8 by separate subagents, each sealed with findings and citations; T1 lint, T2 build of the patched service image, T3 unit tests of the touched packages, T4 contract check against the candidate instance, scoped T5, T7 dependency-vulnerability and secret scans with recorded database versions, T9 candidate deployment with probe traffic, T13 rehearsal of the frozen Watch queries against the candidate. T10 browser checks run whenever the remediation touches the storefront path, played against the candidate instance. Every result carries a broker receipt and the candidate hash; the operator's approval records for `guarded` parts replay in the Workspace.

**Direct-action run (Configuration or Feature flag class, Action Gate):** real reviews R1, R2, R4, and R8; T2 config or flag-schema validation; T4 contract check on the candidate with the changed configuration; the applicable T7 scanners; T13 rehearsal; Recovery Point validation; the recorded Action Gate verdict with its fact table.

**Severe-regression run (rollback path):** no fresh model reviews; the standing Recovery Point and allow-list approval records; the Action Gate fact table; T13 recovery-gate queries after rollback; the Watch reports showing restored Signals; the blocked follow-up release.

### Saved evidence per Demo Run

The Workspace replays for each saved Demo Run: the Incident Brief, Diagnosis Report, Remediation Proposal with the citation map, the applicability resolution table, every Review Report with findings and file-line citations, every test receipt with outcomes and hashes, the Verification Report, the gate fact table and verdict, approval records, the Recovery Point and its validation, the rollout and Watch reports, and the final run outcome. This is the observed-evidence chain the SIH rubric's evidence checks reward; nothing in it is simulated output.

## Incident Workspace and presentation proof

The Workspace renders, per candidate:

- the check table: class, layer, tool and version, target, outcome, receipt link, candidate hash;
- the review panel: each finding with severity, citation, and resolution state, retractions shown as supersessions, never hidden;
- the gate table: every fact of the Release or Action Gate with its supporting evidence and result;
- the flaky, retry, timeout, and stale markers, each linking to the recorded runs;
- the approval records with approver identity, policy and tzdb versions, and expiry;
- the Recovery Point validation result and the Watch-plan rehearsal receipts.

This maps directly to the rubric's evidence areas: the working prototype (saved runs), technical architecture (the resolver and gates as fixed policy), the USP (evidence-led autonomy with deterministic verification), and technology-stack justification (pinned tools and receipts).

## Edge cases

| Case | Required behavior |
|---|---|
| Reviewer or Model Gateway unavailable | Required review missing → `needs-human`, never a pass from silence. |
| Review output malformed | Rerun once; still malformed → `needs-human`. |
| Uncited `blocker`/`major` finding | Role reruns once against the same candidate hash; still uncited or malformed → `needs-human`. |
| Two reviews contradict on a required check | Adjudication: rerun the deterministic check once with pinned tools when one exists, else one fresh independent review of the same role and claim with no prior outputs; still conflicting → `needs-human`. |
| A scanner flags the candidate's own suppression | New `blocker`; human review of suppressions. |
| Check times out | `error`, one rerun, then `needs-human`. |
| Policy tightens mid-Verify | Run lease revoked, new broker actions stop; the gate re-checks live policy; sealed artifacts stay pinned to their creating policy version. |
| Candidate changed after Verify | Release request for the old hash fails `gate-failed`; no silent re-verification. |
| Target changed by another actor | Stale → `needs-human`; the release lease re-check applies. |
| Conditional trigger misfires | The resolver's trigger evaluation is recorded with the check set; an agent can propose a re-resolution with cited surface evidence, never a manual bucket change. |
| Watch-plan rehearsal cannot run on the candidate | `needs-human` before release; a release never proceeds on an unrehearsed plan. |
| Browser check environment unavailable but T10 triggered | `needs-human`, not a skip. |
| Attempt Limit reached mid-loop | Stage finishes or fails; Incident Report; Incident closes `attempt-limit`. |

## Rejected alternatives

- **Run every check on every change:** rejected for cost and noise; deterministic applicability plus the ownership map scopes work while staying conservative at the edges.
- **Model-judged verification:** rejected; the resolver, severity rules, and verdict function are fixed policy code, consistent with the gate design in the settled reports.
- **Majority voting on review disagreements:** rejected; severity-max and evidence-cited resolution keep one well-cited blocker from being outvoted, mirroring the Diagnose-stage rejection of voting.
- **Author self-review:** rejected; the authoring subagent cannot review its own change, and the Orchestrator is not a reviewer.
- **Trusting unbound results:** rejected; every result binds to the candidate hash, and any change reruns everything.
- **Full regression suite always:** rejected; scoped suites with an explicit ownership map, and `needs-human` instead of a silent skip when the map fails.
- **Scanners instead of security review:** rejected; the OWASP Code Review Guide holds that manual security review complements scanners, and ASVS gives normalized, versioned verification requirements. Both run; neither substitutes for the other.
- **Automated tests proving the absence of all vulnerabilities:** rejected outright; no test suite proves a negative of that size. The Verification Report states what was checked, with what tool and database versions, and the Workspace shows it as such.
- **Candidate-authored suppressions:** rejected; a change that silences its own finding is a blocker.
- **Silent retries:** rejected; the only retries are the recorded flaky retry and the recorded error rerun, and both outcomes stay visible.
- **Delegating check selection to the Orchestrator:** rejected; a model must not choose what verifies its own work.

## Test strategy for the gate itself

- **Resolver matrix tests:** every (class × declared surface × diff pattern × catalog) combination resolves to the exact check set; an unknown class or surface returns `needs-human`, never a default.
- **Verdict function tests:** table-driven fixtures produce the exact `pass`, `fail`, or `needs-human` for every combination of required-check outcomes, flakiness flags, approvals, and hash mismatches.
- **Hash-binding tests:** altering any part of the change set invalidates every bound result; a stale result cannot support a pass.
- **Severity tests:** one cited `blocker` fails the candidate regardless of the number of passing reviews; an uncited `blocker` or `major` triggers one rerun and then `needs-human`, while an uncited `minor` or `info` cannot block; a retraction without evidence does not resolve a finding.
- **Independence tests:** the authoring subagent id differs from every reviewer id; reviewers share no scratch; consolidation sees reports only.
- **Loop tests:** the revision cap enforces; a fixable defect reruns all Verify checks; hypothesis-invalidating evidence fails the attempt instead of looping.
- **Flaky and retry tests:** fail-then-pass records `flaky-pass` with both runs and returns `needs-human` for a required or triggered-conditional check; an errored check reruns once.
- **Demo end-to-end tests:** both saved Demo Runs replay their full check tables, gate fact tables, and evidence receipts from the journal and sealed artifacts alone.

## Acceptance checks

The design is ready to implement when tests show that:

1. the resolver returns the exact required, conditional, and not-applicable set for every matrix cell above, and no agent call changes it;
2. a candidate with one cited `blocker` finding fails Verify regardless of the number of passing reviews, a cited `major` finding blocks until fixed or retracted, and an uncited `blocker` or `major` finding makes its review rerun once and then returns `needs-human` if still uncited;
3. changing any file in the change set yields a new candidate hash and a full Verify rerun; a result bound to an old hash cannot enter the gate;
4. a stale target returns `needs-human`, a barred action returns `fail`, an unrehearsed Watch plan and an uncovered Recovery Point surface without approval return `needs-human`, and a missing required check returns the verdict the function names;
5. a model cannot retract another reviewer's finding, add a suppression for its own, or approve its own change;
6. a fail-then-pass records `flaky-pass` with both runs and returns `needs-human` for any required or triggered-conditional check;
7. two contradicting reviews trigger adjudication — a deterministic-check rerun when one exists, else a fresh independent review of the same role and claim — and a still-undecided result returns `needs-human` without any vote counting;
8. hypothesis-invalidating evidence fails the attempt as `hypothesis-invalidated` and never enters the revision loop;
9. the revision cap (default 2) is enforced and every revision reruns all Verify checks;
10. the Demo Profile's saved runs contain every minimum real check for their class with receipts and hashes, and replay in the Workspace from the journal alone;
11. the Demo Profile drops only the research, action, time, token, and cost caps; the Attempt Limit, gates, approvals, and safety controls apply unchanged.

## Hand-off to issue #11

Issue [#11](https://github.com/xddinside/sih26-proto/issues/11) derives the Pi skill, tool, and subagent catalog from this contract. This report deliberately names role contracts, not implementation skills. The derivation rules are:

- Each review role R1–R9 becomes one purpose-built specialist skill implementing the role's inputs, tools, scope, output schema, and severity rules fixed here; each test layer T1–T13 becomes a tool configuration bound to a pinned catalog entry.
- The applicability resolver's trigger predicates become skill-selection rules for the Orchestrator: the resolver decides which skills a Verify stage must run, and #11 decides how those skills are packaged, prompted, and tooled. The consolidation step needs no skill; it is Control Plane code.
- #11 may not change the matrix, the severity scale, the verdict function, the hash-binding rule, or the independence rules. Those are this report's fixed decisions; the skill catalog implements them.

## Primary evidence

- OWASP [Code Review Guide](https://owasp.org/www-project-code-review-guide/): manual security code review holds a place alongside improving scanners. Fetched 2026-08-15.
- OWASP [Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/): normalized, versioned security verification requirements referenced by identifier. Fetched 2026-08-15.
- OpenSSF [Scorecard](https://securityscorecards.dev/): machine-checkable supply-chain checks — code review required before merge, SAST, vulnerability scanning through OSV, pinned dependencies — with per-check risk levels. Fetched 2026-08-15.
- GitHub [supply chain security](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-supply-chain-security): dependency review surfaces added, removed, and updated dependencies per pull request; Dependabot alerts cross-reference the GitHub Advisory Database; artifact attestations establish build provenance. Fetched 2026-08-15.
- NIST [SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final): incident containment, eradication, and recovery phases; pre-approved containment actions reduce harm while evidence is preserved. Fetched 2026-08-15.
- Microsoft Azure DevOps [flaky test management](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/flaky-test-management): rerun-based detection — a test that fails then passes on rerun is flaky — and the choice between suppressing and troubleshooting. Fetched 2026-08-15.
- Playwright [retries](https://playwright.dev/docs/test-retries): retries categorize tests as passed, flaky, or failed, and worker-process isolation keeps a failing test from affecting healthy ones. Fetched 2026-08-15.
- Local Fusion Agent Harness at `/home/xdd/dev/sandbox/fusion`, inspected 2026-08-15 at commit `6e27998b6d11a76574e59cfdce8a1c9766b3fabc`: parallel participants, judge-before-synthesis, and "do not pick a winner" from `packages/coding-agent/src/core/fusion/prompts.ts` and `research-fusion.ts`, grounding the parallel reviews and the no-vote consolidation.
- Settled reports: [hypothesis-gate.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/hypothesis-gate.md) (broker-receipt-only Evidence Set, pre-registered predictions), [worker-isolation.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/worker-isolation.md) (Verify tools, broker-issued isolated test runs, no secrets in Workers), [release-recovery.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/release-recovery.md) (Release Gate facts, frozen Watch plans, tested Recovery Points, irreversible-effect boundary), [authority-action-risk.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/authority-action-risk.md) (Action Gate facts, risk classes, approval records, separation of duties), [orchestrator-stages.md](https://github.com/xddinside/sih26-proto/blob/main/docs/research/orchestrator-stages.md) (Verify stage contract, bounded Repair-to-Verify loop, full rerun on new candidate hash).
