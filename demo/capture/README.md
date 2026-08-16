# Capture and saved-run export (issue #19)

This directory owns the Release Gate path driver, the two-stage Compose probe
ring, the frozen Watch plan (G1–G6), the capture/reset scripts, and the strict
saved export for the two saved Demo Runs. The export lands in
`../../demo/saved-runs/` in the settled layout from
`docs/research/incident-workspace.md`:

```
demo/saved-runs/
  manifest.json
  incidents/inc-demo-payment-1/journal.jsonl
  incidents/inc-demo-payment-2/journal.jsonl
  artifacts/sha256/<hex>.json
```

The two runs replay end to end from this bundle alone. No agent, broker, or
detector runs during the presentation.

## What each file is

| File | Purpose |
|---|---|
| `capture.ts` | CLI entry: `run`, `export`, `finalize`, `verify`. |
| `src/driver.ts` | The Release Gate path driver: Detect → Diagnose (Fusion with two deterministic stub participants) → Repair → Verify → Release → Watch, through the real Control Plane. |
| `src/payloads.ts` | Deterministic stub Model Provider, the four settled Hypotheses, the Evidence Set, and the deterministic review/test/plan payloads. |
| `src/receipts.ts` | Deterministic receipt builders (fixed receipt ids, bound to the candidate hash). |
| `src/adapters.ts` | Docker-backed release adapter and evidence runner (image builds, candidate container, restore drill, T3/T5 runs, service swap). |
| `src/shop.ts` | Real-shop adapter: Prometheus queries, Alertmanager polling, flagd reads, gRPC probe/traffic drivers. |
| `src/export.ts` | Strict export: remaps the Control Plane incident id to the settled presentation id, re-seals artifacts, and verifies with `verifySavedBundle`. |
| `scripts/probe.ts` | Stage-1 probe ring: N valid-card gRPC charge requests, counts reported as JSON. |
| `scripts/traffic.ts` | Continuous charge traffic driver (reduced-profile stand-in for storefront traffic). |
| `scripts/link.sh` | Symlinks the `@sih` workspace packages into `demo/capture` for the driver imports. |
| `test/export.test.ts` | Export verification tests (see below). |

## Prerequisites

1. Node 26 / Bun 1.3.14 at the repo root (`bun install` done there).
2. Local PostgreSQL for the Control Plane: `apps/control-plane/scripts/db.sh`.
3. Docker access via `sg docker -c "..."`.
4. For a **live** capture only: a pristine clone of
   `open-telemetry/opentelemetry-demo` at
   `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` (see `demo/seeds/README.md`).

### First-time setup

```sh
cd demo/capture
bun install              # installs @grpc/grpc-js + @grpc/proto-loader
bun run link             # symlinks @sih/contracts, @sih/brokers, @sih/control-plane, @sih/pi-skills
```

## Capture commands

Two modes exist. Both drive the **real Control Plane** end to end and produce
the same verified export; they differ only in how the trigger numbers are
sourced.

### Offline mode (deterministic, no Docker shop)

Replays the recorded trigger shape through the full stage machine. Used for
CI, re-validation, and any host without enough RAM for the shop.

```sh
cd demo/capture
bun run capture.ts run --run 1 --offline
bun run capture.ts run --run 2 --offline
```

### Live mode (reduced Compose profile, real firing numbers)

Starts the reduced profile (`flagd`, `otel-collector`, `prometheus`,
`alertmanager`, `payment`) with the seeded payment image, runs the charge
driver, waits for the pinned rule to fire, and records the real ratio, call
rate, log line, and flagd receipts. Then it drives the same Control Plane
workflow and runs the real T3/T5 suites, the candidate probe ring, the live
service swap, and the Watch gates against live Prometheus rows.

```sh
cd demo/capture
bun run capture.ts run --run 1 --demo-repo /path/to/opentelemetry-demo
bun run capture.ts run --run 2 --demo-repo /path/to/opentelemetry-demo
```

`--skip-baseline` skips the pre-seed baseline window. `OTEL_DEMO_ROOT` defaults
to `/tmp/opencode/demo-repo` when `--demo-repo` is omitted.

Each `run` command resets the Control Plane database, captures, exports to
`/tmp/sih-capture-staging/run-N`, and finalizes the combined bundle into
`../../demo/saved-runs/` once both runs are present.

## Export and verification commands

```sh
cd demo/capture
bun run capture.ts export --run 1     # re-export run 1 from the database
bun run capture.ts export --run 2
bun run capture.ts finalize           # assemble + verify demo/saved-runs
bun run capture.ts verify             # re-run verifySavedBundle on the bundle
bun test                              # export verification tests
```

`verify` and `finalize` run `verifySavedBundle` and fail with every integrity
error (manifest, sequence, schema, redaction, staleness, hash,
missing-artifact). The bundle is written only after zero errors.

## Reset

The Control Plane database is reset at the start of every `run`. To reset the
demo repository back to the pinned commit between live captures:

```sh
demo/seeds/reset.sh --repo /path/to/opentelemetry-demo
```

The Compose stack is torn down (`docker compose down`) and the payment image
is rebuilt from the overlay at the end of each live run.

## Fixed outcomes (not configurable here)

- **Run 1** (`inc-demo-payment-1`): one-line card-type repair; R1/R2/R3/R4/R8
  and T1/T2/T3/T4/T5/T7/T9/T10/T12/T13 pass with receipts bound to the
  candidate hash; scheduled-hybrid approval recorded (deploy outside the
  autonomous window); Release Gate facts all pass; probe ring 20/20 in three
  stage-1 windows; service swap; Watch G1–G6 pass; error ratio ≥ 0.9 → < 0.05
  across three samples; run `verified-remediation`; Incident resolved, then
  closed after the confirmation window.
- **Run 2** (`inc-demo-payment-2`): same diagnosis and correct repair; R1 cites
  a `major` reachability finding; scoped T5 receipt fails
  "Luhn-failing Visa is rejected" bound to the candidate hash; Verification
  verdict `fail`; no Release record, no production Watch Report, nothing ships;
  Incident open with 2 attempts remaining.

Neither run records a rollback.

## Notes on the export remap

The Control Plane mints incident ids as `inc-<key>-<nonce>`; the settled
presentation layout pins `inc-demo-payment-1` / `inc-demo-payment-2`. The
export remaps the id deterministically and re-seals every artifact against the
remapped payload (content hashes recomputed, journal artifact refs updated).
Two serialization normalizations are applied at export only:

1. The Control Plane records the reproducible-test gate check's
   `cited_item_ids` as broker receipt ids; the journal schema requires
   `sha256:` hashes. The receipts stay recorded as `broker_receipt_recorded`
   events; the citation array is filtered to valid hashes.
2. The span-metrics connector promotes `service.name`, not `service.version`,
   so the candidate cohort runs under `service.name=payment-candidate` with
   `service.version=<candidate digest>` as its resource attribute. The frozen
   Watch plan's stage-1 G2/G3/G4 queries name that cohort.

## Live vs recorded rows

Offline mode records the trigger shape (ratio 0.92, call rate 0.6/s, baseline
0.003) rather than querying a live shop. Live mode sources every number from a
live Prometheus/flagd/docker read. The reduced profile has no storefront or
frontend-proxy, so T10 (browser checkout) and the frontend-proxy 5xx sentinel
in G6 record the charge-path driver in their place; this is stated in the
frozen plan text and in the capture log.
