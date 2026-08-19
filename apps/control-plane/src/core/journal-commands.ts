/**
 * Typed builders for `@sih/contracts` journal commands. The journal reducer
 * enforces transition legality, expected versions, and stage order; these
 * builders only assemble the command shape. Each command carries an
 * idempotency key, an actor, and the policy version in force.
 */
import type {
  BrokerReceipt,
  ClosureReason,
  GateEvaluation,
  IncidentTrigger,
  JournalCommand,
  OrchestratorWorkBudget,
  OrchestratorWorkRequest,
  RunFailureReason,
  RunOutcome,
} from "@sih/contracts/types"

export type ActorKind =
  | "intake-normalizer"
  | "orchestrator"
  | "human"
  | "control-plane"
  | "read-broker"
  | "action-broker"
  | "model-gateway"

export interface Actor {
  id: string
  kind: ActorKind
  credential_scope?: string
}

export interface ArtifactRef {
  schema_id: string
  schema_version: string
  content_hash: string
}

const CONTROL_PLANE: Actor = { id: "cp-1", kind: "control-plane" }

function common(
  idempotencyKey: string,
  actor: Actor,
  policyVersion: string,
  recordedAt: string,
): {
  idempotency_key: string
  recorded_at: string
  actor: Actor
  policy_version: string
} {
  return {
    idempotency_key: idempotencyKey,
    recorded_at: recordedAt,
    actor,
    policy_version: policyVersion,
  }
}

export function triggerReceivedCommand(
  incidentId: string,
  trigger: IncidentTrigger,
  deliveryResult: "incident-created" | "evidence-appended" | "duplicate-noop",
  policyVersion: string,
  recordedAt: string,
): JournalCommand {
  return {
    ...common(`delivery:${trigger.delivery_key}`, CONTROL_PLANE, policyVersion, recordedAt),
    type: "trigger_received",
    incident_id: incidentId,
    trigger,
    delivery_result: deliveryResult,
  }
}

export function incidentTransitionCommand(
  incidentId: string,
  from: "open" | "resolved" | "closed" | null,
  to: "open" | "resolved" | "closed",
  expectedVersion: number,
  closureReason: ClosureReason | undefined,
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  actor: Actor = CONTROL_PLANE,
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "incident_transition",
    incident_id: incidentId,
    from,
    to,
    expected_version: expectedVersion,
    ...(closureReason === undefined ? {} : { closure_reason: closureReason }),
  }
}

export function runTransitionCommand(
  incidentId: string,
  runId: string,
  attempt: number,
  from: string | null,
  to: string,
  expectedRunVersion: number,
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  options: { outcome?: RunOutcome; failure_reason?: RunFailureReason; restart_count?: number } = {},
  actor: Actor = CONTROL_PLANE,
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "run_transition",
    incident_id: incidentId,
    run_id: runId,
    attempt,
    from,
    to,
    expected_run_version: expectedRunVersion,
    ...options,
  } as JournalCommand
}

export function stageTransitionCommand(
  incidentId: string,
  runId: string,
  attempt: number,
  stage: string,
  from: string | null,
  to: string,
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  options: { reason?: string; artifact_ref?: ArtifactRef; candidate_hash?: string; lease_id?: string } = {},
  actor: Actor = CONTROL_PLANE,
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "stage_transition",
    incident_id: incidentId,
    run_id: runId,
    attempt,
    stage,
    from,
    to,
    ...options,
  } as JournalCommand
}

export function artifactSealedCommand(
  incidentId: string,
  runId: string | undefined,
  artifactRef: ArtifactRef,
  producer: { skill?: string; skill_version?: string; tool?: string; tool_version?: string; tool_catalog_version?: string },
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  actor: Actor = CONTROL_PLANE,
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "artifact_sealed",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    artifact_ref: artifactRef,
    ...(Object.keys(producer).length === 0 ? {} : { producer }),
  } as JournalCommand
}

export function gateEvaluatedCommand(
  incidentId: string,
  runId: string | undefined,
  attempt: number | undefined,
  gate: "hypothesis" | "release" | "action",
  evaluation: GateEvaluation,
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
): JournalCommand {
  return {
    ...common(idempotencyKey, CONTROL_PLANE, policyVersion, recordedAt),
    type: "gate_evaluated",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(attempt === undefined ? {} : { attempt }),
    gate,
    evaluation,
  } as JournalCommand
}

export function brokerReceiptCommand(
  incidentId: string,
  runId: string | undefined,
  stage: string | undefined,
  receipt: BrokerReceipt,
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  actor: Actor,
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "broker_receipt_recorded",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(stage === undefined ? {} : { stage }),
    receipt,
  } as JournalCommand
}

export function policyDecisionCommand(
  incidentId: string,
  runId: string | undefined,
  decision: "autonomous" | "approval-required" | "denied" | "needs-human",
  tzdbVersion: string,
  evaluatedAt: string,
  policyVersion: string,
  idempotencyKey: string,
  options: {
    window?: { iana_zone: string; windows: unknown[] }
    evaluated_local_time?: string
    reason?: string
  } = {},
): JournalCommand {
  return {
    ...common(idempotencyKey, CONTROL_PLANE, policyVersion, evaluatedAt),
    type: "policy_decision",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    decision,
    tzdb_version: tzdbVersion,
    evaluated_at: evaluatedAt,
    ...(options.window === undefined ? {} : { window: options.window }),
    ...(options.evaluated_local_time === undefined ? {} : { evaluated_local_time: options.evaluated_local_time }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  } as JournalCommand
}

export function leaseEventCommand(
  incidentId: string,
  runId: string | undefined,
  leaseId: string,
  leaseKind: "run" | "release",
  action: "issued" | "renewed" | "expired" | "revoked",
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  options: { stage?: string; bound_candidate_hash?: string } = {},
): JournalCommand {
  return {
    ...common(idempotencyKey, CONTROL_PLANE, policyVersion, recordedAt),
    type: "lease_event",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    lease_id: leaseId,
    lease_kind: leaseKind,
    action,
    ...options,
  } as JournalCommand
}

export function approvalRecordedCommand(
  incidentId: string,
  runId: string | undefined,
  approval: {
    approval_id: string
    action_digest: string
    approver_identity: string
    approval_system: string
    policy_version: string
    tzdb_version: string
    action_risk_class: "safe" | "guarded"
    expiry: string
    scope?: { target: string; changed_surfaces: string[] }
    action: "granted" | "revoked" | "consumed"
  },
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
): JournalCommand {
  return {
    ...common(idempotencyKey, CONTROL_PLANE, policyVersion, recordedAt),
    type: "approval_recorded",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    approval,
  } as JournalCommand
}

export function humanActionCommand(
  incidentId: string,
  action: "pause" | "resume" | "cancel" | "approve" | "deny" | "close" | "policy-update" | "rollback-request",
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  options: {
    run_id?: string
    reason?: string
    approval_ref?: string
    policy_version_after?: string
  } = {},
  actor: Actor = { id: "operator-1", kind: "human" },
): JournalCommand {
  return {
    ...common(idempotencyKey, actor, policyVersion, recordedAt),
    type: "human_action",
    incident_id: incidentId,
    action,
    ...options,
  } as JournalCommand
}

export function modelUseCommand(
  incidentId: string,
  runId: string | undefined,
  parentAgentId: string,
  agentId: string,
  model: string,
  tokenUse: { prompt_tokens: number; completion_tokens: number },
  toolCalls: { tool: string; tool_call_id: string; args_ref?: string; result_ref?: string }[],
  policyVersion: string,
  recordedAt: string,
  idempotencyKey: string,
  options: { agent_role?: string; prompt_ref?: string; result_ref?: string } = {},
): JournalCommand {
  return {
    ...common(idempotencyKey, { id: "mgw-1", kind: "model-gateway" }, policyVersion, recordedAt),
    type: "model_use",
    incident_id: incidentId,
    ...(runId === undefined ? {} : { run_id: runId }),
    parent_agent_id: parentAgentId,
    agent_id: agentId,
    model,
    token_use: tokenUse,
    tool_calls: toolCalls,
    ...options,
  } as JournalCommand
}

/** Record both accepted and rejected Orchestrator work proposals. The event
 * is audit-only; the journal reducer does not let it mutate stage state. */
export function workRequestedCommand(
  incidentId: string,
  runId: string,
  request: OrchestratorWorkRequest,
  status: "admitted" | "rejected",
  policyVersion: string,
  recordedAt: string,
  options: { code?: string; reason?: string; admittedArtifactRefs?: ArtifactRef[]; actorId?: string } = {},
): JournalCommand {
  return {
    ...common(`work-request:${request.request_id}`, { id: options.actorId ?? `orchestrator-${runId}`, kind: "orchestrator" }, policyVersion, recordedAt),
    type: "work_requested",
    incident_id: incidentId,
    run_id: runId,
    attempt: request.attempt,
    request_id: request.request_id,
    work_id: request.work_id,
    stage: request.stage,
    status,
    depends_on: request.depends_on,
    budget: request.budget as OrchestratorWorkBudget,
    admitted_artifact_refs: options.admittedArtifactRefs ?? [],
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  } as JournalCommand
}

/** Record that a previously admitted work unit produced sealed outputs. */
export function workCompletedCommand(
  incidentId: string,
  runId: string,
  attempt: number,
  workId: string,
  artifactRefs: ArtifactRef[],
  policyVersion: string,
  recordedAt: string,
  actorId = `orchestrator-${runId}`,
): JournalCommand {
  return {
    ...common(`work-complete:${workId}`, { id: actorId, kind: "orchestrator" }, policyVersion, recordedAt),
    type: "work_completed",
    incident_id: incidentId,
    run_id: runId,
    attempt,
    work_id: workId,
    artifact_refs: artifactRefs,
  } as JournalCommand
}
