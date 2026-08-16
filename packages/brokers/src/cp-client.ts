/**
 * HTTP Control Plane client for brokers, and local adapter stubs for the
 * demo (git adapter, CI runner, Compose release adapter, read backends).
 * Brokers never receive credentials: the Control Plane holds the broker token
 * and re-reads server-side state on every call.
 */
import { contentHash } from "@sih/contracts/hashes"
import type { BrokerReceipt } from "@sih/contracts/types"

import type { ControlPlaneClient, LeaseRef, ReadResult } from "./types.js"

export class HttpControlPlaneClient implements ControlPlaneClient {
  constructor(
    private readonly baseUrl: string,
    private readonly brokerToken: string,
  ) {}

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.brokerToken}`,
      },
      body: JSON.stringify(body),
    })
    if (response.status >= 400) {
      const parsed = (await response.json().catch(() => ({}))) as { error?: { code: string; message: string } }
      return { error: parsed.error?.code ?? "BROKER_ERROR", message: parsed.error?.message ?? "control plane error" }
    }
    return (await response.json()) as Record<string, unknown>
  }

  async verifyLease(lease: LeaseRef): Promise<{ valid: boolean; runState: string | null; error?: string }> {
    const result = await this.post("/v1/internal/leases/verify", {
      token: lease.token,
      claims: {
        leaseId: lease.leaseId,
        incidentId: lease.incidentId,
        runId: lease.runId,
        attempt: lease.attempt,
        stage: lease.stage,
        actorId: lease.actorId,
        actorKind: lease.actorKind,
        toolClass: lease.toolClass,
      },
    })
    if (result.error !== undefined) {
      return { valid: false, runState: null, error: String(result.error) }
    }
    return { valid: Boolean(result.valid), runState: (result.run_state as string | null) ?? null }
  }

  async consumePermit(permitId: string, token: string, expected: { candidateHash: string; target: string; incidentId: string }): Promise<{ consumed: boolean; error?: string }> {
    const result = await this.post("/v1/internal/permits/consume", {
      permit_id: permitId,
      token,
      candidate_hash: expected.candidateHash,
      target: expected.target,
      incident_id: expected.incidentId,
    })
    return { consumed: Boolean(result.consumed), error: result.error as string | undefined }
  }

  async recordReceipt(incidentId: string, runId: string | undefined, stage: string | undefined, receipt: BrokerReceipt, actorKind: "read-broker" | "action-broker"): Promise<{ recorded: boolean }> {
    const result = await this.post("/v1/internal/receipts", {
      incident_id: incidentId,
      ...(runId === undefined ? {} : { run_id: runId }),
      ...(stage === undefined ? {} : { stage }),
      receipt,
      actor_kind: actorKind,
    })
    return { recorded: Boolean(result.recorded) }
  }

  async recordModelUse(incidentId: string, runId: string | undefined, input: Record<string, unknown>): Promise<{ recorded: boolean }> {
    const result = await this.post("/v1/internal/model-use", {
      incident_id: incidentId,
      ...(runId === undefined ? {} : { run_id: runId }),
      ...input,
    })
    return { recorded: Boolean(result.recorded) }
  }

  async decideAction(incidentId: string, action: { adapter: string; action_class: string; command: string; category: string; target: string }, stage: string): Promise<{ decision: string; reason: string; riskClass: string }> {
    const result = await this.post("/v1/internal/policy-decision", {
      incident_id: incidentId,
      action,
      stage,
    })
    return {
      decision: String(result.decision),
      reason: String(result.reason),
      riskClass: String(result.riskClass),
    }
  }
}

/** Local read adapters: return data, never credentials. */
export interface ReadAdapter {
  read(request: { backend: string; connection_id: string; query: string }): Promise<{ outcome: ReadResult["outcome"]; data: unknown; row_count: number }>
}

export const prometheusReadAdapter: ReadAdapter = {
  async read(request) {
    return {
      outcome: "ok",
      data: { backend: request.backend, query: request.query, value: 0.92, labels: { service_name: "payment" } },
      row_count: 1,
    }
  },
}

export const flagdReadAdapter: ReadAdapter = {
  async read(request) {
    return {
      outcome: "ok",
      data: { backend: request.backend, key: "paymentFailure", value: 0 },
      row_count: 1,
    }
  },
}

export const gitReadAdapter: ReadAdapter = {
  async read(request) {
    return {
      outcome: "ok",
      data: { backend: request.backend, query: request.query, blob: "<diff>" },
      row_count: 1,
    }
  },
}

export const readAdapters: Record<string, ReadAdapter> = {
  prometheus: prometheusReadAdapter,
  flagd: flagdReadAdapter,
  git: gitReadAdapter,
}

/** A fake Control Plane client for tests and offline use. */
export class FakeControlPlaneClient implements ControlPlaneClient {
  readonly leases = new Set<string>()
  readonly permits = new Set<string>()
  readonly receipts: { incidentId: string; receipt: BrokerReceipt }[] = []
  leaseError: string | undefined
  permitError: string | undefined
  /** When set, consumePermit rejects a mismatched candidate hash. */
  permitCandidateHash: string | undefined
  decision: { decision: string; reason: string; riskClass: string } = { decision: "autonomous", reason: "ok", riskClass: "safe" }

  async verifyLease(lease: LeaseRef): Promise<{ valid: boolean; runState: string | null; error?: string }> {
    if (this.leaseError !== undefined) {
      return { valid: false, runState: null, error: this.leaseError }
    }
    return { valid: this.leases.has(lease.leaseId), runState: "running" }
  }

  async consumePermit(_permitId: string, _token: string, expected: { candidateHash: string; target: string; incidentId: string }): Promise<{ consumed: boolean; error?: string }> {
    if (this.permitError !== undefined) {
      return { consumed: false, error: this.permitError }
    }
    if (this.permitCandidateHash !== undefined && this.permitCandidateHash !== expected.candidateHash) {
      return { consumed: false, error: "CANDIDATE_MISMATCH" }
    }
    return { consumed: true }
  }

  async recordReceipt(incidentId: string, _runId: string | undefined, _stage: string | undefined, receipt: BrokerReceipt): Promise<{ recorded: boolean }> {
    this.receipts.push({ incidentId, receipt })
    return { recorded: true }
  }

  async recordModelUse(): Promise<{ recorded: boolean }> {
    return { recorded: true }
  }

  async decideAction(): Promise<{ decision: string; reason: string; riskClass: string }> {
    return this.decision
  }
}

export async function contentHashOf(data: unknown): Promise<string> {
  const hash = contentHash(data as Parameters<typeof contentHash>[0])
  return hash.ok ? hash.value : "sha256:" + "0".repeat(64)
}
