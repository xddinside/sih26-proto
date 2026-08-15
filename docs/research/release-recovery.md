# Release, Watch, and recovery design

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#4](https://github.com/xddinside/sih26-proto/issues/4)

Researched: 2026-08-15

## Decision

The Control Plane must not become a second CI/CD system. It submits a pinned Remediation to the company's current pipeline through a release adapter, waits for that system's checks and approvals, and controls promotion through a fixed Release Gate. The same adapter reads release state and can request a pre-recorded rollback. It never gets a general production shell.

Every production release starts with a Recovery Point and a staged rollout. The Watch stage compares the candidate with the pre-release baseline and fixed service limits. A severe regression stops promotion and starts the recorded rollback at once when policy permits it. Rollback restores service; it does not prove the Remediation correct. The Incident remains open for a new, safe attempt.

The local Demo Profile keeps this contract but narrows its adapters. It uses a local Kubernetes deployment of the OpenTelemetry Astronomy Shop, a candidate instance that receives synthetic probe traffic, local Prometheus and trace/log evidence, and saved Demo Runs. It does not need a live agent run, company CI/CD connection, service mesh, or production credential system.

## Common contract

### Release record

The Control Plane creates one immutable Release record for each proposed deployment. It contains:

- Incident, Incident Run, attempt, Remediation, repository, commit, and PR identifiers;
- artifact digest, build job, build inputs, and provenance result when the pipeline supplies them;
- target company, environment, services, regions, and expected current version;
- Authority Mode, Automation Policy version, action-risk class, and approvals;
- Release Gate inputs and result;
- Recovery Point identifier;
- rollout plan, Watch plan, stop rules, and rollback action;
- adapter request identifiers and the CI/CD or deployment system's own release identifiers;
- each state change, actor, time, reason, and evidence link.

The artifact digest, not a mutable tag, identifies the release unit. Build provenance should link that artifact to its source and build process. SLSA defines provenance as verifiable information about where, when, and how an artifact was produced, and its verification guide requires matching the attestation subject to the artifact digest ([SLSA provenance](https://slsa.dev/spec/v1.2/provenance), [SLSA verification](https://slsa.dev/spec/v1.2/verifying-artifacts)). A company may keep its current provenance format; the adapter records the result rather than forcing a new build service.

### Release Gate

The Release Gate runs outside the Orchestrator and cannot be waived by a model. It returns `pass`, `fail`, or `needs-human`. A pass requires all of these facts:

1. The Remediation and artifact match the reviewed commit.
2. Required CI, security, code, regression, and end-to-end checks passed in the company's existing system.
3. The target still runs the version named by the release request. A changed target makes the request stale.
4. The action fits the active Authority Mode and Automation Policy.
5. The rollout and Watch plans contain fixed queries, limits, windows, minimum sample counts, and missing-data rules.
6. A tested Recovery Point covers every changed surface, or the uncovered surface has human approval.
7. No irreversible or barred action appears in the change set.
8. The company pipeline's own branch, environment, change-management, and approval rules passed.

Existing controls remain in force. For example, GitHub Actions environments can require reviewers, restrict deployment branches, delay jobs, and use an observability system in a deployment protection rule ([GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)). The Control Plane consumes those results; it does not copy or bypass them.

### Staged release

The adapter uses the company's existing progressive-delivery method when one exists: canary weights, deployment rings, blue-green preview, or an equivalent staged plan. A normal canary starts with a small cohort, then grows through company-set steps such as 5%, 25%, 50%, and 100%. Each step has a minimum time and sample count. Time alone never causes promotion.

Each step follows the same loop:

1. Confirm the release lease and expected current version.
2. Send the desired stage to the release system.
3. Wait for that system to report a settled deployment.
4. Run the Watch gates for the stage window.
5. Promote only on a pass. Pause on `needs-human`. Stop or roll back on failure.

If the target cannot split traffic, the adapter may use one host, one zone, one tenant ring, or a preview target with representative synthetic traffic. If none gives useful isolation, production release needs human review. The system must not label an all-at-once release as a canary.

Argo Rollouts shows the required shape without becoming a product dependency: it supports metric analysis during a canary, can require repeated success, treats some results as inconclusive for human judgment, and falls back to the stable version after an abort ([analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/), [abort and stable fallback](https://argo-rollouts.readthedocs.io/en/stable/getting-started/)). Other adapters must preserve the same stage outcomes.

## Watch design

### Signal gates

The Release Gate freezes the Watch plan before release. The Orchestrator may propose queries, but a policy service validates them against the service catalog and approved limits. A model cannot relax a limit during rollout.

Each stage checks:

- **deployment health:** ready instances, crash loops, restarts, rollout status, and dependency reachability;
- **service health:** request success, error rate, latency, throughput, and saturation;
- **Incident symptom:** the Signal that opened the Incident must improve or disappear;
- **regression sentinels:** no new high-severity error, security finding, or failing critical path;
- **business and data rules:** company-set checks such as no duplicate charge, lost order, corrupt write, or queue loss;
- **telemetry health:** expected traces, metrics, and logs still arrive. Missing candidate data cannot count as health.

Each result records its query, source, candidate and baseline cohort, time range, sample count, value, limit, and source response identifier. Candidate data must carry a stable version or deployment identity. OpenTelemetry defines `service.name` and `service.version`, and defines `deployment.environment.name` for the deployment tier ([service conventions](https://opentelemetry.io/docs/specs/semconv/registry/entities/service/), [deployment attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/)). These fields let the Watch stage separate candidate, stable, and environment data. A company adapter may map equivalent fields from its backend.

Health needs both an absolute limit and a baseline comparison where a baseline exists. This prevents promotion when both versions are bad, or when a quiet canary appears healthy only because it received little traffic. Counter rates must use correct time windows and account for restarts and gaps; OpenTelemetry's metric model gives data points explicit time ranges and describes resets and gaps ([metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)).

The product keeps watching after 100% promotion for a company-set confirmation window. It then marks the release healthy but continues a lower-cost extended Watch for delayed harm. A later matching regression reopens the Incident or creates a linked Incident. The Recovery Point stays retained through the company's rollback and backup window.

### Outcomes

- `pass`: all required gates have enough data and pass.
- `fail`: a fixed stop rule fails.
- `needs-human`: evidence conflicts, data is missing, a query fails beyond its limit, a result falls between pass and fail limits, or policy requires review.

No data is not a pass. A failed observability backend pauses promotion. If the current candidate already causes severe harm, the system rolls back first and reviews the missing evidence after service is safe.

## Recovery Point and rollback

### Recovery Point

The adapter records and validates the Recovery Point before the first production mutation. It contains, where relevant:

- prior source revision, artifact digest, image digest, and deployment revision;
- prior manifests, release values, runtime configuration, and feature-flag versions;
- prior traffic routes, scaling values, regions, and service topology;
- prior infrastructure state or plan plus provider state identifiers;
- database schema version, migration direction, compatible application version, backup identifier, and restore-drill result;
- external dependency and policy versions affected by the release;
- exact rollback commands or API requests, their order, expected preconditions, and timeout;
- retention deadline and the identities allowed to run the rollback;
- a validation result that the referenced artifacts, revisions, and backups still exist.

Kubernetes keeps Deployment revisions in ReplicaSets and can roll a Deployment back to a chosen revision, but that revision covers Pod-template changes, not every state change ([Kubernetes Deployment rollback](https://kubernetes.io/docs/tasks/run-application/update-deployment-rolling/), [Deployment limits](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)). The Recovery Point therefore records configuration, flags, infrastructure, and data separately. It is a recovery plan, not a promise of perfect reversal.

### Severe regression and fast rollback

A severe regression is a policy-set condition that calls for immediate harm reduction. It includes a new data-integrity or security failure, breach of a critical availability limit, loss of a critical dependency, repeated crashes or readiness loss, a material worsening of the Incident, or violation of a company business invariant.

When one occurs, the Control Plane:

1. freezes promotion and new releases to the target;
2. stores the triggering Signals and gate result;
3. verifies that the target still matches the failed release;
4. runs the Recovery Point's pre-approved rollback action;
5. watches the restored version against recovery gates;
6. keeps the Incident open and records whether rollback restored service;
7. pages a human if rollback fails, recovery evidence is unclear, or an irreversible effect remains.

This path does not wait for fresh model judgment. Repair or Emergency Mode may run a pre-approved, reversible rollback automatically. Observe and Prepare Mode cannot mutate production. A company may still require a human for every production action through its Automation Policy.

Rollback success means the prior operating state returned and recovery gates passed. It does not erase a leaked secret, reverse a sent email or completed payment, restore deleted data without a valid backup, or prove that a database downgrade is safe.

### Safe follow-up repair

After rollback, the failed candidate cannot be promoted again. The Orchestrator adds the candidate Signals, gate results, rollback results, and code or configuration difference to the Evidence Set. If the Attempt Limit permits, it starts a new attempt with a new Remediation and Release record. The new attempt must pass every review, test, Recovery Point, Release Gate, and Watch check again. A severe regression never triggers an unreviewed roll-forward.

## Idempotency, concurrency, and audit

Only one release lease may mutate a target service and environment at a time. Each action uses an idempotency key made from the Incident Run, Remediation digest, environment, stage, and action. The adapter stores the desired state before calling the provider, stores the provider request ID, and reconciles provider state after a timeout. A repeated request returns the prior result or continues reconciliation; it does not create another deployment or rollback.

All mutations use an expected-current-version check. If a person or another pipeline changes the target, the action stops as stale and needs review. Rollback names the failed Release and its Recovery Point, not merely “previous,” because another deployment may have changed what previous means.

The append-only audit journal records proposals, policy results, approvals, leases, adapter calls, provider IDs, redacted responses, Signals, Watch queries, state changes, errors, rollback work, and human overrides. It identifies the human, service account, Worker, Orchestrator, policy version, and credential scope involved. Secrets and raw sensitive payloads stay out of the journal; it stores references and hashes where needed. Company CI/CD and cloud audit records remain the source evidence for actions they ran.

## Irreversible actions and human boundary

The Control Plane classifies changed surfaces before release. Autonomous release stops and human review becomes mandatory when any of these apply:

- no complete and tested Recovery Point exists;
- a destructive or backward-incompatible data migration is required;
- the action can delete data, destroy an unbacked resource, complete or refund a payment, send an external message, publish data, or cause another lasting external effect;
- a secret or private data may have escaped; rollback cannot make that exposure un-happen;
- the change widens public access, identity rights, network trust, or production credential scope;
- the adapter, target, or action class has not been approved for unattended use;
- the blast radius exceeds company policy, including an all-at-once release without useful isolation;
- required Signals are absent or conflict, a gate is inconclusive, or a human-owned company approval remains;
- rollback fails, restores only part of the state, or itself needs an unsafe action;
- the expected current state changed outside this Incident Run.

For these cases, the system may still take a pre-approved Emergency action that only contains harm: stop traffic, disable a feature, revoke a credential, isolate a workload, or scale a failing component down. It must preserve evidence and ask a human to decide the lasting repair. Emergency Mode does not permit new code, destructive cleanup, or wider access.

## Solution Contract

The company installs adapters for its source host, CI system, artifact store, deployment system, observability backends, feature flags, infrastructure control, and approval service. Each adapter declares read operations, staged-release support, reversible action classes, idempotency behavior, and credential needs. The company maps services to approved Watch plans and severe-regression rules.

The release adapter triggers or resumes the existing pipeline with the pinned Release record. It consumes native checks, deployment states, approvals, and audit identifiers. It must not import production secrets into a Worker. The long-running Control Plane holds only the narrow broker rights needed to request an approved action; the company's runner or deployment controller keeps the deployment credential.

The first supported production slice should be a Kubernetes service with an existing CI build and either a canary controller or a preview ring. A plain Kubernetes adapter may use a retained Deployment revision for application rollback, but production support must also cover the other changed surfaces in the Recovery Point. Later adapters can add feature flags, infrastructure plans, database migration tools, and other release systems without changing the common state machine.

## Astronomy Shop Demo Profile

The demo uses the OpenTelemetry Astronomy Shop on a local Kubernetes cluster through its published Helm path. The project already includes Prometheus metrics, traces, logs, a load generator, and controllable failures. Current feature flags include `paymentServiceUnreachable`, `productCatalogFailure`, `emailMemoryLeak`, `kafkaQueueProblems`, `imageSlowLoad`, and the Kubernetes-only `failedReadinessProbe` ([Demo docs](https://opentelemetry.io/docs/demo/), [feature flags](https://opentelemetry.io/docs/demo/feature-flags/), [telemetry features](https://opentelemetry.io/docs/demo/telemetry-features/)).

The local release adapter supports only these actions:

- apply a pinned local manifest or image digest to one candidate instance;
- send synthetic probe traffic to the candidate;
- switch the local Service to the candidate after its gates pass;
- restore the saved manifest, image, configuration, feature-flag file, and Service selector;
- read Kubernetes state and the demo's local Signal stores.

This is a two-step probe ring, not a claim of percentage-based production canary routing. Stage 1 keeps normal local traffic on the stable instance while the candidate gets representative synthetic requests. Stage 2 switches local traffic, then runs the full Watch. The saved record uses short windows and three consecutive healthy samples so it fits local traffic, while the Solution Contract leaves production windows to each company's SLO and volume.

Before each run, the demo saves the Git commit or manifest hash, image digests, Helm values, feature-flag configuration, workload revisions, and Service selector as its Recovery Point. Its fixed gates cover readiness, error rate, latency, the injected Incident symptom, the affected service trace, and telemetry arrival. The local adapter uses the same idempotency key, expected-version check, release lease, state machine, and audit fields as the full product.

Prepare at least two real Demo Runs before presentation day:

1. a candidate that passes the probe ring and full Watch, showing the Incident Signal fall and the release become healthy;
2. a candidate that causes a severe readiness or error regression, showing automatic rollback, recovery Signals, and a blocked follow-up release.

The Incident Workspace replays these saved records. It must mark them as saved Demo Runs and show source evidence, not imply that agents or production integrations run live. The demo does not need GitHub Actions, a company approval system, a service mesh, a cloud backup service, or general infrastructure adapters. It proves the shared contracts with local tools.

## Required Incident Workspace evidence

For each release, show:

- reviewed commit and artifact or manifest digest;
- Release Gate checks and Authority Mode decision;
- Recovery Point contents and validation time;
- rollout stages and current stable/candidate identity;
- every Watch gate with baseline, candidate, limit, window, and sample count;
- the exact Signal that caused a stop or rollback;
- rollback actions and post-rollback recovery result;
- linked follow-up attempt or final Incident Report;
- human approvals, overrides, and irreversible effects in a distinct section.

This evidence supports the hackathon rule that judges should reward observed proof rather than claims.

## Rejected choices

- **Replace company CI/CD:** rejected because it duplicates trusted controls and requires broad credentials.
- **Let the Orchestrator decide release health:** rejected because a model could change thresholds or accept weak evidence.
- **Treat a Git revert as the Recovery Point:** rejected because it omits deployment, configuration, flags, infrastructure, and data.
- **Always roll forward after a bad release:** rejected because severe harm calls for a known recovery action before a new attempt.
- **Always require human approval:** rejected because it would make Repair and Emergency Mode meaningless for pre-approved reversible actions.
- **Promise that rollback reverses every effect:** rejected because some data, security, payment, and communication effects last after code restoration.
