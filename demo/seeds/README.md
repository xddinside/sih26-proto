# Payment overlay, seeds, and reset

The Demo Profile's Payment seam. This directory holds the behavior-preserving
`card.js` extraction, the refactored `charge.js`, the T3/T5 test suites, the
pre-seed preservation test, the Dockerfile overlay, the pinned detector rule,
and the two seed patches.

## Layout

- `card.js` — pure `validateCard` seam extracted from upstream `charge.js`.
- `charge.js` — refactored to call `validateCard` and throw its reason.
- `card.unit.test.js` — T3 unit suite (card-type Hypothesis).
- `payment.regression.test.js` — T5 scoped regression suite.
- `smoke-behavior.test.js` — preservation test: seam matches upstream before any seed.
- `Dockerfile` — overlay of `src/payment/Dockerfile` (production + `test-runtime`).
- `rule.yml` — pinned Prometheus rule (`rule_version: "1"`).
- `seeds/S1.patch`, `seeds/S2.patch` — deterministic seed patches.
- `seed-manifest.md` — what each seed changes.
- `apply-seed.sh`, `reset.sh` — repeatable seed and reset.

## Prerequisites

A pristine clone of `open-telemetry/opentelemetry-demo` at
`2e05c45b85b985a691cc75082c234e8d6ac0b2e9`:

```sh
git clone https://github.com/open-telemetry/opentelemetry-demo.git demo-repo
cd demo-repo
git checkout 2e05c45b85b985a691cc75082c234e8d6ac0b2e9
```

## Preservation test (must pass before any seed)

```sh
# From a directory with simple-card-validator@1.1.0 installed, or use the
# test-runtime image (see below):
node --test src/payment/smoke-behavior.test.js
```

## Apply and reset

```sh
# Apply the overlay + S1 (Run 1)
demo/seeds/apply-seed.sh S1 --repo /path/to/demo-repo

# Apply the overlay + S2 (Run 2)
demo/seeds/apply-seed.sh S2 --repo /path/to/demo-repo

# Reset to pristine upstream (removes overlay + seeds)
demo/seeds/reset.sh --repo /path/to/demo-repo
```

After applying a seed, rebuild the payment image from the seeded source:

```sh
cd /path/to/demo-repo
sg docker -c "docker build -f src/payment/Dockerfile -t payment:seeded ."
```

## Tests against the test-runtime target

```sh
cd /path/to/demo-repo
sg docker -c "docker build -f src/payment/Dockerfile --target test-runtime -t payment-test-runtime ."
sg docker -c "docker run --rm payment-test-runtime node --test card.unit.test.js"
sg docker -c "docker run --rm payment-test-runtime node --test payment.regression.test.js"
```

Expected results:

| State | T3 `card.unit.test.js` | T5 `payment.regression.test.js` |
|---|---|---|
| baseline (overlay, no seed) | pass | pass |
| S1 | fail ("valid Visa accepted" fails) | pass |
| S2 | fail (card-type) | pass (card-type still rejects) |
| S1 repaired (card-type restored) | pass | pass |
| S2 repaired (card-type restored, Luhn still missing) | pass | fail ("Luhn-failing Visa is rejected") |
