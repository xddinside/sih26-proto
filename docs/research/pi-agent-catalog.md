# Pi skill, tool, and specialist subagent catalog

Status: decision for the Solution Contract and Astronomy Shop Demo Profile

Issue: [#11](https://github.com/xddinside/sih26-proto/issues/11), child of map [#1](https://github.com/xddinside/sih26-proto/issues/1)

Prerequisite reports: [incident-intake.md](incident-intake.md), [worker-isolation.md](worker-isolation.md), [release-recovery.md](release-recovery.md), [orchestrator-stages.md](orchestrator-stages.md), [hypothesis-gate.md](hypothesis-gate.md), [authority-action-risk.md](authority-action-risk.md), [review-verification.md](review-verification.md), [company-integration.md](company-integration.md)

Researched: 2026-08-15

## Decision

The product runs one Pi Orchestrator per Incident attempt inside one disposable Worker. The Orchestrator proposes everything and decides nothing that policy owns: the Control Plane remains the single durable state writer and owns stage transitions, applicability, the Hypothesis gate, both execution gates, leases, permits, budgets, and policy. The Orchestrator delegates bounded work to specialist subagents — each a fresh Pi agent session inside the Worker, bound to one skill, one tool allow-list, one scratch directory, and one output schema. Every applicable review role (R1–R9) and every applicable test layer (T1–T13) runs in its own specialist subagent with its matching skill; the deterministic tool, the broker, the company pipeline, the applicability resolver, and the Control Plane verdict own execution facts and pass/fail authority, and a model cannot forge a receipt, pick its own applicability, reinterpret a failure, or replace a gate. The Orchestrator assembles the sealed outputs into stage artifacts. Pi provides no security boundary and no durable-state story, so those are product code around it: brokers outside the Worker enforce every access rule, and the journal plus sealed artifacts are the only resume path. This report fixes the catalog, the tool boundary, context hygiene, model policy, failure handling, packaging, and the Demo Profile subset; it deliberately does not freeze the subagent graph, participant count, or per-role models.

## Harness contract

### Trust split

| Concern | Owner | This report's rule |
| --- | --- | --- |
| Durable Incident and Run state | Control Plane only | The Worker proposes transitions and artifacts; nothing it runs can write state directly |
| Stage order, applicability resolution, Hypothesis gate, Release Gate, Action Gate | Control Plane policy code | Models request evaluations; no model input changes a result |
| Leases, permits, approvals, budgets, barred list, action-risk classes | Control Plane | Brokers re-check server-side state at execution |
| Model calls | Model Gateway only | Provider keys exist only there; the Worker holds none |
| External reads and actions | Read Broker and Action Broker only | Every call carries the run lease and records a receipt |
| What the model says and how it investigates | Orchestrator and subagents | Free inside the stage contract and skill contracts |

The Worker is untrusted and disposable. Pi's own documentation states it has no built-in sandbox, that its tools and extensions run with the permissions of the Pi process, and that real isolation needs an OS or container boundary — which is why the settled Worker design runs the whole Pi process in a hardened container and treats brokers, not Pi tools, as the permission boundary. Pi's project trust is an input-loading guard, not a sandbox; the Worker starts Pi in non-interactive mode with project trust denied, project resources ignored, and built-in tools disabled, exactly as [worker-isolation.md](worker-isolation.md) fixes.

### Orchestrator system contract

**Startup inputs** (assembled by the Control Plane before Pi starts, from the journal and sealed artifacts):

1. the scoped run lease: company, Incident, attempt, stage, Authority Mode, Automation Policy version, expiry, and allowed tool classes;
2. the journal checkpoint: `current_stage`, per-stage status, restart count, and the hashes of every sealed artifact produced so far;
3. the sealed artifacts applicable to the stage (Incident Brief, Diagnosis Report, Remediation Proposal, Verification Report, Release record, Watch reports) by content hash;
4. the pinned read snapshot paths: affected repositories, history, lockfiles, redacted configuration, service catalog, runbooks, related past Incidents;
5. the Evidence Set revision id and the cited-subset manifest for the current work;
6. the skills directory digest, tool catalog version, resolver version, and policy version;
7. budgets: wall time, token and cost caps, round cap, broker-action cap, subagent cap, revision cap;
8. the Model Gateway configuration naming the allowed models per role, per policy.

**Allowed decisions:**

- choose the subagent graph: which skills spawn, how many subagents, and in what order, within policy bounds (participants ≥ 2; exactly the review roles and test layers the applicability resolver marks required or triggered; at most one repair implementer per candidate revision);
- choose each subagent's model from the policy's allowed set for that role;
- choose which Read Broker queries to run, within stage limits;
- choose evidence-gathering actions from the Synthesizer's `next_actions` and run them through the brokers;
- compose prompts inside the skill contracts and compose the exact input subset for each subagent;
- propose artifact content — the Control Plane seals it;
- request gate evaluations, applicability resolutions, and stage transitions — the Control Plane computes them;
- run bounded internal candidate revisions within the policy revision cap;
- cancel child subagents, terminate early on settled results, and retry model calls per provider retry settings;
- accept `minor` findings as recorded and decide whether to run conditional checks early.

**Forbidden decisions:**

- write Incident, Run, journal, or Evidence Set state, or seal artifacts, outside the proposal API;
- mint Evidence Set items — only broker receipts become items, per [hypothesis-gate.md](hypothesis-gate.md);
- skip, reorder, or re-bucket any stage, check, or gate; a model cannot waive the Release Gate, the Action Gate, or the Hypothesis gate;
- issue, grant, or consume approvals and permits, or run a `barred` or unapproved `guarded` action;
- compute the action-risk class, candidate hash, verdict function, or consolidation — all deterministic Control Plane code;
- merge, deploy, or execute any production action except through the Action Broker;
- hold or request company, cloud, source-control, or cluster credentials;
- review its own work or substitute a required Review Report; the Orchestrator is not a reviewer, Judge, or Synthesizer;
- change Authority Mode, Automation Policy, budgets, the barred list, or the Emergency allow-list;
- pick a fusion winner or feed model confidence into any gate.

**Context assembly.** The Orchestrator builds each subagent's input as: skill system prompt + stage guardrails + the task + the exact input subset (Evidence Set revision id and cited items, not the whole store) + active tool snippets. Peer outputs are never forwarded. The Pi JSONL session is retained as supporting evidence only; the Workspace is built from the journal and sealed artifacts, per [worker-isolation.md](worker-isolation.md).

**Durable outputs.** Before a stage counts as done, the Control Plane journal appends the transition, policy decision, model-use record (parent-child ids, prompts, models, token use, tool calls, results), broker requests, receipts, and artifact hashes. Artifacts seal by content hash in company-scoped object storage.

**Resume behavior.** A crash, heartbeat loss, pause, or `needs-human` parks the Run; resume spawns a fresh Worker for the same attempt that replays the journal checkpoint and re-runs the unfinished stage from its last sealed artifact, never from unsealed scratch. Restarts per attempt are capped at 2; beyond that the attempt fails `unstable-worker`. Sealing the same content twice records once.

**Failure behavior.** Each stage names its failure result below; the Orchestrator proposes the result and reason, the Control Plane records it, and attempt accounting, the Incident Report, and the next-attempt rules follow [orchestrator-stages.md](orchestrator-stages.md) unchanged.

### Subagent mechanics

Subagents are bounded Pi agent sessions inside the one Worker. The Solution Contract may run each as a separate Pi process in the same container, per [worker-isolation.md](worker-isolation.md); the Demo Profile reuses the live Fusion harness's in-process pattern — `runResearchAgent` in `research-fusion.ts` constructs a fresh `Agent` from `@earendil-works/pi-agent-core` per role — which is the proven cheap shape. Either way:

- each subagent session starts empty: no shared conversation, no inherited history, its own scratch directory (and its own copy-on-write worktree for repair work);
- each session is bound to one skill's system prompt and one tool allow-list, applied through the extension APIs `before_agent_start` and `pi.setActiveTools` before the first turn;
- subagents cannot create nested Workers and reach brokers only through the Orchestrator's tool service;
- every subagent model call goes through the Model Gateway; subagents hold no provider keys;
- the Orchestrator caps process count and concurrent model calls, cancels children when their task ends, and records parent-child ids, prompts, models, token use, tool calls, and results, per [worker-isolation.md](worker-isolation.md).

Pi has no built-in subagent primitive; its SDK documents "build custom tools that spawn sub-agents" as the supported pattern, so the `spawn_subagent` tool is product SDK/extension work, not a Pi feature.

## Stage-by-stage delegation plans

Common envelope for every stage: `{run, attempt, stage, from, to, actor, policy_version, lease_id, time, artifact_ref}`, from [orchestrator-stages.md](orchestrator-stages.md). The stage tool table in [worker-isolation.md](worker-isolation.md) is normative for what each stage may touch.

### Detect

- **Delegation:** none by default. The Orchestrator runs the bounded Read Broker verification queries itself (live symptom snapshot, verification queries, gap between trigger and reality). An evidence-gathering subagent is permitted only when the policy grants it; the Demo Profile uses none.
- **Parallelism:** verification queries run as parallel broker calls, not subagents.
- **Artifact:** Incident Brief v1, proposed by the Orchestrator, sealed by the Control Plane.
- **Completion:** symptom confirmed consistent with the trigger, or verified absent (the `symptom-cleared` path). **Failure:** one full re-verification, then `failed: undiagnosable`.

### Diagnose

- **Delegation, per round:** (1) the Orchestrator builds the Context Brief deterministically from the Incident Brief, policy versions, and Brief Authority Levels — a brief skill may compress conversation-derived operator decisions when any exist; (2) two or more `sih-fusion-participant` subagents run in parallel, each with the same task, brief, and Evidence Set revision id; (3) one `sih-fusion-judge` session runs after the participants; (4) one `sih-fusion-synthesizer` session runs after the Judge; (5) the Orchestrator requests the Hypothesis gate evaluation in the Control Plane.
- **Continue path:** the Orchestrator picks bounded actions from the Synthesizer's `next_actions` and the named gaps, runs them through the brokers (an `sih-evidence-gatherer` subagent where the queries need composition), appends receipts as revision R_{n+1}, and starts the next round. Looping on the same input is not allowed; each round needs new evidence or a narrowed task.
- **Cancellation:** an abort signal propagates to every subagent session, mirroring Fusion's `AbortSignal` handling in `research-fusion.ts`.
- **Malformed output:** a participant output that fails the Hypothesis schema check is recorded with its trace and does not count. A round is valid when at least two participants return well-formed outputs; otherwise the round is invalid and reruns, counting against the round cap where one is configured. This deliberately diverges from the live Fusion code, which aborts the whole run on the first rejected participant (`research-fusion.ts` throws on any rejected participant).
- **Tool failure:** a Read Broker outage marks items `unresolved`; freshness and telemetry coverage fail; the stage cannot seal on missing evidence, per [hypothesis-gate.md](hypothesis-gate.md).
- **Crash/resume:** a Worker interrupted mid-round discards round scratch; the next round starts from the last sealed revision.
- **Artifacts:** Diagnosis Report v1 (ranked Hypotheses, contradictions, gaps, next actions, round records, and the Remediation disposition after acceptance). Participant outputs, Judge analysis, and Synthesizer traces persist as inspectable run evidence — the Fusion Run Artifact pattern — but are excluded from later model context; only the synthesis is durable stage input.
- **Completion:** the deterministic eight-check gate accepts one Hypothesis; the Control Plane then emits the Remediation disposition (`allowed`, `approval-required`, `observe-only`, `prohibited`). **Failure:** round cap exhausted (production default 3) without acceptance → `failed: no-hypothesis`; Observe Mode ends `completed: diagnosis-only`.

### Repair

- **Delegation:** one `sih-repair-planner` subagent turns the accepted Hypothesis and Remediation disposition into a Remediation Proposal draft with the change-to-Hypothesis citation map, Recovery Point draft, blast radius, test plan, and its declared action and changed surfaces. The planner receives the risk table and adapter declarations, not a precomputed class: it proposes the action and surfaces, and the Control Plane computes the deterministic action-risk class from the sealed proposal and the adapter declarations only after the proposal exists. One `sih-repair-implementer` subagent then produces the candidate in its own private copy-on-write worktree or scratch (code path) or authors the typed action plan (direct operations).
- **Parallelism:** planner and implementer run sequentially. Only one implementer works per candidate revision; the implementer writes only its private worktree or scratch, and the Orchestrator integrates the candidate into the sole integration worktree, which alone can become an artifact.
- **Tools:** reads through the Read Broker; per-agent copy-on-write worktrees; local build and test tools; through the Action Broker, creating or updating a Remediation PR or submitting a typed action plan. No merge, no deploy, no direct production action.
- **Artifact:** Remediation Proposal v1. **Completion:** the proposal covers the accepted Hypothesis's causal chain and records its deterministic class and disposition. `safe` proceeds; `guarded` waits for its approval at the execution gate; `barred` or `prohibited` records a human handoff and never executes. **Failure:** no safe or guarded proposal within bounded revisions → `failed: no-remediation`.

### Verify

- **Delegation:** the Control Plane applicability resolver computes the required, conditional, and not-applicable check set. Each required review role R1–R9 runs in its own specialist subagent with its matching skill, in parallel, each with its own scratch directory and no access to peer reports before consolidation. Each required or triggered test layer T1–T13 likewise runs in its own specialist subagent with its matching test skill (§4.6): the subagent plans and scopes that one layer, requests or consumes the pinned broker or company-pipeline run, and returns a receipt-bound Test Report. The deterministic tool, broker, company pipeline, resolver, and verdict function own execution facts and pass/fail authority; a model cannot forge a receipt, re-scope applicability, reinterpret a failure, or replace the gate. The Orchestrator may not add, remove, or re-bucket checks.
- **Ordering:** dependent test layers run in dependency order (build before unit, unit before candidate-instance checks); the check set records each layer's ordering edges.
- **Consolidation and verdict:** deterministic Control Plane code, per [review-verification.md](review-verification.md) — severity takes the maximum, findings stand until resolved, contradictions are adjudicated not voted, and the verdict function is the only thing that passes or fails.
- **Artifact:** Verification Report v1 per candidate hash. **Completion:** every required check passed, hash binding intact. **Failure:** fixable patch defects run the bounded Repair-to-Verify revision loop (new candidate hash, all Verify checks from the top, default cap 2); evidence that invalidates the accepted Hypothesis fails the attempt `hypothesis-invalidated` and never enters the loop; otherwise `failed: verification-failed`.

### Release

- **Delegation:** no model work. The Orchestrator seals the execution candidate and submits a release request (merge/deploy) or a typed direct-action request to the journal; the Release Gate or Action Gate runs outside the Worker; the Action Broker consumes the one-use permit and executes through the adapter. The Orchestrator never executes and never receives a credential.
- **Completion:** the matching gate returns `pass`; a `guarded` action also carries its recorded approval. **Failure:** `fail` → `failed: gate-failed`; `needs-human` parks the Run and resume continues from the gate, never around it; a severe regression after execution takes the pre-approved rollback path and fails `rollback-required`, per [release-recovery.md](release-recovery.md). Emergency Mode substitutes only pre-approved allow-list actions through the Action Gate; no fresh model diagnosis.

### Watch

- **Delegation:** the Orchestrator executes the frozen Watch plan's queries through the Read Broker per rollout step and compares results against the frozen limits in code — the comparison is deterministic, not model judgment. A model subagent may assemble the Watch Report from the recorded results; it never changes a limit, promotes on time, or reinterprets a result that fell between pass and fail limits as healthy.
- **Rollback:** the Orchestrator proposes rollback through the Action Broker; only a pre-approved, policy-permitted recovery action runs, per [release-recovery.md](release-recovery.md).
- **Completion:** all required gates pass with enough data → `completed: verified-remediation` and Incident `resolved`; the `symptom-cleared` confirmation window passes → `completed: symptom-cleared`. Severe regression → pre-approved rollback, Incident stays `open`, Run `failed: rollback-required`. Conflicting or missing data → `needs-human`. No data is never a pass.

## Fusion reuse and SIH-only behavior

### Reused from the live Fusion harness

Inspected 2026-08-15 in `/home/xdd/dev/sandbox/fusion` (dirty worktree, read-only for this task), commit `6e27998b6d11a76574e59cfdce8a1c9766b3fabc`:

| Fusion behavior | Fusion evidence | SIH reuse |
| --- | --- | --- |
| Independent participants | `research-fusion.ts` runs each participant as its own `Agent` with no shared state; `prompts.ts` `PARTICIPANT_SYSTEM_PROMPT` states they receive the same Shared Starting Context | Same: each participant is a fresh session with its own scratch, sees only task + brief + revision |
| Shared Starting Context | `createParticipantPrompt(task, brief)` — same task and brief for every participant | Same shape: diagnosis task + Context Brief with Brief Authority Levels + Evidence Set revision id |
| Judge before Synthesizer | `runResearchFusion` runs `runJudge` then `runSynthesizer` sequentially after all participants | Same order; Judge input is participant outputs only, never tool traces |
| No winner-picking, no vote-as-truth | `JUDGE_SYSTEM_PROMPT`: "Do not pick a winner" | Same; the Judge emits agreement, contradictions, blind spots, unique findings, and a citation audit; only the deterministic gate passes or rejects |
| Inspectable run evidence excluded from later context | `run-artifacts.ts` stores Fusion Run Artifacts as custom messages with `excludeFromContext: true`, anchored to the synthesized turn; artifacts persist even for failed and aborted runs; `run-details.ts`/`trace-collector.ts` record normalized traces, usage, phase durations, and retry delays | Same pattern: participant, Judge, and Synthesizer traces persist for the Incident Workspace and never re-enter model context; only the Synthesized Response is durable stage input |
| Context Brief from conversation-derived alignment | `BRIEF_SYSTEM_PROMPT` captures decisions, rationale, preferences, assumptions, constraints, unresolved tensions; `BRIEF_MAX_MESSAGES = 24`; Brief Authority Levels distinguish binding decisions | Same concept; SIH derives the brief from sealed artifacts (Incident Brief, policy versions) plus operator decisions, never from a raw transcript |
| Per-call retry, timeout, abort | `model-calls.ts` applies provider retry settings (`timeoutMs`, `maxRetries`, `maxRetryDelayMs`) and abort signals per call; `trace-collector.ts` records retry and rate-limit delays | Same per model call, and per SIH rule one failed participant does not abort a round with two valid outputs |

### Deliberate divergences

| Fusion behavior | SIH change | Reason |
| --- | --- | --- |
| Run aborts when any participant call rejects | Round remains valid with ≥ 2 well-formed outputs; failed participants are recorded with their traces | Fixed in [hypothesis-gate.md](hypothesis-gate.md) |
| Participant Outputs are free text | Outputs are machine-checked structured Hypothesis candidates with item-id citations, proposed tests, and objections | The eight-check gate needs structured inputs |
| `web_fetch` known-URL tool for participants and Judge | No open-web fetch in Diagnose; documentation fetch goes through the allow-list proxy and is context, never evidence; a causal claim cannot cite a web page | Fixed in [hypothesis-gate.md](hypothesis-gate.md) and [worker-isolation.md](worker-isolation.md) |
| `/fusion` user command, Fusion Model Selector, conversation-history semantics | Not reused; Fusion runs are Orchestrator-ordered stages inside Diagnose | Fixed in [docs/agents/fusion.md](../agents/fusion.md) |
| Deferred Investigative Fusion Mode | SIH Diagnose adds bounded broker experiments with pre-registered predictions | Fixed in [hypothesis-gate.md](hypothesis-gate.md) |
| Brief written by the Primary Model | Orchestrator builds the brief deterministically from sealed artifacts; a brief model is an optional policy choice | SIH has no conversation history to summarize; artifacts are already compact |

### SIH-only

Evidence Set receipts and hashes, the Hypothesis schema and eight-check gate, the Remediation disposition, stage artifacts and journaling, review/test applicability and the verdict function, the Release Gate and Action Gate, the Recovery Point and rollback, Watch with frozen limits, and the Attempt Limit. All are settled in the reports listed above and are implemented outside the model catalog; skills may produce content for them but never compute them.

## Skill catalog

### Packaging standard

Every skill is a directory under the Worker image's read-only skills root (`/opt/sih/skills/`), shipped and pinned by image digest, never installed during a run:

```
/opt/sih/skills/<name>/
├── SKILL.md          # standard frontmatter + role contract prose
├── contract.json     # SIH metadata: version, stage, tool group, access, independence, scope, output schema ref
├── schemas/          # JSON Schema for the role's output artifact
└── references/       # on-demand reference material
```

**Frontmatter.** Standard Agent Skills fields: `name` (lowercase, hyphens, ≤ 64 chars), `description` (≤ 1024 chars, says exactly when to invoke). SIH metadata goes in the standard `metadata` field (arbitrary key-value mapping, supported by Pi): `sih.stage`, `sih.tool-group`, `sih.access`, `sih.independence`, `sih.scope` (`solution` / `demo` / `both`), `sih.version`. Unknown frontmatter fields are ignored by Pi, so nothing SIH-specific may rely on custom top-level fields. Pi's `allowed-tools` frontmatter is experimental and is not the enforcement point: the SIH extension enforces per-session allow-lists with `pi.setActiveTools`, and brokers re-check everything server-side.

**System prompt composition order** (per subagent session, applied through the extension's `before_agent_start` hook):

1. Pi base prompt with built-in tools disabled and only the session's allow-listed tools described;
2. global Worker guardrails: no direct production access, credentials, or actions (stage-permitted, receipt-backed broker reads only), no secrets, cite Evidence Set item ids only, no peer outputs, outputs must match the role schema;
3. stage guardrails: binding rules for the current stage (e.g. Verify: "you are a reviewer; you cannot edit code or plans");
4. the skill's SKILL.md body;
5. the task and the exact input subset;
6. active tool snippets.

**Tool allow-list composition.** `contract.json` names a tool group (`read-only`, `worktree-edit`, `proposal`, `test-run`); the extension maps the group to concrete Pi tool names and calls `pi.setActiveTools` before the session's first turn. Brokers enforce the stage table independently of whatever tools a session can see.

**Version pinning.** The Worker image digest pins the Pi package, the SIH extension, and the skill tree. Each sealed artifact records its schema version, skill version, tool catalog version, resolver version, and policy version — the same content-addressed discipline as policy and tzdb pinning in [authority-action-risk.md](authority-action-risk.md). A new tool catalog version re-resolves the check set; already-sealed results stay pinned to the catalog that produced them, and a changed required check reruns, per [review-verification.md](review-verification.md).

### Orchestration and evidence skills

| | `sih-orchestrator` | `sih-evidence-gatherer` |
| --- | --- | --- |
| **When invoked** | Loaded once at Worker start; drives every stage | Between Fusion rounds, when the gate returns `continue`, or when Detect/Diagnose needs composed queries |
| **Input subset** | Run lease claims, journal checkpoint, sealed artifacts by hash, policy versions, budgets | The gap list from the Synthesizer or gate: named evidence kinds, queries, or bounded experiments to run |
| **Allowed tools** | `spawn_subagent`, proposal APIs (`propose_artifact`, `propose_transition`, `request_gate_evaluation`, `request_applicability`), Read Broker reads, local scratch notes | Read Broker query tools only, plus experiment proposal |
| **Access** | Read: broker reads. Write: Worker scratch only; all durable writes are proposals. Network: Control Plane and broker endpoints only. No secrets; no direct production access, credentials, or actions | Read-only through the Read Broker; no writes, no shell; no direct production access, credentials, or actions |
| **Output** | Stage artifact proposals and transition proposals; subagent run records | Proposed evidence actions with receipts; items enter the Evidence Set only by broker receipt |
| **Independence** | Is the Orchestrator; never a reviewer, Judge, or Synthesizer | Runs alone; cannot see participant or Judge outputs |
| **Retry / failure** | Crash: Worker restart cap 2, then `unstable-worker`; gate `needs-human`: Run parks, resume continues from the gate | Failed queries mark items `unresolved`; never fabricates coverage |
| **Scope** | Both | Both |

### Fusion role skills

All three share the Diagnose read-only tool group (Read Broker metric/trace/log/code queries; no web, no writes, no shell; no direct production access, credentials, or actions — only stage-permitted, receipt-backed broker reads) and receive the same diagnosis task, Context Brief, and Evidence Set revision id. Differences:

| | `sih-fusion-participant` | `sih-fusion-judge` | `sih-fusion-synthesizer` |
| --- | --- | --- | --- |
| **When invoked** | Every Diagnose round; ≥ 2 in parallel (count is per-run policy choice, not frozen) | Once per round, after all participants complete | Once per round, after the Judge completes |
| **Input subset** | Task, brief, revision id, cited Evidence Set subset | Task, brief, revision id, all Participant Outputs (never tool traces) | Task, brief, revision id, Participant Outputs, Judge analysis |
| **Output schema** | Structured Hypothesis candidates: causal claims with item-id citations, predicted observations, proposed tests, stated objections (machine-checked) | `agreements`, `contradictions`, `blind_spots`, `unique_findings`, `citation_audit` (machine-checked; no winner, no confidence) | `ranked_hypotheses`, `contradictions`, `gaps`, `next_actions`, `fusion_meta` (machine-checked) |
| **Independence** | Parallel, isolated scratch, no peer visibility, cannot communicate; citations must reference revision R_n | Sees participant outputs only; may query the same read-only evidence | Sees Judge analysis and participant outputs; its output alone is durable stage input |
| **Retry / failure** | One failed participant does not invalidate the round if ≥ 2 valid outputs remain; otherwise round invalid and reruns (counts against round cap where configured) | Malformed or failed Judge output reruns once; a second failure invalidates the round | Malformed output reruns once; a second failure ends the round `needs-human` or consumes the round cap |
| **Scope** | Both (Demo Profile: exactly 2 participants) | Both (Demo Profile: exactly 1 Judge) | Both (Demo Profile: exactly 1 Synthesizer) |

### Repair skills

| | `sih-repair-planner` | `sih-repair-implementer` |
| --- | --- | --- |
| **When invoked** | Once per attempt after the accepted Hypothesis and Remediation disposition are recorded | Once per candidate revision, after the planner's draft |
| **Input subset** | Accepted Hypothesis, Remediation disposition, the risk table and adapter declarations, Authority Mode and policy versions, code snapshot, Recovery Point draft inputs, service catalog | The planner's draft, the causal citation map, the base snapshot |
| **Allowed tools** | Read Broker reads; proposal drafting in own scratch | Own private copy-on-write worktree or scratch: edit, write, patch, local build/test tools; PR or typed-plan submission only through the Action Broker |
| **Access** | Read: broker reads. Write: scratch only. No direct production access, credentials, or actions | Write: own worktree or scratch only. Network: allow-list proxy for dependencies; no secrets; no direct production access, credentials, or actions |
| **Output** | Remediation Proposal v1 draft: change description, citation map, test plan, Recovery Point fields, blast radius, declared action and changed surfaces (the action-risk class is computed afterward by the Control Plane) | The candidate diff or typed action plan in its private worktree or scratch; the Orchestrator integrates it into the sole integration worktree |
| **Independence** | Never reviews or tests its own plan; one planner per attempt | The implementer never reviews its own candidate; a new revision may use a fresh implementer |
| **Retry / failure** | Bounded internal revisions; each journal submission is a new candidate hash; no proposal → `failed: no-remediation` | Build or test failure during drafting loops locally; a barred or prohibited surface never reaches execution |
| **Scope** | Both | Both |

### Review role skills R1–R9

Common contract from [review-verification.md](review-verification.md) applies to all nine: inputs are the candidate diff or typed action plan, base snapshot, accepted Hypothesis, citation map, disposition, service catalog, policy version, pinned Evidence Set subset, Recovery Point draft, and already-produced check outputs. Tools are read-only: `read`, `grep`, `find`, `ls` on the pinned snapshot; known-URL fetch through the allow-list proxy (context only, never evidence); pinned read-only analyzers in the sandbox. No project writes, no shell; no direct production access, credentials, or actions — only stage-permitted, receipt-backed broker reads; no secrets. Output is Review Report v1 with findings carrying severity (`blocker` / `major` / `minor` / `info`), citations (file and line, check output ref, item id, or Recovery Point gap), tool versions, and reviewer identity. Scope is the candidate's own diff plus declared surfaces. Independence: each role runs in a distinct subagent instance with its own scratch, in parallel, without peer reports before consolidation; the authoring subagent never reviews; the Orchestrator never substitutes a required report. Retry/failure: malformed report or uncited `blocker`/`major` finding reruns the role once against the same candidate hash; still malformed or uncited → `needs-human`. Every role exists in both scopes; the Demo Profile builds only the ones its classes trigger (see §10).

| Skill | Role | Required for classes | Conditional trigger |
| --- | --- | --- | --- |
| `sih-review-correctness` | R1 Change correctness | Code, Configuration, Feature flags, Deployment, Restart/scale/traffic, Infrastructure, Database, Credentials | — |
| `sih-review-causal-fit` | R2 Causal fit | All classes except Emergency (Emergency substitutes the deterministic precondition check) | — |
| `sih-review-code-quality` | R3 Code quality | Code | Database (migration code) |
| `sih-review-security` | R4 Security / threat | Code, Configuration, Feature flags, Deployment, Infrastructure, Database, Credentials | Restart/scale/traffic (traffic reroute) |
| `sih-review-dependencies` | R5 Dependency / supply-chain | — | Dependency-manifest or lockfile diff, or declared dependency surface |
| `sih-review-data-migration` | R6 Data / migration safety | Database | Code (migration or schema paths) |
| `sih-review-infrastructure` | R7 Infrastructure / policy | Infrastructure | Code, Configuration, Credentials (manifest or policy paths) |
| `sih-review-recovery-point` | R8 Rollback / Recovery Point | Code, Configuration, Feature flags, Deployment, Restart/scale/traffic, Infrastructure, Database, Credentials | — |
| `sih-review-operations` | R9 Operations / observability | Deployment | Logging, metrics, alerting, runbook, or Watch-plan changes |

Emergency and rollback run no fresh model reviews; their standing artifacts are re-checked deterministically at the Action Gate, per [review-verification.md](review-verification.md).

### Test layer skills T1–T13

Every test layer is a specialist skill, and each applicable layer (required or triggered by the applicability resolution) runs in its own fresh subagent. The subagent plans and scopes exactly one layer, maps the fixed catalog inputs to an execution request, requests the pinned run through the broker or consumes the company-pipeline result, and returns a structured receipt-bound Test Report. The deterministic tool, the broker, the company pipeline, the applicability resolver, and the Control Plane verdict own execution facts and pass/fail authority; a model cannot forge a receipt, pick its own applicability, reinterpret a failure, or replace the gate.

Common contract for all thirteen:

- **Inputs:** the candidate hash and change set, the layer's pinned tool/catalog entry with tool and database versions, the target selection (the ownership-map selection for T5, declared surfaces, changed file paths), the execution environment (isolated candidate instance, browser sandbox), any upstream check output the layer depends on (build before unit), and the resolver's trigger-evaluation record for conditional layers.
- **Allowed tools:** the execution-request tool for the layer (broker/CI or browser), read tools on receipts and test output, and — for T6 only — harness authoring in isolated scratch; T10 additionally drives the brokered browser. No project writes and no shell beyond the isolated sandbox. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process and revokes it after the run.
- **Access:** no direct production access, credentials, or actions; only stage-permitted, receipt-backed broker reads. Browser and test environments stay non-production.
- **Output:** Test Report v1 per layer, sealed by content hash: tool and versions, target, execution request id, broker receipt ref, run hashes, outcome (`pass` / `fail` / `flaky-pass` / `error` / `not-run`), a coverage check against the receipt, and the candidate-hash binding. The report cites receipts; it never asserts a result the receipt does not contain.
- **Independence:** one subagent per layer, its own scratch, parallel where ordering allows, no peer reports before consolidation; the authoring subagent never tests its own change.
- **Retry / failure:** a malformed report reruns once, then `needs-human`; a failed or flaky run is recorded exactly as the receipt states — `flaky-pass` on a required or triggered layer returns `needs-human`; a timeout records `error`, reruns once, then `needs-human`. A model cannot reinterpret a failed run as passing.

| Skill | Layer | Invocation | Model role (plan / scope / check against the receipt) |
| --- | --- | --- | --- |
| `sih-test-static-analysis` | T1 Static analysis | Required: Code, Deployment (pipeline-consumed) | Maps the diff to the catalog linter entry; requests the run; checks the findings list against the receipt |
| `sih-test-build` | T2 Schema / lint / build | Required: Code; Configuration, Feature flags, Infrastructure (schema/lint) | Selects build target and validation command from the catalog; requests; verifies the artifact digest |
| `sih-test-unit` | T3 Unit | Required: Code | Maps changed packages to unit targets; requests; checks the per-test summary |
| `sih-test-contract` | T4 Integration / contract | Required: Code, Configuration, Feature flags; conditional elsewhere | Maps declared dependencies to contract checks; requests; checks the contract receipts |
| `sih-test-regression` | T5 Regression | Required: Code (scoped); pipeline-consumed for Deployment | Confirms the resolver's ownership-map selection matches the receipt; never re-scopes the suite |
| `sih-test-fuzz` | T6 Property / fuzz | Triggered: parsing/validation/serialization/boundary diff and the catalog holds a fuzz or property tool for the language | Authors the harness or property for the candidate in isolated scratch; requests the run; reads the counterexample or clean-run receipt |
| `sih-test-security-scan` | T7 Security scanning | Required: Code, Deployment (pipeline-consumed); conditional elsewhere | Requests the applicable pinned scanners; records tool and database versions; scanners never replace R4 |
| `sih-test-migration` | T8 Migration tests | Triggered: data surface declared or migration/schema paths changed | Maps migration paths to up/down plus restore drill; requests; checks the drill receipts |
| `sih-test-isolated-env` | T9 Isolated environment | Triggered: Deployment/Database/Infrastructure class or a candidate target exists | Requests candidate deploy with representative traffic; checks start/serve receipts |
| `sih-test-browser` | T10 E2E / browser | Triggered: user-facing paths touched | Drives the brokered browser over the touched paths; returns Playwright-style run receipts |
| `sih-test-load` | T11 Load / performance | Triggered: performance-sensitive path declared | Maps the hot path to a benchmark with bounds; requests; checks the results |
| `sih-test-fault-recovery` | T12 Fault / recovery | Triggered: changed surface or Recovery Point names a restart/rollback/toggle/rotation/reroute | Maps the changed surface to the drill; requests; checks the drill receipts |
| `sih-test-watch-rehearsal` | T13 Watch-plan rehearsal | Required for every class ending in an execution gate with a Watch plan | Requests the frozen Watch plan's queries against a non-production environment; validates operability, never production health |

All thirteen belong to the Solution Contract catalog. The Demo Profile packages only the subset its selected runs trigger (see §10). A triggered T10 whose browser environment is unavailable returns `needs-human`, never a skip.

## Brokered tool catalog and boundary

### In-Worker Pi tools (SIH extension, in-process)

These run with the Pi process's permissions, so they operate only on Worker-local state; anything external is a broker call.

| Tool | Operates on | Notes |
| --- | --- | --- |
| `read`, `grep`, `find`, `ls` | Pinned read snapshot only | The snapshot is copied in and mounted read-only, never a host bind mount |
| `edit`, `write`, `patch_apply` | The session's own scratch or copy-on-write worktree | Repair implementer only; other stages never see these |
| `bash` (sandbox) | Worker-local commands | Local build and unit tests; declares `network: false` by default |
| `web_fetch_allowlisted` | Known URLs through the allow-list proxy | Documentation context only, never evidence |
| `artifact_draft` / `evidence_note` | Local scratch files | Drafts later proposed to the journal |
| `spawn_subagent` | Creates bounded skill-bound sessions | SDK pattern; records parent-child ids |
| `propose_artifact`, `propose_transition`, `request_gate_evaluation`, `request_applicability` | Control Plane proposal APIs | The only durable-write path |

### Brokers and gateways (outside the Worker)

| Surface | What it exposes to the Worker | Rules |
| --- | --- | --- |
| Read Broker | Telemetry queries (metric/trace/log/security-finding/deployment-event snapshots with receipts), code and context reads (service catalog, runbooks, past Incidents), target-state reads for Watch | Company scope, field redaction, row and time bounds; returns data, never credentials |
| Action Broker | Typed operations through adapters: `submit_remediation_pr`, `submit_typed_action`, `request_isolated_ci`, `request_rollback`, `request_browser_session`, `request_test_secret` | Gate → permit → broker; lease, idempotency key, expected-version check; reconciles unknown outcomes |
| Evidence Journal API (Control Plane) | Append receipt-derived items; seal artifacts by hash | The Worker proposes; only receipts become items |
| Model Gateway | All model calls for every session | Provider keys only here; redaction profile applied; per-attempt budgets |
| CI/release adapter | Behind the Action Broker: trigger or resume the company pipeline, read pipeline state via the Read Broker | Never holds deployment credentials; consumes native checks |
| Browser automation | Broker-provisioned isolated browser sandbox | The Worker never runs a browser against production |
| Git/worktrees | Local in the Worker (copy-on-write); source-host writes only through the Action Broker | The integration worktree alone becomes an artifact |
| Artifact/journal APIs | Control Plane endpoints | Worker proposal-only |

Boundary rules, all broker-enforced regardless of what a Worker asks: a tool that declares network may only call a declared broker or gateway endpoint; the run lease carries stage and tool class; server-side state re-check beats any local claim; a prompt injection or faulty extension cannot widen access because brokers reject what policy does not allow, per [worker-isolation.md](worker-isolation.md). Test-layer subagents request their runs through the Action Broker or the CI/release adapter (or the brokered browser sandbox for T10) and consume results as receipts; a test tool runs directly in the Worker only inside the isolated sandbox, never against a production target.

## Context hygiene

- **Broad Incident-scoped reads, never dumps.** The Read Broker bounds every query by selector, time range, and rows, applies the redaction profile, and returns snapshots with content hashes and links. The Worker never receives raw backend dumps, full log streams, or whole telemetry stores.
- **Citation and hash rules.** Causal claims cite Evidence Set item ids from the pinned revision only; a citation outside R_n is invalid. Items, artifacts, and candidates are content-hashed; results bind to the candidate hash they ran against. Worker-derived restatements are never items.
- **Per-role least context.** A participant gets task + brief + revision id + cited subset; a reviewer gets diff + base + Hypothesis + citation map + policy, never the diagnosis transcript or peer reports; a Watch assembler gets the frozen plan and recorded results, not the whole Run. The Orchestrator assembles each session's input; nothing else leaks.
- **Model-provider redaction.** The Model Gateway applies the redaction profile before any context leaves the company boundary; secrets and user data never enter prompts, per [company-integration.md](company-integration.md).
- **Fusion trace exclusion.** Participant and Judge traces and Fusion Run Artifacts persist for the Incident Workspace and are excluded from future model context, mirroring the live `excludeFromContext` mechanism in `run-artifacts.ts`; only the Synthesized Response continues.
- **Independence by construction.** Each subagent session starts empty, owns a private scratch, sees no peer output, and cannot communicate with siblings; the Orchestrator strips peer artifacts from every input it assembles. The Verify stage adds its own rule: reviewers see no other reviews before consolidation, and the authoring subagent id differs from every reviewer id.

## Model, provider, concurrency, and budget policy

- **No vendor lock-in.** The catalog names roles, not models. Policy resolves each role to allowed models through the Model Gateway; nothing in this report hard-codes a provider. The live Fusion configuration demonstrates the required shape without being a product dependency: at least two participants, a Judge, and a Synthesizer that defaults to the primary model (`resolveFusionConfiguration` in `model-configuration.ts`).
- **Diversity.** Policy may require distinct participant models, and should pick a stronger Judge — the same guidance Fusion's onboarding gives (`formatFusionOnboarding`: "at least two diverse participant models and a stronger Judge Model"). The constraint is configurable policy, not code.
- **Concurrency.** Participant and review subagents run in parallel inside the Worker; the Orchestrator caps process count and concurrent model calls per [worker-isolation.md](worker-isolation.md); the Model Gateway enforces per-attempt budgets and stops new calls when spent.
- **Production budgets** (defaults, operator-configurable, from [authority-action-risk.md](authority-action-risk.md)): wall time 30 minutes per attempt (Job `activeDeadlineSeconds`), token and cost caps at the Model Gateway, Fusion-round cap 3, revision cap 2, Worker restart cap 2, and the configured Attempt Limit (default 3). Emergency actions and rollbacks do not consume attempts.
- **Demo Profile.** Removes the Fusion-round, evidence-action, broker-action, time, token, and model-cost caps so a saved Demo Run finishes on evidence, not a budget; keeps the configured Attempt Limit, Authority Mode, both gates, approvals, leases, host limits (CPU, memory, process, filesystem, network), operator cancel, and cleanup, per [authority-action-risk.md](authority-action-risk.md).

## Failure handling

| Event | Trigger | Response | Enforced by |
| --- | --- | --- | --- |
| Cancellation / pause | Human action | Run lease revoked; no new broker action; in-flight actions reconcile; child sessions aborted via their abort signals; Worker torn down | Control Plane + Orchestrator |
| Subagent timeout | Per-check policy timeout | Record `error`; rerun once; repeat escalates to `needs-human` | Control Plane verdict rules |
| Malformed output | Schema validation fails | Rerun the role once against the same inputs/hash; still malformed → `needs-human`; in Diagnose, a malformed participant simply does not count toward round validity | Orchestrator + Control Plane |
| Tool failure | Broker or Model Gateway down | The stage cannot seal; the Run parks `interrupted` or `awaiting-human`; never proceeds on missing evidence | Control Plane |
| Context overflow | Session grows past model limits | SIH does not rely on Pi compaction as a resume mechanism; the Orchestrator seals the checkpoint and the stage continues in a fresh Worker with per-role least context reassembled from sealed artifacts | Orchestrator + Control Plane |
| Worker crash / resume | Heartbeat loss, crash, timeout | `interrupted`; leases and permits stop; external actions reconcile before anything retries; resume replays the journal into a fresh Worker on the same attempt; restart cap 2, then `unstable-worker` | Control Plane |
| Candidate revision | Fixable patch defect in Verify | Bounded Repair-to-Verify loop: new candidate hash, all Verify checks from the top, cap 2 | Orchestrator proposes; Control Plane caps |
| Hypothesis invalidation | Test or review evidence contradicts the accepted Hypothesis | Never a revision loop: attempt fails `hypothesis-invalidated`; a new Diagnose attempt starts | Control Plane |
| Flaky result | Fail-then-pass on the same hash | Recorded `flaky-pass` with both runs; on a required or triggered-conditional check → `needs-human`, never a pass | Control Plane |

## Demo Profile minimum subset

The Demo Profile builds only the skills the two Code-class runs selected in [demo-runs.md](demo-runs.md) trigger. Both use the Payment overlay: Run 1 reaches Release and Watch after verified remediation; Run 2 ends in Verify when R1 and T5 expose a second seeded defect.

**Build rule:** for each selected run, build every review skill and test-layer skill whose matrix cell is required or triggered for that run's Remediation class and declared surfaces, plus the core skills below.

Required regardless of run choice:

- the SIH Worker image: Pi package pinned, the extension (tool registration, `setActiveTools` per session, `spawn_subagent`), skills tree, read-only snapshot, rootless Docker hardening per [worker-isolation.md](worker-isolation.md);
- core skills: `sih-orchestrator`, `sih-fusion-participant`, `sih-fusion-judge`, `sih-fusion-synthesizer`, `sih-repair-planner`, `sih-repair-implementer`;
- local brokers: Read Broker and Action Broker pointed at the Astronomy Shop and the local test repository, local CI runner, Model Gateway with the demo providers, the Compose probe ring and Recovery Point per [company-integration.md](company-integration.md).

Exact minimum for both selected Code-class runs, from [demo-runs.md](demo-runs.md) and [review-verification.md](review-verification.md):

- review skills R1, R2, R3, R4, and R8;
- test skills T1, T2, T3, T4, scoped T5, T7, T9, T10, T12, and T13;
- Run 1 consumes all passing reports, validates its Recovery Point, passes the Release Gate, and records production Watch; Run 2 records R1's cited reachability finding and T5's deterministic regression failure, then ends `verification-failed` before either execution gate.

Not built for the Demo Profile: R5, R6, R7, R9, T6, T8, and T11. Also not built: a direct-action saved run, an automatic-rollback saved run, the full adapter catalog, Kubernetes Jobs with gVisor, workload-identity federation, production budget enforcement beyond the removed caps, multi-provider policies beyond the demo providers, and the notification adapter. The Solution Contract still includes those roles and rollback behavior.

## Implementation order

1. **Contracts first:** `contract.json` schema and JSON Schema per skill output (including all thirteen Test Report schemas); contract tests for every schema, the tool-group → tool-name mapping, and the per-skill allow-list (read and test skills cannot see write, direct-production, or credential tools). No agents yet.
2. **Worker image skeleton:** pinned Pi, the SIH extension registering the in-Worker tools and `spawn_subagent`, skills tree mounted read-only, non-interactive startup with trust denied and built-ins disabled, local journal/artifact proposal stubs.
3. **Orchestrator skill:** startup-input assembly, stage loop, proposal tools against a local Control Plane stub; state-machine tests for every transition the Orchestrator proposes.
4. **Fusion diagnosis:** participant, Judge, Synthesizer, and evidence-gatherer skills against the local Read Broker and demo Model Gateway; round-validity and trace-exclusion tests (Fusion Run Artifact pattern).
5. **Repair:** planner and implementer skills with copy-on-write worktrees and the Action Broker PR/typed-plan path.
6. **Verify:** review skills R1–R4 and R8, plus T1–T5, T7, T9, T10, T12, and T13 — each a skill-bound subagent that requests the local CI runner, browser, or broker and returns a receipt-bound report; consolidation and verdict via Control Plane code.
7. **Release and Watch:** release-request tools, Watch query execution against the frozen plan, the Release Gate, and the Recovery Point in Compose form. Keep the rollback proposal contract in the product design; the saved runs do not execute it.
8. **Demo Runs:** produce the saved verified-remediation and failed-verification runs from [demo-runs.md](demo-runs.md), then replay them in the Workspace from the journal and sealed artifacts alone.
9. **Solution Contract hardening:** remaining review skills R5–R7 and R9, the full tool catalog, gVisor Jobs, Model Gateway budgets, multi-provider policies, and adapter coverage.

## Acceptance checks

1. Every skill output validates against its schema, including all thirteen Test Report schemas; a malformed output triggers exactly one rerun and then `needs-human`.
2. A read-only or test skill's session has no write, shell, direct-production, or credential tools (allow-list test), and the broker denies the same request regardless (server-side test).
3. The authoring subagent id differs from every reviewer and test-runner id; the Orchestrator never produces a Review Report or a Test Report; participants never see peer outputs (isolation tests).
4. Only broker receipts enter the Evidence Set; a worker-derived restatement cannot support any gate check.
5. Participant and Judge traces persist for the Workspace and are excluded from all later model context; only the Synthesized Response is durable stage input.
6. A round with fewer than two valid participant outputs is invalid and reruns; a failed participant with two valid outputs does not abort the round.
7. The deterministic Hypothesis gate, applicability resolver, consolidation, and verdict function accept no model input; a model cannot change a gate result, a risk class, or a candidate hash.
8. Each T-layer subagent returns a receipt-bound Test Report; a model cannot forge a receipt, re-scope applicability, or reinterpret a failed or flaky run as passing.
9. No Orchestrator or subagent path reaches merge, deploy, or production directly; release and direct-action requests execute only through the Action Broker after the matching gate.
10. A policy-tightening, pause, or cancellation aborts subagent sessions and stops new broker actions immediately; in-flight actions reconcile.
11. Crash, heartbeat loss, and Control Plane restart resume the Run in a fresh Worker from the journal checkpoint and sealed artifacts, with the restart cap (2) enforced.
12. The bounded Repair-to-Verify revision loop reruns all Verify checks on each new candidate hash and stops at the cap; hypothesis-invalidating evidence fails the attempt instead.
13. Budgets (wall time, tokens, cost, round cap, revision cap) are enforced at the Model Gateway and Control Plane in the Solution Contract; the Demo Profile drops only research, action, time, token, and cost caps while the Attempt Limit and every other control stay.
14. Each sealed artifact records its skill, tool catalog, resolver, and policy versions; a new catalog version re-resolves the check set and a changed required check reruns.
15. The two saved Demo Runs replay their full skill, review, test, gate, and receipt trail in the Incident Workspace from the journal and sealed artifacts alone.

## Rejected alternatives

- **Freezing the subagent graph, participant count, or models in the contract:** rejected in [orchestrator-stages.md](orchestrator-stages.md); only the round shape, role schemas, and independence rules are frozen.
- **Pi skills or extensions as a permission boundary:** rejected; Pi documents that extensions share the Pi process's permissions, so brokers are the boundary and the in-process checks are only a second layer.
- **Relying on Pi's experimental `allowed-tools` frontmatter:** rejected; the SIH extension applies per-session allow-lists with `pi.setActiveTools` and brokers re-check server-side.
- **Fusion's all-or-nothing participant failure:** rejected; SIH keeps rounds valid with two well-formed outputs, per [hypothesis-gate.md](hypothesis-gate.md).
- **Open-web fetch for Diagnose participants:** rejected; SIH restricts documentation fetch to the allow-list proxy and treats it as context, never evidence.
- **One universal reviewer or test skill:** rejected; the nine roles, the thirteen layers, and the applicability matrix are fixed policy code in [review-verification.md](review-verification.md).
- **Treating T1–T13 as bare deterministic tool runs with no skill:** rejected; every applicable layer runs in its own specialist subagent that plans, scopes, requests, and reports against the receipt, while the tool and gate keep pass/fail authority.
- **The Orchestrator as Judge, Synthesizer, or reviewer:** rejected; it would judge its own coordination.
- **Model-driven Watch verdicts or promotion:** rejected; limits, stop rules, and promotion are frozen in the Watch plan and compared in code.
- **Pi session compaction as the SIH resume mechanism:** rejected; the journal plus sealed artifacts are the only resume path, and per-role least context keeps sessions small.
- **Hard-coding a model vendor:** rejected; roles resolve to models through Model Gateway policy, matching the live Fusion configuration's provider-agnostic references.
- **Subagents as separate Workers with their own leases:** rejected; one Worker per attempt is one trust boundary and one budget scope, per [worker-isolation.md](worker-isolation.md).

## Hand-off to issue #12

The Incident Workspace (#12) consumes this catalog as its render anchors: the stable skill and role names, the journal's model-use records (parent-child ids, prompts, models, token use, tool calls, results), the Fusion round records with the trace-exclusion rule, Review Reports with findings and citations, Test Reports with receipt references and tool/database versions, gate fact tables, and the saved-run replay requirements. #12 needs no knowledge of subagent internals: everything it renders is a journal entry or a sealed artifact with a hash, a schema version, and a skill version.

## Primary evidence

- Live Fusion Agent Harness, `/home/xdd/dev/sandbox/fusion`, inspected 2026-08-15 read-only at commit `6e27998b6d11a76574e59cfdce8a1c9766b3fabc` (branch `master`, dirty worktree; `packages/coding-agent/src/core/fusion/` is untracked in-flight work, read as the current source of truth per [docs/agents/fusion.md](../agents/fusion.md)):
  - `packages/coding-agent/src/core/fusion/research-fusion.ts` — parallel participants via `Promise.allSettled`, Judge after participants, Synthesizer after Judge, brief creation only when conversation context exists, abort handling, and the all-participants-must-succeed rule SIH deliberately changes;
  - `packages/coding-agent/src/core/fusion/prompts.ts` — `PARTICIPANT_SYSTEM_PROMPT` (shared starting context, no write claims), `JUDGE_SYSTEM_PROMPT` ("Do not pick a winner"), `SYNTHESIZER_SYSTEM_PROMPT`, brief prompt, `BRIEF_MAX_MESSAGES = 24`, prompt assembly for each role;
  - `packages/coding-agent/src/core/fusion/model-configuration.ts` — `resolveFusionConfiguration`: participants ≥ 2 required, Judge required, Synthesizer defaults to the primary model, brief defaults to the Synthesizer; onboarding text recommending diverse participants and a stronger Judge;
  - `packages/coding-agent/src/core/fusion/tool-policy.ts` — read-only `read, grep, find, ls` plus known-URL `web_fetch` for participants and Judge;
  - `packages/coding-agent/src/core/fusion/model-calls.ts` — in-process `Agent` construction per role, provider retry settings (`timeoutMs`, `maxRetries`, `maxRetryDelayMs`), auth from the model registry, abort via `AbortSignal`;
  - `packages/coding-agent/src/core/fusion/run-artifacts.ts`, `run-details.ts`, `trace-collector.ts` — Fusion Run Artifacts as custom messages with `excludeFromContext: true`, normalized traces (system prompt, input messages, transcript, output), usage and retry/rate-limit metrics, artifacts persisted even for failed and aborted runs;
  - `CONTEXT.md` — Fusion language: Shared Starting Context, Fusion Scratchpad, Judge Model ("extracts agreement, contradictions, blind spots, and useful unique contributions", "evaluates Participant Outputs, not participant tool traces"), only the Synthesized Response stored in durable history.
- Pi official documentation, version 0.84.2 (`@earendil-works/pi-coding-agent` installed locally at `/home/xdd/.nvm/versions/node/v26.7.0/lib/node_modules/@earendil-works/pi-coding-agent/`; the live site `pi.dev/docs/latest/security` fetched 2026-08-15 matches the installed copy):
  - `docs/security.md` — no built-in sandbox, tools and extensions run with the process permissions, OS/container boundary required, project trust is not a sandbox, non-interactive trust behavior;
  - `docs/extensions.md` — `pi.registerTool`, `pi.setActiveTools`, `tool_call` blocking, `before_agent_start` system-prompt composition, `context` message filtering, `pi.appendEntry` entries excluded from LLM context;
  - `docs/skills.md` — Agent Skills standard frontmatter (`name`, `description`, `metadata`, experimental `allowed-tools`), discovery locations, unknown frontmatter fields ignored;
  - `docs/sdk.md` — `createAgentSession` and "build custom tools that spawn sub-agents" as the documented subagent pattern (no dedicated subagent primitive exists in the docs);
  - `docs/json.md` — JSON event stream mode for non-interactive integration; `docs/session-format.md` — JSONL session storage;
  - `docs/containerization.md` — plain Docker pattern for whole-process isolation used by the Demo Profile.
- Settled reports, same research date: [worker-isolation.md](worker-isolation.md) (Worker shape, stage tool table, Orchestrator/subagent bounds), [orchestrator-stages.md](orchestrator-stages.md) (stage contracts, resume, budgets), [hypothesis-gate.md](hypothesis-gate.md) (Fusion round contract, Judge and Synthesizer schemas, gate), [review-verification.md](review-verification.md) (R1–R9 roles, T1–T13 layers, verdict function, hand-off rules), [authority-action-risk.md](authority-action-risk.md) (budgets, leases, approvals), [release-recovery.md](release-recovery.md) (Watch, Recovery Point), [company-integration.md](company-integration.md) (Model Gateway redaction, adapters).
