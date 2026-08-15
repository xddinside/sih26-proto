# Demo Runs: seeded Incidents and proof measures

Status: decision for the Astronomy Shop Demo Profile; the Solution Contract stays separate throughout

Issue: [#9](https://github.com/xddinside/sih26-proto/issues/9), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Blocked by (all closed): [#2](https://github.com/xddinside/sih26-proto/issues/2), [#6](https://github.com/xddinside/sih26-proto/issues/6), [#8](https://github.com/xddinside/sih26-proto/issues/8)

Prerequisite reports: [incident-intake.md](incident-intake.md), [worker-isolation.md](worker-isolation.md), [release-recovery.md](release-recovery.md), [orchestrator-stages.md](orchestrator-stages.md), [hypothesis-gate.md](hypothesis-gate.md), [authority-action-risk.md](authority-action-risk.md), [review-verification.md](review-verification.md), [company-integration.md](company-integration.md)

Researched: 2026-08-15

## Decision

Save exactly two Demo Runs, both on the pinned Astronomy Shop commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` and the Compose-only Demo Profile:

1. **Run 1 — verified code Remediation.** One seeded one-line code defect in the Payment service's card-type validation makes every `charge` fail. The run ends in a merge-ready, PR-shaped Remediation that restores the correct card-type check, passes all review and test checks, passes the Release Gate, passes the two-step probe ring and the full Watch, and resolves the Incident.
2. **Run 2 — deterministic failed verification.** The same Incident, from a seed commit that carries a second, silent defect: the card-type inversion plus a removed Luhn guard. The Orchestrator's candidate correctly fixes only the accepted card-type Hypothesis. Verify runs the required checks; the pre-seeded regression suite fails deterministically on the untouched Luhn guard, outside the candidate's diff. The attempt ends `verification-failed`; no Remediation ships and the Incident stays open.

Run 1's Remediation is a real code change. The seeded root cause is code, not a feature flag; the `paymentFailure` flag stays off in both runs. A flag cannot masquerade as the cause.

No rollback appears in either run. The Solution Contract's automatic rollback on severe regression stands unchanged in [release-recovery.md](release-recovery.md); this report only re-selects the Demo Runs, and no credible post-release-only regression exists for a one-line card-type restoration that Verify and T13 could not observe. Run 2 is therefore a deterministic failed-verification path, not a rollback.

Both runs are saved and non-live: the presentation replays the journal and sealed artifacts in the Incident Workspace. No agent, broker, or detector runs during the presentation.

## Solution Contract boundary

This report decides the two saved Demo Runs only. It does not change the Solution Contract. Where a Demo Profile stand-in replaces a Solution Contract system, the stand-in keeps the same interface and record shape, per [company-integration.md](company-integration.md):

| Surface | Solution Contract | Demo Profile (this report) |
|---|---|---|
| Source host | GitHub App on the company repo; `pull_requests: write` for the Remediation PR | Local bare git repository; the source-host adapter stand-in creates a PR-shaped record (branch, patch, diff, review notes) |
| CI/CD | Company pipeline consumed through the release adapter; the product never re-runs it | Local CI runner that runs build and test commands in an isolated container and emits CI-shaped receipts |
| Deployment | Argo Rollouts canary or preview ring; release lease on the target | Compose release adapter: stage 1 candidate container on the internal network with probe traffic; stage 2 live Compose service swap; one release lease per target |
| Approvals | Company approval system (GitHub reviews, environments) | The demo operator approves in the Incident Workspace; identical approval-record schema, scope, and expiry |
| Worker | Kubernetes Job with gVisor | One rootless Docker container per attempt |
| Triggers | mTLS | HMAC-signed webhooks |

Everything else — stage contracts, the Evidence Set, the eight-check Hypothesis gate, the applicability resolver, the Release and Action Gates, the Recovery Point, the Watch plan, the journal, the Attempt Limit — runs as settled, unchanged.

## Common facts for both runs

**Pinned sources.** Upstream `open-telemetry/opentelemetry-demo` at commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9`, inspected 2026-08-15. The Payment service is Node.js:

- `src/payment/charge.js` — the `charge` handler. Line 40 reads the `paymentFailure` number flag through OpenFeature/flagd; line 61 runs `cardValidator`; line 68 sets `demo.payment.card_valid`; line 72 guards the Luhn check; line 76 gates card type; lines 80–81 gate expiry.
- `src/payment/index.js` — gRPC server, `grpc-js-health-check` reporting `SERVING`.
- `src/payment/Dockerfile` — distroless Node image, `npm ci --omit=dev`.
- `src/checkout/main.go` lines 565–581 — `chargeCard`; line 567 checks the `paymentUnreachable` flag; lines 353–356 wrap a failed charge as `codes.Internal`.
- `src/load-generator/script.js` — k6, weighted task loop; checkout is 2 of 29 task weight; its `LOAD_GENERATOR_VUS || '10'` is only the script's own fallback when the env var is unset (the Compose wrapper overrides it with the flagd `loadGeneratorVUs` value; see Traffic below).
- `src/load-generator/people.json` — nine test people. All nine cards are Visa and all expire in 2039.
- `src/flagd/demo.flagd.json` — `paymentFailure` default `off`; `loadGeneratorTraffic` default `on`; `loadGeneratorVUs` default `5`.
- `src/otel-collector/otelcol-config.yml` — default `span_metrics` connector; sanitized span names.
- `src/prometheus/prometheus-config.yaml` — OTLP endpoint; promotes `service.name`, `service.version`, `deployment.environment.name`.
- `compose.yaml` lines 454–495 — the `payment` service and its TCP healthcheck.

**Demo overlay (operator-authored, part of the Compose overlay, applied to the pinned commit before any seed).** To give the defect surface a pure, mock-free test seam and a deterministic regression suite, the overlay extracts the validation block of `charge.js` (Luhn guard at line 72, card-type gate at line 76, expiry gate at lines 80–81) into one dependency-light module:

- `src/payment/card.js` — `validateCard(number, expirationYear, expirationMonth, currentYear, currentMonth)` returns a rejection reason string or `null`. It depends only on `simple-card-validator` (a pure library; no OTel SDK, no flagd, no network).
- `src/payment/charge.js` — refactored to call `validateCard` and throw its reason, preserving upstream behavior exactly.
- `src/payment/card.unit.test.js` — the T3 `node --test` unit suite for the accepted card-type Hypothesis: valid Visa and MasterCard accepted; Amex rejected for card type; an expired card rejected.
- `src/payment/payment.regression.test.js` — the scoped T5 suite selected by the Payment ownership map. Its invalid-card case uses `4111111111111112`, which `simple-card-validator@1.1.0` classifies as Visa with invalid Luhn, and asserts only that it is rejected, not which guard rejects it. That case passes on either seeded image because the inverted card-type clause rejects the card; after the Run-2 candidate restores the card-type clause, it exposes the missing Luhn guard and the case fails.
- `src/payment/Dockerfile` — adds `card.js` to the distroless production target and a Node `test-runtime` target containing `card.js` plus both test files. T3 and T5 run separately against that target, while T2 builds the production target.

This extraction is behavior-preserving and is the demo's own seam, not an upstream change. The seeds below introduce defects into `card.js`. T3 tests the accepted card-type Hypothesis; the distinct scoped T5 suite checks the wider Payment behavior and exposes Run 2's masked defect.

**Seeded defects.** Both runs seed one commit in the local demo repository against the overlay's `card.js`:

- **`S1` (Run 1):** the card-type clause drops its negation — `if (['visa', 'mastercard'].includes(cardType)) return "cannot process"`. Every valid Visa or MasterCard charge now fails; the error rate on `charge` rises toward 1.0 (capture target; the saved metric rows record the actual value). The Luhn and expiry clauses are untouched.
- **`S2` (Run 2):** the same card-type inversion **and** the Luhn guard removed — the `if (!valid) return 'Credit card info is invalid.';` clause is deleted. The card-type inversion drives the Incident; the removed Luhn guard is silent (invalid cards are accepted, so no error Signal exposes it).

These are real code defects seeded by the operator, never a flag.

**Traffic.** The built-in k6 load generator, HTTP scenario only (browser scenario off), weighted tasks. Concurrency comes from the flagd `loadGeneratorVUs` flag, not the script's own fallback: `src/load-generator/entrypoint.sh` polls the flag over OFREP every 10 seconds and passes its value to k6 as `LOAD_GENERATOR_VUS`, restarting k6 on change. The flag's default variant is `5`; the `script.js` `|| '10'` applies only when the env var is absent, which the wrapper never leaves unset, so the effective default is 5 virtual users, not 10. Checkout and multi-item checkout together are 2 of 29 task weight, so a charge fires only every few seconds. If the recorded charge rate falls under the rule's traffic floor, raise `loadGeneratorVUs` to `25` before capture; the floor, not the VU count, is the gate.

**Incident Detector.** The overlay rule from [incident-intake.md](incident-intake.md), unchanged:

```yaml
groups:
  - name: sih-demo
    interval: 15s
    rules:
      - alert: AstronomyShopPaymentErrorRate
        expr: |
          sum(rate(traces_span_metrics_calls_total{
            service_name="payment",status_code="STATUS_CODE_ERROR"
          }[2m]))
          /
          clamp_min(sum(rate(traces_span_metrics_calls_total{
            service_name="payment"
          }[2m])), 0.001) > 0.20
          and
          sum(rate(traces_span_metrics_calls_total{
            service_name="payment"
          }[2m])) > 0.05
        for: 2m
        labels:
          detector_key: payment-error-rate
          service_name: payment
          deployment_environment_name: demo
          severity: critical
        annotations:
          summary: Payment failures exceed 20 percent
```

Grouping and delivery: Alertmanager groups on `tenant_id`, `deployment_environment_name`, `service_name`, `detector_key`; 15-second initial wait, 30-second group interval, 30-minute repeat interval. Never group on instance, pod, span, trace, or status.

Missing-data rule: the ruler freshness detector marks a stale detector; a missed evaluation is never silent health. A zero ratio under verified coverage is valid; a query that returns no data is not a pass, per [hypothesis-gate.md](hypothesis-gate.md). The traffic guard (`> 0.05` calls per second) prevents a ratio over a quiet window.

**Authority Mode and policy.** Repair Mode for both runs. Run 1 runs under scheduled hybrid policy; its merge and deploy land outside the autonomous window and queue for the operator's recorded approval, which also satisfies the [authority-action-risk.md](authority-action-risk.md) Demo Profile requirement of one saved hybrid-policy approval. Run 2 runs under autonomous-at-all-times policy; it ends at Verify before any production action, so no approval or release gate is reached.

**Attempt Limit.** 3 per Incident, unchanged.

## Demo Run 1 — verified code Remediation

### Service and file

Payment service. The overlay extracts the upstream validation block into `src/payment/card.js`'s pure `validateCard`; the seeded defect `S1` drops the negation in that function's card-type clause, and the Remediation restores it. Upstream reference for the correct logic: [charge.js:76](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/charge.js#L76) (card-type gate) and [charge.js:72](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/charge.js#L72) (Luhn guard). The overlay carries separate T3 unit and T5 regression suites.

### Seeded defect and reset

The `S1` commit above. Reset: the capture script checks out the pristine pinned commit, applies the overlay (including `card.js`, `card.unit.test.js`, and `payment.regression.test.js`), and applies `S1` to the local repository, then rebuilds the payment image with the seeded source. No feature flag is touched; `paymentFailure` stays `off` and the recorded flagd receipt proves it.

### Traffic

As in common facts. During the Incident every checkout charge fails, so the checkout service also returns `codes.Internal` to the storefront; checkout's own error rate rises. That rise becomes a regression sentinel in the Watch plan: it must return to baseline after the swap.

### Detector

As in common facts. Expected firing: about 2 minutes of sustained ratio above 0.20 after the seeded image becomes live, plus the 2-minute `for` period.

### Expected Signals and receipts

Capture targets; the saved receipts supply the recorded values.

- Metric: `traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}` ratio target ≥ 0.9; total rate target ≥ 0.05/s (above the rule's traffic floor); `traces_span_metrics_duration_bucket{service_name="payment"}` histograms present; `demo.payment.transactions` counter flat during the Incident.
- Trace: the exemplar `trace_id` joins a checkout span with a child `charge` span in status ERROR; attributes `demo.payment.card_type=visa`, `demo.payment.card_valid=true`; the error is raised in-process with no outbound span between validation and throw.
- Log: pino line `Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted.` carrying `trace_id` and `span_id` via `pino-opentelemetry-transport`; checkout slog line `failed to charge card`.
- Deployment event: commit `S1` applied at time `T_seed`, `service.version` changed to the seeded digest.
- Receipts: flagd OFREP evaluation `paymentFailure=0`; Read Broker metric snapshot; trace and log query receipts; a grep receipt showing the error string occurs only in `card.js`'s card-type clause; the git diff receipt for `S1`; the unit-test, build, review, gate, probe, and Watch receipts listed below.

### Competing Hypotheses and the discriminating test

- **H1:** a code regression in the card-type check, seeded in commit `S1`. Explains the error text, the `card_valid=true` spans failing, and the symptom start matching `T_seed`.
- **H2:** the official `paymentFailure` flag is on. The flag's failure path throws `Invalid token` and tags `demo.user_context.loyalty_level=gold`; the observed spans carry neither, and the flagd receipt reads `0`. H2 cannot explain the evidence.
- **H3:** an upstream payment-provider or card-network outage. `charge.js` makes no outbound call between validation and the throw; the trace shows the throw inside the Payment service with no provider span. H3 cannot explain it.
- **H4:** checkout sends malformed card data, or the `paymentUnreachable` flag routes checkout to a bad address. The spans show valid card attributes, the flagd receipt for `paymentUnreachable` reads `false`, and the pre-seed window with identical traffic had a near-zero error rate (recorded baseline). H4 cannot explain it.

Discriminating test, pre-registered before it runs: the overlay `card.unit.test.js` suite (`node --test`, pure — `validateCard` depends only on `simple-card-validator`, no OpenFeature, flagd, or OTel SDK, so no mocking). Predictions registered first: on the seeded code the "valid Visa accepted" case fails because the card-type clause is inverted; on the corrected code the card-type cases pass. The separate T5 regression suite checks the wider Payment behavior.

### Eight-check Hypothesis gate proof for H1

| Check | Result | Evidence |
|---|---|---|
| 1. Cited coverage | Pass | Every critical item in the trigger window is an ERROR `charge` span or the detector breach; each propagation edge cites items: error span to the card-type clause via the grep receipt; commit `S1` to symptom start via the deployment event |
| 2. Causal edge support | Pass | Trace-metric join (exemplar `trace_id`), trace-log join (`trace_id`/`span_id`), signal-code join (error string unique to `card.js`'s card-type clause), code-deploy join (commit `S1` diff receipt plus `service.version`) |
| 3. Contradiction handling | Pass | No fresh item of equal or higher trust contradicts a supporting item |
| 4. Alternative elimination | Pass | H2 eliminated by the flagd receipt and missing gold-loyalty attributes; H3 eliminated by the in-process throw with no provider span; H4 eliminated by `paymentUnreachable=false` and the pre-seed counterfactual |
| 5. Reproducible test / counterfactual | Pass | Pre-registered `card.unit.test.js` predictions matched the observed seeded behavior (broker receipt); plus the natural counterfactual: pre-seed 30-minute window, same traffic, near-zero error rate (recorded) |
| 6. Scope match | Pass | H1 covers `payment` in `demo`; no uncited breadth |
| 7. Freshness | Pass | All supporting items collected inside the policy window; the deployment-state item matches the current expected version |
| 8. Telemetry coverage | Pass | The near-zero baseline ratio item carries a coverage record: healthy backend, query covered the payment scope and window |

### Remediation and Recovery Point

Remediation Proposal v1, class Code, action-risk class `safe`, disposition `allowed`, gate path Release. Change set: restore the negation in `card.js`'s `validateCard` card-type clause.

```diff
-  if (['visa', 'mastercard'].includes(cardType)) {
+  if (!['visa', 'mastercard'].includes(cardType)) {
```

The overlay's `card.unit.test.js` is red against the seed (`S1` inverts the clause, so "valid Visa accepted" fails) and green after the fix. The separate `payment.regression.test.js` remains green because Run 1 keeps the Luhn guard. The candidate adds no test file; both suites are pre-seeded. The PR-shaped record lives in the local bare repository: branch `remediate/incident-<id>`, patch, diff hash, and review notes.

Recovery Point, recorded and validated before the first mutation: prior compose project file hash; prior payment image digest (the seeded digest); prior `service.version`; prior environment and flag files; the Compose service definition; the exact restore command (`docker compose up -d payment` against the restored project file) with preconditions and timeout; retention through the demo's rollback window. The Recovery Point names every changed surface; the change set itself is one code line in `card.js`, and the deployment adapter's swap is the typed action covered by the same record.

### Review and test checks

Applicability resolver output for this candidate (Code row of [review-verification.md](review-verification.md)):

| Bucket | Checks |
|---|---|
| Required | R1, R2, R3, R4, R8; T1, T2, T3, T4, T5 (scoped), T7 |
| Triggered conditional | T9 (candidate target always exists in the Demo Profile), T10 (the charge path is the storefront checkout path), T12 (the Recovery Point names a restore action), T13 (the candidate carries a Watch plan and a rehearsable environment) |
| Not applicable, recorded | R5 (no dependency-manifest change; the overlay's `card.js` uses only the existing `simple-card-validator` dependency), R6 (no data surface), R7 (no manifest or policy path in the change set; the Compose swap is the release adapter's typed action), R9 (no logging, metrics, or alerting config touched; Watch queries unchanged), T6 (no property or fuzz harness for Node in the demo tool catalog), T8 (no migration), T11 (charge is not declared a performance-sensitive path in the demo service catalog) |

Each applicable R role and each applicable T layer runs in exactly one skilled subagent with its matching skill; the authoring Repair subagent never reviews. Test subagents plan and request pinned tool runs, while deterministic receipts and the Control Plane own pass/fail. T1 lints, T2 builds the patched image, T3 runs `node --test src/payment/card.unit.test.js`, T4 checks the valid-charge contract, T5 runs `node --test src/payment/payment.regression.test.js`, T7 runs pinned dependency, vulnerability, and secret scanners, T9 deploys the candidate with probe traffic, T10 runs a browser-style checkout, T12 drills the restore in the isolated environment, and T13 rehearses the frozen Watch queries against the candidate. Every result binds to the candidate hash and carries a broker receipt.

### Release Gate facts

| Fact | Demo evidence |
|---|---|
| 1. Remediation and artifact match the reviewed commit | Candidate image digest built from the reviewed commit hash of the local repository; hash-binding match in the Verification Report |
| 2. CI, security, code, regression, and E2E checks passed | Local CI runner receipts for build, test, scan, and browser-check steps, consumed as CI-shaped records |
| 3. Target still runs the expected version | Read Broker deployment-state item: live payment digest equals the seeded digest named in the release request |
| 4. Action fits Mode and Policy | Repair Mode; scheduled hybrid policy: the deploy lands outside the autonomous window, so the gate waits for the operator's recorded approval |
| 5. Rollout and Watch plans frozen, complete, rehearsed | Frozen Watch plan file in the Release record; T13 rehearsal receipts |
| 6. Tested Recovery Point covers every changed surface | Recovery Point validation result |
| 7. No barred or irreversible action in the change set | Classifier result `safe` |
| 8. Company pipeline branch, environment, and approval rules passed | The local adapter stand-ins record the same checks; the operator's approval record |

### Candidate probe (stage 1)

The Compose release adapter starts the candidate payment container (candidate image digest, distinct `service.version` and `service.instance.id`) on the internal network. A probe script sends 20 gRPC `charge` requests with a valid 2039 Visa card in each 30-second Watch window and asserts success on all 20. Stage 1 passes only after three consecutive windows where every stage-1 gate passes.

### Watch plan: metrics, bounds, sample floors

Frozen in the Release record; windows of 30 seconds; three consecutive passing samples per stage.

| Gate | Query | Limit | Sample floor | Missing-data rule |
|---|---|---|---|---|
| G1 deployment health | Candidate or live container running; TCP/gRPC healthcheck `SERVING`; no crash loop | Pass/fail | 1 probe per window | Unhealthy or silent = no pass |
| G2 error rate | `sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)` | < 0.05 | ≥ 50 calls per window (stage 1: candidate version filter, ≥ 20) | No data = no pass |
| G3 latency | `histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))` | < 500 ms | ≥ 50 spans per window | No data = no pass |
| G4 telemetry arrival | Span-metric counter increments for the watched version in the window; ruler freshness healthy | Pass/fail | ≥ 1 data point | Absence never counts as health |
| G5 symptom | Same query as G2 against the recorded pre-release baseline (capture target ≥ 0.9) | Must improve to < 0.05 | Same floor as G2 | No data = no pass |
| G6 regression sentinels | No new `error_type` on payment spans beyond the baseline set; checkout error rate < 0.05; frontend-proxy 5xx rate < 0.05 | Pass/fail | Same floors | No data = no pass |

The frozen plan also carries the standard severe-regression stop rule (crash loop or readiness loss, live error rate above 0.5, a new security finding, or a company business-invariant breach). Run 1's candidate never approaches any of these, so the rule stays a recorded, unfired safety line; the Demo Runs do not rely on it because no credible post-release-only regression exists for a one-line card-type restoration.

### Terminal outcome

Stage 1: 20/20 probes succeed; G1–G5 pass for three consecutive windows. Stage 2: the live Compose service swaps to the candidate digest; the charge error ratio falls toward zero (recorded); G1–G6 pass for three consecutive windows. The detector resolves; the resolved trigger sets `detector_state: resolved` and starts the Watch confirmation window. Run outcome `completed: verified-remediation`; Incident `resolved`. After the confirmation window passes with no recurrence, the Incident moves `resolved → closed` (confirmation window and retention requirements met), per [orchestrator-stages.md](orchestrator-stages.md). The Recovery Point stays retained.

### Numeric before/after proof

Capture targets; the saved Watch rows supply the recorded values.

- Charge error ratio: target ≥ 0.9 (seeded live window) falling to < 0.05 (post-swap live window).
- Probe charges: 0/20 succeed on the seeded version; 20/20 succeed on the candidate.
- `demo.payment.transactions` rate: flat during the Incident; back to the checkout rate after.
- Checkout error rate: rises with the Incident; returns to the pre-Incident baseline after the swap (G6).

### Saved artifacts

Incident Trigger v1 with intake snapshot; Evidence Set items with receipts; Fusion round records (two participants, Judge, Synthesizer); Diagnosis Report; the eight-check gate table; Remediation Proposal with citation map and diff hash; PR-shaped record in the local repository; the five Review Reports with cited findings; all test receipts with hashes; Verification Report with applicability table and hash binding; Release record with the frozen Watch plan; Recovery Point and validation; hybrid-window approval record with policy and tzdb versions; stage-1 and stage-2 Watch Reports; the resolved trigger; the confirmation-window records; the run summary and journal.

### Dashboard story

"Real Signals: the seeded commit makes every charge fail; the rule fires above the 0.20 threshold (recorded ratio in the saved rows). Fusion Diagnosis proposes four Hypotheses; the gate table shows the flag, provider, and checkout Hypotheses eliminated item by item, and the pre-registered regression suite confirms the code defect. The Remediation PR restores one line and the suite turns green; five independent reviewers pass and every required and triggered check passes; the hybrid window queues the deploy for one recorded approval; the probe ring then the live swap; the recorded error ratio falls below 0.05 across three consecutive samples; the detector resolves and the Incident resolves, then closes after the confirmation window."

### Runtime and fallback

About 2.5 hours of capture wall clock: baseline 20 min; seed and rebuild 15 min; rule fires within ~5 min; diagnosis 20 min; repair 10 min; verify ~35 min (build, tests, reviews, T9, T13); stage 1 ~5 min; hybrid approval 2 min (operator); stage 2 plus confirmation window ~10 min; export and save 10 min. T3 is pure and mock-free: `node --test src/payment/card.unit.test.js` runs against the pinned builder image `node:26.4.0-slim` with no OpenFeature, flagd, or OTel SDK, so no mocking substitution is needed. Fallbacks: if the rule does not fire within 10 min, check ruler freshness and raise `loadGeneratorVUs` to 25; if a review returns a `major` finding on the fix, the bounded Repair-to-Verify loop revises the candidate (cap 2) and full Verify reruns.

## Demo Run 2 — deterministic failed verification

### Service and file

Payment service. Seed `S2` in the overlay's `src/payment/card.js`: the same card-type inversion as `S1`, plus the Luhn guard clause removed. Upstream reference for the two clauses: [charge.js:76](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/charge.js#L76) (card-type gate) and [charge.js:72](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/charge.js#L72) (Luhn guard).

### Seeded defect and reset

`S2` applies two hunks to `card.js`'s `validateCard`: drop the negation on the card-type clause (same as `S1`) and delete the `if (!valid) return 'Credit card info is invalid.';` clause. Same reset procedure as Run 1; `paymentFailure` stays `off`. The card-type hunk fires the Incident; the removed Luhn guard is silent — invalid cards are accepted, so no error Signal exposes it.

### Traffic

Same load-generator traffic as Run 1. The run never reaches the probe ring.

### Detector

Same rule, grouping, and missing-data behavior as Run 1.

### Expected Signals and receipts

- Incident phase: identical to Run 1 — card-type error ratio target ≥ 0.9, error text, deployment event, flag receipts. The removed Luhn guard produces no Signal of its own (invalid cards are accepted silently).
- Verify phase: T3 passes the candidate's card-type cases. R1 cites both the restored card-type line and the missing adjacent Luhn guard as a `major` reachability finding. T5 `node --test src/payment/payment.regression.test.js` returns `fail`; its receipt names the failing case ("Luhn-failing Visa is rejected") and the candidate hash.
- Receipts: the R1 finding, the T5 failure receipt, the Verification Report with verdict `fail`, the failed evidence item joining the Evidence Set, and the run summary showing `verification-failed`.

### Competing Hypotheses and the discriminating test

Same four Hypotheses and the same pre-registered `card.unit.test.js` predictions as Run 1 (the Incident is identical). H1 passes the gate. The removed Luhn guard is silent and outside the trigger window, so no Hypothesis covers it — correctly.

### Eight-check Hypothesis gate proof

Identical to Run 1's table: the same eight checks pass on the same items, because the Incident and the accepted Hypothesis are the same.

### Remediation and Recovery Point

The Orchestrator authors the correct, minimal fix of the accepted Hypothesis — restore the negation in the card-type clause, exactly Run 1's change set. R2 rejects an unrelated Luhn change because no Incident evidence cites it. The implementation may report the second defect, but policy must route it into new evidence and a later attempt instead of expanding this Remediation. No wrong patch is scripted. A Recovery Point draft is recorded and T12 tests it in the isolated candidate environment, but the run never reaches Release, so no production swap occurs and no Recovery Point is consumed.

### Review and test checks

Same applicability resolution as Run 1 (same Code row): R1, R2, R3, R4, R8 required; T1, T2, T3, T4, T5, T7 required; T9, T10, T12, T13 triggered; the rest recorded not applicable. R1 records a cited `major` finding: restoring the card-type check makes the adjacent missing Luhn guard reachable, so invalid Visa numbers can now pass. This follows the fixed reviewer-scope rule in [review-verification.md](review-verification.md): a reviewer may flag a defect outside the diff when the diff makes it reachable. R2, R3, R4, and R8 can still pass the one-line candidate. T1, T2, and T3 pass. T5 fails deterministically because the pre-seeded "Luhn-failing Visa is rejected" case now returns `null`. Both failures point to the seeded base outside the candidate's diff, so neither is a fixable patch defect inside this attempt; neither contradicts the accepted card-type Hypothesis. The verdict function returns `fail`; the attempt ends `verification-failed`.

### Gate facts

Neither the Release Gate nor the Action Gate runs: the candidate never leaves Verify, and no release request is submitted. The cited R1 finding and required T5 failure each block promotion; the machine test keeps the outcome deterministic even if a review model misses the reachability finding.

### Candidate probe (stage 1)

None. The run ends at Verify before the probe ring. This is the point: the safety net caught the broken state before any deployment.

### Watch plan

T13 rehearses Run 2's candidate-bound Watch plan in the isolated environment during Verify, as the applicability matrix requires. The run never enters the production Watch stage and produces no live Watch Report.

### Terminal outcome

Run `failed: verification-failed` — a required check failed and its cause lies outside the candidate's diff, so no fixable-defect revision applies. The failed evidence joins the Evidence Set. Incident stays `open` with the attempt consumed (2 remain). No Remediation ships, and no Recovery Point is consumed. A new Diagnose attempt may now use the R1 and T5 evidence to form a separate Hypothesis for the missing Luhn guard.

### Numeric before/after proof

Capture targets; the saved receipts supply the recorded values.

- T3 `node --test src/payment/card.unit.test.js` passes the candidate's card-type cases. T5 `node --test src/payment/payment.regression.test.js` fails the "Luhn-failing Visa is rejected" case and records the actual assertion plus the candidate hash.
- No production Watch rows, no live error-ratio change, no deployment: the run ends at Verify, so there is no before/after on the running service — the proof is the failed check and the blocked promotion. T13's isolated rehearsal receipt remains part of Verify.

### Saved artifacts

Incident Trigger and intake snapshot; Evidence Set with receipts; Fusion round records; Diagnosis Report; the eight-check gate table; Remediation Proposal with citation map and diff hash; five Review Reports including R1's cited reachability finding; reports for every applicable test layer, including the passing T3 receipt and failing T5 receipt; the Verification Report with verdict `fail` and candidate-hash binding; the failed-evidence item; the tested Recovery Point draft; and the run summary and journal ending `verification-failed`. No Release record and no production Watch report.

### Dashboard story

"Same Incident, different seed. The seed commit carries a second, silent defect — a removed Luhn guard — alongside the card-type inversion that fires the Incident. Diagnosis accepts the supported card-type Hypothesis and the Orchestrator writes its correct one-line fix. R1 spots that the change makes the missing guard reachable; the separate scoped regression suite proves it by sending an invalid card. The fixed gate fails the attempt before Release. Nothing ships; the Incident stays open, and the new evidence can drive the next attempt."

### Runtime and fallback

About 2 hours of capture wall clock: the same baseline, seed, diagnosis, and verify time as Run 1, ending at Verify (no release probe ring, production Watch, or approval). The T5 failure is a property of the fixed seed plus the Remediation scope, not of model output. R1 adds useful review evidence, but the saved run does not depend on its wording or severity because T5 supplies the deterministic failure. There is no severity tuning and no scripted wrong patch.

## Seed manifest

One manifest file drives both captures. Exact contents:

- **Pin:** Astronomy Shop checkout at commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` plus the project's Compose overlay (Prometheus config override with `rule_files` and the Alertmanager target, the mounted `sih-demo` rule file, Alertmanager, the Intake Normalizer, the Control Plane, and the local brokers), per [incident-intake.md](incident-intake.md) and [company-integration.md](company-integration.md).
- **Overlay files:** `src/payment/card.js` (pure `validateCard`), `src/payment/charge.js` (refactored to call it), `src/payment/card.unit.test.js` (T3), `src/payment/payment.regression.test.js` (T5), and the Payment Dockerfile's production-copy plus `test-runtime` target, all committed to the local demo repository before any seed.
- **Seed commits:** `S1` = drop the negation in `card.js`'s card-type clause; `S2` = `S1` plus delete the Luhn guard clause. Authored as separate commits in the local demo repository; the payment image rebuilds from the seeded source.
- **Flag states:** `paymentFailure=off`, `paymentUnreachable=off`, `loadGeneratorTraffic=on`, `loadGeneratorVUs=5` (raise to `25` only if the traffic floor needs it); all other flags default. The effective k6 concurrency is the flag value, not the script's `|| 10` fallback.
- **Rule file and label validation:** before the first capture, run a validation query against the live store to confirm the `span_metrics` connector emits `traces_span_metrics_calls_total` with `service_name`, `service_version`, and `status_code` labels, and `traces_span_metrics_duration_bucket`; then pin the rule file (version it in the local repo) so every trigger carries the pinned `rule_version`. If the connector emits different label names, write the rule once against the observed names and pin it — this is a setup step, not an open risk.
- **Watch plan file:** G1–G6 with the queries, limits, floors, and the standard severe-regression stop rule (recorded, unfired); frozen before Run 1's release.
- **Probe script:** 20 valid-card charges per stage-1 window (Run 1 only).
- **Identities:** `service.name=payment`, `service.version` set to the image digest, `deployment.environment.name=demo`, `tenant_id=demo`; HMAC secret for the webhook.
- **Policies:** Run 1 scheduled hybrid (window deliberately closed during deploy; approval by the operator); Run 2 autonomous at all times (moot — it ends at Verify); Repair Mode; Attempt Limit 3.

## Capture and reset procedure

1. From pristine: `docker compose up` the pinned stack with the overlay; wait for health; record the 30-minute clean baseline (error rate near zero, checkout success). Run the pre-capture label-validation query and pin the rule file.
2. Apply commit `S1` (Run 1) or `S2` (Run 2); rebuild and swap in the seeded payment image; wait for the rule to fire (about 5 min); verify the Incident Trigger arrives with the HMAC signature.
3. Let the Incident Run proceed through Detect, Diagnose, Repair, and Verify without touching it. For Run 1, approve the hybrid-window deploy when the Workspace asks, then let Release and Watch finish. For Run 2, the run ends at Verify with `verification-failed`; nothing is deployed.
4. After the terminal outcome, export the journal and sealed artifacts to the saved Demo Run store; verify the Workspace replays the run from the journal alone.
5. Reset between runs: stop the stack; restore the pristine checkout (drop the seed commit); restore flag defaults; clear the local Prometheus, Alertmanager, and Control Plane state; then repeat from step 1 for the other run.
6. Presentation check: load both saved runs in the Workspace; confirm every table, receipt link, and gate row renders; confirm no live Worker is running.

## Presentation order (2–3 minutes)

1. **Opening (10 s).** One line: evidence-led incident response with deterministic gates; everything shown is saved evidence, nothing runs live.
2. **Run 1 (75 s).** Detector fires on the seeded card-type defect; intake snapshot with trace and log links; four Hypotheses and the gate table eliminating flag, provider, and checkout causes; the pre-registered regression suite; the one-line PR and the review/test table; the hybrid approval; the probe ring; the live swap; the recorded error ratio falls below 0.05; resolved, then closed after the confirmation window.
3. **Run 2 (75 s).** Same Incident; the seed carries a second, silent defect (a removed Luhn guard). The Orchestrator writes the correct one-line fix; R1 spots the newly reachable gap and T5 proves it with an invalid card; the run ends `verification-failed`; nothing ships; the Incident stays open.
4. **Close (20 s).** Two dials, one risk table, three gates, and a scoped regression suite as the last net: fast where safe, human where it matters, every decision replayable. Automatic rollback remains in the Solution Contract.

## Artifact checklist

Per run, saved under the Demo Run store (layout proposed; the build slice in [#13](https://github.com/xddinside/sih26-proto/issues/13) owns the final structure): Incident Trigger and intake snapshot; Evidence Set with receipt files; Fusion round records; Diagnosis Report; Hypothesis gate table; Remediation Proposal and citation map; PR-shaped record; Review Reports; test receipts; Verification Report. Run 1 adds: Release record, frozen Watch plan, Recovery Point and validation, approval records, probe receipts, Watch Reports, the resolved trigger, and the confirmation-window records. Run 2 adds: the cited R1 finding, the T5 failure receipt, the failed-evidence item, the tested Recovery Point draft, and the `verification-failed` run summary — no Release record or production Watch report. Shared: the pinned rule file, the Alertmanager config, the Watch plan file, the probe script, the seed manifest, the capture script, and the replay verification output.

## Acceptance checks

The runs are ready to capture and present when tests show that:

1. both runs replay end to end in the Incident Workspace from the journal and sealed artifacts alone, marked as saved Demo Runs, with no live agent, broker, or detector activity;
2. Run 1 ends `completed: verified-remediation` and the Incident `resolved` (then `resolved → closed` after the confirmation window), with the charge error ratio recorded ≥ 0.9 before and < 0.05 after across three consecutive Watch samples;
3. Run 1's Remediation is a code change (one restored line in `card.js`) in the local repository; the flagd receipt shows `paymentFailure=off` for the whole run;
4. Run 2 ends `failed: verification-failed`; the T5 receipt names the "Luhn-failing Visa is rejected" case; the failing check's cause is outside the candidate's diff; the Incident stays `open`; no Release or Action Gate ran and nothing shipped;
5. every Run-1 and Run-2 check table matches the Code row of the review-verification matrix, with each not-applicable cell carrying its recorded trigger evaluation, and every result bound to the candidate hash;
6. the eight-check gate table for the accepted Hypothesis cites real Evidence Set items for all eight checks;
7. the numeric before/after values come from saved Watch rows and T3 receipts, not from narrative;
8. the Solution Contract claims remain separate from the Demo Profile build list, per the boundary table above;
9. each applicable R role and T layer maps to one skilled subagent, with deterministic tools and receipts owning test facts, per the `pi-agent-catalog.md` rule.

## Rejected alternatives

- **The `paymentFailure` flag as Run 1's root cause.** Rejected: the task requires a real code fix; a flag cannot masquerade as the code root cause. The flag stays off and serves only as an eliminated Hypothesis.
- **An automatic-rollback Run 2 for the card-type defect.** Rejected: a one-line card-type restoration has no credible post-release-only regression that Verify and T13 could not observe, and any such regression would have to be a model-authored wrong patch or a reviewer-missed defect, both of which the parent review forbids. The Solution Contract's rollback behavior is unchanged; only the Demo Run is re-selected.
- **A `prohibited`-disposition handoff as the safety path.** Rejected: honest and deterministic, but the payment card-type fix is not a barred surface, and the parent asked specifically for a failed-verification/revision path where rollback is not credible.
- **A `hypothesis-invalidated` path.** Rejected: it requires the accepted Hypothesis to be wrong, which means scripting or hoping for a misdiagnosis; the failed-verification path needs only a fixed seed and deterministic checks.
- **`productCatalogFailure` / `kafkaQueueProblems` / `failedReadinessProbe`.** Rejected: the catalog and queue faults are flag-driven or harder to make deterministic; the readiness flag is Kubernetes-only, dropped by [company-integration.md](company-integration.md).
- **A latency or saturation trap.** Rejected: stochastic; the failed-verification path is deterministic by construction.
- **A third saved run for the hybrid-approval moment.** Rejected: Run 1 folds the scheduled-hybrid approval into its Release Gate facts, satisfying the [authority-action-risk.md](authority-action-risk.md) requirement with two runs.
- **Running any of this live during the presentation.** Rejected: out of scope per the map [#1](https://github.com/xddinside/sih26-proto/issues/1).

## Reconciliation with earlier settled examples

[incident-intake.md](incident-intake.md) sketched the `paymentServiceFailure` flag as the first saved run, and [hypothesis-gate.md](hypothesis-gate.md) left the final Demo Run choice open. This report settles the choice: the code defect is the root cause and the flag is an eliminated Hypothesis. [release-recovery.md](release-recovery.md) planned a second run as a severe readiness or error regression ending in automatic rollback; this report supersedes only that Demo Run selection — because no credible post-release-only regression exists for the selected defect — and replaces it with a deterministic failed-verification run. The Solution Contract's automatic rollback on severe regression, its Recovery Point rules, and its Watch stop rules stand unchanged in [release-recovery.md](release-recovery.md); nothing here weakens them.

## Demo skill subset handed to issue #11

The two runs need exactly this set of Pi skills and tools, with one skilled subagent per applicable R role and T layer. Test subagents request pinned runs and return receipt-bound reports; deterministic tools and the Control Plane own pass/fail. This is the `pi-agent-catalog.md` rule that [#11](https://github.com/xddinside/sih26-proto/issues/11) fixes:

- **Diagnose:** two independent Fusion participant subagents, one Judge, one Synthesizer (Synthesizer defaults to the primary model), per [orchestrator-stages.md](orchestrator-stages.md).
- **Repair:** one authoring subagent in a copy-on-write worktree, plus the source-host adapter stand-in for the PR-shaped record.
- **Review roles (one subagent each):** R1 change correctness, R2 causal fit, R3 code quality, R4 security/threat, R8 rollback/Recovery Point. R5, R6, R7, R9 are not applicable to these candidates and are not packaged for the demo.
- **Test layers (one skilled subagent each):** T1 lint (pinned ESLint), T2 build (`docker build` of the patched image), T3 unit (`node --test src/payment/card.unit.test.js`), T4 contract (gRPC `charge` against the candidate), T5 scoped regression (`node --test src/payment/payment.regression.test.js` under the Payment ownership map), T7 dependency-vulnerability and secret scans, T9 candidate deployment with probe traffic, T10 browser checkout, T12 restore drill, and T13 Watch-plan rehearsal. T6, T8, and T11 are not applicable and not packaged.
- **Watch (Run 1):** the frozen-plan gate queries G1–G6 as one deterministic tool configuration consumed by the Orchestrator.

This is the exact Demo hand-off to [#11](https://github.com/xddinside/sih26-proto/issues/11); the full nine-role/thirteen-layer catalog remains the Solution Contract's scope.

## Primary evidence

All upstream sources verified 2026-08-15 at commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9`:

- Astronomy Shop source: [charge.js](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/charge.js), [index.js](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/index.js), [payment Dockerfile](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/payment/Dockerfile), [checkout main.go](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/checkout/main.go), [load-generator script.js](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/load-generator/script.js), [load-generator entrypoint.sh](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/load-generator/entrypoint.sh), [people.json](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/load-generator/people.json), [demo.flagd.json](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/flagd/demo.flagd.json), [collector config](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/otel-collector/otelcol-config.yml), [Prometheus config](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/prometheus/prometheus-config.yaml), [compose.yaml](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/compose.yaml).
- Node.js: the built-in [test runner](https://nodejs.org/api/test.html) (`node --test`, `node:test`, `node:assert`) is stable in the pinned builder image `node:26.4.0-slim`; `simple-card-validator` is the existing pure dependency the overlay's `card.js` reuses, so the regression suite runs with no OTel SDK, flagd, or network.
- OpenTelemetry docs: [Astronomy Shop Docker deployment](https://opentelemetry.io/docs/demo/docker-deployment/), [feature flags](https://opentelemetry.io/docs/demo/feature-flags/), [telemetry features](https://opentelemetry.io/docs/demo/telemetry-features/), [span-metrics connector](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/spanmetricsconnector).
- Prometheus: [alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/), [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/).
- The eight settled reports cited inline above, and the language in [CONTEXT.md](../../CONTEXT.md).

## Blockers and open items

- **The Demo Profile stack is not built yet.** The Compose overlay, Control Plane, brokers, and Worker runner are the build slice of [#13](https://github.com/xddinside/sih26-proto/issues/13). Capture cannot start until they exist. This report pins the runs so the build slice can target them.
- **`card.js` is a demo-only refactor of `charge.js`.** It must be behavior-preserving and live in the overlay, not upstream. The build slice should add one T3 smoke test asserting that the refactored `charge.js` and the unrefactored upstream accept and reject the same card fixtures; until that passes, the overlay seam is not safe to seed on top of.
- **No Demo Run demonstrates automatic rollback.** The parent review accepted a deterministic failed-verification path in place of rollback because no honest post-release-only regression exists for this defect. If a judge expects a rollback demo, the team must select a different defect with a genuine stage-2-only regression, or point to the unchanged Solution Contract rollback text in [release-recovery.md](release-recovery.md). This is a known scope limit, not a defect in the runs.
