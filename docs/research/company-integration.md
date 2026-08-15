# Company integration and OpenTelemetry setup

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#10](https://github.com/xddinside/sih26-proto/issues/10), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Blocked by (all closed): [#2 incident intake](https://github.com/xddinside/sih26-proto/issues/2), [#3 worker isolation](https://github.com/xddinside/sih26-proto/issues/3), [#4 release, Watch, and recovery](https://github.com/xddinside/sih26-proto/issues/4), [#5 orchestrator stages](https://github.com/xddinside/sih26-proto/issues/5), [#6 Evidence Set and Hypothesis gate](https://github.com/xddinside/sih26-proto/issues/6), [#7 authority and action risk](https://github.com/xddinside/sih26-proto/issues/7)

Prerequisite reports: [incident-intake.md](incident-intake.md), [worker-isolation.md](worker-isolation.md), [release-recovery.md](release-recovery.md), [orchestrator-stages.md](orchestrator-stages.md), [hypothesis-gate.md](hypothesis-gate.md), [authority-action-risk.md](authority-action-risk.md)

Researched: 2026-08-15

## Decision

The product ships as one company-hosted installation: a Helm chart that deploys the Control Plane, Incident Workspace, policy and gate services, brokers, Model Gateway, and the Signal intake stack into the company's own Kubernetes, plus a small bootstrap CLI. The product owns the OpenTelemetry path only where the company has none: it installs the OpenTelemetry Operator for local Collectors and auto-instrumentation, runs its own pinned Collector gateway, and detects Incidents through a Prometheus-compatible ruler and Alertmanager before the Intake Normalizer turns a firing into a signed, duplicate-safe Incident Trigger. Companies that already run OpenTelemetry add one OTLP exporter to their own gateway; a query and webhook adapter covers companies that cannot copy raw Signals. Every connection to the company's repositories, CI/CD, deployment, feature-flag, infrastructure, approval, security-alert, and notification systems is a narrow broker-side adapter with declared scopes, short-lived credentials, webhook signature verification, polling fallback, idempotency keys, and an audit trail. The product never replaces those systems and never receives company credentials inside a Worker. The Demo Profile runs the same contracts entirely on Docker Compose with the pinned Astronomy Shop, real local Signals, a local git repository, a local CI runner, and rootless Docker Workers; it stubs company identity, approval, and notification surfaces behind the same adapter interfaces.

## Exact product shape

The Solution Contract is one concrete system of services, one web surface, one CLI, and two storage kinds. It is not a menu of architectures.

| Component | Runs where | Owns | Trust boundary |
|---|---|---|---|
| **Control Plane** | Product namespace, 2+ replicas | All Incident and Incident Run state; the append-only journal; the Evidence Journal API; run leases and release leases; Worker launching (Kubernetes Job with gVisor in production, rootless Docker in the Demo Profile); serves the Incident Workspace | Trusted product core. Single logical durable state writer, per [orchestrator-stages.md](orchestrator-stages.md) |
| **Incident Workspace** | Served by the Control Plane on the company's internal network | Read-only rendering of journal and sealed artifacts; operator controls (Authority Mode, Automation Policy, approvals, pause, cancel) | Trusted UI surface; authenticated by the company identity provider |
| **Policy Service** | Product namespace, stateless | Deterministic action-risk table, Authority Mode ceiling, Automation Policy windows; OPA Rego rules, versioned and pinned | Trusted product core, per [authority-action-risk.md](authority-action-risk.md) |
| **Release Gate / Action Gate** | Product namespace, separate from brokers | The two non-waivable gate checks: `pass`, `needs-human`, `fail` | Trusted product core |
| **Read Broker** | Product namespace, stateless | All Incident-scoped reads: Signals, code, history, configuration, CI results; enforces company scope, redaction, row and time bounds; returns data, never credentials | Trusted; holds narrow read-scoped adapter identities |
| **Action Broker** | Product namespace, stateless | All external actions through the source-host, CI/CD, deployment, feature-flag, infrastructure, and notification adapters; consumes one-use permits; reconciles unknown outcomes | Trusted; holds narrow write-scoped adapter identities; no approval rights |
| **Model Gateway** | Product namespace | All model calls; provider keys; per-attempt token and cost budgets; redaction profiles before context leaves the company | Trusted; the only path model requests take |
| **Signal Gateway** | Product namespace, 2+ replicas behind a Service | The OTLP intake endpoint; enrichment, identity assignment, redaction, batching, disk-backed queues; fan-out to company backends and the product metric store; span-metrics derivation | Trusted intake boundary; requires mTLS |
| **Metric Store + Ruler** | Product namespace | Detection metrics and span metrics; versioned PromQL rules | Trusted intake boundary |
| **Alertmanager** | Product namespace | Grouping and retried delivery of firing/resolved notifications | Trusted intake boundary |
| **Intake Normalizer** | Product namespace, stateless | Converts Alertmanager webhooks and signed finding webhooks into `IncidentTrigger` v1 records with `incident_key` and `delivery_key` | Trusted intake boundary |
| **`sihctl` CLI** | Operator workstation or CI | Install, upgrade, validate, health check, backup trigger, uninstall, and scriptable operator commands | Trusted; operator-authenticated |
| **PostgreSQL** | Company-managed or chart-provisioned | Journal, Incident and Run state, policy versions, adapter state, per-Incident write leases | Source of truth for journal and state; must survive |
| **Object storage** | Company S3-compatible store | Sealed artifacts by content hash: Incident Briefs, Diagnosis Reports, Remediation Proposals, Verification Reports, Release records, Recovery Points, Watch Reports, Incident Reports | Encrypted, company-scoped; must survive with PostgreSQL |

Trust rules, restated as one list:

- The Worker is untrusted and disposable; it receives broad Incident-scoped reads and no company, source-control, cloud, or cluster credentials, per [worker-isolation.md](worker-isolation.md).
- The Control Plane, Policy Service, and both gates are the trusted product core; only they decide.
- Brokers hold narrow adapter identities and nothing else; every external action passes the Action Gate or Release Gate, per [authority-action-risk.md](authority-action-risk.md).
- Model providers sit outside the company boundary; only redacted, minimal context reaches them through the Model Gateway.
- Company systems are external; adapters hold the smallest token that performs the declared operation, prefer short-lived credentials, and record every call.

The Evidence Journal is a Control Plane-owned append API (its own endpoint, per the Worker egress list), not a separate storage system. The journal lives in PostgreSQL; large payloads live in object storage and are cited by content hash.

## Company deployment package and install flow

The package is one Helm chart, `sih`, distributed as an OCI artifact, plus `sihctl`, one packaged CLI binary. Helm charts are versioned packages of Kubernetes resources, and Helm supports OCI registries for distribution ([Helm charts](https://helm.sh/docs/topics/charts/), [OCI registries](https://helm.sh/docs/topics/registries/)). All chart images are pinned by digest and mirrored into the company's own registry, so a private or air-gapped install never pulls from the public internet.

What the chart deploys, all in one product namespace (`sih-system`) plus a separate Worker namespace:

- the Control Plane (with the Workspace), Policy Service, Release Gate, Action Gate, Read Broker, Action Broker, Model Gateway, and Intake Normalizer as Deployments with probes, resource limits, and NetworkPolicies;
- the Signal Gateway (product-built Collector distribution), Prometheus (metric store and ruler), and Alertmanager, with PersistentVolumeClaims for the metric store and the Collector's disk queue;
- a values-gated OpenTelemetry Operator chart dependency plus the Collector and Instrumentation resources for product-owned onboarding; companies on the existing-OTel path disable this dependency when they already manage a compatible Operator;
- a values-gated bundled PostgreSQL for small installs; companies with a managed PostgreSQL point the chart at it;
- ServiceAccounts per service; no default tokens beyond what each service declares;
- the Worker namespace with Restricted Pod Security Standard, the gVisor RuntimeClass reference, default-deny NetworkPolicies, and RBAC that lets the Control Plane create Jobs, per [worker-isolation.md](worker-isolation.md).

The chart declares prerequisites it does not install: a company identity provider (OIDC) for Workspace login, a secret manager (or plain Kubernetes Secrets for small installs), S3-compatible object storage, and optional cert-manager. Reusing those is what keeps the product from becoming a second platform. The company's own ingress, on-call, chat, monitoring, and backup systems stay in place.

Install flow:

1. The operator runs `sihctl init` against the company config file. It renders the chart values, checks the Kubernetes version and prerequisites, and prints the exact adapter credentials to create: a GitHub App (or GitLab equivalent), a CI token scope, deployment and feature-flag identities, an OIDC client, and a notification webhook secret.
2. `sihctl install` performs `helm install` from the OCI artifact with the company values file, then waits for all probes.
3. `sihctl check` runs the onboarding verification checklist below and prints one row per check with proof.
4. The operator onboards the first environment (namespace labels and one service), then runs the end-to-end fire test.

Upgrades: `helm upgrade` with the same values discipline; a pre-upgrade hook validates the new Signal Gateway config with the Collector's config validation command and the rule files with `promtool test rules` before anything rolls. Database migrations run as a one-shot Job hook before the new Control Plane image starts. Product policy, rule files, and gateway config live in a company git repository, so a failed upgrade restores by `helm rollback` plus config revert. Adapter credentials rotate through the same bootstrap step; nothing silently upgrades a credential scope.

Health: every service exposes readiness and liveness probes; `sihctl status` aggregates them; the intake-health detector from [incident-intake.md](incident-intake.md) watches Collector queues and ruler freshness and raises its own Incident. PostgreSQL and object storage health appear as product health signals, not as secrets to the platform.

Backup: nightly logical PostgreSQL backups to the company's object storage with a documented restore drill, versioning or replicated backup for sealed-artifact storage with its own restore check, plus retention of the config repository. Recovery Point rules for the product's own configuration follow [release-recovery.md](release-recovery.md).

Uninstall: `sihctl uninstall` first disables every adapter and revokes product-issued credentials through the product's supported APIs. For company-owned credentials it cannot revoke — a GitHub App, an OIDC client, a webhook secret — it attempts revocation where the platform API allows and otherwise prints a verified checklist so the operator revokes them by hand. It then runs `helm uninstall` to remove the stateless release resources. PostgreSQL volumes and sealed-artifact storage carry a keep policy; namespace or storage deletion is a separate operator action after export or retention expiry. Raw Signals in company backends, the company's CI history, and its audit logs stay untouched.

## Product-owned OpenTelemetry onboarding

This is the first onboarding path, for a company that is uninstrumented or partly instrumented.

### Local layer: Operator and auto-instrumentation

The product installs the OpenTelemetry Operator, the standard Kubernetes way to manage Collectors and inject auto-instrumentation ([Operator docs](https://opentelemetry.io/docs/platforms/kubernetes/operator/)). Supported workloads (Java, Node.js, Python, .NET, and Go) opt in with one pod annotation (`instrumentation.opentelemetry.io/inject-java`, `-python`, `-nodejs`, `-dotnet`, `-go`), or `inject-sdk` for SDK environment injection only; the Operator documents the per-language behavior and limits ([auto-instrumentation](https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/)). Unsupported or custom workloads use the manual SDK or exporter setup instead: the OTLP exporter pointed at the local Collector plus the required resource attributes below. The Operator also sets resource attributes from pod metadata. In both cases `sihctl check` validates the actual Signal quality and identity before the environment is trusted.

### Local/gateway pattern

The standard layout is a DaemonSet local Collector per node (host metrics plus application OTLP) forwarding to the product Signal Gateway over OTLP with mTLS. Small or simple clusters may skip local Collectors and export straight to the gateway; the gateway contract does not care which. The gateway pattern gives every application one OTLP endpoint and central policy, per [incident-intake.md](incident-intake.md) and the [gateway deployment](https://opentelemetry.io/docs/collector/deploy/gateway/) page.

### Required resource identity

The gateway requires and enforces:

- `service.name`, `service.version`, `service.instance.id` (service identity, needed by the Watch stage's stable/candidate split, per [release-recovery.md](release-recovery.md));
- `deployment.environment.name` (the deployment tier);
- Kubernetes identity from the `k8sattributes` processor: `k8s.namespace.name`, `k8s.pod.name`, and the cluster id;
- a tenant label (`sih.tenant`) on each namespace, stamped by the gateway as `tenant_id`, plus the `connection_id` of this company installation.

Data that cannot be assigned to one tenant is quarantined, never merged into an Incident, per [incident-intake.md](incident-intake.md). The OpenTelemetry resource conventions for services and deployment attributes are the contract ([service conventions](https://opentelemetry.io/docs/specs/semconv/registry/entities/service/), [deployment attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/)).

### Gateway distribution and protection

The Signal Gateway is a product-built Collector distribution pinned by digest, built with the OpenTelemetry Collector Builder from a tested component list — the recommended way to limit components to exactly what the pipeline needs ([ocb](https://opentelemetry.io/docs/collector/extend/ocb/), [configuration best practices](https://opentelemetry.io/docs/security/config-best-practices/)). The pipeline is: OTLP receiver with TLS and client-certificate authentication; `k8sattributes`; `redaction`; `memory_limiter`; `batch`; a disk-backed `sending_queue`; then fan-out — traces and logs to the company's chosen trace and log backends, metrics and derived span metrics to the product Prometheus. The span-metrics connector supplies the portable detector input described in [incident-intake.md](incident-intake.md).

mTLS: the OTLP receiver enforces client certificates. cert-manager issues per-namespace client certificates against the company CA or its own ([cert-manager](https://cert-manager.io/docs/)); air-gapped installs use the company CA directly. The Collector supports TLS and authentication in receiver configuration, and the security guidance says to keep sensitive config out of plain files ([Collector configuration](https://opentelemetry.io/docs/collector/configuration/), [config best practices](https://opentelemetry.io/docs/security/config-best-practices/)).

Redaction: the `redaction` processor deletes attributes not on an allow-list and masks blocked values, so secrets and user data are stripped before any backend sees them ([redaction processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/redactionprocessor)). The redaction config is company-editable, reviewed in git, and validated with every gateway rollout.

### Backends, ruler, Alertmanager

The product supplies Prometheus as the metric store and evaluates versioned PromQL rules from the company's rule repository; Prometheus rules support `for` periods and `expr` in the exact form the Demo Profile already uses ([alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)). Alertmanager groups and retries delivery to the Intake Normalizer, which signs the trigger (HMAC in the Demo Profile, mTLS in private installs), per [incident-intake.md](incident-intake.md). Trace and log backends remain the company's choice: the gateway's exporters are adapter configuration, and the Evidence Set links to the company backends by template.

### Validation and rollout

Before any environment goes live, `sihctl check` proves, in order: Collector config validates; rules pass `promtool test rules` against recorded fixtures; a synthetic OTLP payload sent through the gateway arrives with correct identity and no quarantined data; a synthetic threshold crossing fires the rule, reaches the Intake Normalizer, and creates an Incident in Observe Mode; the Collector health and ruler freshness detectors report healthy. Rollout is per environment by namespace label, starting in Observe Mode, moving to Prepare and then Repair only by operator choice, with rule changes shipped through the same git review as code. Collector health and queue metrics feed the intake-health detector, so a broken pipeline is itself an Incident, per [incident-intake.md](incident-intake.md).

## Existing-OTel onboarding

The second path, for a company that already runs OpenTelemetry.

The company adds one OTLP exporter to its own gateway configuration — a fan-out copy, not a new agent and not a migration. The exporter carries a client certificate issued for this installation and the company-assigned `connection_id`. Collector fan-out gives each exporter a copy of every Signal ([Collector architecture](https://opentelemetry.io/docs/collector/architecture/)). From the product gateway onward, the pipeline is identical to the first path: identity checks, redaction, span metrics, rules, Alertmanager, trigger.

Three rules keep this path safe:

- **No double writing.** The product gateway derives span metrics and detection series once, under this connection. The product never re-exports into the company's backends, and a connection that duplicates existing product and company exports into one store is rejected, per [incident-intake.md](incident-intake.md).
- **Data ownership.** Raw traces and logs stay in the company's backends under the company's retention. The company-hosted product stores what it needs to run Incidents — derived detection metrics and span metrics, triggers, evidence snapshots, backend links, journal state, and sealed artifacts — all inside the company boundary under company retention. The company can cut the exporter and lose only future Incidents; past Incident records stand.
- **Fallback when raw Signals cannot be copied.** Where policy forbids the copy, the company connects its own Prometheus-compatible ruler and Alertmanager webhook to the Intake Normalizer, plus read credentials for the company's metric, trace, and log query APIs to a query adapter. The product then gets less: no gateway enrichment, no redaction guarantee, no exemplar control, slower rule rollout. That loss is declared in the Incident Workspace on every trigger received through this path.

Validation for this path repeats the first path's checklist minus the SDK steps, plus two extra proofs: the `connection_id` appears on every Signal, and no derived series is written twice. The staleness rule from [incident-intake.md](incident-intake.md) applies: a stale ruler is a degraded detector, never silent health.

## Repository, CI/CD, and company system connections

One adapter contract covers every company system, then a table fixes each adapter. The common contract, from [authority-action-risk.md](authority-action-risk.md): every adapter declares its read operations, its write operation classes with default action-risk classes, its idempotency behavior, and its credential needs; a new adapter is denied for unattended use until an operator declares it; a company can tighten a class, never loosen it.

| Adapter | Default target | Read surface | Write surface | Credential and identity | Idempotency |
|---|---|---|---|---|---|
| **Source host** | GitHub App (works on GitHub Enterprise Server for private installs); GitLab group access token equivalent | `contents: read` (code, history, blame, lockfiles), `checks: read`, `deployments: read`, `actions: read`, `security_events: read`, `dependabot_alerts: read`, `metadata: read` | `pull_requests: write` (create or update the Remediation PR only); `checks: write` (request a CI re-run) | Installation token, short-lived; no org, admin, or member rights | `X-GitHub-Delivery` header as the webhook key; typed API calls use per-action keys from [release-recovery.md](release-recovery.md) |
| **CI/CD** | The company's current system (GitHub Actions for the default adapter) | Pipeline state via `check_run`, `check_suite`, `workflow_run` webhooks; artifact digests and provenance from the company registry | Request a re-run or a `workflow_dispatch` with an input pinned to the Release record; nothing else | Narrow installation scope; the runner keeps the deployment credential, per [release-recovery.md](release-recovery.md) | Delivery header for events; the CI system's own run ids for requests |
| **Deployment** | Argo Rollouts where present, else native Kubernetes Deployments with retained revisions | Rollout state, analysis results, current and expected versions | Typed ops only: set stage, promote, abort, rollback to the recorded Recovery Point | Scoped ServiceAccount with RBAC on the target namespace only | Per-action keys plus expected-current-version, per [release-recovery.md](release-recovery.md) |
| **Feature flags** | flagd (real in the Astronomy Shop), vendor flag services by adapter | Current flag state and versions | Typed ops: disable, enable, change percentage | Scoped token per flag scope | Same |
| **Infrastructure** | Company Terraform workspaces | Plan and state identifiers | Submit a plan through the company's CI; no direct provider apply | None held by the product; the CI runner applies | Provider state ids recorded in the Recovery Point |
| **Approval** | GitHub required reviews, branch protection, and deployment environments; company approval tool by adapter | Approval records and human identity | None; the product consumes approvals, it does not grant them | Read scope only | Approval records are one-use, per [authority-action-risk.md](authority-action-risk.md) |
| **Notifications** | Outbound webhook to the company's on-call or chat system (Slack-compatible webhook; pager adapters by vendor) | None | Send a bounded, templated message: `needs-human`, rollback failure, Emergency action taken | One webhook secret, rotated | A dedup key per Incident event; the same key replayed produces no second page |
| **Security alert sources** | GitHub `code_scanning_alert` and `dependabot_alert` webhooks; scanner exports by adapter | Finding payloads | None | Read scope only | Delivery header |
| **Observability backends** | Company trace, log, and metric stores | Query APIs plus link templates | None | Read-only query credentials, separate per backend | Read Broker receipts, per [hypothesis-gate.md](hypothesis-gate.md) |

Webhooks: every inbound webhook verifies its signature first (GitHub signs with HMAC-SHA256 via `X-Hub-Signature-256` and delivers a unique `X-GitHub-Delivery` id ([webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [validating deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries))). The delivery id is the idempotency key at the adapter edge; a replay is a no-op and is logged. Every webhook-bearing adapter also has a bounded polling fallback so a missed delivery (network partition, proxy outage) is recovered, and a webhook backlog is never assumed to be empty. GitHub App permissions are chosen per permission and documented per event ([choosing permissions](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/choosing-permissions-for-a-github-app)); the table above is the maximum the product asks for.

CI/CD boundary, restated: the product triggers or resumes the company's pipeline with a pinned Remediation, consumes native checks and approvals, and records their ids. It does not run the pipeline, own the runner, or hold deployment credentials, per [release-recovery.md](release-recovery.md). Workload identity follows the same pattern the company already trusts: where the company's CI must call the product, it uses GitHub's OIDC to get a short-lived token for the workflow, validated against the product's trust configuration ([GitHub OIDC](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect)). Inside the cluster, each product service runs under its own ServiceAccount; brokers exchange bound, audience-limited tokens for adapter identities, and Kubernetes deletes the token with the Pod ([service account tokens](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/#bound-service-account-token-volume-mechanism)).

Audit: every adapter call records actor, service account, credential scope, request ids, redacted responses, and outcome in the journal, per [authority-action-risk.md](authority-action-risk.md); the external system's own audit record stays the source evidence for what it ran.

## Network paths, tenancy, and data locality

```text
company services -> local Collectors -> Signal Gateway (mTLS)
        -> company trace/log backends            (fan-out, redacted)
        -> product Prometheus -> ruler -> Alertmanager -> Intake Normalizer
        -> Control Plane (PostgreSQL + object storage) -> Incident Workspace (company ingress + IdP)
Control Plane -> Worker (Job + gVisor)          ; Worker -> brokers only, default-deny egress
brokers/adapters -> declared endpoints: source host / CI / deployment / flags /
                    infrastructure / approvals / notifications / observability backends (scoped identities)
Model Gateway -> model providers
Intake Normalizer <- security alert sources, deployment events, existing-OTel fallback (signed webhooks)
```

Tenancy: one installation serves one company. `tenant_id` is the internal partition for teams and environments; cross-tenant reads fail at the Read Broker, and Signals without a tenant are quarantined. Worker namespaces are per company and per attempt, per [worker-isolation.md](worker-isolation.md).

Data locality: everything the product stores lives inside the company boundary. Code snapshots, Evidence Sets, and Signals stay on company systems or company-scoped object storage; the journal never stores secrets or raw sensitive payloads. Approved outbound traffic leaves the boundary only through two doors — model calls through the Model Gateway, and broker/adapters calling declared endpoints (source host, CI, deployment, flag, infrastructure, approval, notification, and observability systems). The Model Gateway applies the model redaction profile; brokers enforce adapter-specific field filters and scoped, short-lived credentials. Workers hold no company credentials and have no arbitrary egress, per [worker-isolation.md](worker-isolation.md). Model calls can be pointed at company-approved endpoints for stricter installs.

Retention: the journal follows a company-set default (90 days); sealed artifacts live until the Incident's retention ends; Recovery Points live through the rollback and backup window; raw Signals follow the company backends' own policy, per [release-recovery.md](release-recovery.md) and [incident-intake.md](incident-intake.md).

Encryption and secrets: all internal traffic is TLS or mTLS; adapter secrets live in the company's secret manager, scoped per adapter; Workers never receive credentials, per [worker-isolation.md](worker-isolation.md). At-rest encryption follows the company's storage policy.

Availability, scaling, backpressure: PostgreSQL and object storage are the two stores that must survive; the company's managed PostgreSQL is the recommended default for the first. The Control Plane runs 2+ replicas while keeping the single durable-writer rule, because every Incident mutation commits inside a PostgreSQL transaction that takes the Incident's write lease — the replica that commits the lease owns the mutation, and the append-only, ordered journal plus idempotency keys make concurrent or replayed writes no-ops. Object storage is content-addressed, so sealing the same artifact twice stores one object. Brokers, gates, the Policy Service, and the Intake Normalizer are stateless and scale horizontally; the Signal Gateway scales horizontally behind the Service with a disk-backed queue and `memory_limiter` for backpressure, per [incident-intake.md](incident-intake.md). Concurrent Workers are bounded per company by policy; excess attempts queue in `queued` state, which the state model already supports.

Regional and private installs: regional Signal Gateways and metric stores are supported with one Control Plane per region or company-wide, chosen at install time; the single-writer rule means one Control Plane owns an Incident, and regional reads route through its brokers. Private or air-gapped installs work because every product image is mirrored and no product component calls home; brokers reach the company's own systems over the company's internal network, and the only external dependency that may need egress is the model provider, which stricter installs point at a company-approved endpoint.

Failure modes and required response:

| Failure | Detection and response |
|---|---|
| Gateway cannot export | Disk queue, bounded retries; intake-health Incident before the queue fills, per [incident-intake.md](incident-intake.md) |
| Ruler or store stale | Detector marked degraded; no silent health |
| Webhook missed or replayed | Signature check first; delivery-id idempotency; bounded polling fallback; replay logged as no-op |
| Source host rate-limited | Exponential backoff with jitter; reads degrade to polling; Incident queue unaffected |
| Approval system unreachable | Deny and retry; no bypass, per [authority-action-risk.md](authority-action-risk.md) |
| Notification system down | Alertmanager-style bounded retries with a dedup key; no duplicate pages |
| PostgreSQL unavailable | Control Plane rejects state writes, pauses new Runs, keeps reads alive; journal replay on recovery |
| Object storage unavailable | Sealed artifacts pause; already-sealed stages resume from journal hashes |
| Model provider unreachable | Stage cannot seal; Run parks `interrupted` or `awaiting-human`, never proceeds on missing evidence |
| Certificate rotation | cert-manager issuance; gateway config validated before rollout; expired client certs are rejected, not silently accepted |
| Operator loses the CLI | Workspace covers every operator action except install/uninstall |

## Security and infrastructure Incidents

Security findings and deployment events enter the same trigger and evidence path without claiming OpenTelemetry replaces a SIEM or a cloud control plane. They take a different intake route than service telemetry, because a raw log cannot be evaluated as a Prometheus rule.

Ordinary service and infrastructure telemetry keeps the OTel path: Signals reach the gateway, metrics and derived span metrics reach the ruler, and PromQL rules fire through Alertmanager into the Intake Normalizer, per [incident-intake.md](incident-intake.md). Security findings and deployment events instead arrive as signed source webhooks (a `code_scanning_alert`, a `dependabot_alert`, a deployment event). The Intake Normalizer accepts these signed finding webhooks and normalizes them directly into `IncidentTrigger` v1, with evidence references pointing back to the SIEM, scanner, or cloud console as the system of record. Optionally a Signal Source adapter also emits a bounded counter of findings into the product metric store, so a count or rate rule — a repeated failed deployment, a run of new critical findings — fires through the ruler and Alertmanager like any other detector.

Both routes produce the same `IncidentTrigger` shape and the same Evidence Set kinds; `security-finding` and `deployment-event` already exist in [hypothesis-gate.md](hypothesis-gate.md). The product consumes forwarded alert events; it does not ingest the SIEM's data lake, run its correlation, or replace its analysts. That boundary is stated in the pitch, not hidden.

## Local dashboard access and CLI versus web

The Control Plane serves the Incident Workspace inside the company network only; the company's own ingress, network policy, and identity provider control who can reach it, and no public exposure exists in the default chart. Roles map from the company IdP to three product roles: viewer (read-only), operator (policy dials, pause, cancel, approvals), and approver (approval decisions; cannot also be the policy editor for the same decision, per the separation-of-duties rule in [authority-action-risk.md](authority-action-risk.md)).

Responsibilities split as follows:

- **CLI (`sihctl`)** owns lifecycle and scriptability: install, upgrade, uninstall, `check`, `status`, backup trigger, config validation, credential bootstrap, and headless operator commands (`pause`, `resume`, `approve`, `deny`) for operators who work in a terminal or CI.
- **Web (Incident Workspace)** owns everything visual and evidential: the Incident list, Evidence Set, Hypothesis gate table, stage history, both gate results, approvals with expiry countdown, Authority Mode and Automation Policy dials, the audit tail, and links into the company's telemetry tools. The Workspace is the presentation surface for saved Demo Runs; the CLI is not.

An operator can run every operator action through either surface except installing the product, which is CLI-only. Approvals work from both.

## Onboarding verification checklist

`sihctl check` proves each item with visible evidence, and each proof has a fixed home in the Incident Workspace or the check output:

1. **Signals arrive with identity.** The Workspace shows live arrival counts per service with `service.name`, `service.version`, `deployment.environment.name`, `tenant_id`, and `connection_id`; zero quarantined data.
2. **Rules work.** `promtool test rules` output on recorded fixtures, kept with the rule version.
3. **End-to-end fire test.** A synthetic threshold crossing appears in the Workspace as a real Incident in Observe Mode with its trigger, snapshots, and links — the same path a production Incident takes.
4. **Repo access works.** The check lists the connected repositories, a sample read receipt, and the permissions actually granted by the installation.
5. **CI state reads.** The check shows the latest pipeline state for a connected repository exactly as the CI adapter sees it.
6. **Remediation PR path works.** In Prepare Mode on the fire-test Incident, the Action Broker creates a draft PR in a test repository, and the receipt appears in the journal; the PR is then closed by the operator.
7. **Gates and approvals work.** The check records one Release Gate run and one Action Gate run, each with its inputs and verdict, and one approval flow through the company's approval system (or the local operator in the Demo Profile).
8. **Rollback adapter works.** On the fire-test target, the deployment adapter records a Recovery Point and executes and reverts one pre-approved reversible action with receipts.
9. **Notifications work.** One test notification arrives in the company's channel with the product's dedup key; a replay of the same key does not deliver.
10. **Health detectors run.** Collector queue, ruler freshness, and product service health all report green.

This list is the observable evidence the rubric's verification table asks for; every row is a screenshot or a journal receipt, not a claim.

## Exact Demo Profile

The Demo Profile runs the full state machine, gate code, journal schema, broker contracts, and adapter interfaces on one machine with Docker Compose. It builds only what saved Astronomy Shop Demo Runs need.

**Resolving the Compose/Kubernetes split.** [incident-intake.md](incident-intake.md) pins the official Astronomy Shop Docker Compose stack; [release-recovery.md](release-recovery.md) assumed a local Kubernetes deployment for its two-step probe ring. This report resolves the split in favor of **Compose everywhere in the Demo Profile**. The Kubernetes-only `failedReadinessProbe` flag is dropped from the demo fault list; `paymentServiceFailure` and the other Compose-available flags remain. The two-step probe ring keeps its exact semantics in Compose terms: stage 1 runs a candidate container of the target service with the candidate image digest on the internal network, receiving synthetic probe traffic while real traffic stays on the stable instance; stage 2 swaps the live Compose service to the candidate digest and runs the full Watch. The Recovery Point records the Compose project file hash, image digests, environment and flag files, and the service configuration before any swap — the same fields, in Compose form. This is a two-step probe ring, not a claim of percentage canary routing, exactly as [release-recovery.md](release-recovery.md) states.

What runs, concretely:

- the official Astronomy Shop at the pinned commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9` with its observability layer (Collector, Prometheus, Jaeger, OpenSearch, Grafana, flagd, load generator), per [incident-intake.md](incident-intake.md);
- the project's Compose overlay: the Prometheus config override with `rule_files` and the Alertmanager target, the mounted `sih-demo` rule file, Alertmanager, the Intake Normalizer, and a local Control Plane endpoint, per [incident-intake.md](incident-intake.md);
- the Control Plane with a local PostgreSQL and a local artifact store (a volume behind the same storage interface the full product uses), serving the Incident Workspace on `localhost`;
- the Policy Service, Release Gate, Action Gate, Model Gateway, and the Read and Action Brokers as local processes or small containers;
- local adapters implementing the same interfaces as the Solution Contract, pointed at local stand-ins: a local bare git repository (source host), a local test runner that runs the demo's build and test commands in an isolated container and reports results in CI-shaped records (CI/CD), the Compose release adapter above (deployment), the real flagd (feature flags), and a local notification sink that writes the same templated, dedup-keyed messages to a file and the Workspace (notifications);
- one rootless Docker container per attempt as the Worker, with the hardening from [worker-isolation.md](worker-isolation.md) and a copy-on-write checkout, never a host bind mount.

What is saved: the complete journal and sealed artifacts for each Demo Run — triggers, Evidence Set with receipts, Hypothesis gate table, Fusion round records, Remediation proposal, verification results, Release or Action Gate result, approvals, Recovery Point, rollout stages, Watch results, and rollback or success receipts — replayed by the Incident Workspace and marked as saved Demo Runs, per [orchestrator-stages.md](orchestrator-stages.md). The two planned runs from [release-recovery.md](release-recovery.md) stand: one verified Remediation and one severe-regression rollback.

What is stubbed behind the same interfaces: company SSO becomes the local operator identity recorded in the journal; company approval systems become Workspace approvals with identical record schema and expiry; notifications become the local sink; CI becomes the local runner; the source host becomes the local repository; Kubernetes Jobs with gVisor become rootless Docker Workers; mTLS becomes HMAC-signed triggers, per [incident-intake.md](incident-intake.md).

What the Demo Profile does not build at all (Solution Contract only): the Helm chart and `sihctl` beyond a thin `demo` wrapper, the GitHub App and GitLab adapters, the OpenTelemetry Operator and auto-instrumentation injection, cert-manager, multi-region gateways, production PostgreSQL and backup pipelines, workload-identity federation, real on-call adapters, and infrastructure adapters.

## Pitch explanation

One line: the product installs inside the company's own network, turns the company's OpenTelemetry Signals into signed Incident Triggers, runs each diagnosis and repair attempt in a short-lived gVisor Worker with broad reads and no credentials, and puts every external action through deterministic gates and the company's own pipelines — so incident response gets fast where it is safe and human where it matters, with every decision replayable in the Incident Workspace.

Judge Q&A, companies without OpenTelemetry:

- *"Where do we start?"* The Operator installs with the product; supported workloads opt in with an annotation, and unsupported or custom workloads use the manual SDK/exporter setup. `sihctl check` validates real Signal quality, rules, and a fire test before anything is trusted.
- *"How long until it pays off?"* Onboarding is phased: instrument a service, prove Signals and rules with `sihctl check`, then move each environment from Observe Mode to Prepare and Repair only as the company approves. Observe Mode permits diagnosis and reporting only, so it holds no Remediation action.
- *"Do we replace our monitoring?"* No. The product adds its gateway and detection layer for Incident work; existing dashboards and backends stay untouched.

Judge Q&A, companies with OpenTelemetry:

- *"We already run Datadog/Tempo/ELK."* The company's gateway adds one OTLP exporter; raw Signals stay in the company's backends, and the Evidence Set links back to them.
- *"Who owns the data?"* The company. Raw traces and logs stay in the company's backends; the product stores its own derived metrics, triggers, evidence snapshots, links, journal state, and sealed artifacts inside the company's boundary; the company can cut the exporter at any time.
- *"What if policy forbids copying raw Signals?"* The fallback connects the company's own ruler, Alertmanager webhook, and query APIs; the product loses enrichment and redaction control and says so on every trigger.
- *"Do you replace our CI/CD, approvals, or on-call?"* No. Brokers with narrow, declared scopes use those systems; the company's checks, reviewers, and deployment environments remain authoritative, per [release-recovery.md](release-recovery.md).

Scale and feasibility: the intake path is standard, horizontally scalable infrastructure (Collector gateway with disk queues, Prometheus, Alertmanager); the state machine serializes attempts per Incident and bounds concurrent Workers per company, so cost grows with Incident volume, not Signal volume. The demo reuses the official Astronomy Shop stack, so the prototype cost is overlay work plus the already-decided contracts. The product does not promise universal adapters: each adapter is declared, tested, and tightened by the company; unknown adapters are denied by default, per [authority-action-risk.md](authority-action-risk.md). Rollback restores service, not every effect, per [release-recovery.md](release-recovery.md).

Edge cases: webhook storms (delivery-id dedup and rate limits), missed webhooks (bounded polling), clock skew (decided in the authority report), enterprise proxies and air gaps (mirrored images, no call-home), GitHub Enterprise Server (GitHub App works on private instances), a company with both paths active (one `connection_id` each; duplicate-writer rejection), and a company that uninstalls mid-Incident (product state retained per policy; company backends unaffected).

## Rejected choices

- **SaaS-hosted Control Plane.** Rejected: raw Signal evidence, code snapshots, and the journal must stay inside the company boundary; a hosted plane would need company data egress and a trust story the pitch does not want.
- **Product ships its own CI/CD or deployment system.** Rejected: duplicates trusted controls and needs broad credentials, per [release-recovery.md](release-recovery.md).
- **A second Prometheus per company environment.** Rejected: one product metric store with tenant labels keeps the install small; regional gateways handle scale later.
- **Requiring the product's trace and log stores.** Rejected: detection needs metrics and span metrics only; trace and log stores stay the company's choice, keeping the install small and the data where the company wants it.
- **Agent-per-node onboarding instead of the Operator.** Rejected: the Operator is the documented, standard mechanism for Collector management and auto-instrumentation injection, and it keeps the product from owning every company deployment.
- **Vendor SDK-first onboarding.** Rejected: Collector-first with OTLP gives one policy point (identity, redaction, fan-out) regardless of language.
- **Ingesting SIEM data wholesale.** Rejected: the product consumes forwarded security findings only, and links back to the SIEM as system of record; it does not replace correlation or analysts.
- **A public dashboard.** Rejected: the Workspace is served inside the company's network with company SSO; exposure is the company's decision through its own controls.
- **A GUI installer or a product console for every adapter.** Rejected: `sihctl` plus the chart plus the checklist is enough; everything else would be a second platform.
- **Demo Profile on Kubernetes (kind).** Rejected: the intake report already pins the Compose observability layer, and rootless Docker Workers are the settled local shape; a kind cluster would duplicate the pipeline the Compose overlay already provides without improving the evidence.

## Acceptance checks

The design is ready to implement when tests show that:

1. the chart installs into a clean cluster, `sihctl check` passes all ten checklist items with recorded proof, and uninstall disables every adapter, revokes product-issued credentials, and prints the verified checklist for company-owned credentials;
2. a Signal without `service.name`, `tenant_id`, or `deployment.environment.name` is quarantined, and a connection that double-writes a derived series is rejected;
3. a replayed webhook delivery is a no-op at the adapter edge, and a missed delivery is recovered by the polling fallback;
4. the gateway config fails closed: an invalid config or rule file never reaches a rollout, and an expired client certificate is rejected;
5. the source-host adapter cannot act outside its declared permissions (a permission change shows as a journaled denial, not silent success);
6. the existing-OTel fallback path marks every trigger with its data-quality loss, and cutting the exporter leaves all stored Incident records intact while only future Incidents stop arriving;
7. the Demo Profile runs the full intake-to-Workspace path on Compose, produces the two saved Demo Runs, and the probe ring and Recovery Point behave exactly as specified in Compose form;
8. the notification adapter deduplicates by key, and the approval adapter can never grant an approval the company system did not record;
9. the Worker has no direct company credentials and no arbitrary egress, and every product component's outbound traffic leaves only through the Model Gateway or a scoped broker/adapter to a declared endpoint; no undeclared egress exists;
10. a company without OpenTelemetry can reach a saved, replayable Incident starting only from the Operator and `sihctl check`.

## Primary evidence

All sources verified 2026-08-15.

- OpenTelemetry: [Operator for Kubernetes](https://opentelemetry.io/docs/platforms/kubernetes/operator/), [auto-instrumentation](https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/), [Collector for Kubernetes](https://opentelemetry.io/docs/platforms/kubernetes/collector/), [gateway deployment](https://opentelemetry.io/docs/collector/deploy/gateway/), [architecture and fan-out](https://opentelemetry.io/docs/collector/architecture/), [resiliency](https://opentelemetry.io/docs/collector/resiliency/), [configuration and certificates](https://opentelemetry.io/docs/collector/configuration/), [configuration best practices](https://opentelemetry.io/docs/security/config-best-practices/), [OpenTelemetry Collector Builder](https://opentelemetry.io/docs/collector/extend/ocb/), [redaction processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/redactionprocessor), [service conventions](https://opentelemetry.io/docs/specs/semconv/registry/entities/service/), [deployment attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/), [resource identity](https://opentelemetry.io/docs/specs/otel/resource/), [Astronomy Shop Docker deployment](https://opentelemetry.io/docs/demo/docker-deployment/), [feature flags](https://opentelemetry.io/docs/demo/feature-flags/).
- Helm: [charts](https://helm.sh/docs/topics/charts/), [OCI registries](https://helm.sh/docs/topics/registries/).
- GitHub: [webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) (delivery headers, `X-Hub-Signature-256`, `code_scanning_alert`, `deployment_status`), [validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/choosing-permissions-for-a-github-app), [Actions OIDC](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect), plus deployment environments and pull-request reviews already cited in [release-recovery.md](release-recovery.md).
- Prometheus: [alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/), [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/).
- cert-manager [documentation](https://cert-manager.io/docs/).
- Kubernetes and gVisor evidence as cited in [worker-isolation.md](worker-isolation.md), including [bound service account tokens](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/#bound-service-account-token-volume-mechanism), [gVisor on Kubernetes](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/), and [Pi security](https://pi.dev/docs/latest/security).
- The six prerequisite reports cited inline above, and the binding language in [CONTEXT.md](../../CONTEXT.md).
