/**
 * Local end-to-end smoke: boot the Control Plane against local PostgreSQL,
 * ingest a signed Sample IncidentTrigger, acquire the run lease, boot the
 * Worker for the fixture incident, and drive Detect -> Diagnose (a Fusion
 * round with two deterministic stub participants) against the fixture
 * evidence, posting broker receipts.
 *
 * No model provider is used: the Model Gateway runs a deterministic stub
 * provider that returns structured, schema-valid Fusion participant, Judge,
 * and Synthesizer outputs. The deterministic Hypothesis gate still runs for
 * real inside the Control Plane.
 *
 * Requires PostgreSQL: `apps/control-plane/scripts/db.sh start`.
 */
import { contentHash, deliveryKey, incidentKey, sha256Hex } from "@sih/contracts/hashes"
import { ModelGateway, ReadBroker } from "@sih/brokers"
import type { ControlPlaneClient, LeaseRef, ModelProvider } from "@sih/brokers"

import { bootstrap } from "@sih/control-plane/src/bootstrap.js"
import { loadConfig } from "@sih/control-plane/src/config.js"
import type { ControlPlane } from "@sih/control-plane/src/core/state-machine.js"
import type { EvidenceItem } from "@sih/contracts/types"

import { bootstrapWorker } from "../src/worker/bootstrap.js"
import { DEMO_BUDGETS } from "../src/worker/budgets.js"
import { loadSkillTree } from "../src/skill-catalog.js"
import { PiOrchestratorExtension } from "../src/orchestrator/orchestrator.js"
import type {
  ControlPlaneProposals,
  EvidenceBundle,
} from "../src/orchestrator/orchestrator.js"
import { SKILLS_ROOT } from "../test/helpers.js"

const NOW = new Date().toISOString()
const WINDOW_START = new Date(Date.now() - 3600_000).toISOString()

function hashOf(payload: unknown): `sha256:${string}` {
  const digest = contentHash(JSON.parse(JSON.stringify(payload)) as never)
  if (!digest.ok) {
    throw new Error(digest.error.message)
  }
  return digest.value
}

function itemId(tag: string): `sha256:${string}` {
  return `sha256:${sha256Hex(tag)}`
}

/** The fixture Evidence Set for the Demo Run 1 payment charge failure. */
function buildEvidence(): { items: EvidenceItem[]; bundle: EvidenceBundle } {
  const metricId = itemId("metric:error-ratio-0.92")
  const deploymentId = itemId("deployment:seed-commit-s1")
  const codeId = itemId("code:card.js-card-type-clause")
  const logId = itemId("log:card-type-error-text")
  const traceId = itemId("trace:charge-span-error")
  const flagdId = itemId("flagd:paymentFailure=0")
  const baselineId = itemId("metric:baseline-ratio-0.01")
  const testResultId = itemId("test-result:card-unit-suite")

  const metric: EvidenceItem = {
    id: metricId,
    kind: "metric",
    backend: "prometheus",
    identity: {
      metric_name: "traces_span_metrics_calls_total",
      metric_labels: { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
      window: { starts_at: WINDOW_START, ends_at: null },
    },
    snapshot: 0.92,
    content_hash: hashOf({ metric: "error-ratio", value: 0.92 }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["prometheus-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const deployment: EvidenceItem = {
    id: deploymentId,
    kind: "deployment-event",
    backend: "git",
    identity: {
      before_version: "pristine-digest",
      after_version: "seed-digest",
      diff_hash: `sha256:${sha256Hex("diff-s1")}`,
      applied_at: NOW,
    },
    snapshot: "seed commit S1 applied",
    content_hash: hashOf({ deployment: "s1", after_version: "seed-digest" }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["git-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const code: EvidenceItem = {
    id: codeId,
    kind: "code-location",
    backend: "git",
    identity: {
      commit: "seed-commit-s1",
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
    },
    snapshot: "card-type clause",
    content_hash: hashOf({ file: "src/payment/card.js", line: 12 }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["git-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo", code_file_path: "src/payment/card.js" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const log: EvidenceItem = {
    id: logId,
    kind: "log",
    backend: "opensearch",
    identity: { trace_id: "trace-exemplar", span_id: "span-charge" },
    snapshot: "Sorry, we cannot process visa credit cards.",
    content_hash: hashOf({ log: "card-type-error" }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["opensearch-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const trace: EvidenceItem = {
    id: traceId,
    kind: "trace",
    backend: "jaeger",
    identity: { trace_id: "trace-exemplar", span_id: "span-charge" },
    snapshot: { value: 1 },
    content_hash: hashOf({ trace: "exemplar", span: "charge" }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["jaeger-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const flagd: EvidenceItem = {
    id: flagdId,
    kind: "metric",
    backend: "flagd",
    identity: {
      metric_name: "paymentFailure",
      metric_labels: {},
      flag_key: "paymentFailure",
      window: { starts_at: WINDOW_START, ends_at: null },
    },
    snapshot: 0,
    content_hash: hashOf({ flag: "paymentFailure", value: 0 }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["flagd-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const baseline: EvidenceItem = {
    id: baselineId,
    kind: "metric",
    backend: "prometheus",
    identity: {
      metric_name: "traces_span_metrics_calls_total",
      metric_labels: { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
      window: { starts_at: WINDOW_START, ends_at: null },
    },
    snapshot: 0.01,
    content_hash: hashOf({ metric: "baseline-ratio", value: 0.01 }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["prometheus-read-adapter"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }
  const testResult: EvidenceItem = {
    id: testResultId,
    kind: "test-result",
    backend: "local-ci-runner",
    identity: {
      hypothesis_id: "H1",
      prediction_id: "P1",
      receipt_ref: "rcpt-card-unit-suite",
    },
    snapshot: "card.unit.test.js: pass",
    content_hash: hashOf({ test: "card-unit-suite", result: "pass" }),
    links: [],
    observed_at: NOW,
    fresh_until: null,
    provenance: ["local-ci-runner"],
    trust: "test-result",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
  }

  const items = [metric, deployment, code, log, trace, flagd, baseline, testResult]

  const bundle: EvidenceBundle = {
    revisionId: hashOf({ revision: 1, items: items.map((item) => item.id) }),
    items,
    criticalItemIds: [metricId],
    observedScope: {
      tenant_id: "demo",
      deployment_environment_name: "demo",
      service_name: "payment",
    },
    freshnessWindow: { starts_at: WINDOW_START, ends_at: null },
    expectedDeploymentVersion: "seed-digest",
    coverage: new Map([
      [flagdId, { backend_healthy: true, scope_covered: true, window_covered: true }],
    ]),
    materialAlternatives: [
      { hypothesis_id: "H2", eliminated_by_item_ids: [flagdId], failed_prediction_of_h: false, rejected: false },
      { hypothesis_id: "H3", eliminated_by_item_ids: [traceId], failed_prediction_of_h: false, rejected: false },
      { hypothesis_id: "H4", eliminated_by_item_ids: [flagdId], failed_prediction_of_h: false, rejected: false },
    ],
    testRuns: [
      {
        prediction_id: "P1",
        registered_at: WINDOW_START,
        started_at: NOW,
        receipt_ref: "rcpt-card-unit-suite",
        outcome: "ok",
        prediction_matched: true,
      },
    ],
    counterfactualItemIds: [baselineId],
  }
  return { items, bundle }
}

/** The hypothesis H1 the deterministic stub synthesizer returns. */
function buildH1(incidentId: string, runId: string): Record<string, unknown> {
  return {
    schema_version: "1.0",
    id: "H1",
    incident_id: incidentId,
    incident_run_id: runId,
    attempt: 1,
    round: 1,
    causal_claim: {
      trigger: "deployment of the seeded commit S1",
      defect: "the card-type clause in card.js dropped its negation",
      propagation: [
        {
          from: "seeded commit S1",
          to: "charge failure",
          cited_item_ids: [
            itemId("deployment:seed-commit-s1"),
            itemId("metric:error-ratio-0.92"),
            itemId("code:card.js-card-type-clause"),
          ],
        },
      ],
      failure: "every valid Visa or MasterCard charge fails",
    },
    affected_scope: {
      service_names: ["payment"],
      deployment_environment_names: ["demo"],
      versions: ["seed-digest"],
      window: { starts_at: WINDOW_START, ends_at: null },
    },
    predicted_observations: [
      { id: "P1", statement: "the card-type clause rejects valid cards", registered_at: WINDOW_START },
    ],
    evidence: {
      supporting: [
        itemId("metric:error-ratio-0.92"),
        itemId("deployment:seed-commit-s1"),
        itemId("code:card.js-card-type-clause"),
        itemId("log:card-type-error-text"),
        itemId("trace:charge-span-error"),
        itemId("flagd:paymentFailure=0"),
      ],
      opposing: [],
      unexplained: [],
    },
    alternatives: ["H2", "H3", "H4"],
    proposed_tests: [
      {
        id: "T1",
        procedure: "run card.unit.test.js",
        bounds: "payment package",
        permissions: ["request_isolated_ci"],
        expected: { this_hypothesis: "valid Visa accepted" },
      },
    ],
    status: "accepted",
  }
}

function structuredProvider(
  incidentId: string,
  runId: string,
  revisionId: string,
): ModelProvider {
  const h1 = buildH1(incidentId, runId)
  return {
    async complete(model, prompt) {
      const now = new Date().toISOString()
      let text: string
      if (model.startsWith("stub-participant")) {
        text = JSON.stringify({
          schema_version: "1.0",
          participant_id: model === "stub-participant-1" ? "p-1" : "p-2",
          revision_id: revisionId,
          hypotheses: [h1],
          stated_objections: [],
          completed_at: now,
        })
      } else if (model === "stub-judge") {
        text = JSON.stringify({
          schema_version: "1.0",
          judge_id: "j-1",
          revision_id: revisionId,
          agreements: [],
          contradictions: [],
          blind_spots: [],
          unique_findings: [],
          citation_audit: [
            { participant_id: "p-1", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
            { participant_id: "p-2", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
          ],
          completed_at: now,
        })
      } else {
        text = JSON.stringify({
          schema_version: "1.0",
          synthesizer_id: "s-1",
          revision_id: revisionId,
          ranked_hypotheses: [{ rank: 1, hypothesis: h1 }],
          contradictions: [],
          gaps: [],
          next_actions: [],
          fusion_meta: {
            participant_ids: ["p-1", "p-2"],
            judge_id: "j-1",
            synthesizer_id: "s-1",
            revision_id: revisionId,
            started_at: now,
            completed_at: now,
          },
          completed_at: now,
        })
      }
      return { text, promptTokens: Math.ceil(prompt.length / 4), completionTokens: Math.ceil(text.length / 4) }
    },
  }
}

function controlPlaneClientAdapter(cp: ControlPlane): ControlPlaneClient {
  return {
    async verifyLease(lease) {
      const result = await cp.verifyLease(lease.token, {
        leaseId: lease.leaseId,
        incidentId: lease.incidentId,
        runId: lease.runId,
        attempt: lease.attempt,
        stage: lease.stage,
        actorId: lease.actorId,
        actorKind: lease.actorKind,
        toolClass: lease.toolClass,
      })
      return {
        valid: result.ok,
        runState: result.ok ? result.value.runState : null,
        error: result.ok ? undefined : result.error.code,
      }
    },
    async consumePermit() {
      return { consumed: false, error: "not used in this smoke" }
    },
    async recordReceipt(incidentId, runId, stage, receipt, actorKind) {
      const result = await cp.recordBrokerReceipt(
        incidentId,
        runId ?? undefined,
        stage ?? undefined,
        receipt,
        actorKind,
      )
      return { recorded: result.ok }
    },
    async recordModelUse(incidentId, runId, input) {
      const result = await cp.recordModelUse(incidentId, runId ?? undefined, input as never)
      return { recorded: result.ok }
    },
    async decideAction(incidentId, action, stage) {
      const result = await cp.decideAction(incidentId, action as never, stage)
      return {
        decision: result.ok ? result.value.decision : "denied",
        reason: result.ok ? result.value.reason : result.error.message,
        riskClass: result.ok ? result.value.riskClass : "barred",
      }
    },
  }
}

function inProcessProposals(
  cp: ControlPlane,
  lease: LeaseRef & { token: string },
): ControlPlaneProposals {
  const claims = {
    leaseId: lease.leaseId,
    incidentId: lease.incidentId,
    runId: lease.runId,
    attempt: lease.attempt,
    stage: lease.stage,
    actorId: lease.actorId,
    actorKind: lease.actorKind,
    toolClass: lease.toolClass,
  }
  return {
    async sealArtifact(input) {
      const result = await cp.sealArtifact(lease.incidentId, lease.runId, {
        incidentId: lease.incidentId,
        runId: lease.runId,
        schemaId: input.schemaId,
        schemaVersion: input.schemaVersion,
        payload: input.payload as never,
        producer: input.producer,
      })
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      return { artifact_ref: result.value.artifactRef }
    },
    async stageCommand(command) {
      const result = await cp.submitCommand(lease.incidentId, lease.token, claims, command as never)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
    },
    async completeRun(outcome) {
      const result = await cp.submitCommand(lease.incidentId, lease.token, claims, {
        kind: "complete-run",
        outcome,
      })
      if (!result.ok) {
        throw new Error(result.error.message)
      }
    },
    async failRun(failureReason) {
      const result = await cp.submitCommand(lease.incidentId, lease.token, claims, {
        kind: "fail-run",
        failure_reason: failureReason,
      })
      if (!result.ok) {
        throw new Error(result.error.message)
      }
    },
    async requestHypothesisGate(input) {
      const result = await cp.evaluateHypothesis(lease.incidentId, lease.runId, input)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      return { verdict: result.value.verdict, evaluation: result.value.evaluation }
    },
    async resolveApplicability() {
      throw new Error("not used in this smoke")
    },
    async requestVerificationVerdict() {
      throw new Error("not used in this smoke")
    },
    async requestReleaseGate() {
      return { verdict: "pass", permit: null }
    },
    async requestActionGate() {
      return { verdict: "pass", permit: null }
    },
    async policyDecision(action, stage) {
      const result = await cp.decideAction(lease.incidentId, action as never, stage)
      return {
        decision: result.ok ? result.value.decision : "denied",
        reason: result.ok ? result.value.reason : result.error.message,
        riskClass: result.ok ? result.value.riskClass : "barred",
      }
    },
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const runtime = await bootstrap(config)
  const cp = runtime.cp

  // 1. Ingest the trigger and start the run.
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const deliveryKeyHash = deliveryKey({
    schema_version: "1.0",
    source: "prometheus-alertmanager",
    alert_fingerprint: `payment-error-rate-smoke-${nonce}`,
    status: "firing",
    starts_at: WINDOW_START,
    ends_at: null,
  })
  const incidentKeyHash = incidentKey({
    schema_version: "1.0",
    tenant_id: "demo",
    deployment_environment_name: "demo",
    service_name: "payment",
    detector_key: `payment-error-rate-${nonce}`,
  })
  if (!deliveryKeyHash.ok || !incidentKeyHash.ok) {
    throw new Error("hash failed")
  }
  const trigger = {
    schema_version: "1.0",
    trigger_id: "trig-smoke-pi-skills",
    delivery_key: deliveryKeyHash.value,
    incident_key: incidentKeyHash.value,
    received_at: NOW,
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "git:smoke",
    },    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: WINDOW_START, ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [],
  } as const
  const intake = await cp.handleTrigger(trigger as never)
  if (!intake.ok) {
    throw new Error(intake.error.message)
  }
  const incidentId = intake.value.incidentId
  const runId = "run-1"
  console.log(`[smoke] incident=${incidentId} delivery=${intake.value.deliveryResult}`)

  // 2. Acquire the run lease (Detect) and a Diagnose lease.
  const detectLease = await cp.startRun(incidentId, runId)
  if (!detectLease.ok) {
    throw new Error(detectLease.error.message)
  }
  const diagnoseIssued = await cp.leases.issueRunLease({
    incidentId,
    runId,
    attempt: 1,
    stage: "diagnose",
    actorId: `orchestrator-${runId}`,
    actorKind: "orchestrator",
    authorityMode: "repair",
    policyVersion: "policy-1",
    toolClass: "diagnose",
  })
  const detectLeaseRef: LeaseRef & { token: string } = {
    leaseId: detectLease.value.leaseId,
    token: detectLease.value.token,
    incidentId,
    runId,
    attempt: 1,
    stage: "detect",
    actorId: `orchestrator-${runId}`,
    actorKind: "orchestrator",
    toolClass: "detect",
  }
  const diagnoseLeaseRef: LeaseRef & { token: string } = {
    leaseId: diagnoseIssued.leaseId,
    token: diagnoseIssued.token,
    incidentId,
    runId,
    attempt: 1,
    stage: "diagnose",
    actorId: `orchestrator-${runId}`,
    actorKind: "orchestrator",
    toolClass: "diagnose",
  }

  // 3. Build the fixture evidence and boot the Worker.
  const { bundle } = buildEvidence()
  const worker = await bootstrapWorker({
    leaseSource: {
      async acquire(_incidentId, _runId, stage) {
        return stage === "diagnose"
          ? { leaseId: diagnoseIssued.leaseId, token: diagnoseIssued.token }
          : { leaseId: detectLease.value.leaseId, token: detectLease.value.token }
      },
    },
    incidentId,
    runId,
    attempt: 1,
    checkpoint: {
      incidentId,
      runId,
      attempt: 1,
      currentStage: "detect",
      stageStatus: { detect: "entered" },
      restartCount: 0,
      sealedArtifactHashes: [],
    },
    snapshotDir: "/tmp/pi-skills-smoke-snapshot",
    evidenceRevisionId: bundle.revisionId,
    skillsRoot: SKILLS_ROOT,
    toolCatalogVersion: "tool-catalog@1.0",
    budgets: DEMO_BUDGETS,
    allowedModels: {
      participant: ["stub-participant-1"],
      judge: ["stub-judge"],
      synthesizer: ["stub-synthesizer"],
    },
    artifacts: [],
  })

  const cpClient = controlPlaneClientAdapter(cp)
  const readBroker = new ReadBroker(cpClient)
  const gateway = new ModelGateway(cpClient, structuredProvider(incidentId, runId, bundle.revisionId))
  const skills = await loadSkillTree(SKILLS_ROOT)

  // 4. Detect: bounded Read Broker verification queries in parallel, posting
  // receipts, then seal the Incident Brief.
  const detectOrchestrator = new PiOrchestratorExtension(
    {
      runtime: worker,
      proposals: inProcessProposals(cp, detectLeaseRef),
      gateway,
      lease: detectLeaseRef,
      evidence: bundle,
      readBroker,
    },
    skills,
    "detect",
  )
  const detect = await detectOrchestrator.driveDetect({
    symptom: "every valid charge fails in the payment service",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    serviceTopology: "checkout -> payment (gRPC)",
    policyVersion: "policy-1",
    verificationQueries: [
      { backend: "prometheus", connection_id: "astronomy-shop-local", query: "error ratio", resource_type: "metric" },
      { backend: "flagd", connection_id: "astronomy-shop-local", query: "paymentFailure" },
    ],
  })
  console.log(`[smoke] detect sealed incident-brief ${detect.detail}`)

  // 5. Diagnose: one Fusion round with exactly two deterministic stub
  // participants, then the real deterministic Hypothesis gate.
  const diagnoseOrchestrator = new PiOrchestratorExtension(
    {
      runtime: worker,
      proposals: inProcessProposals(cp, diagnoseLeaseRef),
      gateway,
      lease: diagnoseLeaseRef,
      evidence: bundle,
      readBroker,
    },
    skills,
    "diagnose",
  )
  let diagnose: Awaited<ReturnType<typeof diagnoseOrchestrator.driveDiagnose>>
  try {
    diagnose = await diagnoseOrchestrator.driveDiagnose({
    task: "Diagnose the payment charge failure from the Evidence Set revision R_1.",
    roundCap: 3,
    demoProfile: true,
    fusionConfig: {
      participantIds: ["p-1", "p-2"],
      participantModels: ["stub-participant-1", "stub-participant-2"],
      judgeId: "j-1",
      judgeModel: "stub-judge",
      synthesizerId: "s-1",
      synthesizerModel: "stub-synthesizer",
    },
    remediationDisposition: "allowed",
    })
  } catch (error) {
    for (const gate of cp.gateEvaluations(incidentId, runId)) {
      console.log("[smoke] gate", gate.gate, gate.evaluation.verdict)
      if (gate.gate === "hypothesis") {
        const checks = (gate.evaluation as Extract<typeof gate.evaluation, { checks: unknown[] }>).checks
        for (const check of checks as { check: string; result: boolean; reason?: string }[]) {
          console.log(`[smoke]   ${check.check}: ${check.result} ${check.reason ?? ""}`)
        }
      }
    }
    throw error
  }
  console.log(`[smoke] diagnose sealed diagnosis-report ${diagnose.detail}`)
  const round = diagnoseOrchestrator.fusionRounds[0]
  console.log(
    `[smoke] fusion round=${round.round} valid=${round.valid} participants=${round.participantRuns.map((run) => (run.wellFormed ? "ok" : "failed")).join(",")}`,
  )

  // 6. Confirm receipts and artifacts were recorded.
  const receipts = cp.receipts(incidentId, runId)
  const sealed = cp.sealedArtifacts(incidentId, runId)
  console.log(`[smoke] broker receipts recorded=${receipts.length}`)
  console.log(`[smoke] sealed artifacts=${sealed.map((artifact) => artifact.artifactRef.schema_id).join(", ")}`)
  const gateEval = cp.gateEvaluations(incidentId, runId)
  console.log(`[smoke] hypothesis gate verdict=${gateEval[0]?.evaluation.verdict ?? "none"}`)

  await runtime.store.close()
  console.log("[smoke] done")
  process.exit(0)
}

await main()
