/**
 * Broker types: the run-lease reference, the Control Plane client interface,
 * and broker request/response shapes. Brokers are callers; only the Control
 * Plane writes durable state. Receipts reuse the `@sih/contracts` receipt
 * shape and bind Incident, Run, stage, actor, target, and candidate hash.
 */
import type { BrokerReceipt } from "@sih/contracts/types"

/** The run-lease claims a broker forwards to the Control Plane for server-side
 * verification. The lease's own claims are never trusted; the Control Plane
 * re-reads server-side state. */
export interface LeaseRef {
  leaseId: string
  token: string
  incidentId: string
  runId: string
  attempt: number
  stage: "detect" | "diagnose" | "repair" | "verify" | "release" | "watch"
  actorId: string
  actorKind: "orchestrator" | "control-plane"
  toolClass: string
}

export interface TargetRef {
  tenant_id?: string
  deployment_environment_name?: string
  service_name?: string
  expected_version: string
  actual_version?: string
}

export interface ReadRequest {
  backend: string
  connection_id: string
  query: string
  resource_type?: string
  time_bounds?: { starts_at: string; ends_at: string | null }
}

export interface ReadResult {
  outcome: "ok" | "unresolved" | "expired" | "quarantined" | "error"
  content_hash: string
  observed_at: string
  row_count: number
  data: unknown
}

export interface ActionRequest {
  action: { adapter: string; action_class: string; command: string }
  target: TargetRef
  candidateHash: string
  actionDigest: string
  permitId?: string
  permitToken?: string
}

export interface SourceHostRecord {
  provider: string
  repository: string
  pullRequestNumber: number
  pullRequestUrl: string
  title: string
  branch: string
  baseRef: string
  headRef: string
  state: "open" | "closed" | "merged"
  mergedAt?: string | null
  checksPassed?: number
  checksTotal?: number
  approvals?: number
  diffText: string
}

export interface ModelRequest {
  parentAgentId: string
  agentId: string
  agentRole?: string
  model: string
  prompt: string
  idempotencyKey: string
}

/**
 * The Control Plane client the brokers call. Implemented over the Control
 * Plane's internal HTTP routes; tests inject a fake.
 */
export interface ControlPlaneClient {
  verifyLease(
    lease: LeaseRef
  ): Promise<{ valid: boolean; runState: string | null; error?: string }>
  consumePermit(
    permitId: string,
    token: string,
    expected: { candidateHash: string; target: string; incidentId: string }
  ): Promise<{ consumed: boolean; error?: string }>
  recordReceipt(
    incidentId: string,
    runId: string | undefined,
    stage: string | undefined,
    receipt: BrokerReceipt,
    actorKind: "read-broker" | "action-broker"
  ): Promise<{ recorded: boolean }>
  recordModelUse(
    incidentId: string,
    runId: string | undefined,
    input: Record<string, unknown>
  ): Promise<{ recorded: boolean }>
  decideAction(
    incidentId: string,
    action: {
      adapter: string
      action_class: string
      command: string
      category: string
      target: string
    },
    stage: string
  ): Promise<
    | { decision: string; reason: string; riskClass: string }
    | { decision: string; reason: string; riskClass: string; error?: never }
  >
}

export interface BrokerOutcome {
  receipt: BrokerReceipt
  data?: unknown
}
