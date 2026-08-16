/**
 * Receipt builders: match the `@sih/contracts` broker-receipt shape. Receipts
 * are the only things that own numbers and facts; they bind the Incident, Run,
 * stage, actor, target, and candidate hash.
 */
import { contentHash } from "@sih/contracts/hashes"
import type { BrokerReceipt } from "@sih/contracts/types"

import type { LeaseRef, ReadRequest, ReadResult, TargetRef } from "./types.js"

function receiptId(): string {
  return `rcpt-${cryptoRandomHex(16)}`
}

export function cryptoRandomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("")
}

export async function readReceipt(
  lease: LeaseRef,
  request: ReadRequest,
  result: ReadResult,
  candidateHash: string,
): Promise<BrokerReceipt> {
  return {
    kind: "read",
    receipt_id: receiptId(),
    idempotency_key: `read:${lease.incidentId}:${lease.runId}:${lease.stage}:${result.content_hash}`,
    lease_id: lease.leaseId,
    stage: lease.stage,
    candidate_hash: candidateHash,
    request: {
      backend: request.backend,
      connection_id: request.connection_id,
      query: request.query,
      ...(request.resource_type === undefined ? {} : { resource_type: request.resource_type }),
      ...(request.time_bounds === undefined ? {} : { time_bounds: request.time_bounds }),
    },
    result: {
      outcome: result.outcome,
      content_hash: result.content_hash,
      observed_at: result.observed_at,
      row_count: result.row_count,
    },
  }
}

export async function actionReceipt(
  lease: LeaseRef,
  request: { action: { adapter: string; action_class: string; command: string }; target: TargetRef },
  candidateHash: string,
  outcome: "ok" | "failed" | "error" | "unknown",
  options: { permitId?: string; error?: string; executedAt?: string } = {},
): Promise<BrokerReceipt> {
  return {
    kind: "action",
    receipt_id: receiptId(),
    idempotency_key: `action:${lease.incidentId}:${lease.runId}:${lease.stage}:${candidateHash}`,
    lease_id: lease.leaseId,
    stage: lease.stage,
    candidate_hash: candidateHash,
    action: request.action,
    target: {
      expected_version: request.target.expected_version,
      ...(request.target.tenant_id === undefined ? {} : { tenant_id: request.target.tenant_id }),
      ...(request.target.deployment_environment_name === undefined ? {} : { deployment_environment_name: request.target.deployment_environment_name }),
      ...(request.target.service_name === undefined ? {} : { service_name: request.target.service_name }),
      ...(request.target.actual_version === undefined ? {} : { actual_version: request.target.actual_version }),
    },
    ...(options.permitId === undefined ? {} : { permit_id: options.permitId }),
    outcome,
    executed_at: options.executedAt ?? new Date().toISOString(),
    ...(options.error === undefined ? {} : { error: options.error }),
  }
}

export async function ciReceipt(
  lease: LeaseRef,
  candidateHash: string,
  pipeline: string,
  pipelineRunId: string,
  steps: { name: string; status: "success" | "failure" }[],
  status: "success" | "failure",
  artifactDigest: string,
): Promise<BrokerReceipt> {
  const logHash = contentHash({ steps })
  return {
    kind: "ci",
    receipt_id: receiptId(),
    idempotency_key: `ci:${lease.incidentId}:${lease.runId}:${pipelineRunId}`,
    lease_id: lease.leaseId,
    stage: lease.stage,
    candidate_hash: candidateHash,
    pipeline,
    pipeline_run_id: pipelineRunId,
    steps: steps.map((step) => ({
      name: step.name,
      status: step.status,
      ...(logHash.ok ? { log_ref: logHash.value } : {}),
    })),
    status,
    artifact_digest: artifactDigest,
    finished_at: new Date().toISOString(),
  }
}

export async function testReceipt(
  lease: LeaseRef,
  candidateHash: string,
  layer: "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10" | "T11" | "T12" | "T13",
  tool: string,
  toolVersion: string,
  target: string,
  runs: { run_hash: string; result: "pass" | "fail" | "error"; at: string; detail?: string }[],
  outcome: "pass" | "fail" | "flaky-pass" | "error" | "not-run",
  flaky: boolean,
): Promise<BrokerReceipt> {
  return {
    kind: "test",
    receipt_id: receiptId(),
    idempotency_key: `test:${lease.incidentId}:${lease.runId}:${layer}:${candidateHash}`,
    lease_id: lease.leaseId,
    stage: lease.stage,
    candidate_hash: candidateHash,
    layer,
    tool,
    tool_version: toolVersion,
    target,
    runs,
    outcome,
    flaky,
  }
}
