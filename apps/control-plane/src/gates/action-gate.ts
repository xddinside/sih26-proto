/**
 * The Action Gate: the deterministic gate for typed direct operational
 * Remediations (configuration, feature-flag, restart, scaling, traffic, and
 * infrastructure changes) from docs/research/authority-action-risk.md. It
 * checks the same facts as the Release Gate in operational form.
 */
import type { GateEvaluation } from "@sih/contracts/types"

import type {
  ActionRiskClass,
  PolicyDecision,
  TypedAction,
} from "../core/policy.js"
import type { ApprovalState, FactRow, GateVerdict, RecoveryPointCoverage  } from "./release-gate.js"
import { resolveGateVerdict } from "./release-gate.js"

export interface ActionGateInput {
  candidateHash: string
  action: TypedAction
  riskClass: ActionRiskClass
  /** Fact 1: the typed command matches an approved adapter and action class. */
  adapterApproved: boolean
  /** Fact 2: the target version matches the request's expected version. */
  targetVersionMatches: boolean
  policyDecision: PolicyDecision
  policyDecisionReason: string
  approval: ApprovalState
  /** Fact 4: tested Recovery Point coverage. */
  recoveryPointCoverage: RecoveryPointCoverage
  /** Fact 5: stop and Watch conditions fixed and deterministic. */
  stopWatchConditionsFixed: boolean
  /** Fact 6: Emergency allow-list membership for the named action and service. */
  emergencyAllowListMembership: boolean
  policyVersion: string
  tzdbVersion: string
  evaluatedAt: string
}

/** Evaluate the six Action Gate facts and produce the deterministic verdict. */
export function evaluateActionGate(input: ActionGateInput): {
  facts: FactRow[]
  verdict: GateVerdict
  evaluation: GateEvaluation
} {
  const fact1: FactRow = {
    fact: "1",
    result: input.adapterApproved,
    evidence_refs: [],
    reason: input.adapterApproved
      ? `adapter ${input.action.adapter} approves ${input.action.action_class}`
      : `adapter ${input.action.adapter} has not approved action class ${input.action.action_class} for unattended use`,
  }

  const fact2: FactRow = {
    fact: "2",
    result: input.targetVersionMatches,
    evidence_refs: [],
    reason: input.targetVersionMatches
      ? "target version matches the request"
      : "target version differs from the request's expected version",
  }

  const policyPermits = input.policyDecision !== "denied"
  const approvalSatisfied =
    input.policyDecision !== "approval-required" || input.approval.valid
  const fact3: FactRow = {
    fact: "3",
    result: policyPermits && approvalSatisfied,
    evidence_refs: input.approval.valid && input.approval.approval_id !== null
      ? [{ kind: "approval", ref: input.approval.approval_id }]
      : [],
    reason: !policyPermits
      ? `policy denies the action: ${input.policyDecisionReason}`
      : input.policyDecision === "approval-required" && !input.approval.valid
        ? `policy requires a recorded approval (${input.policyDecisionReason})`
        : "action fits the active Authority Mode and Automation Policy",
  }

  const uncovered = input.recoveryPointCoverage.changed.filter(
    (surface) => !input.recoveryPointCoverage.covered.includes(surface),
  )
  const fact4: FactRow = {
    fact: "4",
    result:
      input.recoveryPointCoverage.validated &&
      (uncovered.length === 0 || input.recoveryPointCoverage.uncoveredApproved),
    evidence_refs: [],
    reason: !input.recoveryPointCoverage.validated
      ? "Recovery Point validation failed"
      : uncovered.length > 0 && !input.recoveryPointCoverage.uncoveredApproved
        ? `uncovered surfaces without approval: ${uncovered.join(", ")}`
        : "tested Recovery Point covers every changed surface",
  }

  const fact5: FactRow = {
    fact: "5",
    result: input.stopWatchConditionsFixed,
    evidence_refs: [],
    reason: input.stopWatchConditionsFixed
      ? "stop and Watch conditions are fixed and deterministic"
      : "stop or Watch conditions are not fixed",
  }

  const barred = input.riskClass === "barred"
  const guardedApprovalSatisfied =
    input.riskClass !== "guarded" || input.approval.valid
  const fact6: FactRow = {
    fact: "6",
    result: !barred && guardedApprovalSatisfied,
    evidence_refs: input.approval.valid && input.approval.approval_id !== null
      ? [{ kind: "approval", ref: input.approval.approval_id }]
      : [],
    reason: barred
      ? "the action is barred; the product never executes it"
      : input.riskClass === "guarded" && !input.approval.valid
        ? "guarded action without a fresh, unexpired, scope-matching approval"
        : "no barred action; approval requirements met",
  }

  const facts: FactRow[] = [fact1, fact2, fact3, fact4, fact5, fact6]

  const verdict = resolveGateVerdict({
    facts,
    barred,
    hashMismatch: false,
    policyDenied: input.policyDecision === "denied",
    approvalOutstanding:
      (input.policyDecision === "approval-required" && !input.approval.valid) ||
      (input.riskClass === "guarded" && !input.approval.valid),
    staleTarget: !input.targetVersionMatches,
  })

  const evaluation = {
    gate: "action",
    candidate_hash: input.candidateHash,
    facts: facts.map(({ fact, result, evidence_refs }) => ({ fact, result, evidence_refs })),
    verdict,
    evaluated_at: input.evaluatedAt,
    policy_version: input.policyVersion,
    tzdb_version: input.tzdbVersion,
  } as GateEvaluation

  return { facts, verdict, evaluation }
}
