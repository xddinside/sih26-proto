# Solution Contract, Demo Profile, and build handoff

Issue: [#13](https://github.com/xddinside/sih26-proto/issues/13) "Assemble the Solution Contract, Demo Profile, and build handoff". This document is the durable, implementation-ready handoff for that issue. It is handoff-only: it builds no code, scaffolds no frontend, and captures no Demo Run.

## 1. Purpose and boundary

This document combines the eleven settled research reports into one plan so the team can start building without another planning session. It records no new product decisions beyond the one fixed frontend choice below.

The settled reports are fixed input. Where a report is canonical for a field, schema, or behavior, this document links to it instead of restating it. The two saved Demo Runs from [demo-runs](research/demo-runs.md) are final; nothing here reopens or re-selects them.

**Fixed frontend decision (user-set, issue #13 comment):** the future Incident Workspace uses TanStack Start and shadcn/ui. The scaffold command is:

```text
bunx --bun shadcn@latest init --preset b236M0Vwv2 --template start --monorepo
```

Issue #13 does not run this command. The scaffold issue must not run it in this repo's root: a clean-room verification on 2026-08-16 with Bun 1.3.14 showed that it prompts for a project name, creates a child folder with a nested `.git`, and produces `apps/web`, `packages/ui`, `bun.lock`, and Turbo config. That issue must run the command in a clean temporary parent directory, then integrate the generated files into this repo without the nested `.git`, `node_modules`, or caches.

### Verified scaffold snapshot

Preset `b236M0Vwv2` resolves to the Sera style, the Mist theme, DM Sans for body text, Raleway for headings, Tabler icons, and Base UI parts.

Verification snapshot (2026-08-16, Bun 1.3.14): shadcn CLI 4.18.0, TanStack Start 1.168.46, TanStack Router 1.170.29, Vite 8.2.1, React 19.2.8, Tailwind 4.3.3, Turbo 2.10.10, TypeScript 6.0.3, Base UI 1.7.0, Tabler Icons 3.46.0. This is a snapshot, not an eternal pin. TanStack Start is a Release Candidate as of the check, so the scaffold build issue must pin the resolved versions and commit `bun.lock`.

Official docs: [shadcn TanStack Start](https://ui.shadcn.com/docs/installation/tanstack), [shadcn monorepo](https://ui.shadcn.com/docs/monorepo), [shadcn CLI](https://ui.shadcn.com/docs/cli), [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview).

## 2. Product and company integration

The product is an autonomous incident remediation system. It turns live operational evidence (traces, metrics, logs, security findings, deployment events) into signed Incident Triggers, diagnoses each Incident with Fusion Diagnosis inside a short-lived Worker, proposes reversible Remediations, verifies them under a fixed review and test contract, and puts every external action through deterministic gates and the company's own pipelines. Humans see and control everything in the Incident Workspace.

Company integration, one answer: the product ships as one company-hosted installation — a Helm chart plus the `sihctl` CLI — inside the company's own Kubernetes, per [company-integration](research/company-integration.md). Two Signal paths exist: the first-class product-owned OpenTelemetry path (product Collector gateway, Prometheus-compatible ruler, Alertmanager, Intake Normalizer) and the existing-OTel path (one OTLP exporter on the company's gateway, with a signed-webhook and query fallback where copying raw Signals is forbidden). Each attempt runs in one short-lived Worker — a Kubernetes Job with gVisor in production — with broad Incident-scoped reads and no company credentials or direct production access. Security findings and deployment events enter through signed webhooks; OpenTelemetry does not replace a SIEM. The company's pipeline, CI/CD, branch protections, deployment environments, and approval systems remain authoritative; the product consumes their records and never replaces them, per [release-recovery](research/release-recovery.md). The Incident Workspace is an evidence and control surface; it is not a replacement for Grafana, Jaeger, log viewers, CI, or approval tools.

## 3. System model and data flow

Fixed flow: **Signal intake** — services export OTLP to the Collector gateway; span metrics feed the Prometheus-compatible store and ruler; Alertmanager groups and retries delivery; the Intake Normalizer signs an `IncidentTrigger` v1; the Control Plane deduplicates by `delivery_key`, opens or updates the Incident by `incident_key`, and queues one serial Incident Run per attempt, per [incident-intake](research/incident-intake.md) and [orchestrator-stages](research/orchestrator-stages.md).

Each Run is one attempt in one Worker hosting one Pi Orchestrator and its subagents. Stages, in fixed order:

1. **Detect** — confirm the symptom from live evidence; seal the Incident Brief. Failure: one retry, then `failed: undiagnosable`.
2. **Diagnose** — Fusion Diagnosis: two or more independent participant subagents on one task, brief, and Evidence Set revision; one Judge compares without picking a winner; one Synthesizer returns ranked Hypotheses, gaps, and next actions. The deterministic eight-check Hypothesis gate in the Control Plane accepts one Hypothesis; the Control Plane then emits a separate Remediation disposition.
3. **Repair** — planner and implementer subagents turn the accepted Hypothesis into a Remediation Proposal v1 with citation map, Recovery Point draft, and declared surfaces; a PR-shaped record is created or updated. No merge or deploy.
4. **Verify** — the applicability resolver selects required, conditional, and not-applicable checks; each applicable review role R1–R9 and test layer T1–T13 runs in its own skilled subagent; the deterministic verdict function seals a Verification Report bound to the candidate hash.
5. **Release** — code merge and deploy pass the Release Gate; typed direct operations pass the Action Gate. The Orchestrator only submits; the Action Broker executes through adapters with a one-use permit.
6. **Watch** — the frozen Watch plan (fixed queries, limits, sample floors, missing-data rules) runs per rollout stage; promotion only on pass; severe regression takes the pre-approved rollback path. When all Watch gates pass, the Run ends `completed: verified-remediation` and the Incident moves to `resolved`; the confirmation window then passing with no recurrence or regression sentinel closes the Incident.

**Recovery:** a severe regression freezes promotion, verifies the target, runs the recorded Recovery Point rollback through the Action Broker, and pages a human on failure; the Incident stays open and the failed candidate can never be promoted again, per [release-recovery](research/release-recovery.md). Reaching the Attempt Limit writes the concise Incident Report (Hypotheses, actions, results) and closes the Incident with the settled `attempt-limit` closure reason, per [orchestrator-stages](research/orchestrator-stages.md).

**Ownership:** the Control Plane owns all durable state, stage transitions, the journal, leases, permits, the policy service, both execution gates, and the Hypothesis gate. The Pi Orchestrator owns proposals, the subagent graph, evidence gathering, and stage content. Skilled subagents produce role outputs; brokers own external reads and actions; deterministic tools, receipts, and gates own facts. The subagent graph is deliberately not frozen, per [orchestrator-stages](research/orchestrator-stages.md) and [pi-agent-catalog](research/pi-agent-catalog.md).

## 4. Authority, risk, budgets, boundaries, and audit

Settled in [authority-action-risk](research/authority-action-risk.md); the exact values:

- **Authority Modes** (capability ceiling, operator-only): Observe (diagnosis and report only), Prepare (ends at a merge-ready Remediation PR), Repair (merge and deploy of approved classes plus safe and guarded typed operations after the matching gate), Emergency (named pre-approved allow-list harm reduction only; no new code, no general shell).
- **Automation Policies** (when a human approves): review at all times; autonomous at all times; scheduled hybrid (IANA time zone plus weekly windows, evaluated at execution time, policy and tzdb versions recorded per verdict).
- **Action-risk classes**: `safe` (reversible, tested Recovery Point covers every changed surface, no approval beyond policy), `guarded` (always needs a recorded human approval in every policy and mode, and the Authority Mode may still deny it), `barred` (the product never executes; a human acts outside it). A company may tighten a class; it never loosens a default.
- **Attempt Limit**: 3 evidence-led diagnosis and Remediation attempts per Incident by default; Emergency actions and rollbacks do not consume attempts. Reaching the limit writes the concise Incident Report and closes the Incident `attempt-limit`.
- **Production budgets**: production config enforces caps. The only settled defaults are wall time 30 minutes per attempt, per-attempt token and cost caps at the Model Gateway, Fusion-round cap 3, revision cap 2, Worker restart cap 2, and approval expiry 30 minutes (configurable 5 minutes to 8 hours), all per [authority-action-risk](research/authority-action-risk.md). No other cap is assumed.
- **Demo Profile caps**: the Demo Profile removes only the Fusion-round, evidence-gathering-action, broker-action, wall-time, model-token, and model-cost caps. It keeps Attempt Limit 3, revision cap 2, Worker restart cap 2, both gates, approvals, leases, cancel, cleanup, and host safety limits (CPU, memory, process, filesystem, network).
- **Human boundaries**: irreversible, destructive, severe, or weakly recoverable changes always need a human under every mode and policy; the irreversible-effects list in [release-recovery](research/release-recovery.md) forces human review before release.
- **Rollback limits**: only pre-approved, reversible Recovery Point rollbacks run without a human; rollback restores service, not every effect; no roll-forward after a severe regression without full review.
- **Audit**: one append-only journal records proposals, policy verdicts (with window, zone, tzdb version), approvals, lease events, broker calls, Watch results, and human overrides, each with actor identity and credential scope. Secrets never enter the journal; external systems' own audit records remain source evidence. Separation of duties: the approver differs from the executing service account; the policy editor cannot be the sole approver of a `guarded` action.

## 5. The two saved Demo Runs

Exactly two saved, non-live runs exist, per [demo-runs](research/demo-runs.md). No agent, broker, or detector runs during the presentation. There is no saved rollback run and no live presentation execution.

- **Run 1 — verified code Remediation.** One seeded one-line defect in the Payment service card-type check (seed `S1` drops the negation in `src/payment/card.js`'s `validateCard`) makes every `charge` fail. The run ends in a merge-ready PR-shaped Remediation that restores the correct card-type check, passes every required review and test check, passes the Release Gate under scheduled hybrid policy with one recorded operator approval (the deploy lands outside the autonomous window), passes the two-step probe ring and the full Watch, resolves the Incident, and closes it after the confirmation window. Proof: recorded charge error ratio target ≥ 0.9 falling to < 0.05 across three consecutive Watch samples; 20/20 probe charges succeed in each stage-1 probe window across three consecutive windows; the flagd receipt shows `paymentFailure=off` throughout.
- **Run 2 — deterministic failed verification.** The same Incident from seed `S2` (the same card-type inversion plus a removed Luhn guard, silent by construction). The Orchestrator writes the correct one-line card-type fix of the accepted Hypothesis; R1 records a cited `major` reachability finding and the scoped T5 regression suite fails deterministically on the "Luhn-failing Visa is rejected" case, outside the candidate's diff. The run ends `failed: verification-failed` before Release; neither execution gate runs; nothing ships; the Incident stays open with 2 attempts remaining. Run 2 has no Release record and no production Watch Report.

Do not claim either run demonstrates automatic rollback. The Solution Contract rollback design in [release-recovery](research/release-recovery.md) stands unchanged; it is pitch-only scope for the demo, per [incident-workspace](research/incident-workspace.md).

## 6. Demo Profile scope versus Solution Contract scope

The Demo Profile runs the same state machines, gate code, journal schema, broker contracts, adapter interfaces, and stage order. It changes the operating layer and builds only what the two runs need. Pitch-only means: fixed by the Solution Contract, described in the Workspace as documentation, never executed or claimed as implemented by the demo.

| Surface | Solution Contract (pitch) | Demo Profile (built) |
|---|---|---|
| Deployment | Company-hosted Helm chart + `sihctl` | Docker Compose overlay on the pinned Astronomy Shop |
| Signal intake | Product Collector gateway, Prometheus ruler, Alertmanager, mTLS | Same stack from the Astronomy Shop Compose observability layer; HMAC-signed webhooks |
| Workers | Kubernetes Job with gVisor per attempt | One rootless Docker container per attempt |
| Source host | GitHub App / GitLab adapter | Local bare git repository; PR-shaped record |
| CI/CD | Company pipeline consumed through the release adapter | Local CI runner emitting CI-shaped receipts |
| Deployment adapter | Argo Rollouts canary or preview ring | Compose two-step probe ring: stage 1 candidate container with probe traffic, stage 2 service swap |
| Approvals | Company approval systems | Demo operator in the Workspace; identical record schema and expiry |
| Auth | Company IdP (OIDC), viewer/operator/approver roles | localhost, no IdP, recorded demo-operator identity |
| Notifications | On-call/chat adapters | Deferred; neither saved run needs a notification adapter |
| Panels | All classes, rollback records, Emergency allow-list, audit search, budget editor, live event stream, live controls | Panels 1–12, read-only policy, audit tail, telemetry deep links, plus static Solution Contract panels for rollback and the full review/test catalog |
| Skills | Full R1–R9 and T1–T13 catalog | The subset in section 10 |
| Budgets | Wall time, token, cost, round, revision caps | Only Fusion-round, evidence-action, broker-action, wall-time, token, and cost caps removed; Attempt Limit 3, revision cap 2, Worker restart cap 2, gates, approvals, leases, cancel, cleanup, host limits stay |

Sources: [demo-runs](research/demo-runs.md), [company-integration](research/company-integration.md), [incident-workspace](research/incident-workspace.md), [pi-agent-catalog](research/pi-agent-catalog.md).

## 7. First vertical build slice and later increments

**First slice: one seeded S1 Incident, end to end, captured and replayed.** Narrow: one service (Payment), one defect (card-type inversion), one attempt, one environment, Compose-only. Complete: real OTel Signals fire the pinned rule, the signed trigger reaches the Control Plane, the Run walks Detect → Diagnose (two participants, Judge, Synthesizer, eight-check gate, disposition) → Repair (one-line diff, PR-shaped record in the local repository) → Verify (full Code-row check set: R1, R2, R3, R4, R8 and T1, T2, T3, T4, scoped T5, T7, plus triggered T9, T10, T12, T13) → Release Gate with the scheduled-hybrid approval → two-step probe ring → Watch G1–G6 → resolved, then closed after the confirmation window. The whole journal and sealed artifacts export to the saved Demo Run store and replay in the Workspace.

Real proof, not stand-ins: OTel Signals, broker receipts, test results, git diffs, gate fact tables, and Watch rows, per [demo-runs](research/demo-runs.md). Contract-shaped local stand-ins are allowed behind the same interfaces for the source host (local bare git), CI/CD (local CI runner), approvals (local operator), and deployment (Compose release adapter), per [company-integration](research/company-integration.md). The demo defers notifications.

**Later increments:** Run 2 (seed `S2`, reuses everything from slice 1; adds the failed-verification path, the R1/T5 evidence, and the "no gate ran" rendering); Workspace completeness (all states, static Solution Contract panels as fixed documentation); saved export, replay verification, screenshot kit, and presentation rehearsal.

**Presentation rule:** the presentation is read-only over the saved journal plus sealed artifacts. It never queries a live backend, never runs a live Worker, and never drives the demo app's development server on stage. It must work offline from the exported static bundle.

## 8. Repo and service boundaries

Proposed layout (the owning build issue confirms final names; nothing here is scaffolded yet):

- `apps/web/` — TanStack Start + shadcn/ui frontend (scaffolded via the section 1 command in a clean temporary parent, integrated with pinned versions and `bun.lock`).
- `packages/ui/` — shared shadcn/ui components and theme produced by the fixed monorepo preset.
- `apps/control-plane/` — Control Plane service: Incident/Run state machine, journal, Incident Trigger endpoint, Policy Service, Hypothesis gate, Release Gate, Action Gate, Workspace read API and static saved-bundle adapter, local PostgreSQL and artifact store.
- `packages/contracts/` — shared JSON Schema and TypeScript types for triggers, journal events, stage artifacts, receipts, gates, and commands.
- `packages/brokers/` — Read Broker, Action Broker, and Model Gateway as local processes.
- `packages/pi-skills/core/` — Worker image, SIH extension, orchestrator, Fusion participant/Judge/Synthesizer, and repair skills.
- `packages/pi-skills/reviews/` — review role skills R1, R2, R3, R4, R8.
- `packages/pi-skills/tests/` — test layer skills T1, T2, T3, T4, scoped T5, T7, T9, T10, T12, T13.
- `demo/compose/` — Compose overlay: Prometheus config override with `rule_files` and the Alertmanager target, the mounted pinned rule file, Alertmanager, Intake Normalizer, local Control Plane endpoint.
- `demo/seeds/` — the Payment overlay (`card.js`, refactored `charge.js`, `card.unit.test.js`, `payment.regression.test.js`, Dockerfile targets), seed commits `S1` and `S2`, the seed manifest, and the pinned rule file.
- `demo/capture/` — capture and reset scripts, the probe script, the frozen Watch plan file, and the export scripts.
- `demo/saved-runs/` — the saved Demo Run store with the settled layout: `manifest.json`, `incidents/<id>/journal.jsonl`, `artifacts/sha256/<hash>.json`, per [incident-workspace](research/incident-workspace.md).
- `demo/ci/` — local CI runner and the local bare git repository.
- `demo/fixtures/contracts/` — contract, journal, hash, and gate fixtures.
- `demo/fixtures/runs/` — sample saved bundles and panel-state fixtures for frontend tests.

The Compose demo is pinned to Astronomy Shop commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` and uses a rootless Docker Worker per attempt, local PostgreSQL and artifact storage for capture, and an exported static bundle for replay. Do not scaffold the frontend, Control Plane, or any package in this repo now.

## 9. Public interfaces and ownership

Each interface is owned by the named service; where a report is canonical it owns the fields, and this handoff only links to it. Pinned demo routes: `/`, `/incidents/:id`, `/incidents/:id/artifacts/:hash`. Pinned demo read APIs: incident list, incident detail, and the authorized artifact envelope.

| Interface | Shape and owner | Canonical |
|---|---|---|
| Incident Trigger | `POST /v1/incident-triggers`, schema v1 with `incident_key`/`delivery_key`, scope, window, summary, evidence refs; Intake Normalizer produces, Control Plane accepts | [incident-intake](research/incident-intake.md) |
| Journal events | Append-only, ordered, idempotent transition records with the common stage envelope and actor, policy version, lease id | [orchestrator-stages](research/orchestrator-stages.md) |
| Sealed artifact envelope | Content-hashed, schema-versioned artifacts in object storage; artifact viewer endpoint `GET /api/incidents/:id/artifacts/:sha256` recomputes the hash | [incident-workspace](research/incident-workspace.md) |
| Read APIs (demo scope) | `GET /api/incidents` (list), `GET /api/incidents/:id?attempt=` (detail), `GET /api/incidents/:id/artifacts/:sha256` (authorized envelope) | [incident-workspace](research/incident-workspace.md) |
| Event stream and commands (deferred live scope) | `GET .../events?after=` (SSE) and `POST /api/incidents/:id/commands` (typed commands) are Solution Contract only; the demo does not build or exercise them | [incident-workspace](research/incident-workspace.md) |
| Broker requests and receipts | Read Broker queries return data, never credentials; Action Broker typed ops (`submit_remediation_pr`, `submit_typed_action`, `request_isolated_ci`, `request_rollback`, `request_browser_session`, `request_test_secret`); every call carries the run lease and records a receipt | [worker-isolation](research/worker-isolation.md), [pi-agent-catalog](research/pi-agent-catalog.md) |
| Worker startup contract | Run lease, journal checkpoint, sealed artifacts by hash, pinned read snapshot, Evidence Set revision, skills and tool catalog digests, budgets, Model Gateway configuration | [pi-agent-catalog](research/pi-agent-catalog.md) |
| Skill output schemas | JSON Schema per role: Fusion participant/Judge/Synthesizer outputs, Review Report v1, Test Report v1, Remediation Proposal v1, Verification Report v1 | [pi-agent-catalog](research/pi-agent-catalog.md), [review-verification](research/review-verification.md) |
| Candidate and content hashes | Candidate hash over the full change set; Evidence Set item ids from canonical content; every result binds to the candidate hash | [hypothesis-gate](research/hypothesis-gate.md), [review-verification](research/review-verification.md) |
| Release and action adapters | One adapter contract (declared reads, write classes, idempotency, credential needs) plus the per-system table; release lease and one-use release permit | [company-integration](research/company-integration.md), [release-recovery](research/release-recovery.md) |
| Saved export manifest | `manifest.json` with format version, capture time, Incident ids, final journal sequence, file hashes; replay verifies and orders by sequence | [incident-workspace](research/incident-workspace.md) |

## 10. Demo Profile Pi skill subset

The exact subset from [pi-agent-catalog](research/pi-agent-catalog.md), one skilled subagent per applicable role:

- **Core** (`packages/pi-skills/core/`): `sih-orchestrator`, `sih-fusion-participant` (exactly 2 in the Demo Profile), `sih-fusion-judge`, `sih-fusion-synthesizer`, `sih-repair-planner`, `sih-repair-implementer`, plus the local Read Broker, Action Broker, CI runner, and Model Gateway.
- **Review skills** (`packages/pi-skills/reviews/`): R1 `sih-review-correctness`, R2 `sih-review-causal-fit`, R3 `sih-review-code-quality`, R4 `sih-review-security`, R8 `sih-review-recovery-point`.
- **Test skills** (`packages/pi-skills/tests/`): T1 `sih-test-static-analysis`, T2 `sih-test-build`, T3 `sih-test-unit`, T4 `sih-test-contract`, scoped T5 `sih-test-regression`, T7 `sih-test-security-scan`, T9 `sih-test-isolated-env`, T10 `sih-test-browser`, T12 `sih-test-fault-recovery`, T13 `sih-test-watch-rehearsal`.
- **Not built for the demo:** R5, R6, R7, R9, T6, T8, T11, the notification adapter, the live event stream, live controls, the policy editor, audit search, a direct-action run, a rollback run, and real rollback execution. The Solution Contract keeps them.

Deterministic tools, broker receipts, the applicability resolver, and Control Plane gates own pass and fail; a model cannot forge a receipt, re-scope applicability, reinterpret a failure, or replace a gate.

Fusion rules, from the live harness at `/home/xdd/dev/sandbox/fusion` (inspected read-only; HEAD `6e27998`, dirty worktree — `packages/coding-agent/src/core/fusion/` is untracked in-flight work): participants run in parallel and receive the same Shared Starting Context; the Judge runs after all participants and must not pick a winner; the Synthesizer runs after the Judge and its response is the only durable conversation turn; Fusion Run Artifacts persist for inspection with `excludeFromContext: true`, so participant and Judge traces stay out of later model context. There is no open-web access during Diagnose: an allow-listed documentation proxy may supply context only, never evidence. The live Fusion harness aborts on any failed participant and returns free text; SIH changes it to require at least two valid, structured participant outputs. `spawn_subagent` is SIH extension work, not a Pi built-in.

## 11. Build order

Ordered for fast parallel delivery. Each issue's definition of done is its listed acceptance checks. Always use `portless` for any app development server in this repo.

1. **Contracts, schemas, hashes, journal, and fixtures** — owns `packages/contracts/`, `demo/fixtures/contracts/`. Blocked by: nothing. DoD: every section 9 schema validates; candidate and content hash helpers; journal event schema; fixture validation.
2. **Frontend scaffold and static replay adapter** — owns the root workspace files, `apps/web/` scaffold, `packages/ui/`, and `apps/web/src/lib/replay/`. Blocked by: 1. DoD: scaffold ran in a clean temporary parent and integrated without the nested `.git`, `node_modules`, or caches; every `latest` range replaced with an exact resolved version; `bun.lock` committed; README uses Bun; one ESLint config; the two generated `consistent-type-specifier-style` lint errors in `packages/ui/src/components/button.tsx` and `packages/ui/src/lib/utils.ts` fixed; Turbo build outputs configured for Vite `dist/**` instead of `.output/**`; `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, and `bun run build` all pass.
3. **Incident list, detail, artifact, and saved-truth frontend** — owns `apps/web/src/routes/` and `apps/web/src/features/incidents/`. Blocked by: 2. DoD: `/`, `/incidents/:id`, and `/incidents/:id/artifacts/:hash` render the list, detail, and authorized artifact envelope from the static bundle; saved/live labels, provenance strips, and receipt-backed numbers apply; saved controls are disabled and cannot submit.
4. **Saved bundles and panel states** — owns `apps/web/src/features/incident-workspace/` and `demo/fixtures/runs/`. Blocked by: 3. DoD: panels 1–12, read-only policy, audit tail, and telemetry deep links render; static Solution Contract panels for rollback and the full review/test catalog render and are clearly marked pitch-only; both panels state neither saved run demonstrates rollback.
5. **Astronomy overlay, seeds, rule, and reset** — owns `demo/compose/`, `demo/seeds/`. Blocked by: 1. DoD: pinned commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9`; overlay healthy; `card.js` preservation test matches upstream before any seed; rule pinned with `rule_version`; `S1`/`S2` apply and reset cleanly.
6. **Control Plane, stores, brokers, and local runner** — owns `apps/control-plane/`, `packages/brokers/`, `demo/ci/`. Blocked by: 1, 5. DoD: state machine, journal, trigger dedup, Policy Service, the three gates, local PostgreSQL and artifact storage, Read/Action Brokers, local CI runner, adapters; tests from [orchestrator-stages](research/orchestrator-stages.md) and [worker-isolation](research/worker-isolation.md).
7. **Pi Worker, Fusion, repair, reviews, and tests** — owns `packages/pi-skills/core/`, `packages/pi-skills/reviews/`, `packages/pi-skills/tests/`. Blocked by: 6. DoD: allow-list, isolation, round-validity, trace-exclusion, receipt-binding, and deterministic consolidation tests from [pi-agent-catalog](research/pi-agent-catalog.md) and [review-verification](research/review-verification.md).
8. **Release Gate, probe ring, Watch, capture, and export** — owns `demo/capture/`, `demo/saved-runs/`. Blocked by: 4, 6, 7. DoD: Run 1 and Run 2 captured end to end; export manifest written; both runs replay from journal and sealed artifacts alone.
9. **Replay, a11y, responsive, screenshots, and rehearsal** — owns `demo/replay/`, `apps/web/e2e/`, and `docs/presentation/`. Blocked by: 4, 8. DoD: strict replay checks (hash mismatch, missing sequence, unknown schema, stale data, redaction, missing artifact); keyboard, 200% zoom, reduced motion, 1280 px, and 390 px checks; 12 screenshots; two timed rehearsals; offline presentation.

## 12. Test strategy

- **Contracts and state machine:** schema validation for every trigger, journal event, and stage artifact; legal-transition-only and idempotent-replay tests, per [orchestrator-stages](research/orchestrator-stages.md).
- **Broker and receipts:** forged stage, expired lease, replayed permit, changed candidate hash, and missing approval all fail at the broker; a worker-derived claim never enters the Evidence Set, per [worker-isolation](research/worker-isolation.md) and [hypothesis-gate](research/hypothesis-gate.md).
- **Worker isolation and allow-lists:** read-only and test skills see no write, shell, production, or credential tools; the authoring subagent id never equals a reviewer id; subagents cannot reach production, source control, or the internet directly.
- **Fusion and Hypothesis gate:** round validity with fewer than two well-formed outputs reruns; one failed participant with two valid outputs does not abort; traces persist for inspection and stay excluded from model context; table-driven gate fixtures return the exact outcome for every check combination; pre-registered predictions are enforced by timestamp.
- **Review and test matrix:** the resolver returns the exact check set for every matrix cell. Consolidation uses fixed deterministic rules: severity takes the maximum, contradictions go to `needs-human`, and there is no majority vote. One cited `blocker` fails a candidate; a `flaky-pass` on a required or triggered-conditional check yields `needs-human`; hash binding invalidates stale results; the verdict function's `pass`/`fail`/`needs-human` table tests run, per [review-verification](research/review-verification.md).
- **End-to-end capture:** both runs replay in the Workspace from journal and sealed artifacts alone, marked as saved, with no live Worker, broker, detector, or backend activity; numeric values come only from Watch rows and receipts.
- **Saved-replay integrity:** strict manifest, journal-sequence, schema, redaction, staleness, content-hash, and missing-artifact checks; explicit replay errors for hash mismatch, missing sequence, unknown schema, stale data, redaction, and missing artifact. Every number comes from a saved row or receipt; every review and test result binds to the candidate hash; the Pi JSONL session and model transcripts are supporting data, never evidence or replay state. Saved-run commands are rejected.
- **Frontend:** keyboard-only use, 200% zoom, `prefers-reduced-motion`, severity never by color alone, and the responsive checks at the 1280 px presentation target and a 390 px viewport, per [incident-workspace](research/incident-workspace.md).
- **Presentation rehearsal:** two timed 2–3 minute run-throughs of the script with the screenshot kit as fallback, offline from the exported bundle.

## 13. Presentation script (2–3 minutes) and evidence kit

Script from [demo-runs](research/demo-runs.md) and the click path in [incident-workspace](research/incident-workspace.md). Every click lands on a saved panel; nothing runs live.

1. **Opening (10 s).** Incident list with both saved-run badges. One line: evidence-led incident response with deterministic gates; everything shown is saved evidence, nothing runs live.
2. **Run 1 (75 s).** Trigger and intake (rule fired above 0.20, recorded ratio ≥ 0.9, pinned rule version); Evidence Set (trace-log join, flagd receipt `paymentFailure=0`, `S1` diff receipt); four Hypotheses and the eight-check gate table eliminating flag, provider, and checkout causes; Fusion round records; the one-line Remediation with citation map and validated Recovery Point; Verify table (R1–R4, R8; T1–T5, T7, T9, T10, T12, T13 receipts); Release Gate facts with the scheduled-hybrid approval record (policy and tzdb versions); Watch: probe ring 20/20 per window, service swap, G1–G6 pass, error ratio ≥ 0.9 → < 0.05 across three samples; resolved, then closed after the confirmation window.
3. **Run 2 (75 s).** Same Incident, same four Hypotheses, same gate table; the correct one-line fix; R1's cited `major` reachability finding; the T5 receipt failing "Luhn-failing Visa is rejected" bound to the candidate hash; Verification Report verdict `fail`; no Release Gate, no Action Gate, no probe ring, no production Watch; nothing shipped; Incident open with 2 attempts remaining.
4. **Close (20 s).** Policy panel: two dials and one risk table. Rollback panel: automatic rollback stays in the Solution Contract, unchanged; neither saved run demonstrates it. Three gates — Hypothesis, Release, Action — and a scoped regression suite as the last net.

**Evidence kit (12 screenshots, from [incident-workspace](research/incident-workspace.md)):** (1) incident list with both saved badges; (2) Run 1 header, trigger, intake snapshot; (3) Run 1 Evidence Set joins and receipts; (4) Run 1 gate table with alternatives eliminated; (5) Run 1 one-line diff, citation map, PR record, Recovery Point validation; (6) Run 1 Verify table and pass; (7) Run 1 Release Gate facts with the hybrid approval; (8) Run 1 Watch rows with the numeric before/after; (9) Run 2 R1 finding and T5 failure receipt; (10) Run 2 verdict `fail`, Incident open, 2 attempts left; (11) policy panel with recorded dial values and Demo cap defaults; (12) rollback panel stating the unchanged contract and that neither run demonstrates it.

## 14. Honest claims, risks, open work, deferred items

**Honest claims the saved runs support:** real OTel Signals drive real Incidents; deterministic gates and receipts, not model confidence, decide acceptance, verification, and release; a real one-line code fix ships through review, tests, hybrid approval, a probe ring, and Watch; the verification net catches a second seeded defect before any deployment; every decision replays from the journal and sealed artifacts.

**Claims the team must not make:** that the agent workflow ran live during the presentation; that a rollback Demo Run exists or that the demo implements the pitch-only panels (rollback records, Emergency allow-list, full R/T matrix, budget editor, audit search, live controls, live event stream); that a percentage-based production canary was used (the demo is a two-step probe ring); that rollback reverses every external effect (rollback is never perfect); that the company installation, adapters, or `sihctl` are built.

**Build-time risks and fallbacks:** the rule does not fire (check ruler freshness, raise `loadGeneratorVUs` to 25 — the traffic floor is the gate, per [demo-runs](research/demo-runs.md)); span-metrics labels differ from the pinned rule (run the pre-capture validation query and pin the rule against observed names — a setup step, not an open risk); the `card.js` overlay seam (must pass the behavior-preservation smoke test before any seed); capture time (~2.5 h Run 1, ~2 h Run 2) and model variance (T5 keeps Run 2 deterministic regardless of R1 wording); a judge expecting a rollback demo (known scope limit — point at the unchanged contract).

**Open work:** the entire Demo Profile stack is unbuilt; capture has not started; the rule is not yet pinned; the Workspace is not scaffolded.

**Deferred production items** (Solution Contract, not demo; not implemented now): the Helm chart and `sihctl`; GitHub App/GitLab, CI, and approval adapters; the OpenTelemetry Operator and auto-instrumentation; cert-manager and mTLS; multi-region gateways; workload-identity federation; production backups; gVisor Jobs and namespace tenancy; Model Gateway budget enforcement; the live event stream and typed commands; the remaining skills (R5–R7, R9, T6, T8, T11); notification adapters; tenancy, billing, retention, compliance, and regional data rules beyond the hackathon contract, per the map [#1](https://github.com/xddinside/sih26-proto/issues/1).

## 15. Follow-on implementation issues

Nine implementation issues turn this handoff into build work. Their blockers serialize the few steps that extend generated frontend files; tasks that may run at the same time own separate paths.

1. **Contracts, schemas, hashes, journal, and fixture validation.** Owns `packages/contracts/`, `demo/fixtures/contracts/`. Inputs: section 9 canonical reports. Outputs: all schemas and types, hash helpers, journal event schema, fixtures. Blocked by: nothing. Accepts: schema tests pass; fixtures validate.
2. **Scaffold the frontend and the static replay adapter.** Owns the root workspace files, `apps/web/` scaffold, `packages/ui/`, and `apps/web/src/lib/replay/`. Inputs: section 1 command and cleanup list. Outputs: integrated scaffold with no nested `.git`, `node_modules`, or caches; pinned versions; `bun.lock`; one ESLint config; fixed `button.tsx` and `utils.ts` lint errors; Turbo `dist/**` outputs. Blocked by: 1. Accepts: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, and `bun run build` pass; replay adapter serves the settled bundle layout with manifest, sequence, and hash verification.
3. **Incident list, detail, artifact, and saved-truth frontend.** Owns `apps/web/src/routes/` and `apps/web/src/features/incidents/`. Inputs: contracts (1), replay adapter (2). Outputs: `/`, `/incidents/:id`, and `/incidents/:id/artifacts/:hash` with saved/live labels, provenance strips, receipt-bound numbers, and disabled saved controls. Blocked by: 2. Accepts: saved controls cannot submit; every rendered number has a receipt or saved row.
4. **Saved bundles and panel states.** Owns `apps/web/src/features/incident-workspace/` and `demo/fixtures/runs/`. Inputs: incident-workspace panel hierarchy. Outputs: panels 1–12, read-only policy, audit tail, telemetry deep links, static Solution Contract panels for rollback and the full review/test catalog. Blocked by: 3. Accepts: pitch-only panels clearly marked; both panels state neither saved run demonstrates rollback; all states render.
5. **Astronomy overlay, seeds, rule, and reset.** Owns `demo/compose/`, `demo/seeds/`. Inputs: pinned commit, overlay files, seeds. Outputs: healthy Compose overlay, pinned rule file, `S1`/`S2` seeds, capture and reset scripts. Blocked by: 1. Accepts: `card.js` preservation test matches upstream before any seed; rule fires with pinned `rule_version`; seeds apply and reset cleanly.
6. **Control Plane, stores, brokers, and local runner.** Owns `apps/control-plane/`, `packages/brokers/`, `demo/ci/`. Inputs: contracts (1), overlay (5). Outputs: state machine, journal, trigger dedup, gates, local PostgreSQL and artifact storage, Read/Action Brokers, local CI runner, adapters. Blocked by: 1, 5. Accepts: tests from [orchestrator-stages](research/orchestrator-stages.md) and [worker-isolation](research/worker-isolation.md).
7. **Pi Worker, Fusion, repair, reviews, and tests.** Owns `packages/pi-skills/core/`, `packages/pi-skills/reviews/`, `packages/pi-skills/tests/`. Inputs: section 10 subset, brokers (6). Outputs: Worker image, extension, all demo skills. Blocked by: 6. Accepts: allow-list, isolation, round-validity, trace-exclusion, receipt-binding, and deterministic consolidation tests from [pi-agent-catalog](research/pi-agent-catalog.md) and [review-verification](research/review-verification.md).
8. **Release Gate, probe ring, Watch, capture, and export.** Owns `demo/capture/`, `demo/saved-runs/`. Inputs: panels (4), Control Plane (6), skills (7). Outputs: Run 1 and Run 2 captures, export manifest. Blocked by: 4, 6, 7. Accepts: Run 1 ends `verified-remediation` and `resolved`, then closed after the confirmation window; Run 2 ends `verification-failed` with no Release record and no production Watch Report; both replay from journal and sealed artifacts alone.
9. **Replay, a11y, responsive, screenshots, and rehearsal.** Owns `demo/replay/`, `apps/web/e2e/`, and `docs/presentation/`. Inputs: captures (8), panels (4). Outputs: replay verification output, 12 screenshots, and the rehearsed script. Blocked by: 4, 8. Accepts: explicit replay errors for hash mismatch, missing sequence, unknown schema, stale data, redaction, and missing artifact; keyboard, 200% zoom, reduced motion, 1280 px, and 390 px checks; two timed rehearsals; offline presentation.

## 16. Acceptance checks for this handoff

1. A new agent can start each build issue in section 15 without asking a product question: the issue body plus its linked reports answer scope, contracts, and boundaries.
2. Every claim in this document links to a settled report, the official frontend docs in section 1, or the verification snapshot; no claim rests on this document alone except the fixed frontend choice.
3. The frontend stack is fixed: TanStack Start and shadcn/ui, the exact init command, the clean-temporary-parent rule, and the pin-after-scaffold rule.
4. Demo Profile scope and Solution Contract scope never blur: every pitch-only surface is labeled pitch-only, and no deferred item is written as implemented.
5. The two Demo Runs are stated exactly as settled: no rollback run, no live presentation execution, Run 2 blocked before Release by R1 plus scoped T5.
6. Both saved runs replay with no live Worker, broker, detector, or backend activity; Run 2 never has a Release record or a production Watch Report.
7. Replay enforces manifest, journal-sequence, schema, redaction, staleness, content-hash, and missing-artifact checks; every gate row cites structured evidence; saved controls cannot submit.
8. The `card.js` preservation test matches upstream before any seed; keyboard, 200% zoom, reduced motion, 1280 px, and 390 px checks pass; the presentation works offline.
