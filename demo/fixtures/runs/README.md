# Saved-run fixture bundle for the Incident Workspace panels

This directory holds the richer saved-run bundle the Incident Workspace panels
(`apps/web/src/features/incident-workspace/`) replay. It extends the settled
fixture data in `demo/fixtures/contracts/valid/` with the full panel evidence
the two saved Demo Runs carry, per `docs/research/demo-runs.md` and
`docs/research/incident-workspace.md`. The settled outcomes are identical to
the contracts fixture:

- **Run 1 (`inc-demo-payment-1`)** — `completed: verified-remediation`;
  Incident `resolved`, then `closed` (`symptom-cleared`) after the confirmation
  window. Journal final sequence 91.
- **Run 2 (`inc-demo-payment-2`)** — `failed: verification-failed`; R1's cited
  `major` reachability finding and the failing T5 receipt bound to the
  candidate hash; no Release record, no production Watch Report, nothing
  ships; Incident `open` with 2 attempts remaining. Journal final sequence 66.

Layout is the settled saved-bundle layout — `manifest.json`,
`incidents/<id>/journal.jsonl`, `artifacts/sha256/<sha256-hex>.json` — and the
same replay adapter verifies every file (`manifest file hashes and sizes,
journal sequence and transitions, schema name and version, redaction metadata,
freshness at the explicit evaluation time `2026-08-16T12:00:00Z`, and every
artifact and receipt reference`).

## Regenerating

```sh
bun run demo/fixtures/runs/generate.ts
```

`generate.ts` is the single source of truth. It builds every file, re-runs
`verifySavedBundle` from `@sih/contracts` over the in-memory bundle, and writes
nothing unless the verification passes. Output is deterministic: rerunning
reproduces the same bytes and hashes.

## Run 1 panel evidence (summary)

- Trigger firing with recorded ratio 0.92 above the 0.20 threshold; intake
  delivery history with a `duplicate-noop` entry; resolved trigger with 0.01.
- Evidence Set revision 1: trace-log join (`trace_id`/`span_id`), flagd
  receipts `paymentFailure=0` and `paymentUnreachable=false`, `S1` deployment
  event and diff receipt, code-location grep receipt, pre-seed near-zero
  baseline with a coverage record.
- Fusion round 1: two participant outputs, Judge output (`agreements`,
  `contradictions`, `blind_spots`, `unique_findings`, `citation_audit`), and
  the durable Synthesizer output with ranked Hypotheses.
- Diagnosis Report: H1 `accepted`, H2/H3/H4 `rejected` with the eliminating
  item in each `evidence.opposing` list; eight-check Hypothesis gate `pass`.
- Remediation: one-line diff, citation map to H1, class `code`, risk `safe`,
  disposition `allowed`, gate path `release`; PR-shaped action receipt from
  the source-host adapter (`remediate/incident-inc-demo-payment-1`).
- Verify: applicability (required R1/R2/R3/R4/R8 + T1/T2/T3/T4/T5/T7;
  triggered T9/T10/T12/T13; not applicable R5/R6/R7/R9/T6/T8/T11); five Review
  Reports and ten Test Reports with receipts; Verification Report `pass` with
  hash-binding match.
- Release: eight Release Gate facts `pass`; scheduled-hybrid policy decision
  `approval-required` (window Mon–Fri 09:00–18:00 America/New_York, tzdb
  2026a); one operator approval granted and consumed; CI receipt with the
  candidate image digest; release lease.
- Watch: frozen plan with G1–G6, the recorded unfired severe-regression stop
  rule, and the T13 rehearsal receipt; stage-1 probe ring 20/20 in each of
  three windows (G1 rows); stage-2 service swap with G1–G6 across three
  windows (error ratio 0.02/0.01/0.01 vs limit 0.05); confirmation-window
  report; Recovery Point with restore command, preconditions, timeout, and
  T12 drill receipt.

## Run 2 panel evidence (summary)

Same Incident, same four Hypotheses, same eight-check gate table, same correct
one-line candidate from seed `S2`. R1 records a cited `major` reachability
finding (restoring the card-type check makes the missing Luhn guard
reachable); T5 fails "Luhn-failing Visa is rejected" bound to the candidate
hash; Verification Report verdict `fail`; the failed evidence joins the
Evidence Set as revision 2; Verify stage `failed`; no Release or Action Gate,
no probe ring, no production Watch Report.

Neither run demonstrates rollback; the rollback panel and the full R1–R9 /
T1–T13 catalog panel are static Solution Contract documentation.
