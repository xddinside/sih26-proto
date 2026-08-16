# Compose overlay (issue #18)

The Demo Profile Compose overlay for the pinned Astronomy Shop commit
`2e05c45b85b985a691cc75082c234e8d6ac0b2e9`.

## Files

- `docker-compose.override.yaml` — the complete overlay: Prometheus config
  override with `rule_files` and the Alertmanager target, the mounted pinned
  rule file, Alertmanager, the Intake Normalizer, the Control Plane endpoint
  stub.
- `prometheus-config.yaml` — upstream Prometheus config + `rule_files` +
  `alerting`.
- `alertmanager.yml` — grouping per the settled intake path; webhook to the
  Intake Normalizer.
- `rule.yml` (in `../seeds/`) — the pinned detector rule (`rule_version: "1"`).
- `intake-normalizer/` — turns the Alertmanager webhook into an `IncidentTrigger`
  v1 and forwards it to the Control Plane.
- `control-plane/` — placeholder endpoint stub (200 OK + log); the real Control
  Plane is issue #20.
- `docker-compose.reduced.yaml` + `otelcol-reduced.yml` — reduced verification
  profile (see below).

## Run the full shop

```sh
# 1. Clone the pinned shop (not into this repo).
git clone https://github.com/open-telemetry/opentelemetry-demo.git demo-repo
cd demo-repo
git checkout 2e05c45b85b985a691cc75082c234e8d6ac0b2e9

# 2. Layer the overlay and start.
sg docker -c "docker compose -f compose.yaml -f compose.observability.yaml \
    -f /path/to/sih26-proto/demo/compose/docker-compose.override.yaml up"
```

The full shop needs ~6.5 GiB+ RAM (Jaeger, OpenSearch, Grafana, the core
services, and the observability stack). On a low-RAM host, use the reduced
profile below; the committed overlay files above remain the complete overlay.

## Reduced verification profile

```sh
OTEL_DEMO_ROOT=/path/to/opentelemetry-demo \
PAYMENT_IMAGE=ghcr.io/open-telemetry/demo:latest-payment \
sg docker -c "docker compose -f demo/compose/docker-compose.reduced.yaml up"
```

Then drive charge traffic (a gRPC client sending `ChargeRequest` to
`localhost:50051`), and query the observed metric labels to pin the rule:

```sh
curl -s 'http://localhost:9090/api/v1/label/__name__/values' \
  | grep traces_span_metrics
```

## Seeded payment image

Build the seeded image against the upstream source, then point the reduced
profile at it:

```sh
cd /path/to/opentelemetry-demo
# apply overlay + seed, then:
sg docker -c "docker build -f src/payment/Dockerfile -t payment:seeded ."
OTEL_DEMO_ROOT=/path/to/opentelemetry-demo PAYMENT_IMAGE=payment:seeded \
sg docker -c "docker compose -f demo/compose/docker-compose.reduced.yaml up"
```

Reset with `demo/seeds/reset.sh` to return to pristine upstream.
