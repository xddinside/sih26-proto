# Authority Modes, Automation Policies, and action risk

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#7](https://github.com/xddinside/sih26-proto/issues/7)

Researched: 2026-08-15

## Decision

An action is permitted when it passes seven checks in a fixed order. Two of them are user dials: the **Authority Mode** caps what the system may do, and the **Automation Policy** decides when a human must approve it. The third input, the **action-risk class** (a fixed, deterministic table plus per-adapter declarations), decides what is safe alone, what needs a human's approval, and what the product never executes. Four of them are machine controls that no user setting, model, or approval can waive: the stage contract, the action and release gates, the broker checks, and the barred-action list.

The system defaults to deny. Unknown actions, new adapters, missing evidence, failed Recovery Points, stale targets, and unavailable approval systems all stop the action. Irreversible, destructive, severe, weakly recoverable, or barred changes need a human under every mode and every policy. Emergency Mode is a narrow, per-service allow-list of pre-approved harm reduction; it is not admin access.

## Relationship and precedence

The Orchestrator may propose work, but only the Control Plane decides. Every external action request moves through this exact order:

```text
Worker stage contract (can this stage act at all?)
   -> barred action or barred-list entry?              STOP: the product never executes it
   -> Authority Mode ceiling (verb allowed?)           STOP: mode does not permit it
   -> Automation Policy (autonomous now?)              if not: queue a human approval
   -> approval record (fresh, unexpired, matching)     STOP: no valid approval
   -> Action Gate (direct operations) or Release Gate (merge and deploy)   pass / needs-human / fail
   -> Action Broker checks (lease, permit, idempotency, expected version, adapter list)
   -> execute, receipt, audit
```

Precedence resolves conflicts as follows:

1. **Safety rules beat user dials.** The barred list, the action and release gates, and broker checks always win. A user cannot pick an Authority Mode or Automation Policy that makes a barred action run, and no approval record overrides a failed gate or a stale target.
2. **Authority Mode beats Automation Policy.** The Mode is the ceiling; the Policy only decides which actions under the ceiling wait for a human. Observe Mode mutates nothing even under an always-autonomous policy.
3. **Action-risk class beats Automation Policy.** Class `guarded` actions need a recorded human approval under every policy, including always-autonomous and scheduled-hybrid windows; after that approval the broker executes them. Class `barred` actions the product never executes; a human acts outside the product.
4. **Emergency allow-list membership is a standing, recorded operator approval** for one named action on one service, never a `barred` one. It satisfies the `guarded` approval requirement for that named action, and the action still passes the action gate and every broker check.
5. **Later checks re-verify earlier facts.** The broker re-reads server-side state and re-evaluates policy at execution time. A Worker, a prompt, or a stale local file cannot claim a permission the Control Plane does not hold.

The evaluation is a pure function of (action, target, stage, Mode, policy version, tzdb version, clock, evidence state, approval state). The same inputs give the same verdict every time. The policy service implements this in the Open Policy Agent policy language: Rego is declarative and data-driven, and its rules are testable as code; the product adds its own versioning and pinning on top ([OPA policy language](https://www.openpolicyagent.org/docs/latest/policy-language/)).

### The three risk classes

| Class | Meaning | Human requirement | Example |
|---|---|---|---|
| `safe` | Reversible, tested Recovery Point covers every changed surface, bounded blast radius, idempotent, adapter approved for unattended use | None beyond the active policy | Config change under a tested Recovery Point, bounded scale-up, restart, canary stage promotion |
| `guarded` | Weakly recoverable, severe, broad blast radius, an uncovered surface in the Recovery Point, or an all-at-once release without isolation | A recorded human approval in every policy and every mode; after approval the broker executes | Data migration without a restore drill, all-at-once production release, rollback that needs an unsafe step |
| `barred` | Irreversible, destructive, or otherwise on the fixed barred list | The product never executes it; a human acts outside the product while the system records the handoff | Delete data, destroy an unbacked resource, send an external message, refund a payment, widen access |

The class table is fixed product code plus declarative adapter entries. A model never computes a risk score. A company can move an action from `safe` to `guarded` or `barred`, and never the other way, without a product change.

### Action Gate and Release Gate

Two deterministic gates sit outside the Orchestrator and outside the Worker. Neither can be waived by a model.

- **Release Gate** gates merge and deploy through the release adapter, exactly as the release design settled: artifact and reviewed commit match, required CI and security checks pass, the target still runs the expected version, the action fits Mode and Policy, the rollout and Watch plans are fixed, a tested Recovery Point covers every changed surface or the uncovered surface has human approval, and no barred action appears in the change set.
- **Action Gate** gates direct operational Remediations that do not flow through the release adapter: configuration, feature-flag, restart, scaling, traffic, and infrastructure changes. It checks the same facts in operational form: the typed command matches an approved adapter and action class, the target still runs the expected version, the action fits Mode and Policy, a tested Recovery Point covers every changed surface or the uncovered surface has human approval, the stop and Watch conditions are fixed and deterministic, and no barred action appears.

Both return `pass`, `needs-human`, or `fail`, and both run before the broker. A direct operation cannot skip its Action Gate any more than a release can skip its Release Gate.

## Action taxonomy

Each category has a default class and default rollback behavior. Adapter declarations and company policy may tighten these, not loosen them.

| Category | Typical actions | Default class | Rollback honesty |
|---|---|---|---|
| Code | Patch, Remediation PR, merge | `safe` to propose and prepare; the merge and deploy follow the Release Gate | Git revert undoes source, not deployment; the Release record's Recovery Point covers the rest |
| Configuration | Helm values, runtime config, environment variables | `safe` with a tested Recovery Point, else `guarded` | Prior values must be recorded in the Recovery Point |
| Feature flags | Disable a flag, enable a flag, change rollout percentage | Disable: `safe`; enable or widen: `guarded` | Flag off restores behavior only if code and config match the recorded prior state |
| Deployments | Staged release of a pinned artifact | `safe` with a canary or preview ring and tested Recovery Point; all-at-once production release is `guarded` | Prior artifact digest and Deployment revision; Kubernetes Deployment rollback covers pod templates, not every surface ([Deployment rollback](https://kubernetes.io/docs/tasks/run-application/update-deployment-rolling/)) |
| Restarts | Restart a Deployment, restart a workload | `safe` | Reversible but briefly disruptive; bounded to once per attempt by default |
| Scaling | Scale up, scale down | Scale up: `safe`; scale down below the company-set redundancy floor: `guarded` | Prior replica counts in the Recovery Point |
| Traffic | Reroute, drain, blue-green switch, shrink a canary stage | `safe` with prior routes recorded | Routes restore from the saved route table |
| Infrastructure | Apply a plan, change a provider resource | `safe` only with provider state identifiers and a saved plan; creating or removing long-lived resources: `guarded`; destroying an unbacked resource: `barred` | Terraform-style state helps; some resources are one-way when destroyed |
| Database and data | Run a migration, backfill, read-only query | Read: `safe`; migration with a tested down path and backup restore drill: `guarded`; destructive migration, backfill that mutates, delete rows: `barred` | A downgrade is only safe when the drill proved it; deleted data without a valid backup does not come back |
| Credentials | Issue a short-lived scoped credential, rotate, revoke | Issue: `safe`; rotate: `guarded` (a half-failed rotation can strand services); revoke: `guarded`, and a named, pre-identified credential may be pre-approved into the Emergency allow-list | A revoked or rotated credential is dead; issuing a new one is a new action, not an undo |
| Security containment | Quarantine a workload, isolate a namespace, block a route | `safe` | Reverses by removing the quarantine |
| Messages and payments | Send a message, publish data, refund or complete a payment | `barred` | External effects last; rollback cannot un-send, un-refund, or un-publish |
| Destructive operations | Delete resources, force-delete pods, purge a queue, drop a table | `barred` | No recovery without a verified backup and restore drill, and even then it is `barred` for autonomous use |

The report states this plainly: restarts, scaling, traffic shifts, quarantine, and flag disables are reversible and safe. Credential changes, data migrations, and infrastructure changes are only partially reversible and stay `guarded` or `barred` unless the company proves otherwise with a tested Recovery Point. Messages, payments, data deletion, and access widening never reverse, never run without a human, and the `barred` ones the product never executes.

## What each Authority Mode may do

| Verb | Observe | Prepare | Repair | Emergency |
|---|---|---|---|---|
| Diagnose | Yes | Yes | Yes | No fresh model diagnosis; it checks current deterministic stop and precondition Signals |
| Propose | No; the Incident Report holds findings | Yes | Yes | No new proposals |
| Prepare (Remediation PR or action plan) | No | Yes, after required checks | Yes | No |
| Merge and deploy | No | No | Yes, `safe` and `guarded` classes after the Release Gate passes | No new code or releases |
| Execute an action directly | No | No | Safe and guarded typed operations through the Action Broker after the Action Gate passes | Yes, allow-list only |
| Roll back | No | No | Yes, pre-approved and reversible, per policy | Yes, pre-approved Recovery Points |

- **Observe** permits reads and the Incident Report only. It exists so a company can turn on diagnosis with zero mutation risk.
- **Prepare** ends at a merge-ready Remediation PR. Nothing merges or deploys, no matter what the Automation Policy says.
- **Repair** permits merge and deploy of approved classes after the Release Gate passes, and permits safe and guarded typed operational Remediations (configuration, feature flags, restart, scaling, traffic, infrastructure) through the Action Broker after the Action Gate passes, a guarded one only with a valid human approval. It also runs the pre-approved, reversible rollback of its own release when a severe regression hits.
- **Emergency** is the narrow path. It does not wait for fresh model diagnosis; it checks current deterministic stop and precondition Signals, then runs only named allow-list actions. It never gets a production shell, new code, destructive cleanup, or wider access.

The Mode is operator-only. A Worker can read the Mode but cannot change it. The same applies to the Automation Policy, budgets, allow-lists, and barred list.

## Automation Policies

### The three policies

1. **Human review at all times.** Preparation work runs without approval: diagnosis, proposals, creating or updating a merge-ready Remediation PR, and isolated test and CI runs. A human approval gates merge, production deployment, pipeline mutation, and any direct production action, in every Mode. Emergency allow-list actions also wait unless the operator switches on the emergency override (below). Default for this policy: override off.
2. **Autonomous at all times.** `safe`-class actions that fit the Mode run without waiting. `guarded` and `barred` classes still need a human, and preparation work runs as above. Default: emergency override on.
3. **Scheduled hybrid.** Autonomous work is allowed inside configured windows; human review applies outside them. Preparation work runs as above. Default: emergency override on.

The policy is selected per Incident or per environment by the operator. The emergency override is one boolean per policy: when on, allow-list actions run without waiting; when off, they queue for approval. This keeps the settled rule intact: a company that wants a human for every production action keeps one, and a company that wants fast harm reduction gets it without gaining anything else.

### Time zones, DST, and windows

A schedule holds one or more weekly windows plus a time zone identifier from the IANA time zone database, for example `America/New_York`. Windows are local civil times in that zone, written as closed-open intervals such as `[Mon-Fri 09:00-18:00)`. The IANA database is the standard, government-maintained record of offsets and daylight-saving rules, and it warns that rules change with little notice ([tz database](https://data.iana.org/time-zones/tz-link.html)). The product therefore:

- validates the zone name against the installed tzdb at authoring time and rejects unknown names;
- evaluates windows with the Control Plane's tzdb data and records the tzdb version in every policy decision;
- records the tzdb version with each policy version, so an old saved Demo Run replays against the rules it used;
- treats DST transitions by the tzdb rules of that zone. A window that falls inside the skipped hour of a spring-forward transition is never autonomous for that day; the decision records the reason.

### Boundary crossing during a run

The schedule is evaluated **at execution time**, not at run start. A run that starts inside a window and reaches its action after the window closes queues for approval instead of proceeding silently. The check uses the broker's clock at the moment of the request, and the audit row stores the evaluated local time, the zone, and the tzdb version. Clock skew beyond a configured two minutes makes the schedule verdict `needs-human` rather than guessing.

### Policy version pinning and policy changes

Every policy version is content-addressed. Each decision, approval, and audit row names the exact policy version and tzdb version it used, so any verdict is reproducible. Restrictions apply immediately: the broker re-evaluates the current policy at execution, and a change that removes an action class stops that action even mid-run. Loosening never helps a running attempt beyond what the current policy already allows. A policy change revokes all outstanding, unexecuted approvals; a human re-approves under the new version. Policy changes come from operators only, and the journal records who changed what and why.

### Pause, resume, and cancellation

An operator can pause an Incident Run at any time. Pause stops new external actions and new approval grants; in-flight actions complete and reconcile; Watch keeps reading. Resume re-evaluates policy from scratch for subsequent actions. Cancellation revokes the run lease, release permits, and outstanding approvals, and the Worker is torn down under the settled Worker cleanup rules.

## Approvals, leases, audit, and separation of duties

### Approval records

One immutable approval record per decision. It holds: the action digest (exact typed command, target, hashes), the approver's company identity, the approval system that vouches for it, the policy version, the tzdb version, the class, the expiry, and the scope. The broker consumes each approval once: a one-use permit bound to the action digest, target, Incident, and expiry. Replay fails at the broker.

Approvals expire. Default expiry is 30 minutes, configurable between 5 minutes and 8 hours. Expired, revoked, or scope-mismatched approvals do not execute. The company's own approval systems (GitHub required reviews, branch protection, deployment environments) stay authoritative for their own decisions; the product consumes those records and does not copy or weaken them ([GitHub pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews), [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).

### Separation of duties

- The Worker holds no approval rights and no credentials; the Action Broker holds no approval rights, only scoped execution identities.
- The Release Gate is a separate service from the Action Broker and from the Worker. The same pipeline and the same actors that proposed the change cannot also be its only gate.
- Where the company's approval service records approver identity, the product checks that the approver differs from the executing service account and refuses otherwise.
- The operator who edits policy cannot be the sole approver of a `guarded` action generated by that policy. When only one human is available, the action waits; the system does not self-approve.
- Kubernetes role-based access control is the pattern the adapters follow for narrow, per-scope service identities ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)).

### Leases

Two lease kinds. The run lease, from the Worker design, bounds every broker request with company, Incident, attempt, stage, Mode, policy version, expiry, and tool class. The release lease allows one mutator per target environment at a time. Both expire, renew only while their run is active, and revoke on pause, cancellation, policy change, or crash. Kubernetes Leases exist precisely for this heartbeat-and-expiry coordination pattern ([Kubernetes Leases](https://kubernetes.io/docs/concepts/architecture/leases/)).

### Idempotency

Every external action carries an idempotency key built from the Incident Run, action digest, environment, stage, and action. The broker stores the desired state and provider request ID before calling out, then returns the stored result on any repeat of the same key. A request whose parameters differ from the stored key is rejected, the same discipline Stripe documents for its API: the first result is saved and returned for repeats, including failures ([Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)). After a timeout the broker records `outcome: unknown`, reads the target, and reconciles before anything retries.

### Audit

The append-only journal records proposals, policy verdicts (including which window, zone, and tzdb version applied), approval grants and revocations, lease events, broker calls, provider IDs, redacted responses, Watch results, errors, and human overrides, each with actor identity, service account, Worker, policy version, and credential scope. External systems keep their own audit records as source evidence; Kubernetes audit logging is the company-side pattern the adapters rely on ([Kubernetes auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/)). Secrets and sensitive payloads stay out of the journal; it stores references and hashes.

## Default-deny rules

These fail closed with no exceptions and no model override:

| Situation | Verdict |
|---|---|
| Unknown action or action class not in the catalog | Deny at the broker |
| New adapter not yet declared and approved for unattended use | Deny until an operator declares its read and write surfaces and assigns its action classes |
| Missing evidence in a Release Gate input | `needs-human` or `fail`, never `pass` |
| Recovery Point validation fails or the restore drill has not passed | Raise the action to `guarded` or `barred` |
| Target version differs from the release request's expected version | Stop as stale; human review |
| Approval system unreachable | Deny and retry; no bypass path exists |
| Expired or revoked lease, replayed permit, changed candidate hash, forged stage | Reject at the broker |
| Clock skew beyond two minutes for a schedule verdict | `needs-human` |
| Operator deletes or changes the policy mid-run | Current policy applies to the next decision; outstanding approvals revoke |

## Budgets and Attempt Limits

Production defaults, all operator-configurable:

- **Wall time:** 30 minutes per attempt. The Worker Job's `activeDeadlineSeconds` enforces it at the platform level.
- **Model tokens and cost:** capped per attempt at the Model Gateway, which stops new model calls when the budget is spent. Kernel CPU, memory, and storage limits still protect the host if accounting fails.
- **Attempt Limit:** 3 evidence-led diagnosis and Remediation attempts per Incident by default; the configured value is authoritative. Reaching it produces the Incident Report.
- Emergency actions and rollbacks do not count as attempts. They reduce harm while the Incident stays open for a new, safe attempt.

The Demo Profile removes the Fusion-round, evidence, broker-action, time, token, and model-cost caps by default, so a demo run does not end early. The full product configures all of these budgets, and the Incident Workspace dashboard still shows every limit field so the presentation can point at those controls. Removing these caps never removes anything else: CPU, memory, process, filesystem, network, Authority Mode, the Action Gate, the Release Gate, the configured Incident Attempt Limit, approvals, leases, operator cancel, and cleanup controls all stay in force.

## Emergency Mode allow-list

Per-service, operator-approved, name by name. The default list:

- roll back to the Recovery Point of the named release;
- disable a named feature flag;
- restart a named Deployment, once per attempt;
- scale a named Deployment down to no less than the company-set floor, or up to no more than twice its current size;
- reroute traffic away from the named failing service to its pre-approved fallback;
- revoke one named, pre-identified credential;
- apply the pre-approved network quarantine to a named workload.

Membership is a standing, recorded operator approval for one named action on one service. The list holds `safe` and `guarded` actions only; a `barred` action can never be allow-listed. Every entry runs through the Action Gate and the broker with the normal lease, permit, idempotency, and audit rules. New code, new releases, data operations, destructive cleanup, wider access, and external messages are absent from the list and stay absent.

## Failure response and edge cases

| Case | Response |
|---|---|
| Policy says autonomous but the broker's re-check disagrees | Broker denies; the action queues for approval; the conflict is journaled and shown in the Workspace |
| A window expires mid-action | The action executes; it was checked atomically at request time. The next action re-checks |
| Rollback fails or restores only part of the state | Freeze promotion, page a human, keep the Incident open; no roll-forward without review |
| Attempt Limit reached | Write the Incident Report and close the attempt path |
| Operator pauses mid-autonomous-action | In-flight action completes and reconciles; nothing new starts |
| Emergency action hits an uncovered surface | Stop and page a human; the allow-list action does not improvise |
| Two Workers race on one target | Release lease allows one mutator; the loser's request stops as stale |
| Demo Profile runs without a live approval service | The local operator approves through the Incident Workspace; the same approval records and expiry rules apply |

## Dashboard control model

The Incident Workspace shows two dials and one fixed table:

- **Authority Mode dial:** Observe, Prepare, Repair, Emergency. One choice per Incident; operator-only; takes effect from the next action decision. Emergency activation is immediate.
- **Automation Policy dial:** review always, autonomous always, scheduled hybrid. Hybrid shows the schedule editor: IANA zone picker, weekly windows, and the emergency override switch. The dashboard names the policy version and tzdb version in force.
- **Risk table:** the taxonomy with each category's current class, per-company overrides, and the barred list, read-only to everyone but operators.

Below them: pending approvals with approve, deny, and expiry countdown; pause and resume; Attempt Limit and budget fields (configurable in the full product; the Demo Profile removes the Fusion-round, evidence, action, time, token, and cost caps); the live audit tail; and a per-action history showing which check denied or allowed every decision and why.

## Demo Profile

The demo uses the same policy engine, classes, approvals, leases, idempotency keys, and audit schema as the Solution Contract, with a local broker limited to the Astronomy Shop and a local test repository. It removes the Fusion-round, evidence, broker-action, time, token, and model-cost caps so a demo run does not end early, and it keeps the configured Incident Attempt Limit and every other control. The saved Demo Runs record the Mode, policy version, schedule verdicts, approval records, action and release gate results, and broker receipts, so the presentation shows the control model working on real evidence rather than describing it. One saved run demonstrates a scheduled-hybrid policy where an action lands outside the window and queues for approval; the Workspace replays the recorded decision with its policy and tzdb versions.

## Pitch explanation

The operator sets two dials. The first, Authority Mode, says how far agents may go: diagnose, prepare a merge-ready PR, or merge, deploy, and run operational fixes after gates. The second, Automation Policy, says when a human must approve: always before any production change, never for safe actions, or inside configured hours. A fixed risk table then decides what needs a human's approval and what the product never executes, and the action and release gates and broker checks stay deterministic regardless of the dials. Incident response becomes fast where it is safe and human where it matters, with every decision recorded and replayable.

## Test strategy

The policy service is tested as a pure function:

1. **Matrix tests** over (Mode × policy × class × category × stage) assert the exact verdict for every cell, including all barred and guarded rows under autonomous and hybrid policies.
2. **Gate tests:** the Action Gate denies a stale target, an uncovered Recovery Point surface, a barred action, and a direct operation without fixed stop conditions; the Release Gate does the same for merge and deploy.
3. **Window tests** with an injectable clock: start, end, and crossing events; the spring-forward skipped hour in `America/New_York`; the fall-back repeated hour; an invalid zone name rejected at authoring.
4. **Replay and revocation tests:** replayed permits, expired approvals, revoked approvals, policy changes revoking outstanding approvals, and scope mismatches all fail at the broker.
5. **Lease and race tests:** two attempts on one target; a crash after an external call reconciles without a blind retry.
6. **Determinism tests:** identical (action, policy version, tzdb version, clock, evidence) inputs yield identical verdicts across runs.
7. **Demo Profile tests:** removing the Fusion-round, evidence, action, time, token, and cost caps changes nothing in the enforcement path except the removed budget checks themselves; Attempt Limit, both gates, approvals, leases, cancel, and cleanup still apply.

## Acceptance checks

1. A barred action is denied under Repair Mode, autonomous policy, and Emergency Mode, with a recorded human handoff.
2. A guarded action is executed by the broker only after a valid, unexpired, scope-matching approval, in every policy.
3. Observe Mode produces no PR, merge, deploy, or rollback, even under always-autonomous.
4. A run that starts inside a hybrid window and executes after it closes queues for approval.
5. The broker denies an unknown action, a new adapter, an expired lease, and a replayed permit.
6. A failed Recovery Point, stale target, or unreachable approval system stops the action without a bypass.
7. Policy and Mode changes require an operator and appear in the journal with versions.
8. The Demo Profile runs without Fusion-round, evidence, action, time, token, or cost caps while CPU, memory, process, filesystem, network, Authority Mode, both gates, Attempt Limit, approvals, leases, cancel, and cleanup limits still apply.
9. A saved Demo Run replays its Mode, policy, schedule, approval, gate, and broker decisions from recorded versions.
10. Under human-review policy, the system still creates or updates a merge-ready Remediation PR without approval, while merge, deployment, pipeline mutation, and direct production action wait for approval.
11. An all-at-once release without isolation is guarded, not barred: the broker may execute it only after human approval and the Release Gate passes.
12. Repair Mode executes a guarded typed operational Remediation through the broker after a valid human approval and the Action Gate passes, not only safe operations.

## Rejected alternatives

- **One dial instead of two:** merging Mode and Policy into a single autonomy spectrum was rejected because capability and timing change for different reasons; two dials keep the mental model small and each setting testable.
- **Model-computed risk scores:** rejected because class must be deterministic and reproducible; the fixed table plus adapter declarations gives that.
- **UTC offsets or abbreviations for schedules:** rejected because DST rules need a real zone; IANA tzdb identifiers with recorded versions are the only correct form.
- **Evaluate the schedule once at run start:** rejected because a run can outlive its window; execution-time checks close that escape.
- **Emergency as general admin:** rejected; the allow-list is named, per-service, and broker-checked.
- **Agents may edit policy, budgets, or their own Mode:** rejected; escalation must be operator-only or the dials mean nothing.
- **Model-judged rollback:** already rejected in the release design; rollback stays pre-approved, reversible, and policy-gated.

## Primary evidence

- Open Policy Agent [policy language](https://www.openpolicyagent.org/docs/latest/policy-language/): declarative, data-driven rules that are testable as code; the product supplies versioning and pinning.
- IANA [time zone database](https://data.iana.org/time-zones/tz-link.html): zone identifiers, DST rules, government changes with little notice; and its references to RFC 6557 (maintenance), RFC 3339 (timestamps), and RFC 9557 (zone-suffixed timestamps).
- Kubernetes [Leases](https://kubernetes.io/docs/concepts/architecture/leases/), [auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/), and [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): expiry, audit, and narrow-identity patterns for adapters.
- Stripe [idempotent requests](https://docs.stripe.com/api/idempotent_requests): stored first-result semantics and parameter-mismatch rejection for idempotency keys.
- GitHub [pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews) and [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): company-side approval records the product consumes.
- Settled reports from the same research date for Kubernetes Deployment rollback, Job TTL, Pod Security Standards, NetworkPolicy, service-account tokens, secrets guidance, SLSA provenance, Argo Rollouts analysis, GitHub deployment environments, and OpenTelemetry conventions ([release-recovery.md](release-recovery.md), [worker-isolation.md](worker-isolation.md)).
