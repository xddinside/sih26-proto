/**
 * Deterministic receipt builders for the capture. Receipt ids are fixed (the
 * settled RECEIPT_IDS), so the exported journal is byte-stable across
 * re-captures apart from the real timestamps and hashes. Every receipt binds
 * the Incident, Run, stage, actor, candidate hash, and target.
 */
import { contentHash } from "@sih/contracts/hashes"
import type { BrokerReceipt } from "@sih/contracts/types"

import { NO_CANDIDATE_HASH } from "../../../packages/pi-skills/src/orchestrator/orchestrator.js"

export interface ReceiptEnv {
  incidentId: string
  runId: string
  leaseId: string
  stage: string
  candidateHash: string
}

export function hashOf(payload: unknown): `sha256:${string}` {
  const digest = contentHash(JSON.parse(JSON.stringify(payload)) as never)
  if (!digest.ok) {
    throw new Error(digest.error.message)
  }
  return digest.value
}

export function readReceipt(env: ReceiptEnv, spec: {
  receiptId: string
  backend: string
  connectionId: string
  query: string
  resourceType?: string
  result: { outcome: "ok" | "unresolved" | "expired" | "quarantined" | "error"; data: unknown; rowCount?: number; observedAt?: string }
}): BrokerReceipt {
  return {
    kind: "read",
    receipt_id: spec.receiptId,
    idempotency_key: `read:${env.incidentId}:${env.runId}:${env.stage}:${spec.receiptId}`,
    lease_id: env.leaseId,
    stage: env.stage as never,
    candidate_hash: env.candidateHash,
    request: {
      backend: spec.backend,
      connection_id: spec.connectionId,
      query: spec.query,
      ...(spec.resourceType === undefined ? {} : { resource_type: spec.resourceType }),
    },
    result: {
      outcome: spec.result.outcome,
      content_hash: hashOf(spec.result.data),
      observed_at: spec.result.observedAt ?? new Date().toISOString(),
      ...(spec.result.rowCount === undefined ? {} : { row_count: spec.result.rowCount }),
    },
  } as BrokerReceipt
}

export function actionReceipt(env: ReceiptEnv, spec: {
  receiptId: string
  adapter: string
  actionClass: string
  command: string
  target: {
    tenantId: string
    environment: string
    serviceName: string
    expectedVersion: string
    actualVersion?: string
  }
  permitId?: string
  outcome: "ok" | "failed" | "error" | "unknown"
  executedAt?: string
}): BrokerReceipt {
  return {
    kind: "action",
    receipt_id: spec.receiptId,
    idempotency_key: `action:${env.incidentId}:${env.runId}:${env.stage}:${spec.receiptId}`,
    lease_id: env.leaseId,
    stage: env.stage as never,
    candidate_hash: env.candidateHash,
    action: {
      adapter: spec.adapter,
      action_class: spec.actionClass,
      command: spec.command,
    },
    target: {
      tenant_id: spec.target.tenantId,
      deployment_environment_name: spec.target.environment,
      service_name: spec.target.serviceName,
      expected_version: spec.target.expectedVersion,
      ...(spec.target.actualVersion === undefined ? {} : { actual_version: spec.target.actualVersion }),
    },
    ...(spec.permitId === undefined ? {} : { permit_id: spec.permitId }),
    outcome: spec.outcome,
    executed_at: spec.executedAt ?? new Date().toISOString(),
  } as BrokerReceipt
}

export function testReceipt(env: ReceiptEnv, spec: {
  receiptId: string
  layer: "T1" | "T2" | "T3" | "T4" | "T5" | "T7" | "T9" | "T10" | "T12" | "T13"
  tool: string
  toolVersion: string
  target: string
  runs: Array<{ runHash: string; result: "pass" | "fail" | "error"; at: string; detail?: string }>
  outcome: "pass" | "fail" | "flaky-pass" | "error" | "not-run"
  flaky?: boolean
}): BrokerReceipt {
  return {
    kind: "test",
    receipt_id: spec.receiptId,
    idempotency_key: `test:${env.incidentId}:${env.runId}:${env.stage}:${spec.receiptId}`,
    lease_id: env.leaseId,
    stage: env.stage as never,
    candidate_hash: env.candidateHash,
    layer: spec.layer,
    tool: spec.tool,
    tool_version: spec.toolVersion,
    target: spec.target,
    runs: spec.runs.map((run) => ({
      run_hash: run.runHash,
      result: run.result,
      at: run.at,
      ...(run.detail === undefined ? {} : { detail: run.detail }),
    })),
    outcome: spec.outcome,
    flaky: spec.flaky ?? false,
  } as BrokerReceipt
}

export function ciReceipt(env: ReceiptEnv, spec: {
  receiptId: string
  pipeline: string
  pipelineRunId: string
  steps: Array<{ name: string; status: "success" | "failure" }>
  status: "success" | "failure"
  artifactDigest: string
}): BrokerReceipt {
  const logHash = hashOf({ steps: spec.steps })
  return {
    kind: "ci",
    receipt_id: spec.receiptId,
    idempotency_key: `ci:${env.incidentId}:${env.runId}:${spec.receiptId}`,
    lease_id: env.leaseId,
    stage: env.stage as never,
    candidate_hash: env.candidateHash,
    pipeline: spec.pipeline,
    pipeline_run_id: spec.pipelineRunId,
    steps: spec.steps.map((step) => ({
      name: step.name,
      status: step.status,
      log_ref: logHash,
    })),
    status: spec.status,
    artifact_digest: spec.artifactDigest,
    finished_at: new Date().toISOString(),
  } as BrokerReceipt
}

/** The no-candidate hash used for stage reads that precede any candidate. */
export function noCandidateHash(): string {
  return NO_CANDIDATE_HASH
}
