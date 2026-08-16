# Seed manifest

Drives both saved Demo Runs (see `docs/research/demo-runs.md`). One manifest, two
seed commits, one reset path.

## Pin

Astronomy Shop checked out at commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9`
plus the project Compose overlay in `demo/compose/` (Prometheus config override
with `rule_files` and the Alertmanager target, the mounted `sih-demo` rule file,
Alertmanager, the Intake Normalizer, the Control Plane endpoint stub).

## Overlay files (committed to the local demo repository before any seed)

- `src/payment/card.js` — pure `validateCard(number, expirationYear, expirationMonth, currentYear, currentMonth)`
  returning a rejection reason or `null`. Extracted from `charge.js`; behavior-
  preserving (see `smoke-behavior.test.js`).
- `src/payment/charge.js` — refactored to call `validateCard` and throw its reason.
- `src/payment/card.unit.test.js` — T3 suite for the accepted card-type Hypothesis.
- `src/payment/payment.regression.test.js` — T5 scoped regression suite.
- `src/payment/smoke-behavior.test.js` — preservation test (pre-seed gate).
- `src/payment/Dockerfile` — production copy of `card.js` plus a `test-runtime`
  target.

## Seed commits

Authored as separate commits in the local demo repository against the overlay's
`card.js`. The payment image rebuilds from the seeded source.

- **`S1`** (`seeds/S1.patch`, Run 1): the card-type clause drops its negation —
  `if (['visa','mastercard'].includes(cardType)) return "cannot process"`. Every
  valid Visa/MasterCard charge now fails; the `charge` error ratio rises toward
  1.0. The Luhn and expiry clauses are untouched.
- **`S2`** (`seeds/S2.patch`, Run 2): applies on top of `S1`. The same card-type
  inversion **and** the Luhn guard removed — the
  `if (!valid) return 'Credit card info is invalid.';` clause is deleted. The
  card-type inversion drives the Incident; the removed Luhn guard is silent
  (invalid cards are accepted, so no error Signal exposes it).

Apply both: `git apply seeds/S1.patch && git apply seeds/S2.patch`.

## Flag states

`paymentFailure=off`, `paymentUnreachable=off`, `loadGeneratorTraffic=on`,
`loadGeneratorVUs=5` (raise to `25` only if the traffic floor needs it); all other
flags default. The effective k6 concurrency is the flag value, not the script's
`|| 10` fallback. Neither seed touches a flag; the root cause is code.

## Rule file and label validation

`rule.yml` is the pinned rule (alert `AstronomyShopPaymentErrorRate`,
`detector_key: payment-error-rate`, `rule_version: "1"`). Before the first
capture, run the label-validation query against the live store to confirm the
`span_metrics` connector emits `traces_span_metrics_calls_total` with `service_name`
and `status_code` labels (plus `span_name`, `span_kind`, `collector_instance_id`),
and `traces_span_metrics_duration_bucket`. The rule is pinned against these observed
names; `service_version` is not a default connector dimension and is therefore not
used as a matcher.

## Identities

`service.name=payment`, `service.version` set to the image digest,
`deployment.environment.name=demo`, `tenant_id=demo`.

## Policies

Run 1 scheduled hybrid; Run 2 autonomous at all times (moot — ends at Verify);
Repair Mode; Attempt Limit 3.
