# Incident Workspace: replay surface for saved Demo Runs and the Solution Contract

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#12](https://github.com/xddinside/sih26-proto/issues/12), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Blocked by (all closed): [#2](https://github.com/xddinside/sih26-proto/issues/2), [#3](https://github.com/xddinside/sih26-proto/issues/3), [#4](https://github.com/xddinside/sih26-proto/issues/4), [#5](https://github.com/xddinside/sih26-proto/issues/5), [#6](https://github.com/xddinside/sih26-proto/issues/6), [#7](https://github.com/xddinside/sih26-proto/issues/7), [#8](https://github.com/xddinside/sih26-proto/issues/8), [#9](https://github.com/xddinside/sih26-proto/issues/9), [#10](https://github.com/xddinside/sih26-proto/issues/10), [#11](https://github.com/xddinside/sih26-proto/issues/11)

Prerequisite reports: [incident-intake.md](incident-intake.md), [worker-isolation.md](worker-isolation.md), [release-recovery.md](release-recovery.md), [orchestrator-stages.md](orchestrator-stages.md), [hypothesis-gate.md](hypothesis-gate.md), [authority-action-risk.md](authority-action-risk.md), [review-verification.md](review-verification.md), [company-integration.md](company-integration.md), [demo-runs.md](demo-runs.md), [pi-agent-catalog.md](pi-agent-catalog.md)

Researched: 2026-08-15

## Decision

The Incident Workspace is the Control Plane's web surface for human oversight. Its evidence views render the append-only journal and sealed artifacts; live controls submit typed commands back to the Control Plane, which validates, authorizes, and journals them before state changes. Saved Demo Runs are always read-only and are the sole presentation data. The Workspace never treats a model transcript as evidence. It is not a monitoring dashboard: raw Signals stay in the company's telemetry backends, and every Evidence Set item links out to Prometheus, Jaeger, Grafana/OpenSearch, Git, and CI while the saved snapshot stays the durable copy. The demo build renders the panels the two saved runs exercise, plus pitch-only documentation panels for Solution Contract surfaces no saved run demonstrates: rollback records, the Emergency allow-list, the full nine-role/thirteen-layer catalog, and production budgets. Saved runs replay with truthful saved/live labels and no live agent, broker, or detector, per [demo-runs.md](demo-runs.md).

The Solution Contract rollback design in [release-recovery.md](release-recovery.md) is unchanged by this report. The Workspace renders the rollback panel because the product must explain it, not because a saved run demonstrates it.

## What the Workspace is and is not

It is the human view and control surface for an Incident, its Evidence Set, Incident Runs, policy decisions, Remediation, gates, Watch results, and Recovery Point, per [CONTEXT.md](../../CONTEXT.md). It does not replace a monitoring dashboard, log viewer, CI console, or company approval system, and it is not a live demo driver. It links to those systems and consumes their records, per [incident-intake.md](incident-intake.md) and [company-integration.md](company-integration.md).

Pitch design versus demo build:

| Surface | Solution Contract (pitch) | Demo build |
|---|---|---|
| Auth | Company IdP (OIDC), internal network only, roles viewer/operator/approver | localhost or local network, no IdP, recorded demo-operator identity |
| Live controls | Dials, approvals, pause, cancel, budget edits take effect immediately | Read-only rendering of recorded policy versions; approve/deny/pause/cancel disabled for saved runs |
| Panels | All Remediation classes, rollback records, Emergency allow-list, audit search, adapter views | The panels the two runs exercise plus pitch-only documentation panels |

## Information architecture

One SPA, served by the Control Plane (localhost in the demo). Routes:

- `/` — Incident list.
- `/incidents/:id` — Incident detail with sticky section navigation and an attempt selector.
- `/incidents/:id/artifacts/:hash` — authorized, redacted artifact viewer with a schema-version and integrity banner; it never exposes unfiltered object-store bytes.

Incident list rows: state (`open`/`resolved`/`closed`), severity, scope (service, environment), detector key, first trigger time, last activity, attempts used/limit, latest run outcome, saved/live badge, related-Incident links. Saved rows carry the standing banner: "Saved Demo Run — captured `<timestamp>`; replaying journal and sealed artifacts; no live agent, broker, or detector activity."

Incident detail section order, the canonical panel hierarchy:

| # | Panel | Renders | Source | Build scope |
|---|---|---|---|---|
| 1 | Header | Incident key, state, severity, scope, `detector_state`, Attempt Limit, attempts used, saved badge, closure reason | Journal | Build |
| 2 | Attempts and stages | Serial attempts; per attempt the fixed stage chips Detect → Diagnose → Repair → Verify → Release → Watch with status `entered`/`in-progress`/`completed`/`failed`/`skipped`; run state, outcome, restart count, lease events; `skipped` carries its recorded reason | Journal, [orchestrator-stages.md](orchestrator-stages.md) | Build |
| 3 | Trigger and intake | IncidentTrigger v1 fields: schema version, `trigger_id`, `delivery_key`, `incident_key`, detector `rule_id` and pinned `rule_version`, state, severity, scope, window, `signal_summary` value and threshold; intake snapshot; delivery history with dedup no-ops; resolved trigger and confirmation window; HMAC note in the demo | Journal, [incident-intake.md](incident-intake.md) | Build |
| 4 | Evidence Set and receipts | Items grouped by revision; per item: id, kind, backend, identity, query with absolute window, redacted snapshot, `content_hash`, links (expired marked), `observed_at`, `fresh_until`, provenance chain, trust class (`backend`/`test-result`/`human`), joins, redaction profile and masked fields, outcome (`ok`/`unresolved`/`expired`/`quarantined`), `supersedes`/`contradicts` | Journal, [hypothesis-gate.md](hypothesis-gate.md) | Build |
| 5 | Hypotheses and eight-check gate | Ranked Hypotheses with status chips (`proposed`/`testing`/`accepted`/`rejected`/`superseded`/`confirmed`); causal graph with edges clickable to cited item ids; the eight-check gate table: check, result, exact items counted, reason — counts and booleans only; discriminating tests with pre-registered predictions and broker receipts; alternatives with the item that eliminated each; root-cause rule (only Remediation plus Watch confirms) | Sealed artifacts, [hypothesis-gate.md](hypothesis-gate.md) | Build |
| 6 | Fusion rounds | Per round: every participant's structured output (exactly two in the Demo Profile; count remains dynamic in the Solution Contract); Judge output (`agreements`, `contradictions`, `blind_spots`, `unique_findings`, `citation_audit`); Synthesizer output (`ranked_hypotheses`, `gaps`, `next_actions`, `fusion_meta`); round validity. Participant and Judge traces sit behind an explicit disclosure view marked "excluded from later model context — inspection only"; only the Synthesized Response is durable stage input | Sealed artifacts, [pi-agent-catalog.md](pi-agent-catalog.md) | Build |
| 7 | Remediation | Remediation Proposal v1: change description, diff or typed action plan, change-to-Hypothesis citation map, test plan, Recovery Point draft, blast radius, deterministic action-risk class (`safe`/`guarded`/`barred`), Remediation disposition (`allowed`/`approval-required`/`prohibited`/`observe-only`), gate path (Release or Action); PR-shaped record (branch `remediate/incident-<id>`, patch, diff hash, review notes) for code; candidate hash | Sealed artifacts, [orchestrator-stages.md](orchestrator-stages.md) | Build |
| 8 | Verify | Applicability resolution table: required/conditional/not-applicable buckets with each conditional's recorded trigger evaluation, resolver and policy versions; R1–R9 Review Reports: per-role status, findings with severity (`blocker`/`major`/`minor`/`info`), file-line citations, status `open`/`retracted`/`fixed-in-revision`, reviewer subagent id, retractions shown as supersessions; T1–T13 Test Reports: layer, pinned tool and database versions, target, receipt ref, runs with hashes, outcome (`pass`/`fail`/`flaky-pass`/`error`/`not-run`); Verification Report with candidate hash, hash-binding match, verdict and reason; flaky, retry, timeout, and stale markers | Sealed artifacts, [review-verification.md](review-verification.md) | Build |
| 9 | Release or Action Gate | The eight Release Gate facts, or the operational Action Gate facts, each with evidence refs and result; verdict `pass`/`fail`/`needs-human`; permit consumption; release record (artifact digest, approvals, rollout and Watch plans, adapter ids, stage history). A run that never reached a gate renders "not reached — run ended `verification-failed`", never an empty gate | Journal, [release-recovery.md](release-recovery.md), [authority-action-risk.md](authority-action-risk.md) | Build |
| 10 | Approvals | One immutable record per decision: action digest, approver identity, approval system, policy version, tzdb version, class, expiry countdown, scope; one-use consumption. Pending approve/deny controls exist only for live runs; saved runs render recorded decisions read-only | Journal, [authority-action-risk.md](authority-action-risk.md) | Build |
| 11 | Watch | Frozen plan file (G1–G6 queries, limits, sample floors, missing-data rules, and the recorded unfired severe-regression stop rule); per stage-1 and stage-2 window: query, baseline and candidate cohort, time range, sample count, value, limit, outcome; numeric before/after from saved Watch rows; confirmation window; resolved trigger; extended-Watch note | Sealed artifacts, [demo-runs.md](demo-runs.md), [release-recovery.md](release-recovery.md) | Build |
| 12 | Recovery Point | Recorded fields (prior Compose project file hash, image digest, `service.version`, environment and flag files, service definition, exact restore command with preconditions and timeout, retention window), validation result and timestamp, T12 drill receipts; it names every changed surface | Sealed artifacts, [release-recovery.md](release-recovery.md) | Build |
| 13 | Rollback records | Solution Contract path, rendered as fixed documentation: severe regression freezes promotion, stores triggering Signals, verifies the target, runs the pre-approved rollback through the Action Broker, watches recovery gates, pages a human on failure; the Emergency allow-list; rollback honesty limits. The panel states plainly that neither saved run contains a rollback and that the design in [release-recovery.md](release-recovery.md) stands unchanged | Static contract content | Pitch-only |
| 14 | Policies and limits | Authority Mode dial (Observe/Prepare/Repair/Emergency), Automation Policy dial (review always/autonomous always/scheduled hybrid, IANA windows, emergency override switch), policy and tzdb versions in force; Attempt Limit; the risk table with class per category and the barred list; production budget fields; Demo Profile defaults. Saved runs render recorded versions read-only; edits are operator-only and live-only | Journal, [authority-action-risk.md](authority-action-risk.md) | Build (read-only) |
| 15 | Audit trail | Append-only journal tail: actor, service account, Worker, policy version, credential scope, redacted payloads, idempotency keys, provider ids, human overrides in a distinct section | Journal | Build (tail only; search is pitch-only) |
| 16 | Telemetry deep links | Per item: backend link templates (Prometheus graph query, Jaeger trace, Grafana/OpenSearch log view, Git blob/commit, CI run, flagd receipt); saved snapshot always present; a link is marked expired when backend retention passed; the presentation never depends on a live backend | Journal, [hypothesis-gate.md](hypothesis-gate.md) | Build |

## Saved versus live truth rules

- **Saved or live, always labeled.** A saved run carries the standing "Saved Demo Run" badge with capture timestamp and store path. A live Incident carries a "live" badge with `detector_state` and last intake time. Nothing renders unlabeled.
- **Saved replay is read-only.** Approve, deny, pause, cancel, dial edits, and budget edits are disabled for saved runs; the saved run renders the recorded policy versions and approval records instead.
- **Provenance on every artifact.** Each artifact shows its content hash, schema version, skill version, tool catalog version, resolver version, policy version, tzdb version where relevant, and `sealed_at`. Each Evidence Set item shows its provenance chain (collector → gateway → backend → broker receipt id) and trust class. Worker-derived restatements never render as items.
- **Hashes bind results.** Review and test rows show the candidate hash they ran against; the Verification Report shows the hash-binding match. A stale result is marked, never treated as current.
- **Citations, not prose.** Gate tables and findings render cited item ids, file-line references, and receipt refs. An uncited claim renders marked `uncited` and cannot support a check.
- **Receipts own numbers.** Every rendered number has a receipt or saved row behind it. A number without a receipt is a rendering bug, not evidence.
- **Timestamps are real.** Capture times are real; windows are absolute; recorded intake delay and skew are shown, never smoothed.
- **Versions are pinned and shown.** Rule version, image digests, tool and database versions, policy and tzdb versions appear exactly as recorded.
- **Redaction is visible.** Masked fields render as masks with the redaction profile id; a required item redacted beyond policy shows `needs-human` at its gate row, per [hypothesis-gate.md](hypothesis-gate.md).
- **Stale and missing data are marked, never hidden.** Expired freshness, expired links, unresolved items, and malformed artifacts render as labeled gaps. No data is never a pass.
- **Prose is never evidence.** Free-text fields (finding wording, brief text) render as labeled prose. Any value shown in a gate row, verdict, or comparison must come from a structured field or a receipt, never from narrative.

## Presentation click paths (2–3 minutes)

Order from [demo-runs.md](demo-runs.md): opening 10 s, Run 1 75 s, Run 2 75 s, close 20 s. Every click lands on a saved panel; nothing runs live.

**Opening (10 s).** Land on `/`. The list shows both saved runs with badges and capture timestamps. One line: "Evidence-led incident response with deterministic gates; everything shown is saved evidence, nothing runs live."

**Run 1 — verified code Remediation (75 s).**

| s | Click | Shows |
|---|---|---|
| 0 | Open Run 1 | Header: Incident `resolved → closed`, outcome `verified-remediation`, detector resolved, Saved badge, attempt 1/3 |
| 8 | Trigger and intake | Rule `AstronomyShopPaymentErrorRate`, recorded ratio ≥ 0.9 above the 0.20 threshold, traffic floor, pinned `rule_version`, intake links |
| 16 | Evidence Set | Exemplar trace with `card_valid=true` joined to the pino error log; flagd receipt `paymentFailure=0`; `S1` deployment event and diff receipt |
| 26 | Hypotheses and gate | H1–H4 ranked; H1's eight-check gate table all pass; H2 (flag), H3 (provider), H4 (checkout) eliminated item by item |
| 37 | Fusion | Round 1: two participants, Judge, Synthesizer with ranked Hypotheses and next actions |
| 42 | Remediation | One-line diff restoring the negation in `card.js`; citation map; class `safe`; disposition `allowed`; PR-shaped record; Recovery Point validated |
| 50 | Verify | Code-row applicability table; R1–R4, R8 pass with sealed findings; T1–T5, T7, T9, T10, T12, T13 receipts; Verification Report `pass` with hash binding |
| 61 | Release Gate, then Approvals | Eight facts pass; fact 4 highlights scheduled hybrid — the deploy lands outside the autonomous window and queues; one approval record with policy and tzdb versions |
| 68 | Watch | Stage 1 probe ring 20/20 across three windows; stage 2 swap; G1–G6 pass; error ratio ≥ 0.9 → < 0.05 across three samples; confirmation window; closed |
| 74 | Policy | Repair Mode, scheduled hybrid, Attempt Limit 3 |

**Run 2 — deterministic failed verification (75 s).**

| s | Click | Shows |
|---|---|---|
| 0 | Open Run 2 | Header: Incident `open`, run `failed: verification-failed`, attempt consumed, 2 remaining, Saved badge |
| 8 | Trigger, then Hypotheses | Same rule, same four Hypotheses, identical eight-check gate table — the Incident is the same |
| 20 | Remediation | The same correct one-line card-type fix; the citation map covers only the accepted card-type causal chain and contains no unsupported Luhn change |
| 28 | Verify | T3 passes the card-type cases; R1 finding: `major`, "restoring the card-type check makes the adjacent missing Luhn guard reachable", cited file and line; T5 receipt: `fail` on "Luhn-failing Visa is rejected", bound to the candidate hash |
| 46 | Verification Report | Verdict `fail`; hash binding intact; the failed evidence joins the Evidence Set |
| 54 | Attempts and stages | Verify failed; no Release Gate, no Action Gate, no probe ring, no production Watch Report; T13 rehearsal receipt remains part of Verify; nothing shipped |
| 64 | Policy | Autonomous at all times (moot — the run ends at Verify); Attempt Limit shows 2 remaining |

**Close (20 s).** Policy panel: two dials and one risk table. Rollback panel: automatic rollback stays in the Solution Contract, unchanged. Three gates — Hypothesis, Release, Action — and a scoped regression suite as the last net.

## Auth and roles

**Full product (company-hosted, private network).** Login through the company IdP (OIDC); the company's ingress, network policy, and IdP control who reaches the Workspace, and no public exposure exists in the default chart, per [company-integration.md](company-integration.md). Three roles:

- **Viewer** — read-only access to Incidents, Evidence Sets, runs, and reports.
- **Operator** — policy dials, Attempt Limit, budgets, adapter declarations, pause, resume, cancel, and rollback requests.
- **Approver** — approval decisions. Separation of duties from [authority-action-risk.md](authority-action-risk.md): an approver cannot be the policy editor for the same decision, the approver identity must differ from the executing service account, and the operator who edits a policy cannot be the sole approver of a `guarded` action generated by that policy.

The browser holds no broker or company-system credential. The Control Plane uses secure same-site sessions, requires a CSRF token and expected Incident version on commands, authorizes every command again at the server, and journals both accepted and denied requests. Company Git, CI, deployment-environment, and approval rules remain authoritative; the Workspace consumes their records instead of overriding them.

**Demo.** localhost or local network only. No IdP; one demo-operator identity is recorded in the journal, and Workspace approvals use the identical record schema and expiry. Triggers stay HMAC-signed, per [incident-intake.md](incident-intake.md).

## Policy controls

Settled names and meanings, rendered in the Policies and limits panel:

- **Authority Mode** — the capability ceiling, operator-only, one of Observe, Prepare, Repair, Emergency. Takes effect from the next action decision; Emergency is immediate.
- **Automation Policy** — when a human must approve: review at all times, autonomous at all times, or scheduled hybrid (IANA zone, weekly windows, emergency override switch). Evaluated at execution time; a window crossing queues approval; the verdict records the policy version and tzdb version.
- **Attempt Limit** — the user-set maximum of evidence-led diagnosis and Remediation attempts per Incident (default 3); reaching it writes the Incident Report and closes the Incident `attempt-limit`.
- **Action-risk classes** — `safe`: reversible, tested Recovery Point covers every changed surface, no approval beyond the active policy. `guarded`: weakly recoverable or broad blast radius; it always needs a recorded human approval, and the Authority Mode may still deny it. `barred`: the product never executes it; a human acts outside the product and the handoff is recorded.
- **Approval windows and expiry** — hybrid windows decide when approval is needed; approval records expire (default 30 minutes, configurable 5 minutes to 8 hours) and are consumed once.
- **Pause** — stops new broker actions and new approval grants immediately; in-flight actions reconcile; Watch keeps reading. **Cancel** — revokes the run lease, release permits, and outstanding approvals, then tears down the Worker.
- **Operator rollback access** — an operator requests rollback through the Action Broker as a pre-approved typed action (or Emergency allow-list entry); it passes the Action Gate and the Recovery Point names the identities allowed to run it. It is a recorded action, never a shell.
- **Production caps, configurable and enforced** — wall time 30 minutes per attempt, token and cost caps per attempt at the Model Gateway, Fusion-round cap 3, evidence-action cap, broker-action cap, revision cap 2, Worker restart cap 2.
- **Demo Profile defaults** — no Fusion-round, evidence-action, broker-action, wall-time, token, or model-cost caps, so a saved run finishes on evidence, not a budget. The Demo Profile still keeps the Attempt Limit, both gates, approvals, leases, host limits (CPU, memory, process, filesystem, network), operator cancel, cleanup, and every safety control, per [authority-action-risk.md](authority-action-risk.md) and [pi-agent-catalog.md](pi-agent-catalog.md). The panel shows every limit field, capped or not, so the presentation can point at the controls.

## States

| State | Rendering |
|---|---|
| Loading | Skeleton plus replay progress ("replaying journal entry N/M"); no partial gate rows while loading |
| Empty | Empty-state text for `/` (no Incidents) and for empty sub-panels ("no Watch Report — the run ended at Verify") |
| Failed | Run banner with `failure_reason`; failed evidence visible in the Evidence Set; Incident open and attempts remaining shown; Incident Report panel when the Attempt Limit closed it |
| Needs-human | `awaiting-human` banner naming the gate and the missing fact; pending approval or decision with the resume rule ("resume continues from the gate, never around it") |
| Redacted | Masked fields with profile id; a gate check that needed redacted evidence shows `needs-human`, never a pass |
| Stale | Expired `fresh_until` marks on items; expired link marks; stale-target banner with the expected-version mismatch |
| Interrupted | Run banner with restart count and reconciliation status; resume or `unstable-worker` outcome from the journal |
| Rollback | A live full-product Incident renders its recorded rollback sequence. The demo pitch-only panel explains the contract and both saved runs show "no rollback records" truthfully |
| Partial-artifact | Missing artifact renders its hash, schema version, and a gap mark; malformed artifact opens the authorized, redacted viewer with a warning; nothing is fabricated or hidden |

## Smallest data contract and replay source

The same projection layer reads PostgreSQL journal rows and content-addressed artifacts in the full product, or a static saved bundle in the demo. It exposes:

- `GET /api/incidents?cursor=&state=&saved=` — the list projection: Incident id and key, state, severity, scope, detector state, first trigger and last activity times, attempts used and limit, latest run outcome, saved/live marker, capture time, and related ids;
- `GET /api/incidents/:id?attempt=` — the detail projection: Incident fields, ordered Run and stage states, ordered journal events, and artifact references needed by panels. Each event carries a monotonic `sequence`, event type, recorded time, actor, policy version, redaction profile, and content-hash refs;
- `GET /api/incidents/:id/artifacts/:sha256` — an Incident-scoped, authorized envelope containing `content_hash`, artifact type, schema and schema version, `sealed_at`, producer skill and tool versions, redaction metadata, provenance, and the redacted structured payload. The server recomputes the hash and returns an integrity error on mismatch;
- `GET /api/incidents/:id/events?after=` — a live-only server-sent event stream of new journal sequence numbers and artifact refs. Reconnect resumes from `after`; polling the detail endpoint is the fallback. Saved replay never opens this stream;
- `POST /api/incidents/:id/commands` — live-only typed commands such as approve, deny, pause, resume, cancel, policy update, and rollback request. Each request carries an idempotency key and expected Incident version. IdP role checks, separation of duties, current policy, and gate checks run server-side; success means the command was accepted and journaled, not that an external action completed. Saved ids reject every command.

The presentation bundle uses the same envelopes: `manifest.json`, `incidents/<id>/journal.jsonl`, and `artifacts/sha256/<hash>.json`. The manifest records the export format version, capture time, Incident ids, expected final journal sequence, and hashes of every file. Replay verifies the manifest and artifact hashes, orders events by journal sequence rather than wall-clock time, and renders an explicit gap on a missing sequence, unknown schema, or hash mismatch. It never repairs or invents data. This lets one static file server replace the live read APIs on presentation day without changing panel code.

Replay source is the journal plus sealed artifacts only. The Pi JSONL session is retained as supporting evidence and is never a stage or gate source, per [worker-isolation.md](worker-isolation.md).

Model and tool use renders from redacted journal model-use records — parent-child ids, prompts, models, token use, tool calls, and results — as an agent-activity view available only to authorized roles. Fusion participant and Judge traces persist for inspection but render only behind an explicit disclosure view labeled "excluded from later model context", mirroring the live Fusion `excludeFromContext` mechanism in `run-artifacts.ts`; only the Synthesized Response is durable stage input, per [pi-agent-catalog.md](pi-agent-catalog.md). Resume assembles context from sealed artifacts and the journal checkpoint; rendered Workspace HTML and disclosure views are never context sources.

## Accessibility and responsive behavior

Semantic headings and scoped tables; dials, approvals, pause, and cancel are keyboard-operable buttons and selects; visible focus; `aria-live` for state changes; severity never conveyed by color alone; `prefers-reduced-motion` disables timeline animation. Desktop uses a sticky section rail and wide evidence tables at the 1280 px presentation target. Under roughly 900 px the rail becomes a section picker, panels stack, and wide tables gain a labeled horizontal scroll region plus a compact summary before the table. The demo acceptance pass covers keyboard-only use, 200% zoom, reduced motion, the 1280 px presentation view, and a 390 px incident-reading view; the full product keeps the same behavior for live controls.

## Minimum build slice for issue #13

**Build.** (1) The three snapshot read endpoints (list, detail, artifact) behind a static-bundle adapter; the live event stream and command endpoint are not needed for replay. (2) Incident list and detail shell with section navigation. (3) Panels 1–12, 14 (read-only), 15 (tail), and 16 as specified above — the exact panels the two runs exercise. (4) Saved/live badges, provenance strips, receipt links with expired marking. (5) The loading, empty, failed, needs-human, redacted, stale, interrupted, and partial-artifact states. (6) The authorized, redacted artifact viewer with manifest, sequence, and hash validation.

**Pitch-only behavior and panels.** The live event stream and typed command endpoint; rollback records; the Emergency allow-list; the full nine-role/thirteen-layer matrix; the production budget editor; the schedule editor beyond display; audit search; and multi-Incident live views. Their contracts are fixed here, but the demo does not pretend they execute.

**Presentation screenshots to prepare (saved evidence kit).**

1. Incident list with both Saved Demo Run badges.
2. Run 1 header, trigger, and intake snapshot with deep links.
3. Run 1 Evidence Set: trace-log join, flagd receipt, `S1` diff receipt.
4. Run 1 Hypotheses and the eight-check gate table, alternatives eliminated item by item.
5. Run 1 Remediation: one-line diff, citation map, PR record, Recovery Point validation.
6. Run 1 Verify: applicability table, R1–R4 and R8 reports, T1–T5/T7/T9/T10/T12/T13 receipts, Verification Report pass.
7. Run 1 Release Gate facts with the hybrid-window approval record (policy and tzdb versions, expiry).
8. Run 1 Watch: stage-1 probe ring, stage-2 swap, G1–G6 rows, error ratio ≥ 0.9 → < 0.05 across three samples.
9. Run 2 Verify: R1's cited `major` finding and T5's failing receipt with candidate hash.
10. Run 2 Verification Report verdict `fail` and the open Incident with 2 attempts remaining.
11. Policy panel: recorded dial values, Attempt Limit, and the Demo Profile cap defaults.
12. Rollback panel stating the unchanged Solution Contract rollback path.

**Acceptance checks.**

1. Both runs replay end to end from the journal and sealed artifacts alone, marked Saved Demo Runs, with no live agent, broker, or detector activity, per [demo-runs.md](demo-runs.md).
2. Every gate table renders only counts, booleans, timestamps, and cited item ids; no prose appears in a gate row as evidence.
3. Every numeric value (error ratios, probe counts, T3/T5 results) comes from a saved Watch row or receipt; none comes from narrative.
4. Run 1 shows the scheduled-hybrid approval with its policy and tzdb versions, the eight Release Gate facts, G1–G6, and `resolved → closed` after the confirmation window.
5. Run 2 shows R1's cited reachability finding and the T5 failure receipt bound to the candidate hash, verdict `fail`, the execution-gate panel marked "not reached" with no fact table or permit, Incident `open`, 2 attempts remaining.
6. Receipt links resolve to saved snapshots; expired or missing links are marked, never silently dropped.
7. Redacted items show masks and profile ids; a gate needing redacted evidence shows `needs-human`.
8. Loading, empty, failed, needs-human, stale, interrupted, and partial-artifact states each render correctly.
9. Saved-run controls (approve, deny, pause, cancel, dial edits) are disabled; live-only controls exist only in the Solution Contract description.
10. The Demo Profile cap defaults render exactly: no Fusion-round, evidence-action, broker-action, wall-time, token, or model-cost caps; Attempt Limit, both gates, approvals, leases, host limits, cancel, and cleanup remain.
11. The rollback panel states the unchanged [release-recovery.md](release-recovery.md) design and does not weaken it.
12. Fusion traces render only behind the excluded-from-context disclosure view; only the Synthesized Response appears in the stage flow.
13. The auth and roles section matches [company-integration.md](company-integration.md) (viewer, operator, approver, separation of duties); the demo runs localhost or local network only.
14. Keyboard navigation, 200% zoom, and `prefers-reduced-motion` pass manually; the Incident path remains usable at both the 1280 px presentation target and a 390 px viewport.

**Rejected alternatives.**

- **A monitoring dashboard replacing Grafana, Jaeger, or OpenSearch.** Rejected: the Workspace links to the company's backends and keeps snapshots; it never replaces them, per [incident-intake.md](incident-intake.md) and [hypothesis-gate.md](hypothesis-gate.md).
- **Rendering the Pi JSONL transcripts as the primary view.** Rejected: journal plus sealed artifacts are the only render source, per [worker-isolation.md](worker-isolation.md).
- **Live dials and approval buttons active during saved replay.** Rejected: saved runs replay recorded policy versions; live controls on saved data would mislead the judges and invent live automation, which [demo-runs.md](demo-runs.md) forbids.
- **A separate backend service for the Workspace.** Rejected: the Control Plane already owns the thin projection, stream, and command endpoints; presentation day uses a static adapter over the same envelopes.
- **Re-querying telemetry backends during the presentation.** Rejected: the presentation must not depend on live backends; the saved snapshot is the durable copy and links are navigation aids.
- **Showing Fusion participant and Judge traces in the stage flow.** Rejected: traces persist for inspection behind the exclusion label; only the Synthesized Response continues, per [pi-agent-catalog.md](pi-agent-catalog.md).
- **A live rollback reenactment.** Rejected: no honest post-release-only regression exists for the selected defect, per [demo-runs.md](demo-runs.md); the Solution Contract rollback text stands unchanged.
- **Heavy charting libraries.** Rejected: tables and small inline bars suffice for a 3-minute replay; charts add build risk with no evidential gain.
- **Full policy editing and audit search in the demo build.** Rejected: pitch-only panels; the demo needs recorded versions rendered read-only.

## Hand-off to issue #13

The Workspace consumes the render anchors fixed by [pi-agent-catalog.md](pi-agent-catalog.md): the stable skill and role names, journal model-use records, Fusion round records with the trace-exclusion rule, Review Reports with findings and citations, Test Reports with receipt references and tool/database versions, gate fact tables, and the saved-run replay requirements. Issue #13 owns the saved Demo Run store layout ([demo-runs.md](demo-runs.md) proposed it), the Compose overlay, Control Plane, brokers, Worker runner, and the build slice above, including the two capture scripts and the replay verification output.

## Blockers and open items

- **The Demo Profile stack is not built.** The Workspace replay cannot start until #13 delivers the Compose overlay, Control Plane, brokers, and Worker runner; capture itself cannot start, per [demo-runs.md](demo-runs.md).
- **`card.js` behavior-preservation smoke test.** The overlay seam is not safe to seed on top of until the T3 smoke test proves the refactored `charge.js` accepts and rejects the same fixtures as upstream, per [demo-runs.md](demo-runs.md).
- **Rule pinning.** The pre-capture label-validation query and pinned rule file must exist before any trigger carries a `rule_version`, per [demo-runs.md](demo-runs.md).
- **Presentation machine must serve the saved bundle.** Screenshot kit and replay run from the saved journal and artifacts alone; a missing artifact store on the day breaks the truth rule, so the static export is the fallback.
- **No live automation on presentation day.** The Workspace deliberately provides none; any request for a live run on stage is a scope change to the map [#1](https://github.com/xddinside/sih26-proto/issues/1), not a build gap.

## Primary evidence

The ten settled reports cited inline above, the language in [CONTEXT.md](../../CONTEXT.md), the live Fusion harness trace-exclusion mechanism cited in [pi-agent-catalog.md](pi-agent-catalog.md), and the presentation order fixed in [demo-runs.md](demo-runs.md).
