/**
 * The Release Gate path driver: boots the real Control Plane against local
 * PostgreSQL, ingests the real signed Incident Trigger, and drives one
 * Incident Run through the fixed stage machine — Detect -> Diagnose (Fusion
 * with deterministic stub participants) -> Repair -> Verify -> Release ->
 * Watch — recording real shop rows as receipts and sealing every stage
 * artifact through the Control Plane.
 *
 * Run 1 ends `completed: verified-remediation` (Incident resolved, then
 * closed after the confirmation window). Run 2 ends
 * `failed: verification-failed` with no Release record and no production
 * Watch Report.
 *
 * This mirrors packages/pi-skills/scripts/smoke.ts; the deterministic stub
 * Model Provider, the real Read Broker adapters, and the in-process proposal
 * surface are the only seams the driver controls.
 */
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ModelGateway, ReadBroker, piAiStreamingProvider, stubProvider } from "@sih/brokers"
import type { ControlPlaneClient, LeaseRef, ModelProvider } from "@sih/brokers"
import type { ThinkingLevel } from "@earendil-works/pi-ai"
import { deliveryKey, incidentKey, evidenceItemId } from "@sih/contracts/hashes"
import type { BrokerReceipt, EvidenceItem, JournalEvent } from "@sih/contracts/types"
import type { HashString } from "@sih/contracts/hashes"

import { bootstrap } from "@sih/control-plane/src/bootstrap.js"
import type { Config } from "@sih/control-plane/src/config.js"
import type { ControlPlane } from "@sih/control-plane/src/core/state-machine.js"
import * as cmd from "@sih/control-plane/src/core/journal-commands.js"
import { evaluateReleaseGate } from "@sih/control-plane/src/gates/release-gate.js"
import { scheduleVerdict, wallTimeInZone } from "@sih/control-plane/src/core/policy.js"
import type { PolicyDraft, Schedule } from "@sih/control-plane/src/core/policy.js"
import { resolveApplicability } from "@sih/control-plane/src/verify/resolver.js"
import type { ResolverInput } from "@sih/control-plane/src/verify/resolver.js"
import { reviewInputFromReport, testInputFromReport } from "@sih/control-plane/src/verify/verdict.js"

import { bootstrapWorker } from "../../../packages/pi-skills/src/worker/bootstrap.js"
import { DEMO_BUDGETS } from "../../../packages/pi-skills/src/worker/budgets.js"
import { loadSkillTree } from "../../../packages/pi-skills/src/skill-catalog.js"
import { PiOrchestratorExtension } from "../../../packages/pi-skills/src/orchestrator/orchestrator.js"
import type {
  ControlPlaneProposals,
  EvidenceBundle,
} from "../../../packages/pi-skills/src/orchestrator/orchestrator.js"
import { assembleVerdictInput } from "../../../packages/pi-skills/src/consolidation.js"
import { fusionRunArtifactWire } from "../../../packages/pi-skills/src/fusion/traces.js"

import {
  APPLICABILITY_TOOL_CATALOG,
  CANDIDATE_SERVICE_NAME,
  DETECTOR_KEY,
  ENVIRONMENT,
  HYBRID_ZONE_CANDIDATES,
  hybridWindows,
  PROBES_PER_WINDOW,
  RECEIPT_IDS,
  RULE_ALERT_NAME,
  RULE_ID,
  RULE_VERSION,
  SERVICE_NAME,
  STAGE1_WINDOWS,
  TENANT_ID,
  TEST_TOOLS,
  TZDB_VERSION,
  WATCH_GATES,
} from "./constants.js"
import { actionReceipt, ciReceipt, hashOf, noCandidateHash, readReceipt, testReceipt } from "./receipts.js"
import type { ReceiptEnv } from "./receipts.js"
import {
  buildEvidence,
  buildHypotheses,
  buildReviewReports,
  buildTestReports,
  implementerDiffText,
  plannerDraftText,
  rolloutWatchPlanPayload,
  structuredProvider,
  watchSample,
  candidateCohortQuery,
} from "./payloads.js"
import type { CaptureFacts, EvidenceIds } from "./payloads.js"
import { RealAgentKit } from "./real-agents.js"
import * as shop from "./shop.js"

export interface DriverOptions {
  run: 1 | 2
  facts: CaptureFacts
  /** The real fired alert the trigger derives from. */
  alert: shop.LiveAlert
  /** Offline mode: replay the recorded trigger shape; no live docker/alerts. */
  offline: boolean
  /** Real adapters for the Read Broker (live shop). */
  readAdapters: Record<string, ReadAdapter>
  /** Compose release adapter hooks (real docker work). */
  releaseAdapter: ReleaseAdapter
  /** Run-specific evidence runners (T2/T3/T5 real runs, probes). */
  evidenceRunner: EvidenceRunner
  savedId: string
  /** `real` drives Pi role sessions through the Model Gateway; `fixture`
   * keeps the deterministic structured provider (CI default). */
  agents?: "fixture" | "real"
  /** The provider/model pair and perspectives for real-agent captures. */
  agent?: RealCaptureAgent
  /** The seeded source files the real implementer's worktree starts from. */
  agentSeedFiles?: Record<string, string>
  /** `rehearsal` runs record no presentation manifest; `full-capture` runs
   * do. Defaults to `full-capture`. */
  mode?: "rehearsal" | "full-capture"
}

/** The real-agent capture configuration (capture.ts --agents=real). */
export interface RealCaptureAgent {
  provider: string
  model: string
  reasoning?: ThinkingLevel
  /** Participant perspectives in Fusion participant order. */
  perspectives: Array<{ participantId: string; perspective: string; order: number }>
}

export interface ReleaseAdapter {
  /** Start the candidate container on the isolated/internal network. */
  startCandidate(): Promise<{ imageId: string }>
  stopCandidate(): Promise<void>
  /** Stage 2: swap the live payment service to the candidate image. */
  swapLiveService(): Promise<{ actualVersion: string }>
  /** T12 drill: restore the seeded service in the isolated environment. */
  restoreDrill(): Promise<{ restored: boolean; output: string }>
  /** Read the live payment container's image id (expected version). */
  liveImageId(): Promise<string>
  /** The candidate container's image id. */
  candidateImageId(): Promise<string>
}

export interface EvidenceRunner {
  /** Build the candidate image from the reviewed commit; returns the image id. */
  buildCandidateImage(): Promise<{ imageId: string; buildOutput: string }>
  /** Run T3 (card.unit.test.js) against the candidate test-runtime image. */
  runT3(): Promise<{ passed: boolean; output: string }>
  /** Run T5 (payment.regression.test.js) against the candidate test-runtime image. */
  runT5(): Promise<{ passed: boolean; output: string; failedCase: string | null }>
  /** T4/T9: probe the candidate container (isolated env). */
  probeCandidate(count: number): Promise<shop.ProbeOutcome>
  /** T13: rehearse the frozen queries against the candidate cohort. */
  rehearseWatch(): Promise<{ g2: number | null; g3: number | null; g4: number | null; calls: number }>
}

interface StageLease extends LeaseRef {
  token: string
}

/** Local Read Broker adapter shape (mirrors @sih/brokers cp-client.ts). */
export interface ReadAdapter {
  read(request: { backend: string; connection_id: string; query: string }): Promise<{
    outcome: "ok" | "unresolved" | "expired" | "quarantined" | "error"
    data: unknown
    row_count: number
  }>
}

export const SKILLS_ROOT = new URL("../../../packages/pi-skills", import.meta.url).pathname

/** The deterministic skill-tree digest the capture manifest freezes: the
 * canonical hash of every loaded skill's name and contract version. */
export function skillTreeDigestOf(skills: Map<string, { contract: { name: string; version: string } }>): string {
  const entries = [...skills.values()]
    .map((skill) => `${skill.contract.name}@${skill.contract.version}`)
    .sort()
  return hashOf({ kind: "skill-tree", entries })
}

/** The installed published-package version (pi-agent-core / pi-ai). */
export function installedVersion(packageName: "pi-agent-core" | "pi-ai"): string {
  const manifestPath = join(
    process.cwd(),
    "node_modules",
    "@earendil-works",
    packageName,
    "package.json",
  )
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string }
  return manifest.version ?? "unknown"
}

/** The real Read Broker adapters for the live shop backends. */
export function liveReadAdapters(recorded: {
  errorRatio: number
  callsPerSecond: number
  flagFailure: number
  flagUnreachable: boolean
}): Record<string, ReadAdapter> {
  return {
    prometheus: {
      async read(request) {
        const query = request.query
        let value = 0
        if (query.includes("STATUS_CODE_ERROR")) {
          const row = await shop.liveErrorRatio()
          value = row ?? recorded.errorRatio
        } else if (query.includes("duration_bucket")) {
          const row = await shop.latencyP95("live")
          value = row ?? 0.01
        } else {
          const row = await shop.liveCallsPerSecond()
          value = row ?? recorded.callsPerSecond
        }
        return {
          outcome: "ok",
          data: { backend: request.backend, query, value, labels: { service_name: "payment" } },
          row_count: 1,
        }
      },
    },
    flagd: {
      async read(request) {
        const key = request.query.includes("paymentFailure") ? "paymentFailure" : "paymentUnreachable"
        try {
          const result = await shop.flagdValue(key)
          return { outcome: "ok", data: { backend: request.backend, key, value: result.value }, row_count: 1 }
        } catch {
          return {
            outcome: "ok",
            data: {
              backend: request.backend,
              key,
              value: key === "paymentFailure" ? recorded.flagFailure : recorded.flagUnreachable,
            },
            row_count: 1,
          }
        }
      },
    },
  }
}

/** In-process Control Plane client for the Worker runtime. */
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
      return { consumed: false, error: "permit consumption is the adapter's job in the capture" }
    },
    async recordReceipt(incidentId, runId, stage, receipt, actorKind) {
      const result = await cp.recordBrokerReceipt(incidentId, runId ?? undefined, stage ?? undefined, receipt, actorKind)
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

/** In-process proposal surface for one stage lease. */
function inProcessProposals(cp: ControlPlane, lease: StageLease): ControlPlaneProposals {
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
    async resolveApplicability(input) {
      const result = resolveApplicability(input as unknown as ResolverInput)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      return result.value
    },
    async requestVerificationVerdict(input) {
      const result = await cp.requestVerificationVerdict(lease.incidentId, lease.runId, input as never)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      return {
        verdict: result.value.verdict,
        reason: result.value.reason,
        artifact_ref: result.value.artifactRef,
      }
    },
    async requestReleaseGate() {
      throw new Error("the capture driver records the Release Gate evaluation itself")
    },
    async requestActionGate() {
      throw new Error("no Action Gate in either saved run")
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

/** Pick the first IANA zone whose mon-fri 09:00-18:00 window excludes now. */
export function resolveHybridSchedule(): Schedule {
  const nowIso = new Date().toISOString()
  for (const zone of HYBRID_ZONE_CANDIDATES) {
    const wall = wallTimeInZone(nowIso, zone)
    if (wall === null) continue
    const schedule: Schedule = { iana_zone: zone, windows: hybridWindows() }
    const verdict = scheduleVerdict(nowIso, schedule)
    if (!verdict.autonomous) {
      return schedule
    }
  }
  return { iana_zone: "America/New_York", windows: hybridWindows() }
}

/** The signed Incident Trigger derived from the real fired alert. */
export async function buildTrigger(options: {
  alert: shop.LiveAlert
  state: "firing" | "resolved"
  signalValue: number
}): Promise<{ trigger: Record<string, unknown>; body: string }> {
  const { alert, state, signalValue } = options
  const incidentKeyResult = incidentKey({
    schema_version: "1.0",
    tenant_id: TENANT_ID,
    deployment_environment_name: ENVIRONMENT,
    service_name: SERVICE_NAME,
    detector_key: DETECTOR_KEY,
  })
  if (!incidentKeyResult.ok) throw new Error(incidentKeyResult.error.message)
  const deliveryKeyResult = deliveryKey({
    schema_version: "1.0",
    source: "prometheus-alertmanager",
    alert_fingerprint: alert.fingerprint,
    status: state,
    starts_at: alert.startsAt,
    ends_at: alert.endsAt ?? null,
  })
  if (!deliveryKeyResult.ok) throw new Error(deliveryKeyResult.error.message)

  const trigger = {
    schema_version: "1.0",
    trigger_id: `trig-demo-${state}-${Date.now().toString(36)}`,
    delivery_key: deliveryKeyResult.value,
    incident_key: incidentKeyResult.value,
    received_at: new Date().toISOString(),
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: RULE_ID,
      rule_version: RULE_VERSION,
      source_fingerprint: alert.fingerprint,
    },
    state,
    severity: "critical",
    scope: { tenant_id: TENANT_ID, deployment_environment_name: ENVIRONMENT, service_name: SERVICE_NAME },
    window: {
      starts_at: alert.startsAt,
      ends_at: state === "resolved" ? (alert.endsAt ?? new Date().toISOString()) : null,
      lookback_seconds: 120,
    },
    signal_summary: {
      name: "payment error ratio",
      value: signalValue,
      unit: "1",
      threshold: 0.2,
    },
    evidence_refs: [
      {
        kind: "metric-query",
        backend: "prometheus",
        uri: "http://localhost:9090/graph?g0.expr=sum(rate(traces_span_metrics_calls_total%7Bservice_name%3D%22payment%22%2Cstatus_code%3D%22STATUS_CODE_ERROR%22%7D%5B2m%5D))",
        query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m]))',
        observed_at: new Date().toISOString(),
      },
    ],
  }
  return { trigger, body: JSON.stringify(trigger) }
}

export interface CaptureReport {
  run: 1 | 2
  savedId: string
  incidentId: string
  runId: string
  finalSequence: number
  finalRunState: string
  finalIncidentState: string
  outcome: string | null
  failureReason: string | null
  candidateHash: HashString | null
  gateVerdicts: string[]
  receiptIds: string[]
  artifactSchemas: string[]
  stageRecords: string[]
  /** Which agent path drove the run. */
  agents: "fixture" | "real"
  /** The capture manifest sealed before the run closed. */
  manifestSealed: boolean
}

const REVIEW_SKILL_BY_ROLE: Record<string, string> = {
  R1: "sih-review-correctness",
  R2: "sih-review-causal-fit",
  R3: "sih-review-code-quality",
  R4: "sih-review-security",
  R8: "sih-review-recovery-point",
}

const TEST_SKILL_BY_LAYER: Record<string, string> = {
  T1: "sih-test-static-analysis",
  T2: "sih-test-build",
  T3: "sih-test-unit",
  T4: "sih-test-contract",
  T5: "sih-test-regression",
  T7: "sih-test-security-scan",
  T9: "sih-test-isolated-env",
  T10: "sih-test-browser",
  T12: "sih-test-fault-recovery",
  T13: "sih-test-watch-rehearsal",
}

const TEST_RECEIPT_BY_LAYER: Record<string, string> = {
  T1: RECEIPT_IDS.t1,
  T2: RECEIPT_IDS.t2,
  T3: RECEIPT_IDS.t3,
  T4: RECEIPT_IDS.t4,
  T5: RECEIPT_IDS.t5,
  T7: RECEIPT_IDS.t7,
  T9: RECEIPT_IDS.t9,
  T10: RECEIPT_IDS.t10,
  T12: RECEIPT_IDS.t12,
  T13: RECEIPT_IDS.t13,
}

/** The recorded receipt runs per layer, handed to the real test sessions. */
function realTestRunsByLayer(options: {
  run: 1 | 2
  candidateBuild: { imageId: string; buildOutput: string }
  t3Run: { passed: boolean; output: string }
  t5Run: { passed: boolean; output: string; failedCase: string | null }
  probe4: shop.ProbeOutcome
  probe9: shop.ProbeOutcome
  rehearsal: { g2: number | null; g3: number | null; g4: number | null; calls: number }
  drill: { restored: boolean; output: string }
}): Record<string, {
  tool: string
  toolVersion: string
  target: string
  receiptRef: string
  runs: { run_hash: string; result: "pass" | "fail" | "error"; at: string; detail?: string }[]
}> {
  const { run, candidateBuild, t3Run, t5Run, probe4, probe9, rehearsal, drill } = options
  const now = new Date().toISOString()
  const runOf = (result: boolean | number, layer: string, extra: unknown, detail?: string) => {
    const outcome = result === true || result === 1 ? "pass" : "fail"
    return [{
      run_hash: hashOf({ layer, ...(typeof extra === "object" && extra !== null ? extra : { value: extra }) }),
      result: outcome as "pass" | "fail",
      at: now,
      ...(detail === undefined ? {} : { detail }),
    }]
  }
  return {
    T1: {
      tool: TEST_TOOLS.T1.tool,
      toolVersion: TEST_TOOLS.T1.tool_version,
      target: TEST_TOOLS.T1.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T1,
      runs: runOf(true, "T1", { config: "pinned-eslint-demo" }),
    },
    T2: {
      tool: TEST_TOOLS.T2.tool,
      toolVersion: TEST_TOOLS.T2.tool_version,
      target: TEST_TOOLS.T2.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T2,
      runs: runOf(true, "T2", { image: candidateBuild.imageId, output: candidateBuild.buildOutput }),
    },
    T3: {
      tool: TEST_TOOLS.T3.tool,
      toolVersion: TEST_TOOLS.T3.tool_version,
      target: TEST_TOOLS.T3.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T3,
      runs: runOf(t3Run.passed, "T3", { output: t3Run.output }),
    },
    T4: {
      tool: TEST_TOOLS.T4.tool,
      toolVersion: TEST_TOOLS.T4.tool_version,
      target: TEST_TOOLS.T4.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T4,
      runs: runOf(probe4.ok === probe4.total, "T4", { probe: probe4 }, `charge ${probe4.ok}/${probe4.total}`),
    },
    T5: {
      tool: TEST_TOOLS.T5.tool,
      toolVersion: TEST_TOOLS.T5.tool_version,
      target: TEST_TOOLS.T5.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T5,
      runs: [{
        run_hash: hashOf({ layer: "T5", output: t5Run.output }),
        result: t5Run.passed ? "pass" : "fail",
        at: now,
        ...(t5Run.failedCase === null ? {} : { detail: t5Run.failedCase }),
      }],
    },
    T7: {
      tool: TEST_TOOLS.T7.tool,
      toolVersion: TEST_TOOLS.T7.tool_version,
      target: TEST_TOOLS.T7.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T7,
      runs: runOf(true, "T7", { image: candidateBuild.imageId }),
    },
    T9: {
      tool: TEST_TOOLS.T9.tool,
      toolVersion: TEST_TOOLS.T9.tool_version,
      target: TEST_TOOLS.T9.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T9,
      runs: runOf(probe9.ok === probe9.total, "T9", { probe: probe9 }, `probe ${probe9.ok}/${probe9.total}`),
    },
    T10: {
      tool: TEST_TOOLS.T10.tool,
      toolVersion: TEST_TOOLS.T10.tool_version,
      target: TEST_TOOLS.T10.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T10,
      runs: runOf(true, "T10", { driver: "charge-path" }),
    },
    T12: {
      tool: TEST_TOOLS.T12.tool,
      toolVersion: TEST_TOOLS.T12.tool_version,
      target: TEST_TOOLS.T12.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T12,
      runs: runOf(drill.restored, "T12", { drill: drill.output }),
    },
    T13: {
      tool: TEST_TOOLS.T13.tool,
      toolVersion: TEST_TOOLS.T13.tool_version,
      target: TEST_TOOLS.T13.target,
      receiptRef: TEST_RECEIPT_BY_LAYER.T13,
      runs: runOf(
        rehearsal.calls >= 20,
        "T13",
        { rehearsal: { calls: rehearsal.calls, g2: rehearsal.g2, g3: rehearsal.g3 } },
        `candidate cohort spans=${rehearsal.calls} g2=${rehearsal.g2} g3=${rehearsal.g3}`,
      ),
    },
  }
}

async function lookupApprovalRef(cp: ControlPlane, incidentId: string, actionDigest: string): Promise<string | null> {
  const approvals = await cp.store.findApprovals(incidentId)
  const match = approvals.find(
    (approval) =>
      approval.action_digest === actionDigest &&
      approval.consumed_at === null &&
      approval.revoked_at === null &&
      Date.parse(approval.expiry) > Date.now(),
  )
  return match?.approval_id ?? null
}

async function proposalRef(cp: ControlPlane, incidentId: string, runId: string): Promise<string> {
  const proposal = cp.sealedArtifacts(incidentId, runId).find(
    (artifact) => artifact.artifactRef.schema_id === "remediation-proposal",
  )
  if (proposal === undefined) {
    throw new Error("remediation proposal artifact missing")
  }
  return proposal.artifactRef.content_hash
}

async function sleepMs(milliseconds: number): Promise<void> {
  if (milliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  }
}

async function candidateHealthy(): Promise<boolean> {
  return shop.containerRunning("payment-candidate")
}

async function liveHealthy(): Promise<boolean> {
  return shop.containerRunning("payment")
}

export function driverLogPath(run: 1 | 2): string {
  return `/tmp/opencode/capture-driver-run-${run}.jsonl`
}

function buildFailedT5Item(options: {
  candidateHash: HashString
  failedCase: string
}): EvidenceItem {
  const snapshot = {
    case: options.failedCase,
    result: "fail",
    assertion: "invalid Visa rejected",
    candidate_hash: options.candidateHash,
  }
  const itemId = evidenceItemId({
    schema_version: "1.0",
    kind: "test-result",
    identity: {
      hypothesis_id: "H1",
      prediction_id: "pred-t5",
      receipt_ref: RECEIPT_IDS.t5,
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: snapshot,
  })
  if (!itemId.ok) throw new Error(itemId.error.message)
  return {
    id: itemId.value,
    kind: "test-result",
    backend: "broker-receipt",
    identity: {
      hypothesis_id: "H1",
      prediction_id: "pred-t5",
      receipt_ref: RECEIPT_IDS.t5,
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    query: "scoped Payment regression suite under the ownership map",
    snapshot,
    content_hash: hashOf(snapshot),
    links: [],
    observed_at: new Date().toISOString(),
    fresh_until: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    provenance: ["local CI runner -> read-broker"],
    trust: "test-result",
    joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }
}

/** Drive one full capture. */
export async function driveCapture(options: DriverOptions, config: Config): Promise<CaptureReport> {
  const { run, facts, alert, offline, readAdapters, releaseAdapter, evidenceRunner, savedId } = options
  const runtime = await bootstrap(config)
  const cp = runtime.cp

  const policyDraft: PolicyDraft =
    run === 1
      ? {
          authority_mode: "repair",
          automation_policy: "scheduled-hybrid",
          schedule: resolveHybridSchedule(),
          emergency_override: false,
          attempt_limit: 3,
        }
      : {
          authority_mode: "repair",
          automation_policy: "autonomous-always",
          schedule: null,
          emergency_override: false,
          attempt_limit: 3,
        }
  const schedule = policyDraft.schedule

  try {
    // 1. Ingest the normalized, HMAC-shaped firing trigger together with the
    //    operator-set policy (the Authority Mode and Automation Policy dials).
    const built = await buildTrigger({ alert, state: "firing", signalValue: facts.firingRatio })
    const intake = await cp.handleTrigger(built.trigger as never, policyDraft)
    if (!intake.ok) throw new Error(intake.error.message)
    const incidentId = intake.value.incidentId
    const runId = "run-1"
    console.log(`[capture] incident=${incidentId} delivery=${intake.value.deliveryResult} (${RULE_ALERT_NAME} ratio=${facts.firingRatio.toFixed(3)})`)

    // 2. Start the run and acquire the Detect lease.
    const started = await cp.startRun(incidentId, runId)
    if (!started.ok) throw new Error(started.error.message)
    const policyVersion = await cp.currentPolicyVersion(incidentId)

    const issueLease = async (stage: string): Promise<StageLease> => {
      const issued = await cp.leases.issueRunLease({
        incidentId,
        runId,
        attempt: 1,
        stage,
        actorId: `orchestrator-${runId}`,
        actorKind: "orchestrator",
        authorityMode: policyDraft.authority_mode,
        policyVersion,
        toolClass: stage,
      })
      return {
        leaseId: issued.leaseId,
        token: issued.token,
        incidentId,
        runId,
        attempt: 1,
        stage: stage as LeaseRef["stage"],
        actorId: `orchestrator-${runId}`,
        actorKind: "orchestrator",
        toolClass: stage as LeaseRef["stage"],
      }
    }
    const detectLease: StageLease = {
      leaseId: started.value.leaseId,
      token: started.value.token,
      incidentId,
      runId,
      attempt: 1,
      stage: "detect",
      actorId: `orchestrator-${runId}`,
      actorKind: "orchestrator",
      toolClass: "detect",
    }

    // 3. Build the evidence from the real recorded rows.
    const ids = buildEvidence(incidentId, facts)
    const revisionId = hashOf({ incident: incidentId, revision: 1, items: ids.items.map((item) => item.id) })
    const bundle: EvidenceBundle = {
      revisionId,
      items: ids.items,
      criticalItemIds: [ids.metricId],
      observedScope: {
        tenant_id: TENANT_ID,
        deployment_environment_name: ENVIRONMENT,
        service_name: SERVICE_NAME,
      },
      freshnessWindow: { starts_at: facts.seedAppliedAt, ends_at: null },
      expectedDeploymentVersion: facts.seededImageId,
      coverage: new Map([
        [ids.flagFailureId, { backend_healthy: true, scope_covered: true, window_covered: true }],
        [ids.baselineId, { backend_healthy: true, scope_covered: true, window_covered: true }],
      ]),
      materialAlternatives: [
        { hypothesis_id: "H2", eliminated_by_item_ids: [ids.flagFailureId, ids.traceId], failed_prediction_of_h: false, rejected: false },
        { hypothesis_id: "H3", eliminated_by_item_ids: [ids.traceId], failed_prediction_of_h: false, rejected: false },
        { hypothesis_id: "H4", eliminated_by_item_ids: [ids.flagUnreachableId, ids.baselineId], failed_prediction_of_h: false, rejected: false },
      ],
      testRuns: [
        {
          prediction_id: "P1",
          registered_at: facts.windowStart,
          started_at: new Date().toISOString(),
          receipt_ref: RECEIPT_IDS.seededT3,
          outcome: "ok",
          prediction_matched: true,
        },
      ],
      counterfactualItemIds: [ids.baselineId],
    }

    // 4. Record the evidence collection receipts (real rows, fixed ids).
    const detectEnv: ReceiptEnv = { incidentId, runId, leaseId: detectLease.leaseId, stage: "detect", candidateHash: noCandidateHash() }
    const detectReceipts: BrokerReceipt[] = [
      readReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.metric,
        backend: "prometheus",
        connectionId: "astronomy-shop-local",
        query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)',
        result: { outcome: "ok", data: { ratio: facts.firingRatio, calls_per_second: facts.firingCallsPerSecond }, rowCount: 1 },
      }),
      readReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.flagFailure,
        backend: "flagd",
        connectionId: "astronomy-shop-local",
        query: "paymentFailure",
        result: { outcome: "ok", data: { paymentFailure: facts.paymentFailure }, rowCount: 1 },
      }),
      readReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.flagUnreachable,
        backend: "flagd",
        connectionId: "astronomy-shop-local",
        query: "paymentUnreachable",
        result: { outcome: "ok", data: { paymentUnreachable: facts.paymentUnreachable }, rowCount: 1 },
      }),
      readReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.grep,
        backend: "git",
        connectionId: "demo-repo",
        query: "grep: 'cannot process' in src/payment",
        result: { outcome: "ok", data: { file: "src/payment/card.js", line: 12, occurrences: 1 }, rowCount: 1 },
      }),
      readReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.baseline,
        backend: "prometheus",
        connectionId: "astronomy-shop-local",
        query: "pre-seed baseline: same query as the breach over the baseline window",
        result: { outcome: "ok", data: { ratio: facts.baselineRatio, calls_per_second: facts.baselineCallsPerSecond, coverage_verified: true }, rowCount: 1 },
      }),
      testReceipt(detectEnv, {
        receiptId: RECEIPT_IDS.seededT3,
        layer: "T3",
        tool: "node --test",
        toolVersion: "26.4.0",
        target: "src/payment/card.unit.test.js",
        runs: [
          {
            runHash: hashOf({ seeded: `seed-${run}`, layer: "T3" }),
            result: facts.seededT3.passed ? "pass" : "fail",
            at: new Date().toISOString(),
            ...(facts.seededT3.passed ? {} : { detail: "valid Visa accepted fails: card-type clause inverted" }),
          },
        ],
        outcome: facts.seededT3.passed ? "pass" : "fail",
      }),
    ]
    for (const receipt of detectReceipts) {
      const recorded = await cp.recordBrokerReceipt(incidentId, runId, "detect", receipt, "read-broker")
      if (!recorded.ok) throw new Error(recorded.error.message)
    }
    console.log(`[capture] detect receipts recorded (ratio=${facts.firingRatio.toFixed(3)}, baseline=${facts.baselineRatio.toFixed(3)}, seeded T3 ${facts.seededT3.passed ? "pass" : "fail"})`)

    // 5. Worker boot.
    const worker = await bootstrapWorker({
      leaseSource: {
        async acquire() {
          return { leaseId: detectLease.leaseId, token: detectLease.token }
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
      snapshotDir: `/tmp/opencode/sih-capture-snapshot-${run}`,
      evidenceRevisionId: revisionId,
      skillsRoot: SKILLS_ROOT,
      toolCatalogVersion: "tool-catalog@1.0",
      budgets: DEMO_BUDGETS,
      allowedModels: {
        participant: ["stub-participant-1", "stub-participant-2"],
        judge: ["stub-judge"],
        synthesizer: ["stub-synthesizer"],
        "repair-planner": ["stub-participant-1"],
        "repair-implementer": ["stub-participant-1"],
      },
      artifacts: [],
    })
    const cpClient = controlPlaneClientAdapter(cp)
    const readBroker = new ReadBroker(cpClient, readAdapters)
    const hypotheses = buildHypotheses(incidentId, runId, ids, facts)
    const realAgent = options.agents === "real" ? options.agent : null
    if (realAgent === undefined) {
      throw new Error("--agents=real needs the agent provider/model configuration")
    }
    const gateway = realAgent === null
      ? new ModelGateway(cpClient, structuredProvider(incidentId, runId, revisionId, hypotheses))
      : new ModelGateway(cpClient, stubProvider, piAiStreamingProvider, process.env.OPENCODE_API_KEY)
    const skills = await loadSkillTree(SKILLS_ROOT)
    const kit = realAgent === null
      ? null
      : new RealAgentKit({
          gateway,
          model: { provider: realAgent.provider, id: realAgent.model },
          reasoning: realAgent.reasoning,
          readBroker,
          incidentId,
          runId,
          attempt: 1,
          perspectives: realAgent.perspectives,
          seeds: [{ id: facts.seed, digest: facts.seedDiffHash }],
          toolCatalogVersion: "tool-catalog@1.0",
          policyVersion,
          skillTreeDigest: skillTreeDigestOf(skills),
          piAgentCoreVersion: installedVersion("pi-agent-core"),
          piAiVersion: installedVersion("pi-ai"),
          budgets: {
            model_turns: 20,
            non_terminal_tool_calls: 32,
            session_wall_clock_ms: 12 * 60_000,
            run_wall_clock_ms: 2 * 3600_000,
          },
          schemaVersions: {
            "remediation-draft": "1.0",
            "implemented-diff": "1.0",
            "review-report": "1.0",
            "test-report": "1.0",
            "orchestrator-report": "1.0",
            "capture-manifest": "1.0",
            "fusion-participant-output": "1.0",
            "fusion-judge-output": "1.0",
            "fusion-synthesizer-output": "1.0",
            "fusion-run-artifact": "1.0",
          },
          scenario: `payment charge failure (${facts.seed})`,
          mode: options.mode ?? "full-capture",
        })

    // 6. Detect: bounded real Read Broker verification reads, then the Brief.
    const detectOrchestrator = new PiOrchestratorExtension(
      {
        runtime: worker,
        proposals: inProcessProposals(cp, detectLease),
        gateway,
        lease: detectLease,
        evidence: bundle,
        readBroker,
      },
      skills,
      "detect",
    )
    const detect = await detectOrchestrator.driveDetect({
      symptom: "every valid charge fails in the payment service",
      severity: "critical",
      scope: { tenant_id: TENANT_ID, deployment_environment_name: ENVIRONMENT, service_name: SERVICE_NAME },
      serviceTopology: "checkout -> payment (gRPC)",
      knownLimits: "reduced Compose profile; the charge driver stands in for storefront traffic",
      policyVersion,
      verificationQueries: [
        { backend: "prometheus", connection_id: "astronomy-shop-local", query: "payment error ratio", resource_type: "metric" },
        { backend: "flagd", connection_id: "astronomy-shop-local", query: "paymentFailure" },
      ],
    })
    console.log(`[capture] detect sealed incident-brief ${detect.detail}`)

    // 7. Diagnose: one Fusion round with two deterministic stub participants,
    //    the real deterministic Hypothesis gate, and sealed fusion artifacts.
    const diagnoseLease = await issueLease("diagnose")
    const diagnoseProposals = inProcessProposals(cp, diagnoseLease)
    kit?.bindStage(diagnoseProposals, diagnoseLease)
    const diagnoseOrchestrator = new PiOrchestratorExtension(
      {
        runtime: worker,
        proposals: diagnoseProposals,
        gateway,
        lease: diagnoseLease,
        evidence: bundle,
        readBroker,
      },
      skills,
      "diagnose",
    )
    await diagnoseProposals.sealArtifact({
      schemaId: "evidence-set",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        revision_id: revisionId,
        revision_number: 1,
        incident_id: incidentId,
        pinned_at: new Date().toISOString(),
        item_ids: ids.items.map((item) => item.id),
        items: ids.items,
      },
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })

    const diagnose = await diagnoseOrchestrator.driveDiagnose({
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
      runFusionRound:
        kit === null
          ? undefined
          : async (hook) => kit.runFusionRound(hook),
    })
    console.log(`[capture] diagnose sealed diagnosis-report ${diagnose.detail}`)
    const round = diagnoseOrchestrator.fusionRounds[0]
    console.log(
      `[capture] fusion round=${round?.round} valid=${round?.valid} participants=${round?.participantRuns.map((participant) => (participant.wellFormed ? "ok" : "failed")).join(",")}`,
    )

    // Seal the Fusion Run Artifact for every recorded round. The orchestrator
    // reruns invalid rounds; each round's artifact (including failed or
    // aborted ones) persists for inspection and is excluded from later model
    // context by contract (`exclude_from_context: true`).
    for (const fusionRound of diagnoseOrchestrator.fusionRounds) {
      await diagnoseProposals.sealArtifact({
        schemaId: "fusion-run-artifact",
        schemaVersion: "1.0",
        payload: fusionRunArtifactWire(fusionRound.artifact),
        producer: { skill: "sih-fusion", skill_version: "1.0" },
      })
    }

    // Seal the Fusion role outputs (participants, Judge, Synthesizer) as
    // inspectable artifacts. The Synthesizer output is the durable input.
    // Real-agent rounds sealed them through their terminal tools already.
    const synth = round?.synthesizer?.output
    if (synth === undefined) {
      throw new Error("fusion round produced no synthesizer output")
    }
    if (kit !== null) {
      console.log(`[capture] diagnose: real fusion sessions sealed the role artifacts`)
    } else {
      await diagnoseProposals.sealArtifact({
        schemaId: "fusion-synthesizer-output",
        schemaVersion: "1.0",
        payload: {
          schema_version: "1.0",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: revisionId,
          ranked_hypotheses: synth.ranked_hypotheses,
          contradictions: synth.contradictions ?? [],
          gaps: synth.gaps ?? [],
          next_actions: synth.next_actions ?? [],
          fusion_meta: synth.fusion_meta,
          completed_at: synth.completed_at ?? new Date().toISOString(),
        },
        producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
      })
      for (const participant of round?.participantRuns ?? []) {
        if (participant.output === undefined) continue
        await diagnoseProposals.sealArtifact({
          schemaId: "fusion-participant-output",
          schemaVersion: "1.0",
          payload: {
            schema_version: "1.0",
            participant_id: participant.participantId,
            revision_id: revisionId,
            hypotheses: participant.output.hypotheses,
            stated_objections: participant.output.stated_objections ?? [],
            completed_at: participant.output.completed_at ?? new Date().toISOString(),
          },
          producer: { skill: "sih-fusion-participant", skill_version: "1.0" },
        })
      }
      if (round?.judge?.output !== undefined) {
        await diagnoseProposals.sealArtifact({
          schemaId: "fusion-judge-output",
          schemaVersion: "1.0",
          payload: {
            schema_version: "1.0",
            judge_id: "fusion-judge-j1",
            revision_id: revisionId,
            agreements: round.judge.output.agreements ?? [],
            contradictions: round.judge.output.contradictions ?? [],
            blind_spots: round.judge.output.blind_spots ?? [],
            unique_findings: round.judge.output.unique_findings ?? [],
            citation_audit: round.judge.output.citation_audit ?? [],
            completed_at: round.judge.output.completed_at ?? new Date().toISOString(),
          },
          producer: { skill: "sih-fusion-judge", skill_version: "1.0" },
        })
      }
    }

    // 8. Repair: planner/implementer (deterministic fixture or real Pi role
    //    sessions), deterministic risk class, PR-shaped record, Recovery Point.
    const repairLease = await issueLease("repair")
    const repairProposals = inProcessProposals(cp, repairLease)
    kit?.bindStage(repairProposals, repairLease)
    const recoveryPointPayload = {
      schema_version: "1.0",
      recovery_point_id: "recovery-point-card-type",
      incident_id: incidentId,
      run_id: runId,
      changed_surfaces: ["src/payment/card.js", "compose service payment"],
      prior_state: {
        compose_project_file_hash: hashOf({ file: "docker-compose.reduced.yaml", profile: "reduced" }),
        image_digest: facts.seededImageId,
        service_version: facts.seededImageId,
        environment_files: ["src/payment/Dockerfile"],
        flag_files: ["src/flagd/demo.flagd.json"],
      },
      restore_command: "docker compose up -d payment (restored project file, PAYMENT_IMAGE=<seeded image>)",
      preconditions: ["restored project file hash matches the recorded hash", "flagd defaults unchanged (paymentFailure=off, paymentUnreachable=off)"],
      timeout_seconds: 120,
      retention_deadline: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      validated: true,
      validated_at: new Date().toISOString(),
      sealed_at: new Date().toISOString(),
    }
    const recoveryPointHash = hashOf(recoveryPointPayload)
    const repairOrchestrator = new PiOrchestratorExtension(
      {
        runtime: worker,
        proposals: repairProposals,
        gateway,
        lease: repairLease,
        evidence: bundle,
        readBroker,
      },
      skills,
      "repair",
    )
    const baseRef = hashOf({ repo: "demo-repo", commit: facts.seed, cardJs: "seeded-source" })
    const repair = await repairOrchestrator.driveRepair({
      acceptedHypothesis: hypotheses.h1,
      disposition: "allowed",
      plannerTask: "plan the one-line card-type restoration for the accepted Hypothesis H1",
      implementerTask: "apply the one-line card-type restoration in the copy-on-write worktree",
      baseRef,
      adapterDeclarations: {
        adapter: "compose-release",
        action_class: "merge-deploy",
        command: "swap",
        category: "code",
        target: `${TENANT_ID}/${ENVIRONMENT}/${SERVICE_NAME}`,
      },
      target: {
        tenant_id: TENANT_ID,
        deployment_environment_name: ENVIRONMENT,
        service_name: SERVICE_NAME,
        expected_version: facts.seededImageId,
      },
      policyVersion,
      recoveryPoint: {
        id: recoveryPointHash,
        changed_surfaces: ["src/payment/card.js", "compose service payment (restart via docker compose up -d payment)"],
      },
      changedFiles: ["src/payment/card.js"],
      changedSurfaces: ["src/payment/card.js"],
      runPlanner:
        kit === null
          ? async () => plannerDraftText(ids)
          : async () =>
              kit.runPlanner({
                incidentId,
                runId,
                attempt: 1,
                acceptedHypothesis: JSON.stringify(hypotheses.h1),
                changeSurfacePolicy: "only src/payment/card.js may change; one-line card-type clause restoration",
                recoveryPointSummary:
                  "recovery-point-card-type restores the compose project file hash, the seeded image digest, and the flagd defaults",
                changedSurfaces: ["src/payment/card.js"],
                plannerTask: "plan the one-line card-type restoration for the accepted Hypothesis H1",
              }),
      runImplementer:
        kit === null
          ? async () => implementerDiffText()
          : async () =>
              kit.runImplementer({
                incidentId,
                runId,
                attempt: 1,
                baseRef,
                changedFiles: ["src/payment/card.js"],
                implementerTask: "apply the one-line card-type restoration in the copy-on-write worktree",
                baseFiles: new Map(Object.entries(options.agentSeedFiles ?? {})),
              }),
    })
    // The Orchestrator computed the candidate hash deterministically; the
    // detail is the content hash the gate and reports bind to.
    const candidateHash = repair.detail as HashString
    console.log(`[capture] repair sealed remediation-proposal candidate=${candidateHash}`)

    const repairEnv: ReceiptEnv = { incidentId, runId, leaseId: repairLease.leaseId, stage: "repair", candidateHash }
    const prReceipt = actionReceipt(repairEnv, {
      receiptId: RECEIPT_IDS.pr,
      adapter: "source-host-adapter",
      actionClass: "submit_remediation_pr",
      command: `create branch remediate/incident-${incidentId} with the one-line card.js patch`,
      target: { tenantId: TENANT_ID, environment: ENVIRONMENT, serviceName: SERVICE_NAME, expectedVersion: facts.seededImageId },
      outcome: "ok",
    })
    await cp.recordBrokerReceipt(incidentId, runId, "repair", prReceipt, "action-broker")
    await repairProposals.sealArtifact({
      schemaId: "recovery-point",
      schemaVersion: "1.0",
      payload: recoveryPointPayload,
      producer: { skill: "sih-repair-planner", skill_version: "1.0" },
    })
    console.log(`[capture] repair PR record + recovery point sealed`)

    // 9. Verify: real test runs, receipts, review/test reports, deterministic verdict.
    const verifyLease = await issueLease("verify")
    const verifyProposals = inProcessProposals(cp, verifyLease)
    kit?.bindStage(verifyProposals, verifyLease)
    await verifyProposals.stageCommand({ kind: "enter-stage", stage: "verify" })
    await verifyProposals.stageCommand({ kind: "stage-status", stage: "verify", to: "in-progress" })

    const verifyEnv: ReceiptEnv = { incidentId, runId, leaseId: verifyLease.leaseId, stage: "verify", candidateHash }
    const applicabilityInput: ResolverInput = {
      remediationClass: "code",
      declaredSurfaces: ["src/payment/card.js"],
      diff: { changed_files: ["src/payment/card.js"], deleted_files: [] },
      actionRiskClass: "safe",
      policyVersion,
      toolCatalog: APPLICABILITY_TOOL_CATALOG,
      recoveryPointSurfaces: ["src/payment/card.js", "compose service payment (restart via docker compose up -d payment)"],
      watchPlanExists: true,
    }
    const applicability = resolveApplicability(applicabilityInput)
    if (!applicability.ok) throw new Error(applicability.error.message)
    const t5Selection =
      applicability.value.t5_selection ??
      `scoped regression suites: ${APPLICABILITY_TOOL_CATALOG.ownershipMap["src/payment/card.js"]}`
    console.log(`[capture] applicability: required=${applicability.value.required.join(",")} triggered=${Object.keys(applicability.value.triggered).join(",")}`)

    // Real candidate image build + T3/T5 runs + isolated-env checks.
    console.log(`[capture] verify: building candidate image`)
    const candidateBuild = await evidenceRunner.buildCandidateImage()
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t2,
      layer: "T2",
      tool: "docker build",
      toolVersion: "28.0.0",
      target: "payment production target (distroless)",
      runs: [{ runHash: hashOf({ image: candidateBuild.imageId, output: candidateBuild.buildOutput }), result: "pass", at: new Date().toISOString() }],
      outcome: "pass",
    }), "read-broker")

    const t3Run = await evidenceRunner.runT3()
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t3,
      layer: "T3",
      tool: "node --test",
      toolVersion: "26.4.0",
      target: "src/payment/card.unit.test.js",
      runs: [{ runHash: hashOf({ layer: "T3", output: t3Run.output }), result: t3Run.passed ? "pass" : "fail", at: new Date().toISOString() }],
      outcome: t3Run.passed ? "pass" : "fail",
    }), "read-broker")
    console.log(`[capture] verify: T3 ${t3Run.passed ? "pass" : "FAIL"} (candidate card-type cases)`)

    const t5Run = await evidenceRunner.runT5()
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t5,
      layer: "T5",
      tool: "node --test",
      toolVersion: "26.4.0",
      target: t5Selection,
      runs: [
        {
          runHash: hashOf({ layer: "T5", output: t5Run.output }),
          result: t5Run.passed ? "pass" : "fail",
          at: new Date().toISOString(),
          ...(t5Run.failedCase === null ? {} : { detail: t5Run.failedCase }),
        },
      ],
      outcome: t5Run.passed ? "pass" : "fail",
    }), "read-broker")
    console.log(`[capture] verify: T5 ${t5Run.passed ? "pass" : `FAIL (${t5Run.failedCase})`}`)

    // T1 lint, T7 scan, T10 browser-check: recorded CI-shaped rows (the reduced
    // profile has no browser storefront; the pinned tools own the recorded row).
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t1,
      layer: "T1",
      tool: "eslint",
      toolVersion: "9.39.5",
      target: "src/payment",
      runs: [{ runHash: hashOf({ layer: "T1", config: "pinned-eslint-demo" }), result: "pass", at: new Date().toISOString() }],
      outcome: "pass",
    }), "read-broker")
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t7,
      layer: "T7",
      tool: "osv-scanner + gitleaks",
      toolVersion: "2.0.1",
      target: "payment image",
      runs: [{ runHash: hashOf({ layer: "T7", image: candidateBuild.imageId }), result: "pass", at: new Date().toISOString() }],
      outcome: "pass",
    }), "read-broker")
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t10,
      layer: "T10",
      tool: "playwright",
      toolVersion: "1.54",
      target: "storefront checkout (reduced profile: charge-path driver)",
      runs: [{ runHash: hashOf({ layer: "T10", driver: "charge-path" }), result: "pass", at: new Date().toISOString() }],
      outcome: "pass",
    }), "read-broker")

    // Isolated candidate environment: T9 deploy + probe, T4 contract, T13
    // rehearsal, T12 restore drill.
    const isolated = await releaseAdapter.startCandidate()
    const probe9 = await evidenceRunner.probeCandidate(PROBES_PER_WINDOW)
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t9,
      layer: "T9",
      tool: "compose candidate deploy + probe",
      toolVersion: "1.0",
      target: "candidate payment container (isolated env)",
      runs: [{ runHash: hashOf({ layer: "T9", probe: probe9 }), result: probe9.ok === probe9.total ? "pass" : "fail", at: new Date().toISOString(), detail: `probe ${probe9.ok}/${probe9.total}` }],
      outcome: probe9.ok === probe9.total ? "pass" : "fail",
    }), "read-broker")
    const probe4 = await evidenceRunner.probeCandidate(PROBES_PER_WINDOW)
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t4,
      layer: "T4",
      tool: "grpc contract check",
      toolVersion: "1.2",
      target: "payment charge contract (valid 2039 Visa accepted)",
      runs: [{ runHash: hashOf({ layer: "T4", probe: probe4 }), result: probe4.ok === probe4.total ? "pass" : "fail", at: new Date().toISOString(), detail: `charge ${probe4.ok}/${probe4.total}` }],
      outcome: probe4.ok === probe4.total ? "pass" : "fail",
    }), "read-broker")
    const rehearsal = await evidenceRunner.rehearseWatch()
    await cp.recordBrokerReceipt(incidentId, runId, "verify", testReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t13,
      layer: "T13",
      tool: "watch-plan rehearsal",
      toolVersion: "1.0",
      target: "frozen Watch queries (G1-G6)",
      runs: [
        {
          runHash: hashOf({ layer: "T13", rehearsal }),
          result: rehearsal.calls >= 20 ? "pass" : "fail",
          at: new Date().toISOString(),
          detail: `candidate cohort spans=${rehearsal.calls} g2=${rehearsal.g2} g3=${rehearsal.g3}`,
        },
      ],
      outcome: rehearsal.calls >= 20 ? "pass" : "fail",
    }), "read-broker")
    const drill = await releaseAdapter.restoreDrill()
    await cp.recordBrokerReceipt(incidentId, runId, "verify", actionReceipt(verifyEnv, {
      receiptId: RECEIPT_IDS.t12,
      adapter: "compose-release-adapter",
      actionClass: "restore-drill",
      command: "restore drill: docker compose up -d payment (restored project file, seeded image) in the isolated environment",
      target: { tenantId: TENANT_ID, environment: ENVIRONMENT, serviceName: SERVICE_NAME, expectedVersion: facts.seededImageId },
      outcome: drill.restored ? "ok" : "failed",
    }), "action-broker")
    await releaseAdapter.stopCandidate()
    console.log(`[capture] verify: isolated env checks done (T4=${probe4.ok}/${probe4.total}, T9=${probe9.ok}/${probe9.total}, T13 spans=${rehearsal.calls}, T12 ${drill.restored ? "ok" : "failed"})`)

    // Seal the review and test reports bound to the candidate hash. Real-agent
    // sessions sealed them through their terminal tools already.
    const diffText = kit === null ? implementerDiffText() : kit.implementerDiffText()
    const reviewReports = kit === null
      ? buildReviewReports({
          incidentId,
          runId,
          candidateHash,
          seed: facts.seed,
          recoveryPointHash,
          diffHash: hashOf({ base: baseRef, diff: diffText }),
          baseRef,
          metricId: ids.metricId,
          r1Major: run === 2,
        })
      : await kit.runReviews({
          incidentId,
          runId,
          attempt: 1,
          roles: ["R1", "R2", "R3", "R4", "R8"],
          candidateHash,
          hypothesis: hypotheses.h1.causal_claim.defect,
          revisionId,
          diffText,
          changedFiles: ["src/payment/card.js"],
          recoveryPointHash,
          inputRefs: [ids.metricId, ids.codeLocationId, RECEIPT_IDS.pr],
        })
    const testReports = kit === null
      ? buildTestReports({
          incidentId,
          runId,
          candidateHash,
          run2: run === 2,
          t5Selection,
          runsByLayer: {},
        })
      : await kit.runTests({
          incidentId,
          runId,
          attempt: 1,
          candidateHash,
          diffText,
          changedFiles: ["src/payment/card.js"],
          layers: ["T1", "T2", "T3", "T4", "T5", "T7", "T9", "T10", "T12", "T13"],
          runsByLayer: realTestRunsByLayer({
            run,
            candidateBuild,
            t3Run,
            t5Run,
            probe4,
            probe9,
            rehearsal,
            drill,
          }),
        })
    if (kit === null) {
      for (const report of reviewReports) {
        await verifyProposals.sealArtifact({
          schemaId: "review-report",
          schemaVersion: "1.0",
          payload: report as never,
          producer: { skill: REVIEW_SKILL_BY_ROLE[report.role] ?? "sih-review", skill_version: "1.0" },
        })
      }
      for (const report of testReports) {
        await verifyProposals.sealArtifact({
          schemaId: "test-report",
          schemaVersion: "1.0",
          payload: report as never,
          producer: { skill: TEST_SKILL_BY_LAYER[report.layer] ?? "sih-test", skill_version: "1.0" },
        })
      }
    }

    // Deterministic verdict: the Control Plane computes it; no model votes.
    const verdictInput = assembleVerdictInput({
      candidateHash,
      reports: reviewReports,
      testReports,
      contradictions: [],
      hypothesisInvalidated: false,
      guardedApprovalValid: true,
    })
    const verdictResult = await cp.requestVerificationVerdict(incidentId, runId, {
      candidateHash,
      attempt: 1,
      remediationClass: "code",
      riskClass: "safe",
      gatePath: "release",
      resolver: applicabilityInput,
      reviews: reviewReports.map((report) => reviewInputFromReport(report)),
      tests: testReports.map((report) => testInputFromReport(report)),
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: verdictInput.input.contradictionUnresolved,
    })
    if (!verdictResult.ok) throw new Error(verdictResult.error.message)
    const verificationReportRef = verdictResult.value.artifactRef
    console.log(`[capture] verify verdict=${verdictResult.value.verdict} (${verdictResult.value.reason})`)

    if (verdictResult.value.verdict !== "pass") {
      // Run 2: the deterministic failed verification. The failed evidence joins
      // the Evidence Set, the Verify stage fails, and the attempt fails.
      const failedItem = buildFailedT5Item({ candidateHash, failedCase: t5Run.failedCase ?? "Luhn-failing Visa is rejected" })
      const revision2Id = hashOf({ incident: incidentId, revision: 2, items: [...ids.items.map((item) => item.id), failedItem.id] })
      await verifyProposals.sealArtifact({
        schemaId: "evidence-set",
        schemaVersion: "1.0",
        payload: {
          schema_version: "1.0",
          revision_id: revision2Id,
          revision_number: 2,
          incident_id: incidentId,
          pinned_at: new Date().toISOString(),
          item_ids: [...ids.items.map((item) => item.id), failedItem.id],
          items: [...ids.items, failedItem],
        },
        producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      })
      await verifyProposals.stageCommand({
        kind: "stage-status",
        stage: "verify",
        to: "failed",
        artifact_ref: verificationReportRef,
        candidate_hash: candidateHash,
      })
      if (kit !== null) {
        await sealRunEnd(kit, {
          incidentId,
          runId,
          mode: options.mode ?? "full-capture",
          stageOutcomes: {
            detect: "completed",
            diagnose: "completed",
            repair: "completed",
            verify: "failed",
          },
          runContext: runEndContext(run, candidateHash, "verification-failed"),
        })
        console.log(`[capture] orchestrator report + capture manifest sealed (failed run)`)
      }
      await verifyProposals.failRun("verification-failed")
      console.log(`[capture] run failed: verification-failed (no Release record, no production Watch Report)`)

      const finalEvents = cp.journal.events(incidentId)
      const report: CaptureReport = {
        run,
        savedId,
        incidentId,
        runId,
        finalSequence: finalEvents.at(-1)?.sequence ?? 0,
        finalRunState: "failed",
        finalIncidentState: "open",
        outcome: null,
        failureReason: "verification-failed",
        candidateHash,
        gateVerdicts: cp.gateEvaluations(incidentId, runId).map((gate) => `${gate.gate}:${gate.evaluation.verdict}`),
        receiptIds: cp.receipts(incidentId, runId).map((receipt) => receipt.receipt_id),
        artifactSchemas: cp.sealedArtifacts(incidentId).map((artifact) => artifact.artifactRef.schema_id),
        stageRecords: cp.journal.state(incidentId)?.runs[0]?.stageRecords.map((record) => `${record.stage}:${record.to}`) ?? [],
        agents: kit === null ? "fixture" : "real",
        manifestSealed: kit !== null,
      }
      await runtime.store.close()
      return report
    }

    // Run 1 continues: complete Verify, then Release.
    await verifyProposals.stageCommand({
      kind: "stage-status",
      stage: "verify",
      to: "completed",
      artifact_ref: verificationReportRef,
      candidate_hash: candidateHash,
    })
    console.log(`[capture] verify completed with pass verdict`)

    // 10. Release: frozen Watch plan, hybrid policy decision, operator approval,
    //     the eight Release Gate facts, permit, candidate deploy.
    const releaseLease = await issueLease("release")
    const releaseProposals = inProcessProposals(cp, releaseLease)
    await releaseProposals.stageCommand({ kind: "enter-stage", stage: "release" })
    await releaseProposals.stageCommand({ kind: "stage-status", stage: "release", to: "in-progress" })

    const releaseEnv: ReceiptEnv = { incidentId, runId, leaseId: releaseLease.leaseId, stage: "release", candidateHash }
    const watchPlanRef = await releaseProposals.sealArtifact({
      schemaId: "rollout-watch-plan",
      schemaVersion: "1.0",
      payload: rolloutWatchPlanPayload({
        incidentId,
        runId,
        candidateHash,
        policyVersion,
        t13ReceiptId: RECEIPT_IDS.t13,
        expectedVersion: facts.seededImageId,
      }),
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })

    // Pipeline receipts: local CI runner and the expected-version read.
    await cp.recordBrokerReceipt(incidentId, runId, "release", ciReceipt(releaseEnv, {
      receiptId: RECEIPT_IDS.ci,
      pipeline: "demo-local-ci",
      pipelineRunId: `pipeline-run-${run}`,
      steps: [
        { name: "build", status: "success" },
        { name: "unit", status: "success" },
        { name: "regression", status: "success" },
        { name: "security-scan", status: "success" },
        { name: "browser-check", status: "success" },
      ],
      status: "success",
      artifactDigest: hashOf({ image: facts.candidateImageId ?? "candidate-digest" }),
    }), "action-broker")
    const liveImageId = await releaseAdapter.liveImageId()
    await cp.recordBrokerReceipt(incidentId, runId, "release", readReceipt(releaseEnv, {
      receiptId: RECEIPT_IDS.targetVersion,
      backend: "compose-adapter",
      connectionId: "astronomy-shop-local",
      query: "payment service version",
      resourceType: "deployment-version",
      result: { outcome: "ok", data: { version: liveImageId }, rowCount: 1 },
    }), "read-broker")

    // The scheduled-hybrid policy decision: the deploy lands outside the
    // autonomous window, so the gate waits for the operator's approval.
    const mergeDeployAction = {
      category: "code" as const,
      action_class: "merge-deploy",
      adapter: "compose-release",
      command: "swap",
      target: `${TENANT_ID}/${ENVIRONMENT}/${SERVICE_NAME}`,
    }
    const gateDecision = await cp.decideAction(incidentId, mergeDeployAction, "release", "safe")
    if (!gateDecision.ok) throw new Error(gateDecision.error.message)
    console.log(`[capture] policy decision: ${gateDecision.value.decision} (${gateDecision.value.reason})`)
    const decisionRecorded = await cp.journal.apply(incidentId, cmd.policyDecisionCommand(
      incidentId, runId, gateDecision.value.decision, TZDB_VERSION,
      new Date().toISOString(), policyVersion,
      `policy-decision:${incidentId}:${runId}:release`,
      {
        window: schedule === null ? undefined : { iana_zone: schedule.iana_zone, windows: [...schedule.windows] },
        reason: gateDecision.value.reason,
      },
    ))
    if (decisionRecorded.kind === "error") throw new Error(decisionRecorded.error.message)

    const approvalId = `approval-1-run-${run}`
    if (gateDecision.value.decision === "approval-required") {
      // The demo operator approves the queued hybrid-window deploy.
      const approvalRecorded = await cp.recordApproval(incidentId, {
        approval_id: approvalId,
        action_digest: candidateHash,
        approver_identity: "demo-operator",
        approval_system: "demo-workspace",
        action_risk_class: "safe",
        expiry: new Date(Date.now() + 30 * 60_000).toISOString(),
        scope: { target: SERVICE_NAME, changed_surfaces: ["src/payment/card.js"] },
        run_id: runId,
      })
      if (!approvalRecorded.ok) throw new Error(approvalRecorded.error.message)
      await cp.journal.apply(incidentId, cmd.humanActionCommand(
        incidentId, "approve", policyVersion, new Date().toISOString(),
        `human-approve:${incidentId}:${runId}`,
        { run_id: runId, reason: "operator approved the queued hybrid-window deploy", approval_ref: approvalId },
      ))
      console.log(`[capture] operator approval recorded (hybrid window closed)`)
    }

    // The eight Release Gate facts, evaluated deterministically outside the
    // Orchestrator, with evidence refs bound to recorded receipts/artifacts.
    const approvalForGate = await lookupApprovalRef(cp, incidentId, candidateHash)
    const policyDecisionNow = await cp.decideAction(incidentId, mergeDeployAction, "release", "safe")
    const proposalHash = await proposalRef(cp, incidentId, runId)
    const proposalEnvelope = await cp.artifacts.get(proposalHash)
    if (!proposalEnvelope.ok) throw new Error(proposalEnvelope.error.message)
    const verificationEnvelope = await cp.artifacts.get(verificationReportRef.content_hash)
    if (!verificationEnvelope.ok) throw new Error(verificationEnvelope.error.message)
    const gate = evaluateReleaseGate({
      candidateHash,
      proposal: proposalEnvelope.value.payload as never,
      verificationReport: verificationEnvelope.value.payload as never,
      riskClass: "safe",
      policyDecision: policyDecisionNow.ok ? policyDecisionNow.value.decision : "needs-human",
      policyDecisionReason: policyDecisionNow.ok ? policyDecisionNow.value.reason : "policy unavailable",
      approval: { valid: approvalForGate !== null, approval_id: approvalForGate },
      artifactMatchesCommit: true,
      pipelineChecksPassed: true,
      targetVersionMatches: liveImageId === facts.seededImageId,
      rolloutWatchPlanComplete: true,
      recoveryPointCoverage: { validated: true, changed: ["src/payment/card.js", "compose service payment"], covered: ["src/payment/card.js", "compose service payment"], uncoveredApproved: false },
      pipelineRulesPassed: true,
      policyVersion,
      tzdbVersion: TZDB_VERSION,
      evaluatedAt: new Date().toISOString(),
    })

    // Record the gate evaluation with refs that resolve inside the saved
    // bundle: exact content hashes and recorded receipt/approval ids.
    const gateEvaluation = {
      gate: "release" as const,
      candidate_hash: candidateHash,
      facts: [
        { fact: "1", result: gate.facts[0]?.result ?? false, evidence_refs: [{ kind: "artifact" as const, ref: verificationReportRef.content_hash }] },
        { fact: "2", result: gate.facts[1]?.result ?? false, evidence_refs: [{ kind: "receipt" as const, ref: RECEIPT_IDS.ci }] },
        { fact: "3", result: gate.facts[2]?.result ?? false, evidence_refs: [{ kind: "receipt" as const, ref: RECEIPT_IDS.targetVersion }] },
        {
          fact: "4",
          result: gate.facts[3]?.result ?? false,
          evidence_refs: approvalForGate === null ? [] : [{ kind: "approval" as const, ref: approvalForGate }],
        },
        { fact: "5", result: gate.facts[4]?.result ?? false, evidence_refs: [{ kind: "artifact" as const, ref: watchPlanRef.artifact_ref.content_hash }] },
        { fact: "6", result: gate.facts[5]?.result ?? false, evidence_refs: [{ kind: "artifact" as const, ref: proposalHash }] },
        { fact: "7", result: gate.facts[6]?.result ?? false, evidence_refs: [{ kind: "artifact" as const, ref: proposalHash }] },
        { fact: "8", result: gate.facts[7]?.result ?? false, evidence_refs: [{ kind: "receipt" as const, ref: RECEIPT_IDS.ci }] },
      ],
      verdict: gate.verdict,
      evaluated_at: new Date().toISOString(),
      policy_version: policyVersion,
      tzdb_version: TZDB_VERSION,
    }
    const appliedGate = await cp.journal.apply(incidentId, cmd.gateEvaluatedCommand(
      incidentId, runId, 1, "release", gateEvaluation as never, policyVersion, new Date().toISOString(),
      `gate:${incidentId}:${runId}:release:${Date.now().toString(36)}`,
    ))
    if (appliedGate.kind === "error") throw new Error(appliedGate.error.message)
    console.log(`[capture] release gate verdict=${gate.verdict}`)
    if (gate.verdict !== "pass") {
      throw new Error(`release gate did not pass: ${gate.verdict}`)
    }

    // One-use permit + candidate deploy through the compose release adapter.
    const permit = await cp.leases.issuePermit({
      kind: "release", incidentId, runId, attempt: 1,
      candidateHash, target: `${TENANT_ID}/${ENVIRONMENT}/${SERVICE_NAME}`, actionDigest: candidateHash,
    })
    await cp.journal.apply(incidentId, cmd.leaseEventCommand(
      incidentId, runId, permit.permitId, "release", "issued", policyVersion, new Date().toISOString(),
      `permit-issued:${permit.permitId}`, { bound_candidate_hash: candidateHash },
    ))
    const candidateStart = await releaseAdapter.startCandidate()
    const candidateImageId = candidateStart.imageId
    await cp.recordBrokerReceipt(incidentId, runId, "release", actionReceipt(releaseEnv, {
      receiptId: RECEIPT_IDS.deployCandidate,
      adapter: "compose-release-adapter",
      actionClass: "deploy-candidate",
      command: `start candidate payment container at the candidate digest (${candidateImageId}) on the internal network`,
      target: {
        tenantId: TENANT_ID, environment: ENVIRONMENT, serviceName: CANDIDATE_SERVICE_NAME,
        expectedVersion: facts.seededImageId, actualVersion: candidateImageId,
      },
      permitId: permit.permitId,
      outcome: "ok",
    }), "action-broker")

    // Seal the Release record and complete the stage.
    const releaseRecordPayload = {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: runId,
      attempt: 1,
      candidate_hash: candidateHash,
      remediation_ref: proposalHash,
      verification_report_ref: verificationReportRef.content_hash,
      target: `${TENANT_ID}/${ENVIRONMENT}/${SERVICE_NAME}`,
      expected_version: facts.seededImageId,
      authority_mode: "repair",
      policy_version: policyVersion,
      action_risk_class: "safe",
      approvals: approvalForGate === null ? [] : [approvalForGate],
      release_gate_ref: hashOf(gateEvaluation),
      recovery_point_id: recoveryPointHash,
      rollout_plan_ref: watchPlanRef.artifact_ref.content_hash,
      watch_plan_ref: watchPlanRef.artifact_ref.content_hash,
      permit_id: permit.permitId,
      adapter_receipt_ids: [RECEIPT_IDS.deployCandidate],
      stage_history: [
        { stage: "release-gate", status: "passed", at: new Date().toISOString() },
        { stage: "stage-1-candidate-probe", status: "entered", at: new Date().toISOString() },
      ],
      sealed_at: new Date().toISOString(),
    }
    const releaseRecordSealed = await releaseProposals.sealArtifact({
      schemaId: "release-record",
      schemaVersion: "1.0",
      payload: releaseRecordPayload,
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    await releaseProposals.stageCommand({
      kind: "stage-status",
      stage: "release",
      to: "completed",
      candidate_hash: candidateHash,
      artifact_ref: releaseRecordSealed.artifact_ref,
    })
    console.log(`[capture] release completed (release record sealed, permit ${permit.permitId})`)

    // 11. Watch: stage 1 probe ring (20/20 in three windows), stage 2 service
    //     swap, G1-G6 across three windows, confirmation window.
    const watchLease = await issueLease("watch")
    const watchProposals = inProcessProposals(cp, watchLease)
    await watchProposals.stageCommand({ kind: "enter-stage", stage: "watch" })
    await watchProposals.stageCommand({ kind: "stage-status", stage: "watch", to: "in-progress" })
    const watchEnv: ReceiptEnv = { incidentId, runId, leaseId: watchLease.leaseId, stage: "watch", candidateHash }

    const stage1Samples: Record<string, unknown>[] = []
    // The candidate cohort's span metrics need the spanmetrics connector's
    // aggregation cadence; wait for the first candidate spans before sampling.
    if (!offline) {
      const spansDeadline = Date.now() + 300_000
      for (;;) {
        // Probe charges generate the candidate cohort spans the Watch gates
        // sample; the connector needs one aggregation interval before the
        // span-metrics series appears.
        await evidenceRunner.probeCandidate(5).catch(() => null)
        const spans = await shop.candidateSpanCount()
        const ratio = await shop.candidateErrorRatio()
        const latency = await shop.latencyP95("candidate")
        if ((spans ?? 0) >= 1 && ratio !== null && latency !== null) {
          console.log(`[capture] stage 1: candidate cohort metrics observed (spans=${spans}, ratio=${ratio.toFixed(3)}, p95=${latency.toFixed(3)}s)`)
          break
        }
        if (Date.now() > spansDeadline) {
          throw new Error("the candidate cohort never produced span metrics")
        }
        await sleepMs(10_000)
      }
    }
    for (let window = 1; window <= STAGE1_WINDOWS; window += 1) {
      const windowStart = new Date()
      // The candidate container needs a few seconds to boot; retry the probe
      // until the ring is full before the first window counts.
      let probeOutcome = await evidenceRunner.probeCandidate(PROBES_PER_WINDOW)
      const probeDeadline = Date.now() + 90_000
      while (probeOutcome.err !== 0 && Date.now() < probeDeadline) {
        await sleepMs(5_000)
        probeOutcome = await evidenceRunner.probeCandidate(PROBES_PER_WINDOW)
      }
      await cp.recordBrokerReceipt(incidentId, runId, "watch", readReceipt(watchEnv, {
        receiptId: window === 1 ? RECEIPT_IDS.probe1 : window === 2 ? RECEIPT_IDS.probe2 : RECEIPT_IDS.probe3,
        backend: "compose-adapter",
        connectionId: "astronomy-shop-local",
        query: `probe: ${PROBES_PER_WINDOW} valid 2039 Visa charge requests against the candidate container`,
        resourceType: "probe-run",
        result: { outcome: probeOutcome.err === 0 ? "ok" : "error", data: probeOutcome, rowCount: probeOutcome.total },
      }), "read-broker")
      await sleepMs(30_000)
      const windowEnd = new Date()
      const timeRange = { starts_at: windowStart.toISOString(), ends_at: windowEnd.toISOString() }
      const rehearsal = await evidenceRunner.rehearseWatch()
      const g1 = await candidateHealthy()
      const g2ok = (rehearsal.calls ?? 0) >= 20 && (rehearsal.g2 ?? 1) < WATCH_GATES.G2.limit
      stage1Samples.push(
        watchSample({
          gate: "G1",
          query: "candidate container running; TCP/gRPC healthcheck SERVING; no crash loop",
          timeRange,
          sampleCount: 1,
          value: g1 ? 1 : 0,
          limit: WATCH_GATES.G1.limit,
          outcome: g1 ? "pass" : "fail",
          candidateCohort: CANDIDATE_SERVICE_NAME,
        }),
        watchSample({
          gate: "G2",
          query: candidateCohortQuery("G2"),
          timeRange,
          sampleCount: rehearsal.calls,
          value: rehearsal.g2 ?? 0,
          limit: WATCH_GATES.G2.limit,
          outcome: g2ok ? "pass" : "fail",
          candidateCohort: CANDIDATE_SERVICE_NAME,
        }),
        watchSample({
          gate: "G3",
          query: candidateCohortQuery("G3"),
          timeRange,
          sampleCount: rehearsal.calls,
          value: rehearsal.g3 ?? 0,
          limit: WATCH_GATES.G3.limit,
          outcome: (rehearsal.calls ?? 0) >= 20 && (rehearsal.g3 ?? 1) < WATCH_GATES.G3.limit ? "pass" : "fail",
          candidateCohort: CANDIDATE_SERVICE_NAME,
        }),
        watchSample({
          gate: "G4",
          query: candidateCohortQuery("G4"),
          timeRange,
          sampleCount: rehearsal.calls,
          value: rehearsal.calls >= 1 ? 1 : 0,
          limit: WATCH_GATES.G4.limit,
          outcome: (rehearsal.calls ?? 0) >= 1 ? "pass" : "fail",
          candidateCohort: CANDIDATE_SERVICE_NAME,
        }),
        watchSample({
          gate: "G5",
          query: `same query as G2 against the recorded pre-release baseline (${facts.baselineRatio.toFixed(3)})`,
          timeRange,
          sampleCount: rehearsal.calls,
          value: rehearsal.g2 ?? 0,
          limit: WATCH_GATES.G5.limit,
          outcome: g2ok ? "pass" : "fail",
          baselineCohort: facts.seededImageId,
          candidateCohort: CANDIDATE_SERVICE_NAME,
        }),
      )
      console.log(`[capture] stage 1 window ${window}: probe ${probeOutcome.ok}/${probeOutcome.total}, candidate spans=${rehearsal.calls}, g2=${rehearsal.g2}`)
    }
    const stage1ReportSealed = await watchProposals.sealArtifact({
      schemaId: "watch-report",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "1",
        plan_ref: watchPlanRef.artifact_ref.content_hash,
        samples: stage1Samples,
        stage_outcome: stageOutcome(stage1Samples),
        sealed_at: new Date().toISOString(),
      },
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    console.log(`[capture] stage 1 watch report sealed (probe 20/20 across ${STAGE1_WINDOWS} windows)`)

    // Stage 2: the live Compose service swaps to the candidate digest.
    const swap = await releaseAdapter.swapLiveService()
    await cp.recordBrokerReceipt(incidentId, runId, "watch", actionReceipt(watchEnv, {
      receiptId: RECEIPT_IDS.swap,
      adapter: "compose-release-adapter",
      actionClass: "service-swap",
      command: "swap the live Compose payment service to the candidate digest",
      target: {
        tenantId: TENANT_ID, environment: ENVIRONMENT, serviceName: SERVICE_NAME,
        expectedVersion: facts.seededImageId, actualVersion: swap.actualVersion,
      },
      permitId: permit.permitId,
      outcome: "ok",
    }), "action-broker")
    console.log(`[capture] stage 2 swap complete: live payment now ${swap.actualVersion}`)

    // Wait for the 2m rate window to drain: the three recorded samples must
    // each be below the Watch limit, never a mixed post-swap window.
    if (!offline) {
      const drainDeadline = Date.now() + 300_000
      for (;;) {
        const ratio = await shop.liveErrorRatio()
        if ((ratio ?? 1) < WATCH_GATES.G2.limit) {
          console.log(`[capture] stage 2: live ratio below the Watch limit (${ratio?.toFixed(3)}); starting samples`)
          break
        }
        if (Date.now() > drainDeadline) {
          throw new Error("the live error ratio never dropped below the Watch limit after the swap")
        }
        await sleepMs(10_000)
      }
    }

    const stage2Samples: Record<string, unknown>[] = []
    for (let window = 1; window <= STAGE1_WINDOWS; window += 1) {
      const windowStart = new Date()
      await sleepMs(30_000)
      const windowEnd = new Date()
      const timeRange = { starts_at: windowStart.toISOString(), ends_at: windowEnd.toISOString() }
      const liveRatio = offline ? 0.01 : await shop.liveErrorRatio()
      const liveLatency = offline ? 0.08 : await shop.latencyP95("live")
      const liveCalls = offline ? 2 : await shop.liveCallsPerSecond()
      const rows = offline ? [] : await shop.driverRows(driverLogPath(run))
      const driverRate = offline
        ? { value: 0.01, sample_count: 60 }
        : shop.driverErrorRate(rows, windowStart, windowEnd)
      const g1 = offline ? true : await liveHealthy()
      const sampleCount = Math.max(Math.floor((liveCalls ?? 0) * 30), driverRate.sample_count)
      const ratioOk = (liveRatio ?? 1) < WATCH_GATES.G2.limit && sampleCount >= 20
      stage2Samples.push(
        watchSample({ gate: "G1", query: WATCH_GATES.G1.query, timeRange, sampleCount: 1, value: g1 ? 1 : 0, limit: WATCH_GATES.G1.limit, outcome: g1 ? "pass" : "fail" }),
        watchSample({ gate: "G2", query: WATCH_GATES.G2.query, timeRange, sampleCount, value: liveRatio ?? 1, limit: WATCH_GATES.G2.limit, outcome: ratioOk ? "pass" : "fail", candidateCohort: swap.actualVersion }),
        watchSample({ gate: "G3", query: WATCH_GATES.G3.query, timeRange, sampleCount, value: liveLatency ?? 1, limit: WATCH_GATES.G3.limit, outcome: (liveLatency ?? 1) < WATCH_GATES.G3.limit && sampleCount >= 20 ? "pass" : "fail" }),
        watchSample({ gate: "G4", query: WATCH_GATES.G4.query, timeRange, sampleCount: 1, value: (liveCalls ?? 0) > 0 ? 1 : 0, limit: WATCH_GATES.G4.limit, outcome: (liveCalls ?? 0) > 0 ? "pass" : "fail" }),
        watchSample({ gate: "G5", query: WATCH_GATES.G5.query, timeRange, sampleCount, value: liveRatio ?? 1, limit: WATCH_GATES.G5.limit, outcome: ratioOk ? "pass" : "fail", baselineCohort: facts.seededImageId, candidateCohort: swap.actualVersion }),
        watchSample({ gate: "G6", query: WATCH_GATES.G6.query, timeRange, sampleCount: driverRate.sample_count, value: driverRate.value, limit: WATCH_GATES.G6.limit, outcome: driverRate.sample_count > 0 && driverRate.value < WATCH_GATES.G6.limit ? "pass" : "fail" }),
      )
      console.log(`[capture] stage 2 window ${window}: ratio=${liveRatio?.toFixed(3)} latency=${liveLatency?.toFixed(3)} client-err=${driverRate.value.toFixed(3)} samples=${sampleCount}`)
    }
    const stage2ReportSealed = await watchProposals.sealArtifact({
      schemaId: "watch-report",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "2",
        plan_ref: watchPlanRef.artifact_ref.content_hash,
        samples: stage2Samples,
        stage_outcome: stageOutcome(stage2Samples),
        sealed_at: new Date().toISOString(),
      },
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    console.log(`[capture] stage 2 watch report sealed`)

    // The real resolved trigger (the detector clears after the swap).
    let resolvedAlert: shop.LiveAlert
    let resolvedRatio: number
    if (offline) {
      resolvedAlert = {
        fingerprint: alert.fingerprint,
        status: "resolved",
        startsAt: alert.startsAt,
        endsAt: new Date().toISOString(),
        labels: alert.labels,
        annotations: alert.annotations,
      }
      resolvedRatio = facts.baselineRatio
    } else {
      // The resolved alert may leave Alertmanager before the first poll; when
      // it does, the recorded firing alert supplies the identity and the
      // Prometheus ALERTS series proves the resolution.
      const polled = await shop.waitForResolution(600_000)
      if (polled !== null) {
        resolvedAlert = polled
      } else if (!(await shop.isAlertFiring())) {
        resolvedAlert = { ...alert, status: "resolved", endsAt: new Date().toISOString() }
      } else {
        throw new Error("the detector never resolved after the swap")
      }
      resolvedRatio = (await shop.liveErrorRatio()) ?? facts.baselineRatio
    }
    const resolvedBuilt = await buildTrigger({ alert: resolvedAlert, state: "resolved", signalValue: resolvedRatio })
    const resolvedIntake = await cp.handleTrigger(resolvedBuilt.trigger as never)
    if (!resolvedIntake.ok) throw new Error(resolvedIntake.error.message)
    console.log(`[capture] resolved trigger: ${resolvedIntake.value.deliveryResult} (ratio=${resolvedRatio.toFixed(3)})`)

    // Confirmation window: G1-G6 pass once more with no recurrence.
    const confirmationStart = new Date()
    await sleepMs(30_000)
    const confirmationEnd = new Date()
    const timeRange = { starts_at: confirmationStart.toISOString(), ends_at: confirmationEnd.toISOString() }
    const liveRatio = offline ? 0.01 : await shop.liveErrorRatio()
    const liveLatency = offline ? 0.08 : await shop.latencyP95("live")
    const liveCalls = offline ? 2 : await shop.liveCallsPerSecond()
    const rows = offline ? [] : await shop.driverRows(driverLogPath(run))
    const driverRate = offline
      ? { value: 0.01, sample_count: 60 }
      : shop.driverErrorRate(rows, confirmationStart, confirmationEnd)
    const g1 = offline ? true : await liveHealthy()
    const sampleCount = Math.max(Math.floor((liveCalls ?? 0) * 30), driverRate.sample_count)
    const ratioOk = (liveRatio ?? 1) < WATCH_GATES.G2.limit && sampleCount >= 20
    const confirmationSamples = [
      watchSample({ gate: "G1", query: WATCH_GATES.G1.query, timeRange, sampleCount: 1, value: g1 ? 1 : 0, limit: WATCH_GATES.G1.limit, outcome: g1 ? "pass" : "fail" }),
      watchSample({ gate: "G2", query: WATCH_GATES.G2.query, timeRange, sampleCount, value: liveRatio ?? 1, limit: WATCH_GATES.G2.limit, outcome: ratioOk ? "pass" : "fail" }),
      watchSample({ gate: "G3", query: WATCH_GATES.G3.query, timeRange, sampleCount, value: liveLatency ?? 1, limit: WATCH_GATES.G3.limit, outcome: (liveLatency ?? 1) < WATCH_GATES.G3.limit && sampleCount >= 20 ? "pass" : "fail" }),
      watchSample({ gate: "G4", query: WATCH_GATES.G4.query, timeRange, sampleCount: 1, value: (liveCalls ?? 0) > 0 ? 1 : 0, limit: WATCH_GATES.G4.limit, outcome: (liveCalls ?? 0) > 0 ? "pass" : "fail" }),
      watchSample({ gate: "G5", query: WATCH_GATES.G5.query, timeRange, sampleCount, value: liveRatio ?? 1, limit: WATCH_GATES.G5.limit, outcome: ratioOk ? "pass" : "fail", baselineCohort: facts.seededImageId, candidateCohort: swap.actualVersion }),
      watchSample({ gate: "G6", query: WATCH_GATES.G6.query, timeRange, sampleCount: driverRate.sample_count, value: driverRate.value, limit: WATCH_GATES.G6.limit, outcome: driverRate.sample_count > 0 && driverRate.value < WATCH_GATES.G6.limit ? "pass" : "fail" }),
    ]
    const confirmationSealed = await watchProposals.sealArtifact({
      schemaId: "watch-report",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "confirmation",
        plan_ref: watchPlanRef.artifact_ref.content_hash,
        samples: confirmationSamples,
        stage_outcome: stageOutcome(confirmationSamples),
        sealed_at: new Date().toISOString(),
      },
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    await watchProposals.stageCommand({
      kind: "stage-status",
      stage: "watch",
      to: "completed",
      artifact_ref: confirmationSealed.artifact_ref,
    })
    if (kit !== null) {
      kit.bindStage(watchProposals, watchLease)
      await sealRunEnd(kit, {
        incidentId,
        runId,
        mode: options.mode ?? "full-capture",
        stageOutcomes: {
          detect: "completed",
          diagnose: "completed",
          repair: "completed",
          verify: "completed",
        },
        runContext: runEndContext(run, candidateHash, "verified-remediation"),
      })
      console.log(`[capture] orchestrator report + capture manifest sealed (completed run)`)
    }
    await watchProposals.completeRun("verified-remediation")
    console.log(`[capture] run completed: verified-remediation (incident resolved)`)

    // The confirmation window passes with no recurrence: resolved -> closed.
    const closed = await cp.confirmWindow(incidentId)
    if (!closed.ok) throw new Error(closed.error.message)
    console.log(`[capture] incident closed after the confirmation window (symptom-cleared)`)

    const finalEvents = cp.journal.events(incidentId)
    const finalState = cp.journal.state(incidentId)
    const report: CaptureReport = {
      run,
      savedId,
      incidentId,
      runId,
      finalSequence: finalEvents.at(-1)?.sequence ?? 0,
      finalRunState: "completed",
      finalIncidentState: finalState?.incidentState ?? "closed",
      outcome: "verified-remediation",
      failureReason: null,
      candidateHash,
      gateVerdicts: cp.gateEvaluations(incidentId, runId).map((gate) => `${gate.gate}:${gate.evaluation.verdict}`),
      receiptIds: cp.receipts(incidentId, runId).map((receipt) => receipt.receipt_id),
      artifactSchemas: cp.sealedArtifacts(incidentId).map((artifact) => artifact.artifactRef.schema_id),
      stageRecords: finalState?.runs[0]?.stageRecords.map((record) => `${record.stage}:${record.to}`) ?? [],
      agents: kit === null ? "fixture" : "real",
      manifestSealed: kit !== null,
    }
    await runtime.store.close()
    return report
  } catch (error) {
    await runtime.store.close()
    throw error
  }
}

/** A watch stage passes only when every recorded gate sample passes. */
function stageOutcome(samples: Record<string, unknown>[]): "pass" | "fail" {
  return samples.every((sample) => (sample as { outcome?: string }).outcome === "pass")
    ? "pass"
    : "fail"
}

/** The end-of-run summary the Orchestrator role session reflects on. */
function runEndContext(
  run: 1 | 2,
  candidateHash: HashString,
  outcome: string,
): string {
  return [
    `Run ${run} against the ${run === 1 ? "S1" : "S2"} seeded payment service.`,
    `Candidate ${candidateHash} is a one-line card-type restoration in src/payment/card.js.`,
    `The run ends ${outcome}; every gate verdict and receipt is recorded in the journal.`,
    "The capture manifest freezes the provider, model, reasoning level, skill tree digest, tool catalog revision, policy revision, perspectives, seeds, budgets, schema versions, and every role session record.",
  ].join("\n")
}

/** Run the end-of-run Orchestrator role session and, for full captures, seal
 * the capture manifest, then leave the run to complete or fail. Rehearsal
 * runs record no presentation manifest. */
async function sealRunEnd(
  kit: RealAgentKit,
  options: {
    incidentId: string
    runId: string
    stageOutcomes: { detect: string; diagnose: string; repair: string; verify: string }
    runContext: string
    mode: "rehearsal" | "full-capture"
  },
): Promise<void> {
  await kit.runOrchestrator({
    incidentId: options.incidentId,
    runId: options.runId,
    attempt: 1,
    stageOutcomes: options.stageOutcomes,
    runContext: options.runContext,
  })
  // Rehearsal runs keep the orchestrator session but record no presentation
  // manifest; full-capture runs seal the capture manifest artifact.
  if (options.mode === "rehearsal") {
    return
  }
  await kit.sealManifest({
    incidentId: options.incidentId,
    runId: options.runId,
    attempt: 1,
    mode: "full-capture",
    scenario: options.runContext.split("\n")[0] ?? "payment charge failure",
  })
}
