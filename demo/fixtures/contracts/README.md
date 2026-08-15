# Contract fixtures

These fixtures drive the `@sih/contracts` saved-bundle verifier tests. They are
**contract fixtures, not captured real telemetry**: they exercise the settled
wire shape, hashing, journal order, and integrity checks on synthetic inputs
that match the final Demo Run truth from `docs/research/demo-runs.md`.

## Layout

- `valid/` — the single byte-accurate saved bundle: `manifest.json`,
  `incidents/<id>/journal.jsonl`, and content-addressed
  `artifacts/sha256/<hash>.json` envelopes. It contains two Incidents:
  - `inc-demo-payment-1` (Run 1) — reaches `verified-remediation`, then the
    Incident resolves and closes after the confirmation window.
  - `inc-demo-payment-2` (Run 2) — fails Verify with
    `failure_reason: verification-failed`; it has no Release record and no
    production Watch Report.
- `invalid-cases.json` — the deterministic mutation cases, each with its
  expected integrity error code.

Invalid bundles are not stored as directories. The verifier tests load
`valid/`, apply each mutation in memory (see
`packages/contracts/test/invalid-cases.ts`), and assert the named error.

## Truth label

Neither fixture is captured telemetry. Run 1 and Run 2 mirror the settled
Demo Run outcomes only; the numeric values (error ratio, thresholds, probe
counts) are synthetic. Do not present these files as a saved production run.

## Regeneration

```bash
cd packages/contracts && bun run fixtures
```

The generator is deterministic and rewrites `valid/` and `invalid-cases.json`,
removing any stale `invalid/` directory.
