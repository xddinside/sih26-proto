# Evidence kit — the fixed 12 views (issue #22)

The 12 screenshots live in `shots/` (captured at the 1280 px presentation
width from the captured bundle `demo/saved-runs/`). Each entry names the
route, the panel, and the exact rows and numbers to show on stage. Every
number is a saved row or receipt; none is narrative.

Capture time shown throughout: `2026-08-16T17:16:21.283Z`. The two saved runs
are `inc-demo-payment-1` (Run 1) and `inc-demo-payment-2` (Run 2).

| # | File | Route | Panel(s) | Exact content to show |
|---|---|---|---|---|
| 1 | `01-incident-list.png` | `/` | Incident list | The standing saved banner ("captured 2026-08-16T17:16:21.283Z · bundle format 1.0 · 2 incidents · evaluation time is the bundle capture time, never the live clock"). Two rows: `inc-demo-payment-1` **closed**, `inc-demo-payment-2` **open**, both `severity critical`, scope `payment · demo`, 1 attempt used, latest run `completed · verified-remediation` (Run 1) vs `failed · verification-failed` (Run 2). |
| 2 | `02-run1-header-trigger-intake.png` | `/incidents/inc-demo-payment-1` | Header, Trigger and intake | Header: `closed: symptom-cleared`, `detector resolved`, `1 attempt used of 3 · 2 remaining`, outcome `verified-remediation`. Intake: rule `payment-error-rate` `version 1`, firing `recorded value 1` vs `threshold 0.2`, received `15:59:42.019Z`; resolved trigger `value 0`; delivery history `incident-created` (seq 1), `duplicate-noop` (seq 3), `evidence-appended` (seq 85). |
| 3 | `03-run1-evidence-set.png` | `/incidents/inc-demo-payment-1` | Evidence Set and receipts | Revision 1 with items grouped by trust class. The flagd receipt `paymentFailure=0` (and `paymentUnreachable=false`), the `S1` deployment/diff receipt, the trace-log join (exemplar `trace_id`/`span_id`), the grep receipt locating the error string in `card.js`, and the pre-seed near-zero baseline. Redaction profile `demo-profile`, provenance `collector -> gateway -> backend -> read-broker-receipt-…`. |
| 4 | `04-run1-hypotheses-gate.png` | `/incidents/inc-demo-payment-1` | Hypotheses and gate | H1 `accepted`; H2 (flag), H3 (provider), H4 (checkout) `rejected`, each showing the item that eliminated it. The eight-check gate table `verdict pass` — cited-coverage, causal-edge-support, contradiction-handling, alternative-elimination, reproducible-test, scope-match, freshness, telemetry-coverage all pass. |
| 5 | `05-run1-remediation-recovery.png` | `/incidents/inc-demo-payment-1` | Remediation, Recovery Point | The one-line diff `- if (['visa','mastercard'].includes(cardType)) {` / `+ if (!['visa','mastercard'].includes(cardType)) {`; class `code`, risk `safe`, disposition `allowed`, gate path `release`; PR-shaped record `remediate/incident-inc-906e6512ce2f-msvzqbwt`; citation map to H1; Recovery Point validated with the T12 restore drill receipt. |
| 6 | `06-run1-verify.png` | `/incidents/inc-demo-payment-1` | Verify | Applicability table (required R1/R2/R3/R4/R8 + T1/T2/T3/T4/T5/T7; triggered T9/T10/T12/T13; recorded not-applicable R5/R6/R7/R9/T6/T8/T11). Five Review Reports `pass` and ten Test Reports `pass`; Verification Report `verdict pass` with hash-binding `match` on candidate `sha256:515f83a0…`. |
| 7 | `07-run1-release-gate-approvals.png` | `/incidents/inc-demo-payment-1` | Release Gate, Approvals | Release Gate `verdict pass` with all eight facts and evidence refs (evaluated `15:59:52.023Z`, policy `policy:sha256:63ae0a…`, tzdb `2026a`). One approval record `approval-1-run-1` `granted` by `demo-operator`, tzdb `2025b`, action-risk class `safe`, expiry `16:29:51.976Z`. |
| 8 | `08-run1-watch.png` | `/incidents/inc-demo-payment-1` | Watch | Frozen G1–G6 plan with the unfired severe-regression stop rule and T13 rehearsal receipt. Probe ring `20/20 succeeded` across `receipt-probe-w1/w2/w3`. Stage-1 rows record the no-data `fail` on G2–G5 (candidate has no organic traffic). Stage-2 `live service swap` rows record the elevated G2/G3/G5 (`value 1`) during the 2-minute rate lag. **Confirmation window** G2 and G5 `value 0` `< 0.05` `pass` — the recorded before/after (1.0 → 0). |
| 9 | `09-run2-r1-t5.png` | `/incidents/inc-demo-payment-2` | Verify | R1 `fail` with the open `major` finding "restoring the card-type check makes the adjacent missing Luhn guard reachable, so invalid Visa numbers can now pass", cited `src/payment/card.js:12` and `:9`. T5 `fail` on `node --test` (`26.4.0`), receipt `receipt-t5`, failing case **"Luhn-failing Visa is rejected"**, bound to candidate `sha256:bb888523…`. |
| 10 | `10-run2-verdict-open-attempts.png` | `/incidents/inc-demo-payment-2` | Header, Verify | Header: `open`, `detector firing`, `1 attempt used · 2 remaining`. Verify: Verification Report `verdict fail`, hash-binding `match`, reason "an open cited major finding must be resolved in a revision before the change ships". The run banner `failed: verification-failed`. |
| 11 | `11-policy-panel.png` | `/incidents/inc-demo-payment-1` | Policies and limits | Recorded execution-time decision `approval-required`, tzdb `2026a`, window `Pacific/Kiritimati mon 09:00–fri 18:00` (deploy outside the autonomous window). The action-risk table and Demo Profile caps (removed vs kept) render as fixed contract content. **Note:** the two recorded dials show no position for the captured bundle — see the discrepancy note below. |
| 12 | `12-rollback-panel.png` | `/incidents/inc-demo-payment-1` | Rollback (contract) | "Proposed product scope — Solution Contract only." "Neither saved run contains a rollback…" The fixed rollback sequence, the Emergency allow-list, and the honesty limits. It states plainly the demo build provides no live rollback path. |

## Discrepancies the presenter must not gloss over

These are captured-truth facts that diverge from the wording in
`docs/build-handoff.md` section 13. They are reported to the parent; do not
re-word them on stage.

1. **Watch stage rows (shot 8).** Section 13 says "G1–G6 pass … error ratio
   ≥ 0.9 → < 0.05 across three samples." The captured rows record the honest
   story instead: stage-1 rows are `fail` (no data — the candidate sees only
   probe traffic, so "no data is never a pass"); stage-2 rows record the
   still-elevated ratio (`value 1`) during the 2-minute rate lag after the
   16:01:40 swap; the **confirmation window** (16:03:41–16:04:11) records the
   clean `0 < 0.05` pass on G2/G5. Say exactly that. The watch panel also
   renders a hardcoded summary line "each below the 0.05 limit" next to the
   failing stage-2 rows — that line is wrong for this capture and is a
   rendering bug to fix (see report).
2. **Recovery Point consumed flag.** The captured swap receipt id is
   `receipt-service-swap`, but the panel projection looks for `receipt-swap`,
   so the Recovery Point panel renders `consumed: false` with the Run-2 note
   ("never consumed — the run ended at Verify") even though Run 1 shipped.
   Point at the `Stage 2 — live service swap` row in Watch instead.
3. **Policy dials (shot 11).** The recorded policy versions are content
   hashes (`policy:sha256:63ae0a…` / `policy:sha256:68781e…`); the
   `RECORDED_POLICIES` registry keys the fixture ids (`policy-hybrid-v1` /
   `policy-autonomous-v1`), so the two dials render with no recorded position
   for the captured bundle. The recorded meaning still appears in the
   execution-time decision row (`approval-required`, hybrid window). This is a
   parent-owned constant to reconcile.
