# Evidence Set and Hypothesis acceptance gate

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#6](https://github.com/xddinside/sih26-proto/issues/6)

Researched: 2026-08-15

## Decision

The Evidence Set is an append-only, revision-hashed store of cited items. Every item comes from a broker receipt and carries provenance, trust class, freshness, hashes, joins, and redaction marks. Models can never mint items.

A Hypothesis is a structured causal claim with predicted observations, cited supporting and opposing evidence, alternatives, proposed discriminating tests, and a status. Fusion Diagnosis runs one task and one Evidence Set revision through two or more independent participant subagents, a Judge that compares without picking a winner, and a Synthesizer that returns ranked Hypotheses, gaps, and next actions.

The Orchestrator owns evidence gathering and the next step. A fixed, versioned gate in the Control Plane evaluates each Hypothesis on eight deterministic evidence checks: cited coverage, causal edge support, contradiction handling, material alternative elimination, reproducible tests or counterfactual evidence, scope match, freshness, and telemetry coverage. The gate returns `pass`, `continue`, `reject`, or `needs-human`. It uses counts and booleans only. It uses no numeric score aggregate and no model self-reported confidence.

Acceptance is evidential and independent of Authority Mode and Automation Policy. A true cause can be accepted in Observe Mode or when its Remediation needs a human. After acceptance, the Control Plane emits a separate deterministic Remediation disposition — `allowed`, `approval-required`, `prohibited`, or `observe-only` — that gates the next step, not the truth of the Hypothesis. An accepted Hypothesis drives Remediation planning; it is called root cause only after Remediation and Watch evidence support it.

## Evidence Set

The Evidence Set holds the cited Signals, code locations, deployment changes, and test results used to explain an Incident or judge a Remediation. It is not a context dump. Each round of diagnosis pins one revision; new evidence creates a new revision.

### Item schema

```json
{
  "id": "sha256(canonical content | kind | identity)",
  "kind": "metric | trace | log | security-finding | deployment-event | code-location | test-result",
  "backend": "prometheus | jaeger | opensearch | git | ci | flagd | broker-receipt",
  "identity": {
    "trace_id": "...", "span_id": "...",
    "metric_name": "...", "metric_labels": {...}, "window": {...},
    "commit": "...", "diff_hash": "...", "flag_key": "..."
  },
  "query": "exact query text with absolute start and end times",
  "snapshot": "redacted value, labels, status, and message",
  "content_hash": "sha256 of the canonical raw payload",
  "links": ["backend link templates resolved with params"],
  "observed_at": "2026-08-15T15:35:20Z",
  "window": {"starts_at": "...", "ends_at": "..."},
  "fresh_until": "policy-derived expiry",
  "provenance": ["collector -> gateway -> backend -> broker adapter receipt id"],
  "trust": "backend | test-result | human",
  "joins": {
    "service_name": "payment", "service_version": "...",
    "deployment_environment_name": "demo", "tenant_id": "demo",
    "code_file_path": "...", "code_line_number": 42, "code_function_name": "..."
  },
  "redaction": {"profile_id": "...", "masked_fields": ["..."]},
  "outcome": "ok | unresolved | expired | quarantined",
  "supersedes": ["item ids"],
  "contradicts": ["item ids"]
}
```

Every kind requires the identity fields that make it joinable: traces and logs carry `trace_id` and `span_id`; metrics carry name, labels, and an absolute window; code locations carry commit, `code.file.path`, and `code.line.number`; deployment events carry the before and after versions, diff hash, and applied-at time; test results carry the hypothesis id, prediction id, and a broker receipt.

Items are immutable. A correction adds a new item that supersedes the old one. Nothing deletes an item. The superseding item carries the `supersedes` link at creation; the reverse `superseded_by` link is derived in an index or view, never written onto the immutable item.

### Provenance and trust

Only these classes may become Evidence Set items:

| Class | Origin | Supports the gate |
|---|---|---|
| `backend` | Query snapshot taken by a broker adapter with a receipt | yes |
| `test-result` | Experiment run by the broker with a receipt | yes |
| `human` | Item added by an operator through the Incident Workspace | yes |
| worker-derived | A model's restatement of evidence | never an item |

The Worker is untrusted. The Read Broker records the query, the connection, the retrieval outcome, and a content hash on every fetch and returns data, never credentials. A participant subagent can cite an item; it cannot create one. This blocks evidence laundering by construction.

The gate uses items with `outcome: ok` only. `quarantined` items exist for audit but cannot support a check.

### Freshness

The gate evaluates freshness at evaluation time, not at collection time. A supporting item must have `outcome: ok`, an `observed_at` inside the policy window, and no passed `fresh_until`. Deployment-state items must match the current expected version; a deployment that happened after collection makes them stale. The Orchestrator re-collects stale items before the next round. A measured zero counts only when the query ran on a healthy backend with verified coverage for the scope and window; missing, stale, or unhealthy data is never evidence of health.

### Links and hashes

`links` are navigation aids built from backend link templates, never arbitrary URLs from the webhook. The durable copy is the `snapshot` plus `content_hash`. When backend retention removes raw data, the snapshot stays valid and the link is marked expired, not hidden.

### Access and redaction

The Read Broker enforces company scope, field redaction, and row and time bounds on every query. Secrets and user data never enter the Evidence Set. Each item names the redaction profile applied. If required evidence is redacted beyond what the policy allows, the gate returns `needs-human`, not a pass.

### Missing and conflicting data

An item with `outcome: unresolved` marks a gap; it does not block other evidence. Conflicting items both stay visible. Resolution happens by supersession (a newer item replaces an older one) or by a discriminating test. Missing telemetry and a measured zero are different: a bounded query that returns zero is valid negative evidence only when the backend was healthy and coverage was verified for the scope and window; otherwise the result is `unresolved`. No data is not a pass: absence never counts as evidence for any Hypothesis.

### Joins

A causal claim needs a chain of items connected by shared identity, not a pile of correlated items. The joins:

- **trace-metric:** exemplars carry `trace_id` from span metrics to spans, and the trace backend links onward to logs.
- **trace-log:** OpenTelemetry log records carry `trace_id` and `span_id` when a span is active, so a failing span joins its log lines.
- **signal-code:** stable `code.file.path`, `code.line.number`, and `code.function.name` span attributes join a Signal to a line in the pinned repository snapshot.
- **code-deploy:** the commit joins a deployment diff, and `service.version` plus `deployment.environment.name` join it to the running target.

Two items without a shared identity field cannot sit next to each other in a causal edge.

## Hypothesis

A Hypothesis is a possible root cause ranked by how well it explains the Evidence Set. It is not a guess and not yet a root cause.

### Schema

```json
{
  "id": "...",
  "incident_id": "...", "incident_run_id": "...",
  "attempt": 1, "round": 1,
  "causal_claim": {
    "trigger": "condition that activates the defect",
    "defect": "location and nature: code, configuration, infrastructure, or deployment change",
    "propagation": [
      {"from": "state or step", "to": "state or step", "cited_item_ids": ["..."]}
    ],
    "failure": "observable effect; must match the Incident symptom"
  },
  "affected_scope": {
    "service_names": ["payment"], "deployment_environment_names": ["demo"],
    "versions": ["..."], "window": {"starts_at": "...", "ends_at": "..."},
    "cohorts": ["..."]
  },
  "predicted_observations": [
    {"id": "...", "statement": "...", "discriminates": ["alt-hypothesis-id"],
     "registered_at": "2026-08-15T15:40:00Z"}
  ],
  "evidence": {
    "supporting": ["item ids"],
    "opposing": ["item ids"],
    "unexplained": ["critical items this Hypothesis does not explain"]
  },
  "alternatives": ["competing hypothesis ids"],
  "proposed_tests": [
    {"id": "...", "procedure": "...", "bounds": "...", "permissions": ["..."],
     "expected": {"this_hypothesis": "...", "alternative_id": "..."}}
  ],
  "status": "proposed | testing | accepted | rejected | superseded | confirmed"
}
```

### Status rules

- `proposed`: entered by a Fusion round.
- `testing`: a discriminating test is running.
- `accepted`: the gate passed. This Hypothesis is the basis for Remediation planning. It is still a Hypothesis; it is not called root cause.
- `rejected`: the gate returned `reject`. The rejection reason and rejecting items stay attached. A later round can resurface the Hypothesis only with new evidence that contradicts the rejection reason.
- `superseded`: a newer Hypothesis explains everything this one did and more.
- `confirmed`: Remediation shipped, Watch shows the Incident symptom gone and no regression, and the Hypothesis's predicted observations held. Only a `confirmed` Hypothesis is called root cause.

The root-cause rule is fixed: prediction and experiment can support a Hypothesis; only Remediation and Watch evidence can confirm it.

## Fusion Diagnosis round

### Shared Starting Context

Every participant in a round receives exactly the same starting context:

1. **Diagnosis Task:** the Incident Trigger summary, symptom, severity, scope, window, detector rule version, and known limits.
2. **Evidence Set revision `R_n`:** the pinned revision id and the cited subset. Every participant reads the same items.
3. **Context Brief:** conversation-derived alignment a participant cannot rediscover from the evidence: user decisions, rationale, preferences, assumptions, constraints, and unresolved tensions. Each entry carries a Brief Authority Level marking binding decisions apart from preferences. Rediscoverable material — runbooks, service topology, the service catalog, and related past Incidents — belongs in the cited Evidence Set or the shared read context, not the Brief.
4. **Tools:** Diagnose read tools through the Read Broker, plus the ability to propose tests.

The Orchestrator builds the task and brief. The brief is compact; it does not dump the transcript.

### Independence rules

1. Participants run in parallel and see only their own work. No participant sees another Participant Output, the Judge analysis, or the Synthesized Response.
2. Each participant has its own scratch directory. Participants cannot communicate.
3. Every causal claim must cite Evidence Set item ids. Uncited claims are marked `uncited` and cannot support the gate.
4. Citations must reference items in revision `R_n`. A citation to an item outside the revision is invalid.
5. Participants propose tests. Only the Orchestrator can order a bounded experiment through the broker.
6. Participants have no project writes, no shell, no web search, and no production access. Documentation fetched through the allow-list proxy is context, not evidence; a causal claim cannot cite a web page.

### Round validity

A round is valid when at least two participants return well-formed outputs. A failed participant is recorded with its trace and the round continues if the minimum holds; otherwise the round is invalid and reruns. Invalid rounds count against the round budget where one is configured; the Demo Profile has none.

## Judge contract

The Judge subagent receives the task, Context Brief, Evidence Set revision id, and all Participant Outputs. It may query the same read-only evidence.

**Input:** task, brief, revision id, participant outputs (each holding Hypotheses with citations, proposed tests, and stated objections).

**Output** (structured, machine-checked):

- `agreements`: topics where participants align, with the hypothesis ids that align.
- `contradictions`: pairs of claims that cannot both hold, with the hypothesis ids and the item ids implicated.
- `blind_spots`: critical evidence items or evidence kinds no participant explained.
- `unique_findings`: findings from exactly one participant, with cited item ids.
- `citation_audit`: per participant, counts of uncited claims, invalid citations, and citations to missing items.

The Judge compares; it does not pick a winner and does not emit a confidence score. Its output feeds the Synthesizer and the audit trail, not the gate directly.

## Synthesizer contract

The Synthesizer subagent receives the task, brief, revision id, Participant Outputs, and the Judge analysis.

**Output** (structured, machine-checked):

- `ranked_hypotheses`: one entry per distinct causal claim. Participants who agree merge into one Hypothesis with combined citations; disagreements stay distinct. The rank orders by how much of the Evidence Set each Hypothesis explains. The rank is advisory.
- `contradictions`: consolidated from the Judge.
- `gaps`: missing evidence kinds and which checks they hold open.
- `next_actions`: proposed evidence actions. Each names a query or a bounded experiment, its procedure, bounds, permissions, and which Hypothesis it discriminates between. The Orchestrator chooses and approves actions; the Synthesizer only proposes.
- `fusion_meta`: participant, Judge, and Synthesizer identities, revision id, and timestamps.

The Synthesizer produces one result per round. The Synthesized Response is the durable record the next stage reads. Participant and Judge traces and artifacts persist for inspection in the Incident Workspace but remain excluded from later model context, mirroring Fusion Run Details.

## Acceptance gate

### Ownership

The gate is fixed, versioned policy code that runs in the Control Plane. It sits outside the Worker and outside any model. The Orchestrator requests an evaluation; it cannot waive, edit, or re-order the checks. A prompt injection in the Worker cannot change a gate result.

### Gate checks

For a Hypothesis H against Evidence Set revision R, all eight checks must pass:

1. **Cited coverage.** H's failure matches the Incident symptom, and every critical item in the trigger window is supporting or explained away. Every propagation edge has at least one cited item. `unexplained_critical_items == 0`. Critical items are anomaly Signals from the trigger window: error spans, breach of the detector threshold, ERROR logs, failed probes, and deployment events in the window.
2. **Causal edge support.** The cited items of each edge form a joined chain from trigger to failure using the shared identity fields above. A broken chain fails this check and names the missing join.
3. **Contradiction handling.** No fresh item of the same or higher trust contradicts a supporting item of H. Contradictions resolve by supersession; an unresolved contradiction fails this check and requires targeted resolution.
4. **Alternative elimination.** Material alternatives are those a participant or the Judge raised with cited evidence, plus causes the service catalog or topology names as relevant to the affected scope. Each material, non-rejected alternative has at least one item or test outcome it cannot explain, or a prediction of H that failed for it. `undiscriminated_material_alternatives == 0`. Causes nobody raised and no topology names are out of scope, not alternatives. If a material alternative explains strictly more items than H and both stand, the Orchestrator tests the alternative first.
5. **Reproducible tests or counterfactual evidence.** At least one discriminating test of H ran with a broker receipt and its observed outcome matched the pre-registered prediction, or the Evidence Set holds a recorded natural counterfactual: the symptom window against a comparable window or cohort that differs only in H's trigger. A test that ran and failed rejects H. A test run with errors counts for nothing and reruns once.
6. **Scope match.** H's affected scope covers the Incident's observed scope. Scope beyond the observed scope must carry its own citations; uncited breadth is trimmed, not failed.
7. **Freshness.** Every supporting item passes the freshness rules above. One stale item fails the check and the Orchestrator re-collects.
8. **Telemetry coverage.** Every supporting item that reports a zero or negative result carries a coverage record showing the backend was healthy and the query covered the affected scope and window. A measured zero under verified coverage is valid negative evidence. Missing, stale, or unhealthy data never supports a pass.

### Scores and numbers policy

The gate uses no numeric score, no weights, no aggregate, and no model self-reported confidence. The only numbers are:

- counts: uncited claims, unsupported edges, unresolved contradictions, undiscriminated material alternatives, executed tests, passed tests, stale items, unexplained critical items;
- booleans: each check's result;
- timestamps: prediction registration against experiment start, observation against freshness window.

Each count means exactly one thing and pairs with a boolean threshold. The Synthesizer's coverage rank orders which Hypothesis to test first; it never turns a fail into a pass. This keeps the gate explainable to an evaluator: pass means "all eight named facts hold", not "the model felt 87% sure".

### Outcomes

- `pass`: all eight checks hold. The Hypothesis becomes `accepted` and Remediation planning begins. At most one Hypothesis passes per evaluation. If two pass at once, the gate downgrades both to `continue` and returns one mandated discriminating test between them.
- `continue`: fixable gaps remain — a missing join, an untested prediction, a stale item, an undiscriminated material alternative, an unresolved contradiction. The Orchestrator gathers the named evidence or starts the next round. This is not a failure of the Hypothesis.
- `reject`: evidence settles it — a discriminating test failed, a critical edge was contradicted with no supersession possible, or coverage is impossible. The status becomes `rejected` with the reason and items recorded.
- `needs-human`: a person must resolve an evidence question — required evidence is redacted beyond what policy allows, no safe test is available and no counterfactual exists, or conflicting evidence cannot be split by an allowed test. It is an evidence decision, never an action-permission decision.
- **Attempt Limit:** when the Incident Run exhausts the user-set Attempt Limit without a verified Remediation, the system produces the Incident Report: the Evidence Set, all Hypotheses with statuses, actions taken, and results. This covers an unaccepted Hypothesis, no safe Remediation, a failed Verify, and a failed Watch, not only a missing confirmed root cause.

### Remediation disposition

Acceptance is evidential only. A true cause can be accepted in Observe Mode or when its Remediation needs a human. After acceptance, the Control Plane computes a separate deterministic disposition from the active Authority Mode, Automation Policy, and the action-risk classification of the implied changed surface:

- `allowed`: the surface is reversible under the Recovery Point rules and within the permitted action classes for the active mode and policy.
- `approval-required`: the surface is reversible but the Automation Policy requires human review, or the action class needs approval.
- `prohibited`: the surface is barred or irreversible; no Remediation of this kind is permitted under any mode.
- `observe-only`: the Authority Mode permits diagnosis and reporting only.

The disposition gates the next step, not the truth of the Hypothesis. It never changes acceptance. An accepted Hypothesis in Observe Mode, or one whose only Remediation is barred, remains an accepted cause of the Incident.

## Evidence-gathering loop

The Orchestrator owns the loop. Each step:

1. Run a Fusion round on revision `R_n`.
2. Evaluate the gate on the Synthesizer output.
3. `pass` ends Diagnose; the accepted Hypothesis moves to Remediation planning, and the Control Plane emits the Remediation disposition.
4. `continue` picks bounded actions from the Synthesizer's `next_actions` and the named gaps, runs them through the brokers, appends results as revision `R_{n+1}`, and starts round n+1.
5. Production may configure Fusion-round, broker-action, experiment, time, token, and cost budgets. When a budget exhausts without a pass, the attempt ends with the best state recorded and a `needs-human` or next-attempt decision. The Attempt Limit still bounds the Incident.
6. The Demo Profile removes Fusion-round, broker-action, time, token, and cost caps so a run finishes on evidence, not a budget. It keeps the configured Incident Attempt Limit and host and safety controls.

### Bounded experiments

An experiment must register its prediction before it starts; the policy service compares timestamps and rejects an experiment whose prediction was registered after the start. The broker runs it in isolation: a sandbox or staged target in the Solution Contract, a candidate instance with probe traffic in the Demo Profile. Diagnose never mutates production. The receipt records procedure, bounds, outcome (`ok | failed | error`), and the prediction tested.

### Fallback when a test cannot run

If an experiment is not permitted, the Orchestrator records a `not-run` item with the reason and tries a natural counterfactual: symptom window against pre-deploy window, affected cohort against unaffected cohort, or deployment diff timing. If neither exists, the test-dependent check stays unmet, the round ends in `continue`, and exhausted budgets (where configured) lead to `needs-human`. The gate never infers a pass from an absent test.

### Anti-laundering and anti-circularity rules

- Only broker receipts become items. A participant's restatement of an item is stored with the Hypothesis, never as a new item. Citations to worker-derived notes are invalid.
- Predictions are pre-registered. A test can only confirm what was written down before it ran, so post-hoc rationalization cannot mint evidence.
- Every test must be able to refute its Hypothesis. The broker rejects a test whose design can only confirm.
- A Hypothesis cannot cite a test it did not define, and a prediction cannot cite the observation it was written to predict.
- Items are never deleted. Supersession, not erasure, resolves contradiction. The audit trail keeps both sides.

## Incident Workspace audit view

The Incident Workspace shows, per Hypothesis, why the gate decided what it decided:

- the causal graph, each edge clickable to its cited items and their backend links;
- the gate table: all eight checks, each with result, the exact items counted, and the reason;
- supporting, opposing, and unexplained items side by side, with freshness and redaction marks;
- alternatives and the evidence that discriminated each one out;
- every test with its pre-registered prediction, receipt, and outcome, including failed and `not-run` tests;
- Fusion round details: participant outputs, Judge analysis, citation audit, and Synthesizer output, mirroring Fusion Run Details;
- status changes with actor and time: gate, Orchestrator, or human;
- rejections, supersessions, and human overrides in a distinct section.

A human can answer "why did this pass" one check at a time without reading the transcript. The rubric rewards observed evidence; the workspace makes every acceptance an observable chain.

## Demo Profile

The Demo Profile runs the same contracts on the pinned Astronomy Shop commit `2e05c45b85b985a691cc75082c234e8d6ac0b2e9`, with two participants, one Judge, and one Synthesizer. It removes Fusion-round, broker-action, time, token, and cost caps so saved Demo Runs finish on evidence, not a budget. It keeps the configured Incident Attempt Limit, Authority Mode, Release Gate, and host and safety controls.

### Payment failure

`paymentServiceFailure` makes the Payment service error on `charge`. The trigger is the span-metrics error rate over `service_name=payment`. Round one produces typical competing Hypotheses: a defect in the charge path, an upstream payment-provider outage, and a checkout-side misconfiguration. The discriminating evidence:

- the trace exemplar joins the error span to its logs by `trace_id`, showing the error raised inside the Payment service, which the provider-outage Hypothesis cannot explain;
- the deployment join shows the flag change at time T matching the symptom start, which the code-defect Hypothesis cannot explain;
- the counterfactual: with the flag off, the error rate returns to baseline.

The gate then requires one reproducible test: re-enable the flag and watch the error rate move with the flag state. Only the flag Hypothesis explains all three. The saved Demo Run shows the full chain.

### A second fault

`productCatalogFailure` errors on `GetProduct` for one product ID, `OLJCESPC7Z`. This fault exercises alternative elimination cleanly:

- Hypothesis A: the Product Catalog service degraded globally. Prediction: failures spread across product IDs.
- Hypothesis B: a single product ID is broken. Prediction: failures confined to `OLJCESPC7Z`.

The discriminating test is a grouped query of failed `GetProduct` requests by product ID over the trigger window. The result rejects A and leaves B, which then passes coverage, scope, freshness, and telemetry coverage with the same code-location and flag-deploy joins. `kafkaQueueProblems` is a third ready fault: a lag-spike Signal, a consumer-delay deployment join, and a counterfactual window where the injected delay is absent. The final Demo Run choice stays open; the gate treats all three identically.

## Edge cases and failure handling

| Case | Response |
|---|---|
| Two Hypotheses pass at once | Downgrade both to `continue`; return one mandated discriminating test. |
| No Hypothesis proposed | `continue` with gap-gathering actions; after the round budget (where one is configured), `needs-human`. |
| Fewer than two valid participant outputs | Round invalid; rerun counts against the round budget where one is configured. |
| Evidence backend down | Items mark `unresolved`; freshness and telemetry coverage fail; telemetry-health Incident fires; no pass from missing data. |
| Bounded query returns zero | Valid negative evidence only under verified telemetry coverage; otherwise `unresolved`. |
| Retention removed raw data | Snapshot stays valid; links marked expired. |
| Fresh conflicting items, same trust | `continue`; resolution by supersession or discriminating test. |
| Test errored | Rerun once; a second error marks `not-run`. |
| Test failed | `reject` the Hypothesis. |
| Remediation disposition is `prohibited` or `approval-required` | Disposition recorded; acceptance unchanged. A human decides the next step. |
| Human rejects an accepted Hypothesis | Allowed and recorded. A human cannot flip a failing check to pass without new evidence. |
| Worker interrupted mid-round | Round scratch discarded; next round starts from the last sealed revision. |
| Attempt Limit reached without a verified Remediation | Produce the Incident Report. |

## Test strategy and acceptance checks

The implementation is ready when tests show that:

1. a table-driven gate fixture returns the exact outcome for each combination of the eight evidence checks;
2. a worker-derived claim cannot enter the Evidence Set and cannot support any check;
3. a prediction registered after experiment start is rejected at the broker;
4. an expired or quarantined item cannot support a pass;
5. an edge whose items share no identity field fails causal edge support;
6. one passing Hypothesis forces `continue` on all others;
7. a failed discriminating test rejects and records the reason;
8. a measured zero passes only with a verified-coverage record, and missing telemetry never passes;
9. the Remediation disposition is emitted separately and never changes acceptance; an accepted Hypothesis in Observe Mode returns `observe-only`, and a barred surface returns `prohibited` while acceptance stands;
10. a round with one valid participant is invalid and reruns;
11. the saved Demo Run for the payment fault and the product-catalog fault replays the full audit trail in the Incident Workspace.

## Rejected alternatives

- **Vote or majority selection:** the Judge compares; the gate checks evidence, not agreement counts. Unique findings matter.
- **Model self-reported confidence:** cannot pass or rank a Hypothesis; the gate never reads it.
- **A model evaluating the gate:** the gate is fixed policy code; a model could change thresholds or accept weak evidence.
- **A numeric aggregate score:** counts plus booleans stay explainable; one weighted number hides which check failed.
- **Debate rounds between participants:** participants stay independent; seeing each other's outputs breaks the shared-context guarantee.
- **Requiring unanimous agreement:** one participant's blind spot must not block a well-evidenced Hypothesis.
- **Web-sourced evidence:** the open web gives no receipts and no joins; evidence comes from configured backends only.
- **Deleting contradictory items:** erasure destroys the audit trail; supersession keeps both sides.
- **Calling an accepted Hypothesis a root cause:** Remediation and Watch must confirm it first.
- **Letting participants run their own experiments:** the Orchestrator orders bounded broker experiments; Diagnose never mutates production.
- **Folding action permission into acceptance:** a true cause can be accepted when its Remediation is barred or needs a human; the disposition is a separate deterministic result.

## Mapping: live Fusion project to this Incident use case

Inspected 2026-08-15 in `/home/xdd/dev/sandbox/fusion` (dirty worktree, read-only for this task): `CONTEXT.md`, `docs/prototypes/fusion-research-mode.md`, `packages/coding-agent/src/core/fusion/research-fusion.ts`, and `prompts.ts`.

| Fusion pattern | Reused here | SIH-specific change |
|---|---|---|
| Shared Starting Context: task + Context Brief + tools | Same; participants get one task, one brief, one revision | Brief stays conversation-derived; runbooks, topology, and past Incidents live in the Evidence Set or shared read context |
| Context Brief with Brief Authority Levels | Same | Binding decisions carry the Authority Mode and policy versions |
| Participants run in parallel, read-only tools | Same | Tools are Read Broker queries, not local files or web fetch; no web search |
| Participant Outputs not forced into a structure | Rejected here | The gate needs the machine-checked Hypothesis schema; outputs are structured |
| Judge analyzes agreement, contradictions, blind spots, unique findings; does not pick a winner | Same | Judge also emits a per-participant citation audit |
| Synthesizer produces one result | Same | Result is a ranked Hypothesis set with gaps and next actions, not free prose |
| Scratchpad excluded from durable context; Fusion Run Details inspectable | Same | Participant and Judge traces and artifacts persist for inspection but stay out of later model context; only synthesis is durable |
| Per-call retry, abort, and failure handling (`research-fusion.ts`) | Same per model call | One failed participant does not abort the run when two valid outputs remain |
| Fusion Run Artifact stores normalized traces | Same pattern | Journal plus sealed artifacts, as fixed in worker isolation |
| `/fusion` command and Fusion Model Configuration | Not reused | Fusion runs are Orchestrator-ordered stages, not a user command |
| Deferred Investigative Fusion Mode | Basis | SIH Diagnose adds bounded broker experiments with pre-registered predictions |

What stays Fusion-only: the user-facing `/fusion` command, the Fusion Model Selector, and its conversation-history semantics. What stays SIH-only: the Evidence Set with receipts and hashes, the Hypothesis schema, the deterministic gate and Remediation disposition in the Control Plane, the Orchestrator's evidence loop, the Attempt Limit, and the root-cause confirmation rule.

## Primary evidence

- Fusion Agent Harness live source, inspected 2026-08-15: [`research-fusion.ts`](/home/xdd/dev/sandbox/fusion/packages/coding-agent/src/core/fusion/research-fusion.ts), [`prompts.ts`](/home/xdd/dev/sandbox/fusion/packages/coding-agent/src/core/fusion/prompts.ts), [`tool-policy.ts`](/home/xdd/dev/sandbox/fusion/packages/coding-agent/src/core/fusion/tool-policy.ts), [`CONTEXT.md`](/home/xdd/dev/sandbox/fusion/CONTEXT.md), [`fusion-research-mode.md`](/home/xdd/dev/sandbox/fusion/docs/prototypes/fusion-research-mode.md).
- Zeller et al., [Introduction to Debugging](https://www.debuggingbook.org/html/Intro_Debugging.html): the cause-effect chain from defect to failure, and the scientific method of hypothesis, prediction, experiment, refine, refute. Fetched 2026-08-15.
- OpenTelemetry Demo [feature flags](https://opentelemetry.io/docs/demo/feature-flags/): fault names and behavior used in the Demo Profile. Fetched 2026-08-15.
- OpenTelemetry [code attributes registry](https://opentelemetry.io/docs/specs/semconv/attributes-registry/code/): `code.file.path`, `code.line.number`, `code.function.name` for the signal-code join. Fetched 2026-08-15.
- Google SRE, [Postmortem Culture](https://sre.google/sre-book/postmortem-culture/): blameless postmortems record all contributing causes and never expose user data; supports keeping rejected and superseded Hypotheses visible. Fetched 2026-08-15.
- Project decisions: [incident-intake](incident-intake.md), [worker-isolation](worker-isolation.md), and [release-recovery](release-recovery.md), and the language in [CONTEXT.md](../../CONTEXT.md).
