# Signal-to-Incident intake

## Decision

Use an OpenTelemetry Collector gateway for Signal intake and enrichment, then use a Prometheus-compatible rule engine and Alertmanager for stateful detection. A small Intake Normalizer turns the Alertmanager webhook into the product's versioned `IncidentTrigger`. The Control Plane accepts that trigger, applies product-level deduplication, stores an immutable evidence snapshot, and starts an Incident Run.

Do not make the Collector the Incident Detector. It should receive, process, and fan out Signals. Rule state, pending periods, firing and resolved state, grouping, and delivery retries belong in the metric rule and notification layer.

```text
services / local Collectors
          | OTLP
          v
product OTel gateway
  | traces -> trace backend
  | metrics + span metrics -> Prometheus-compatible store and ruler
  | logs -> log backend
  |                         |
  |                         v
  |                    Alertmanager
  |                         |
  +-------------------------|------------------+
                            v                  |
                    Intake Normalizer          | query links
                            | IncidentTrigger   |
                            v                  |
                       Control Plane -----------+
```

OpenTelemetry defines the Collector as a receiver, processor, and exporter with fan-out to more than one target. Its gateway pattern gives applications and local Collectors one OTLP endpoint and central policy. This matches the boundary above without tying the product to one telemetry vendor.

## Two supported entry paths

### 1. Product-owned OpenTelemetry setup

This is the default Solution Contract.

1. The product installs or supplies a pinned OpenTelemetry Collector distribution and signed config. Services export OTLP to a local Collector where needed; local Collectors send OTLP over mTLS to a product-managed gateway.
2. The gateway requires `service.name`, adds `deployment.environment.name`, tenant, region, cluster, and product connection IDs as resource data, and rejects or quarantines data that cannot be assigned to one tenant.
3. `memory_limiter`, redaction/filtering, resource processing, batching, and a disk-backed sending queue protect the gateway. Network exporters use bounded retries. Collector health and queue metrics feed a separate intake-health detector.
4. The gateway exports traces, metrics, and logs to configured query backends. Its span-metrics connector derives request count, error count, and latency histograms from traces for one portable detector input.
5. A Prometheus-compatible store holds detection metrics. Its ruler evaluates versioned PromQL rules. Alertmanager groups and retries notifications to the Intake Normalizer.
6. Raw Signals stay in the telemetry backends under the company's retention policy. The Control Plane stores only the trigger, rule/query text, selected values and exemplars, source links, and later Evidence Set additions.

For the full product, the contract is the OTLP receiver plus Prometheus query/rule and Alertmanager webhook interfaces, not a single backend brand. A private install may use the product's managed compatible stack or adapters for the company's approved trace, metric, and log stores. This keeps the Incident workflow fixed while storage can scale or meet local data rules.

### 2. Existing OpenTelemetry connection

Keep the current pipeline and add the product as a second OTLP exporter on the customer's gateway. Collector fan-out gives each exporter a copy. The product gateway then follows the same processing, span-metrics, rule, and trigger path as the first-class setup.

Use a stable `connection_id` and preserve resource identity. Route each metric stream through one writer; do not have two gateway replicas produce the same derived series. If policy forbids copying raw Signals, connect the customer's compatible rule/Alertmanager webhook and query APIs instead. That fallback must pass backend links and read credentials, and it gives the product less control over data quality and rule rollout.

## Demo Profile

Pin the official Astronomy Shop repository to a tested commit. The source snapshot used for this decision is `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` on 2026-08-15.

The official Compose observability layer already supplies the main path:

- services send OTLP to one Collector;
- the Collector exports traces to Jaeger, metrics by OTLP to Prometheus, and logs to OpenSearch;
- its `span_metrics` connector emits `traces_span_metrics_calls_total` and duration histograms;
- Grafana links metric exemplars to Jaeger by `trace_id`, and Jaeger links trace and span IDs to OpenSearch logs.

Add a small Compose overlay, owned by this project, with:

- a small Prometheus config override that adds `rule_files` and the Alertmanager target, plus one mounted rule file;
- Alertmanager;
- the Intake Normalizer;
- the local Control Plane endpoint.

Use the Astronomy Shop `paymentServiceFailure` feature flag for the first saved Demo Run. The official flag makes the Payment service fail calls to `charge`, while the built-in load generator supplies traffic. Keep the rule simple and visible:

```yaml
groups:
  - name: sih-demo
    interval: 15s
    rules:
      - alert: AstronomyShopPaymentErrorRate
        expr: |
          sum(rate(traces_span_metrics_calls_total{
            service_name="payment",status_code="STATUS_CODE_ERROR"
          }[2m]))
          /
          clamp_min(sum(rate(traces_span_metrics_calls_total{
            service_name="payment"
          }[2m])), 0.001) > 0.20
          and
          sum(rate(traces_span_metrics_calls_total{
            service_name="payment"
          }[2m])) > 0.05
        for: 2m
        labels:
          detector_key: payment-error-rate
          service_name: payment
          deployment_environment_name: demo
          severity: critical
        annotations:
          summary: Payment failures exceed 20 percent
```

The traffic guard avoids a ratio based on too few calls. The `for` period avoids one bad request. Before presentation day, run the clean baseline, enable the flag at `/feature`, wait for the rule to fire, let the Incident Run finish, and save the full run. Disable the flag and retain the resolved notification and Watch evidence. The presentation reads the saved run; it does not depend on a live agent workflow.

## Grouping and duplicate handling

Alertmanager groups on `tenant_id`, `deployment_environment_name`, `service_name`, and `detector_key`. It must not group on instance, pod, span, trace, or alert status. Use a 15-second initial wait, a 30-second group interval, and a 30-minute repeat interval in the Demo Profile. Production values are policy settings.

The Intake Normalizer computes:

```text
incident_key = sha256(tenant_id | environment | service_name | detector_key)
delivery_key = sha256(source | alert_fingerprint | status | starts_at | ends_at)
```

The Control Plane enforces a unique `delivery_key`. A firing trigger opens an Incident when no active Incident has the same `incident_key`; later firing triggers append evidence to that Incident. A resolved trigger changes detector state and starts or updates Watch, but it does not erase the Incident. A new firing event after the prior Incident has closed creates a new Incident and records the earlier Incident as related.

This second deduplication layer is required because Alertmanager state can reset, two notifier replicas can deliver the same webhook, and an existing monitoring connection may use different fingerprints.

## Incident Trigger v1

The webhook endpoint is `POST /v1/incident-triggers`. Use mTLS in private installs or an HMAC signature with a timestamp and nonce in the demo. Reject unknown tenants, stale signatures, unsupported schema versions, missing identity fields, and timestamps too far from server time.

```json
{
  "schema_version": "1.0",
  "trigger_id": "01J...",
  "delivery_key": "sha256:...",
  "incident_key": "sha256:...",
  "received_at": "2026-08-15T15:35:20Z",
  "detector": {
    "source": "prometheus-alertmanager",
    "connection_id": "astronomy-shop-local",
    "rule_id": "payment-error-rate",
    "rule_version": "git:abc123",
    "source_fingerprint": "..."
  },
  "state": "firing",
  "severity": "critical",
  "scope": {
    "tenant_id": "demo",
    "deployment_environment_name": "demo",
    "service_name": "payment"
  },
  "window": {
    "starts_at": "2026-08-15T15:33:00Z",
    "ends_at": null,
    "lookback_seconds": 120
  },
  "signal_summary": {
    "name": "payment error ratio",
    "value": 0.84,
    "unit": "1",
    "threshold": 0.20
  },
  "evidence_refs": [
    {
      "kind": "metric-query",
      "backend": "prometheus",
      "uri": "http://localhost:9090/graph?...",
      "query": "sum(rate(...[2m])) / sum(rate(...[2m]))",
      "observed_at": "2026-08-15T15:35:00Z"
    },
    {
      "kind": "trace",
      "backend": "jaeger",
      "uri": "http://localhost:8080/jaeger/ui/trace/<trace_id>",
      "trace_id": "<trace_id>"
    },
    {
      "kind": "log-query",
      "backend": "opensearch",
      "uri": "http://localhost:8080/grafana/explore?...",
      "query": "service.name:payment AND traceId:<trace_id>"
    }
  ]
}
```

The Normalizer queries the metric backend at intake and stores the observed value, query, time range, rule version, and up to three exemplar trace IDs. It creates trace and log links from those exemplars. If no exemplar exists, it creates bounded service-and-time queries and marks them `unresolved`, rather than inventing a trace link. Links are navigation aids; the stored query and value snapshot are the durable first items in the Evidence Set.

## Query and evidence rules

- Metric evidence uses PromQL plus an absolute start and end time. Store the returned value and labels with the link.
- Trace evidence uses `trace_id` when an exemplar exists; otherwise use service, error status, operation, and the trigger window.
- Log evidence uses `trace_id` and `span_id` where present, then service/resource identity and time. OpenTelemetry log records can carry both IDs and resource data, which supports this join.
- Strip secrets and user data from links and snapshots. Use backend link templates instead of accepting arbitrary URLs from the webhook.
- Record backend, connection, query, rule commit, collection time, and retrieval outcome on every Evidence Set item.

## Failure modes and required response

| Failure | Detection and response |
|---|---|
| Collector cannot export | Watch queue size, enqueue failures, send failures, accepted and sent item counts. Use a disk-backed queue and bounded retry; raise a separate intake-health Incident before the queue fills. |
| Collector restarts | Persistent queue resumes pending exports. A full or failed disk can still lose Signals, so expose that fact in the Incident Workspace. |
| Missing or bad resource identity | Quarantine the stream and report setup failure. Never merge `unknown_service` or cross-tenant data into an Incident. |
| Duplicate metric writers | Pin derived series to one writer or route by service. Alert on out-of-order samples and reject a connection that duplicates product and existing exports into the same store. |
| Metric store or ruler is stale | Require a recent successful evaluation timestamp. Mark the detector degraded; do not treat absence of firing as health. |
| Alertmanager or Control Plane is down | Alertmanager retries. The Normalizer and Control Plane use idempotent delivery keys, so retry is safe. |
| Webhook is forged or replayed | Verify mTLS or signature, timestamp, nonce, tenant, and connection. Reject before any Incident Run starts. |
| Cardinality grows without bound | Keep rule and grouping labels to stable resource fields. Never group on trace, span, pod, URL, or raw error text. |
| Exemplar, trace, or log is absent | Keep the metric snapshot as valid evidence, add bounded fallback queries, and show the gap. Do not block Incident creation. |
| Backend retention removes raw data | Preserve the intake snapshot and saved Demo Run. Mark later external links expired rather than hiding the loss. |
| Rule changes while an alert is active | Put the rule version in every trigger. Treat a material identity change as a new `detector_key`; do not silently rewrite prior evidence. |
| Clock skew or delayed data | Use backend evaluation time, preserve event and receive times, allow a bounded late window, and show the delay. |

## Why this fits the SIH rubric

- **Problem and impact:** one explicit path shows how a service failure becomes an Incident instead of calling every error an Incident.
- **Technical excellence:** it joins three OpenTelemetry Signal types through shared resource and trace identity, while deterministic rules and idempotent keys sit outside model judgment.
- **Feasibility and scale:** the Demo Profile reuses the official Astronomy Shop stack. The Solution Contract uses standard OTLP and Prometheus/Alertmanager interfaces, supports a private first-class install, and adds an existing-OTel path without replacing the company's backends.
- **Solution quality and proof:** the saved Demo Run can show the feature flag, raw metric query, fired rule, normalized trigger, trace, linked logs, Incident Run, resolved detector state, and Watch result. These are observable items for the rubric's prototype, architecture, technology choice, and scalability checks.

## Primary evidence

- OpenTelemetry Collector [architecture and fan-out](https://opentelemetry.io/docs/collector/architecture/), [gateway deployment](https://opentelemetry.io/docs/collector/deploy/gateway/), [resilience](https://opentelemetry.io/docs/collector/resiliency/), and [internal health metrics](https://opentelemetry.io/docs/collector/internal-telemetry/).
- OpenTelemetry [resource identity](https://opentelemetry.io/docs/specs/otel/resource/) and [log correlation](https://opentelemetry.io/docs/specs/otel/logs/).
- Astronomy Shop [telemetry features](https://opentelemetry.io/docs/demo/telemetry-features/), [feature flags](https://opentelemetry.io/docs/demo/feature-flags/), and [Docker deployment](https://opentelemetry.io/docs/demo/docker-deployment/).
- Astronomy Shop source at the reviewed commit: [Collector base config](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/otel-collector/otelcol-config.yml), [observability exporters](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/otel-collector/otelcol-config-observability.yml), [Prometheus config](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/prometheus/prometheus-config.yaml), [Compose observability layer](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/compose.observability.yaml), and [Grafana exemplar links](https://github.com/open-telemetry/opentelemetry-demo/blob/2e05c45b85b985a691cc75082c234e8d6ac0b2e9/src/grafana/provisioning/datasources/default.yaml).
