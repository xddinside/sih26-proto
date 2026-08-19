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

### Frozen-evidence rehearsal (issue #29)

Rehearsals load exactly one verified revision-1 Evidence Set from
`demo/saved-runs`, use the network-free streaming provider by default, and
retain the attempt in the append-only development store. They never accept an
API key on the command line; the live provider reads `OPENCODE_API_KEY` from
the environment through the Gateway.

```sh
bun run capture.ts rehearse --scenario 1
bun run capture.ts rehearse --scenario 2 --provider opencode-go --model <model-id> --reasoning high
```

Use `--model-turns`, `--non-terminal-tool-calls`, `--session-wall-clock-ms`,
and `--run-wall-clock-ms` to lower the bounded rehearsal budgets. Rehearsal
output cannot be promoted by `finalize`; only completed real full-capture
runs are presentation-eligible.

### Deterministic full capture (issue #30)

The full-capture integration slice: both scenarios run end to end through
actual Pi role sessions using the deterministic streaming provider double,
starting from the seeded Signals and Incident Trigger (never a frozen
Evidence Set). The deterministic provider streams responses and tool calls
through the same Model Gateway transport contract as a real provider; every
role executes through the Pi runtime with typed tools, and the Control Plane
owns every gate, transition, receipt, and terminal state.

```sh
bun run capture.ts run --run 1 --agents real --mode full-capture --provider deterministic
bun run capture.ts run --run 2 --agents real --mode full-capture --provider deterministic
```

Deterministic full captures are network-free and mark their capture manifest
`provider_class: fixture` / `provider: deterministic`: they are explicitly
development fixtures. Their exported bundles pass the saved-bundle verifier
and replay offline, but they are never presentation-eligible and cannot be
promoted by `finalize` or `present`. A failed deterministic full capture is
retained in the append-only dev store with its partial artifacts.

The full Incident Run respects the finite 120-minute wall-clock limit and
the per-role/lifecycle limits for every real-agent capture (rehearsal and
full-capture alike); `--model-turns`, `--non-terminal-tool-calls`,
`--session-wall-clock-ms`, and `--run-wall-clock-ms` lower the bounded
budgets for tests and fast iteration.

### Presentation selection and freeze (issue #31)

Real-agent captures append to the append-only development store at
`dev-runs/dev-store.jsonl` (each run's journal and artifacts under
`dev-runs/runs/...`). Presentation finalization (`capture.ts present`)
selects from that store and never runs, calls, or rewrites it:

- **Manifest identity.** Every completed capture seals a v1.2 capture
  manifest that freezes the provider class and slug, model, reasoning level,
  exact `pi-agent-core`/`pi-ai` versions, resolved provider catalog metadata,
  skill-tree digest, tool-catalog and role-prompt revisions, policy revision,
  Investigation Perspectives, seed digests, schema versions, and every
  session/run/lifecycle budget. Its `manifest_digest` is the canonical
  `contentHash` over the payload minus run identity.
- **Frozen-config digest.** The dev-store record's `configDigest` hashes the
  manifest's frozen fields (run identity excluded), so an identical
  configuration yields an identical digest and any change to provider, model,
  reasoning, Pi version, prompt, skill, tools, perspectives, policy, seed,
  schema, or budget starts a new streak.
- **Per-scenario streak.** Each scenario tracks its own consecutive streak:
  eligible full-capture real runs under one unchanged `configDigest`. A
  failed, incomplete, unexpected, deterministic-fixture, or differently
  configured run breaks the streak.
- **Eligibility.** A run is eligible only as a full-capture, real-provider
  run with a sealed manifest, whose bundle verifies and carries every
  required succeeded role. Run 1 is eligible only with its verified
  Release/Watch outcome; Run 2 only with `verification-failed` / "Blocked
  safely" and no Release.
- **Selection.** A scenario becomes selectable after three consecutive
  eligible runs under one digest; `present` needs both scenarios and
  assembles the latest eligible run of each into `demo/saved-runs`, strictly
  verified. Deterministic fixtures, rehearsals, and tampered bundles are
  rejected even when their records and bundles otherwise verify.
- **Provenance.** Every successful `present` appends a `selection` record to
  the dev store naming the selected runs, their store paths, manifest
  digests, and the frozen-config digests, so the bundle always traces back to
  the append-only development store.

```sh
cd demo/capture
bun run capture.ts store     # list the dev store and selection records
bun run capture.ts present   # assemble + verify the presentation bundle
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
