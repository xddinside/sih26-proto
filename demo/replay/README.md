# Replay verification (issue #22)

Strict, offline verification that the captured saved bundle replays honestly
and that every corruption class renders as a named integrity error.

## What is checked

`replay-check.ts` runs three layers over `demo/saved-runs/` (the captured
export — never modified):

1. **Pristine verification** through the same pipeline the Incident Workspace
   uses: the web replay adapter (`apps/web/src/lib/replay/`) over
   `verifySavedBundle` from `@sih/contracts`. This covers the manifest file
   hashes and UTF-8 sizes, journal sequence and legal transitions, schema name
   and version, redaction metadata, freshness at the explicit demo evaluation
   time (`2026-08-16T12:00:00Z`), and every journal artifact and receipt
   reference.
2. **Fixed outcomes** for both saved runs, asserted through the same
   `workspaceView` projection the panels render:
   - Run 1 `inc-demo-payment-1` — `completed: verified-remediation`; Incident
     `resolved`, then `closed` (`symptom-cleared`) after the confirmation
     window; firing-trigger ratio ≥ 0.9; one-line card.js diff; R1–R4, R8 and
     T1–T5, T7, T9, T10, T12, T13 pass; Release Gate pass with eight facts and
     the scheduled-hybrid approval; probe ring 20/20 across three windows;
     recorded after-ratio < 0.05.
   - Run 2 `inc-demo-payment-2` — `failed: verification-failed`; R1's cited
     `major` reachability finding; T5's failing receipt naming
     "Luhn-failing Visa is rejected" bound to the candidate hash; verdict
     `fail` with intact hash binding; no Release record, no Action Gate, no
     production Watch Report; Incident `open` with 2 attempts remaining.
3. **Corruption catalog** (`mutations.ts`, mutation-catalog style like
   `packages/contracts/test/invalid-cases.ts`): a copy of the bundle is
   mutated once per corruption class and re-verified; each case must surface
   its exact error code:

   | Case | Corruption | Exact code |
   |---|---|---|
   | corrupt-hash | journal bytes tampered, manifest hash stale | CHANGED_CONTENT |
   | missing-sequence | journal event removed, sequence gap | BAD_SEQUENCE |
   | unknown-schema | envelope names a schema the registry lacks | UNKNOWN_SCHEMA |
   | stale-data | evidence item `fresh_until` moved past the evaluation time | STALE_DATA |
   | redaction-failure | masked field declared but not the literal `[REDACTED]` | REDACTION_FAILURE |
   | missing-artifact | a journal-referenced artifact file deleted | MISSING_ARTIFACT |
   | stale-schema | envelope names a version newer than the registry | STALE_SCHEMA |

## Run

```sh
bun demo/replay/replay-check.ts
```

Exit code 0 when every check passes (warnings are recorded divergences
between the captured rows and the fixed section-13 script wording — see
`docs/presentation/evidence-kit.md`); 1 on any failed check.

Typecheck (ad hoc, not part of the root workspace):

```sh
bunx tsc -p demo/replay/tsconfig.json
```

## Boundaries

- The captured bundle in `demo/saved-runs/` is read-only input; every mutation
  runs on an in-memory copy.
- The replay source is the journal plus sealed artifacts only; no Pi JSONL
  session or model transcript is read.
- No Worker, broker, detector, or backend runs. This is pure verification.
