/**
 * Action Broker: typed operations only. Write actions are stage-specific and
 * pass through controlled tools; the Worker never gets a shell, a credential,
 * or a general production command. Release-stage actions require a one-use
 * permit consumed at the Control Plane; a replayed permit fails closed.
 */
import type { ControlPlaneClient, LeaseRef, ActionRequest } from "./types.js"
import { actionReceipt } from "./receipts.js"
import type { BrokerReceipt } from "@sih/contracts/types"

export class ActionBrokerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

/** The fixed stage write table from docs/research/worker-isolation.md. */
const STAGE_WRITES: Record<string, ReadonlySet<string>> = {
  detect: new Set(),
  diagnose: new Set(),
  repair: new Set(["submit_remediation_pr"]),
  verify: new Set(["request_isolated_ci"]),
  release: new Set(["submit_typed_action", "request_rollback"]),
  watch: new Set(["request_rollback"]),
}

export interface ActionAdapter {
  execute(action: { adapter: string; action_class: string; command: string }): Promise<{ outcome: "ok" | "failed" | "error"; detail?: string }>
}

const localActionAdapters: Record<string, ActionAdapter> = {
  "compose-release": {
    async execute(action) {
      return { outcome: "ok", detail: `compose-release ${action.command}` }
    },
  },
  "local-git": {
    async execute(action) {
      return { outcome: "ok", detail: `local-git ${action.command}` }
    },
  },
  "local-ci": {
    async execute(action) {
      return { outcome: "ok", detail: `local-ci ${action.command}` }
    },
  },
  "local-rollback": {
    async execute(action) {
      return { outcome: "ok", detail: `local-rollback ${action.command}` }
    },
  },
  "browser-session": {
    async execute(action) {
      return { outcome: "ok", detail: `browser-session ${action.command}` }
    },
  },
}

export class ActionBroker {
  constructor(
    private readonly cp: ControlPlaneClient,
    private readonly adapters: Record<string, ActionAdapter> = localActionAdapters,
  ) {}

  /**
   * Execute a typed action. The broker re-checks the lease, the stage write
   * table, the Control Plane's policy decision, and (for release-stage
   * actions) consumes a one-use permit. A barred, denied, stale, forged, or
   * mismatched request fails closed.
   */
  async execute(lease: LeaseRef, request: ActionRequest): Promise<BrokerReceipt> {
    const verified = await this.cp.verifyLease(lease)
    if (!verified.valid) {
      throw new ActionBrokerError("STALE_LEASE", verified.error ?? "lease verification failed")
    }

    // The stage contract: this stage may not perform this write class.
    const allowed = STAGE_WRITES[lease.stage] ?? new Set()
    if (!allowed.has(request.action.action_class)) {
      throw new ActionBrokerError("FORGED_STAGE", `stage ${lease.stage} may not perform ${request.action.action_class}`)
    }

    // The adapter must be declared and its action class approved.
    const adapter = this.adapters[request.action.adapter]
    if (adapter === undefined) {
      throw new ActionBrokerError("UNKNOWN_ADAPTER", `adapter ${request.action.adapter} is not declared`)
    }

    // Release-stage actions require a one-use permit bound to the candidate
    // hash and target, consumed atomically at the Control Plane.
    if (lease.stage === "release") {
      if (request.permitId === undefined || request.permitToken === undefined) {
        throw new ActionBrokerError("MISSING_PERMIT", "release-stage action requires a one-use permit")
      }
      const consumed = await this.cp.consumePermit(request.permitId, request.permitToken, {
        candidateHash: request.candidateHash,
        target: request.target.service_name ?? request.target.expected_version,
        incidentId: lease.incidentId,
      })
      if (!consumed.consumed) {
        throw new ActionBrokerError(consumed.error ?? "PERMIT_USED", consumed.error ?? "permit consume failed")
      }
    }

    // Policy: the Control Plane decides. A denied or barred action never
    // executes, under any mode or policy.
    const decision = await this.cp.decideAction(
      lease.incidentId,
      {
        adapter: request.action.adapter,
        action_class: request.action.action_class,
        command: request.action.command,
        category: this.categoryOf(request.action.action_class),
        target: request.target.service_name ?? "",
      },
      lease.stage,
    )
    if (decision.decision === "denied") {
      throw new ActionBrokerError("BARRED_ACTION", decision.reason)
    }
    if (decision.riskClass === "barred") {
      throw new ActionBrokerError("BARRED_ACTION", "barred action class; the product never executes it")
    }

    const adapterResult = await adapter.execute(request.action)
    const receipt = await actionReceipt(lease, request, request.candidateHash, adapterResult.outcome, {
      permitId: request.permitId,
      error: adapterResult.detail,
    })
    await this.cp.recordReceipt(lease.incidentId, lease.runId, lease.stage, receipt, "action-broker")
    return receipt
  }

  private categoryOf(actionClass: string): string {
    if (actionClass === "submit_remediation_pr") return "code"
    if (actionClass === "request_rollback") return "configuration"
    if (actionClass === "request_isolated_ci") return "code"
    if (actionClass === "request_browser_session") return "code"
    return "configuration"
  }
}
