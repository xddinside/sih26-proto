# Worker isolation and access design

## Decision

The Solution Contract runs each Incident attempt in one short-lived Kubernetes Job Pod with the gVisor `runsc` runtime. The Pod is the Worker. It contains one Pi Orchestrator and the subagents that the Orchestrator starts. The Worker receives a fixed snapshot of the relevant code and Evidence Set, a disposable writable area, and an identity that can call a small set of product-owned brokers. It receives no company, source-control, cloud, or cluster credentials.

Pi is the agent harness, not the security boundary. Pi states that it has no built-in sandbox, that its tools and extensions have the permissions of the Pi process, and that unattended work needs an operating-system or container boundary ([Pi security](https://pi.dev/docs/latest/security)). Pi also warns that a read/write host bind mount lets a contained process change the host. The design therefore copies inputs into the Worker and exports reviewed artifacts; it does not mount a company checkout or Pi home from a trusted host.

The Control Plane owns policy, durable state, and all external side effects. Read Broker, Action Broker, Evidence Journal, Model Gateway, and Release Gate endpoints sit outside the Worker. An in-process Pi extension gives agents stage-specific tools and blocks obvious misuse, but a broker must reject every request that policy does not allow. A prompt injection or faulty extension cannot grant itself more access.

The Demo Profile uses one rootless local Docker container per attempt. It keeps the same custom tool and broker contracts but may implement the brokers as local processes. It has no product time or model-cost cap. This profile proves the workflow without building Kubernetes, gVisor operations, or company identity links.

## Trust boundaries

The system treats repository text, Signals, build output, model output, generated code, and every process inside a Worker as untrusted. It trusts only:

- the signed Worker image and pinned Pi package;
- Control Plane policy and the Release Gate implementation;
- broker-side adapters and their audit log;
- the identity service and external systems that those adapters call.

The Worker image contains the only loaded Pi extensions and skills. Start Pi in non-interactive mode with project trust denied, project resources ignored, and built-in tools disabled. Register narrow read, search, test, patch, evidence, and proposal tools from the image. Pi supports custom tools, active-tool changes, tool-call interception, and replacement of built-in tools ([Pi extensions](https://pi.dev/docs/latest/extensions)). These hooks improve the agent interface and add a second check. They are not a permission boundary because extension code shares the Pi process rights.

Do not install packages or extensions during an Incident Run. Build the image in CI, pin it by digest, scan it, and record its digest with the run. Do not mount the host Docker socket, the default Kubernetes service-account directory, cloud metadata endpoint, host paths, devices, or a user Pi home.

## Solution Contract: Worker shape

The Control Plane creates one Job for each attempt, not for each subagent. The Job has `restartPolicy: Never` and `backoffLimit: 0`; a retry becomes a new attempt with a new identity and journal entry. Set `activeDeadlineSeconds` from the Incident policy and `ttlSecondsAfterFinished` for cleanup. Kubernetes Jobs support automatic cascading cleanup through `ttlSecondsAfterFinished` ([Kubernetes Job TTL](https://kubernetes.io/docs/concepts/workloads/controllers/job/#ttl-mechanism-for-finished-jobs)).

Use a dedicated Worker namespace per company or a stronger cluster split when company policy calls for it. Enforce the Kubernetes Restricted Pod Security Standard: non-root UID, no privilege escalation, all Linux capabilities dropped, a runtime-default seccomp profile, no privileged or host namespaces, and no host-path volumes. The standard defines these controls for lower-trust workloads ([Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)). Add a read-only root filesystem and writable `emptyDir` volumes only for `/workspace`, `/scratch`, `/tmp`, and Pi session output.

Set `runtimeClassName` to the installed gVisor RuntimeClass. gVisor supports Kubernetes through a RuntimeClass and `runsc` ([gVisor Kubernetes setup](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/)). It reduces direct host-kernel exposure, but it is one layer, not a complete boundary: gVisor says mapped files and network remain available and that cgroups and network policy must enforce resource and network limits ([gVisor security model](https://gvisor.dev/docs/architecture_guide/security/)). Keep the Pod hardening, broker checks, and network rules even with gVisor.

Apply CPU, memory, process, and ephemeral-storage requests and limits. The Solution Contract also supports policy values for maximum wall time, model tokens, model cost, concurrent subagents, tool calls, and attempt count. The Control Plane meters model use at the Model Gateway and stops new calls when a run reaches its budget. Kernel and storage limits still protect the platform if model accounting fails.

## Files and broad read access

Broad read access means broad access to Incident-relevant context, not broad access to company systems or secrets.

Before Pi starts, the Control Plane creates a manifest of permitted inputs and populates immutable snapshots:

- the affected repositories, commit history, blame data, and dependency lockfiles;
- the Evidence Set: relevant traces, metrics, logs, security findings, and deployment events;
- redacted configuration, topology, service catalog, runbooks, past related Incidents, approved recovery actions, and current policy;
- CI results, recent deployment diffs, feature-flag state, and the current Recovery Point where one exists.

The Read Broker may fetch more context during a run. Each request includes company, Incident, attempt, stage, resource type, selector, time range, and reason. The broker enforces company scope, field redaction, row and time bounds, and records the query plus a content hash. It returns data, never backend credentials. Reads can stay available through Detect, Diagnose, Repair, Verify, Release, and Watch so agents can test new Hypotheses against evidence.

Mount the input snapshot read-only. Give each analysis subagent its own writable scratch directory. Repair subagents get separate copy-on-write worktrees based on the same commit; the Orchestrator selects and applies a patch into an integration worktree. This prevents concurrent agents from racing on one checkout. Only the integration worktree can become a Remediation artifact.

## Stage and authority rules

Every broker request carries a Control Plane-signed run lease with company, Incident, attempt, current stage, Authority Mode, Automation Policy version, expiry, and allowed tool class. The broker checks the current server-side state as well as the claims; changing a prompt or local stage file has no effect.

| Stage | Worker-local writes | External reads | External writes or production actions |
| --- | --- | --- | --- |
| Detect | Evidence notes only | Signals and service context | None |
| Diagnose | Hypotheses, citations, test plans | All relevant read sources | None |
| Repair | Per-agent worktrees, patch, migration or action plan | All relevant read sources | Submit a proposed diff or action plan to the journal only |
| Verify | Test output and verification report | CI and test context | May request isolated CI or test runs through the broker; cannot merge or deploy |
| Release | Final evidence bundle | Current policy, approvals, target and Recovery Point | May submit a release request; cannot execute it |
| Watch | Watch evidence and outcome | Post-change Signals and deployment state | May propose rollback; only the Action Broker can run an already permitted recovery action |

Authority Mode narrows this table:

- Observe permits reads and an Incident Report only.
- Prepare permits the Action Broker to create or update a Remediation PR after the required checks; it never permits merge or deployment.
- Repair permits only configured classes of merge or deployment after the Release Gate passes.
- Emergency permits only named, pre-approved recovery operations such as rollback, restart, scaling, rerouting, or feature disablement. It does not expose a general production shell.

Code-host writes use a Source Control adapter in the Action Broker. The Worker sends a base commit, patch hash, target repository, and requested operation. The adapter checks branch rules and uses its own scoped installation identity. Cloud, Kubernetes, feature-flag, and deployment operations follow the same typed-command pattern. Do not offer `kubectl`, `ssh`, a cloud CLI, arbitrary HTTP, or a generic production shell to the Worker.

## Narrow release handoff

The Orchestrator ends Verify by sealing a release candidate: Evidence Set references, exact Remediation artifact hash, tests, independent review results, target, Authority Mode, Automation Policy version, and Recovery Point. Any change creates a new candidate hash.

The Release Gate runs outside the Worker and checks required evidence, tests, reviews, approvals, current permissions, target freshness, policy, and recovery conditions. On success it writes a short-lived, one-use release permit bound to the candidate hash, target, exact typed operation, adapter, Incident, and expiry. The Action Broker consumes the permit once, rechecks target state, performs the operation with credentials that never enter the Worker, and writes a receipt. A successful gate does not grant the Orchestrator a credential or a general release tool.

Use an idempotency key for every external action. If the result is unclear after a timeout, record `outcome: unknown`, inspect the target through a read adapter, and reconcile before any retry. Never assume that a failed client call means that the target did nothing.

## Identity, credentials, and secrets

Set `automountServiceAccountToken: false`. Project a short-lived, audience-bound workload token only when broker authentication needs it. Give it no Kubernetes RBAC rights. Kubernetes recommends bounded TokenRequest credentials and notes that deleting the Pod invalidates its bound tokens ([Kubernetes service-account tokens](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/#bound-service-account-token-volume-mechanism)). Exchange that token at the Control Plane for the run lease. Do not put the token or lease in a subagent prompt or model request. The whole Worker remains one trust boundary, so broker policy must stay safe even if any process steals the low-privilege run lease.

Provider keys stay at the Model Gateway. Company integration secrets stay in each broker adapter's secret store. Prefer short-lived credentials and separate secret scope; Kubernetes also warns that Secret list access reveals values and recommends short-lived secrets and limited mounts ([Kubernetes Secrets guidance](https://kubernetes.io/docs/concepts/security/secrets-good-practices/)). If a test truly needs a secret, the broker issues a stage-, test-, and attempt-bound value into a memory-backed mount for one command, masks it from output, then revokes it. The Worker cannot list secrets.

## Network rules

Apply default-deny ingress and egress NetworkPolicies. Kubernetes allows all traffic when no policy selects a namespace, so the default deny must be explicit ([Kubernetes NetworkPolicy defaults](https://kubernetes.io/docs/concepts/services-networking/network-policies/#default-policies)). Allow no inbound connections; the Worker polls or streams out to the Control Plane.

Allow egress only to cluster DNS and fixed internal endpoints for the Control Plane, Read Broker, Action Broker, Evidence Journal, Model Gateway, and approved test services. Route any required public package or documentation fetch through an audited allow-list proxy with size and content limits. Block cloud metadata, company production networks, source-control APIs, arbitrary internet access, and private address ranges from direct Worker access. Use the proxy for host-name rules because standard NetworkPolicy targets Pods, namespaces, ports, and IP blocks rather than domain names.

Each tool declares whether it may use the network. Local search, patching, and most tests run with no network. A build that needs dependencies uses a locked, read-through package cache or the allow-list proxy. Record destination, bytes, result hash, and tool call in the journal.

## Orchestrator and subagents

One Pi process owns the Incident Run and starts bounded subagent Pi processes inside the same Worker. The Orchestrator decides the graph at run time, while the stage contract stays fixed. A normal Diagnose stage can run independent analysts in parallel, followed by a judge comparison, synthesis, and evidence-led follow-up. Repair and review can also use specialist skills.

Subagents share the Worker's isolation, network policy, read snapshot, and budgets. They receive only their task, cited Evidence Set subset, stage tools, and a private scratch or worktree path. They cannot create nested Workers or call brokers except through the Orchestrator's tool service. The Orchestrator caps process count and concurrent model calls, cancels children when their task ends, and records parent-child IDs, prompts, models, token use, tool calls, and results. Model diversity remains a later policy choice; this design does not freeze the graph or provider.

## Durable evidence and recovery from failure

The Worker is disposable and is never the sole store for run state. Before acknowledging a step, the Control Plane appends its stage transition, policy decision, broker request, tool result, model-use record, artifact hash, and external-action receipt to an append-only Incident journal. Store larger inputs and outputs in encrypted, company-scoped object storage and cite them by content hash. Preserve the Pi JSONL session as supporting evidence, but build the Incident Workspace from the journal and sealed artifacts, not from a transcript parser.

On normal completion or cancellation, the Worker uploads pending local test output and patches, closes the journal stream, and exits. On crash, timeout, lost heartbeat, or Control Plane cancellation:

1. The Control Plane marks the attempt interrupted and stops issuing leases.
2. Brokers reject expired or revoked leases and release permits.
3. Kubernetes sends termination, then kills the process tree after a short grace period.
4. The Job and its ephemeral volumes are deleted by the TTL controller; a reaper handles stuck resources.
5. The Control Plane reconciles every action with no final receipt before it starts another attempt.
6. A new attempt receives the last sealed artifacts and journal checkpoint, not a reused writable filesystem or credential.

If cleanup fails, quarantine the Worker namespace, block new Workers there, alert an operator, and retain the journal. Never widen access to recover a stuck run.

## Demo Profile

Run the whole Pi Orchestrator and its subagents in one rootless Docker container per attempt. Pi documents whole-process Docker as its simple local isolation pattern ([Pi containerization](https://pi.dev/docs/latest/containerization)); Docker rootless mode runs both daemon and containers without root privileges ([Docker rootless mode](https://docs.docker.com/engine/security/rootless/)). Use:

- a read-only root filesystem, non-root user, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, [Docker's default seccomp profile](https://docs.docker.com/engine/security/seccomp/), PID and memory bounds, and `--rm`;
- a copied Astronomy Shop checkout and Evidence Set, not a read/write bind mount to the user's source tree;
- a disposable volume for the integration worktree and per-subagent scratch;
- an internal Docker network shared only with local Demo brokers, the saved Astronomy Shop endpoints, and the Model Gateway; no default internet route, host Docker socket, or host Pi home;
- the same stage tools, lease claims, journal schema, release-candidate hash, and broker receipts as the Solution Contract.

The Demo Profile has no automatic wall-time, token, or model-cost budget. It can take as long and spend as much model budget as needed to create strong saved Demo Runs. It still keeps CPU, memory, process, filesystem, network, Authority Mode, Release Gate, Attempt Limit, operator cancel, and cleanup controls; unlimited time and cost must not mean unlimited host or production access. Short-lived credentials may refresh while the container lives.

For the prototype, the Action Broker can target only the local Astronomy Shop and a local or test source repository. Save completed Demo Runs in the same durable format used by the Incident Workspace. The presentation reads those saved records; it does not need a live Worker.

## What the local prototype need not build

The local build does not need:

- Kubernetes Job creation, gVisor node pools, admission policy, namespace tenancy, or a Worker reaper;
- company SSO, workload-identity federation, external secret stores, regional storage, or production compliance controls;
- live adapters for every observability backend, source host, CI system, cloud, cluster, feature-flag service, or deployment system;
- dynamic domain allow-list proxy management, package-cache service, billing, or hard model budgets;
- multi-company scheduling or a production sandbox operations console.

It must still prove one real end-to-end path: ingest Astronomy Shop Signals, start a disposable local Worker, preserve broad read evidence, run independent diagnosis, produce a Remediation, verify it, pass the deterministic Release Gate, apply only a local permitted action through the broker, Watch the result, save the Evidence Set and receipts, and clean up the Worker.

## Acceptance checks

The production design is ready to implement when tests show that:

1. a Diagnose agent cannot write its snapshot or call an external action;
2. a Repair agent can change only its disposable worktree;
3. a forged stage, expired lease, changed candidate hash, replayed permit, or missing approval fails at the broker;
4. the Worker cannot reach source control, production, metadata services, or the public internet directly;
5. no provider, company, cloud, source-control, or cluster credential appears in Worker files, environment, logs, or Pi sessions;
6. parallel subagents cannot overwrite each other's work;
7. a crash before, during, and after an external action yields a durable, reconciled outcome without a blind retry;
8. cleanup removes the Job, processes, volumes, and bound identity while preserving the journal and sealed artifacts;
9. the Demo Profile produces a saved Demo Run with the same stage and evidence contract without requiring production sandbox systems.
