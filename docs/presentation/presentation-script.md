# Presentation script — 2–3 minutes, offline (issue #22)

Timed to 180 s, matching the fixed order in `docs/build-handoff.md` section 13
and the click path in `docs/research/incident-workspace.md`. Every click lands
on a saved panel; nothing runs live. The screenshot kit in `evidence-kit.md`
is the offline fallback for any step.

Wording stays within the honest claims (section 14): no live agent, broker, or
detector; no rollback Demo Run; no pitch-only panel claimed as implemented.

## Pacing map

| Second | Route | Section | Say / show |
|---|---|---|---|
| 0:00 | `/` | list | "Evidence-led incident response with deterministic gates. Everything shown is saved evidence — nothing runs live." Point at the two saved-run rows (Run 1 closed, Run 2 open). |
| 0:10 | `/incidents/inc-demo-payment-1` | header | Header: closed `symptom-cleared`, `verified-remediation`, 1 of 3 attempts. |
| 0:18 | Run 1 | intake | Rule `payment-error-rate` v1 fired at `recorded value 1` above the `0.2` threshold; delivery history with a `duplicate-noop` and the resolved trigger. |
| 0:26 | Run 1 | evidence | flagd receipt `paymentFailure=0`; the `S1` diff receipt; the trace-log join. |
| 0:36 | Run 1 | hypotheses | H1 accepted; flag/provider/checkout eliminated item by item; eight-check gate pass. |
| 0:47 | Run 1 | fusion | Two participants, Judge, Synthesizer with ranked hypotheses. |
| 0:52 | Run 1 | remediation | The one-line card-type restoration; class `safe`, disposition `allowed`; PR-shaped record; validated Recovery Point. |
| 1:00 | Run 1 | verify | R1–R4, R8 and T1–T5, T7, T9, T10, T12, T13 pass; Verification Report `pass`, hash binding match. |
| 1:11 | Run 1 | gates + approvals | Eight Release Gate facts pass; the scheduled-hybrid decision `approval-required` (deploy outside the autonomous window) with one recorded approval. |
| 1:18 | Run 1 | watch | Probe ring `20/20` across three windows; the stage-2 swap; the recorded ratio falls to `0` in the confirmation window (before/after 1.0 → 0). |
| 1:24 | Run 1 | policy | Repair Mode + hybrid; Attempt Limit 3. |
| 1:25 | `/incidents/inc-demo-payment-2` | header | Same Incident, open, `verification-failed`, 2 attempts remaining. |
| 1:33 | Run 2 | hypotheses | Same four hypotheses, same accepted H1. |
| 1:45 | Run 2 | remediation | The same correct one-line fix. |
| 1:53 | Run 2 | verify | R1's `major` reachability finding; T5 fails "Luhn-failing Visa is rejected" bound to the candidate hash. |
| 2:11 | Run 2 | verify | Verification Report `fail`, hash binding intact; the failed evidence joins the Evidence Set. |
| 2:19 | Run 2 | attempts | Verify failed; no Release Gate, no Action Gate, no production Watch Report; nothing shipped. |
| 2:29 | Run 2 | policy | Autonomous policy is moot at Verify. |
| 2:40 | Run 1 | policy | Close: two dials, one risk table. |
| 2:50 | Run 1 | rollback | Automatic rollback stays in the Solution Contract, unchanged; neither saved run demonstrates it. Three gates plus a scoped regression suite as the last net. |

## Rehearsal records

Two complete timed rehearsals ran against the dev server (captured bundle).
Logs: `rehearsals/rehearsal-1.txt` and `rehearsals/rehearsal-2.txt`.

- Rehearsal 1 — 171 s, 20/20 stops landed on saved panels.
- Rehearsal 2 — 171 s, 20/20 stops landed on saved panels.

Both complete inside the 2–3 minute envelope with ~10 s of headroom for stage
transitions and pointing at rows.

## Honest-claims note

Full company deployment (Helm chart + `sihctl`), real rollback execution, the
remaining review/test layers (R5–R7, R9, T6, T8, T11), the Emergency allow-list
as a live control, budget editing, audit search, and live approve/deny/pause/
cancel are Solution Contract scope, not demo proof. Neither saved run executes
a rollback; the demo build provides no live controls or live backend.
