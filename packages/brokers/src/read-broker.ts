/**
 * Read Broker: returns data, never credentials. Every call carries the run
 * lease and records a receipt binding the Incident, Run, stage, actor, and
 * candidate hash. The broker checks the Control Plane's server-side lease
 * state, not the lease's own claims.
 */
import type { ControlPlaneClient, LeaseRef, ReadRequest, ReadResult } from "./types.js"
import type { ReadAdapter } from "./cp-client.js"
import { readReceipt } from "./receipts.js"
import { readAdapters } from "./cp-client.js"

export class ReadBrokerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

export class ReadBroker {
  constructor(
    private readonly cp: ControlPlaneClient,
    private readonly adapters: Record<string, ReadAdapter> = readAdapters,
  ) {}

  /**
   * Execute a bounded read. A stale, expired, revoked, or forged lease fails
   * closed before any data moves.
   */
  async read(lease: LeaseRef, request: ReadRequest, candidateHash: string): Promise<{ result: ReadResult; receiptId: string }> {
    const verified = await this.cp.verifyLease(lease)
    if (!verified.valid) {
      throw new ReadBrokerError("STALE_LEASE", verified.error ?? "lease verification failed")
    }

    const adapter = this.adapters[request.backend]
    if (adapter === undefined) {
      throw new ReadBrokerError("UNKNOWN_BACKEND", `no read adapter for backend ${request.backend}`)
    }

    const adapterResult = await adapter.read(request)
    const result: ReadResult = {
      outcome: adapterResult.outcome,
      content_hash: await this.hash(adapterResult.data),
      observed_at: new Date().toISOString(),
      row_count: adapterResult.row_count,
      data: adapterResult.data,
    }

    const receipt = await readReceipt(lease, request, result, candidateHash)
    await this.cp.recordReceipt(lease.incidentId, lease.runId, lease.stage, receipt, "read-broker")

    return { result, receiptId: receipt.receipt_id }
  }

  private async hash(data: unknown): Promise<string> {
    const { contentHashOf } = await import("./cp-client.js")
    return contentHashOf(data)
  }
}
