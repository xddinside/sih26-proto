/**
 * The Release Gate: the deterministic eight-fact gate for code merge and
 * deploy, from docs/research/release-recovery.md and
 * docs/research/authority-action-risk.md. It runs outside the Orchestrator
 * and outside the Worker; a model cannot waive it.
 */
import type {
  GateEvaluation,
  RemediationProposal,
} from "@sih/contracts/types"

import type { PolicyDecision, ActionRiskClass  } from "../core/policy.js"

export interface ApprovalState {
  valid: boolean
  approval_id: string | null
}

export interface RecoveryPointCoverage {
  validated: boolean
  changed: string[]
  covered: string[]
  uncoveredApproved: boolean
}

export interface ReleaseGateInput {
  candidateHash: string
  proposal: RemediationProposal
  verificationReport: { candidate_hash: string; hash_binding: { match: boolean } }
  riskClass: ActionRiskClass
  policyDecision: PolicyDecision
  policyDecisionReason: string
  approval: ApprovalState
  /** Fact 1: hash binding intact and the artifact matches the reviewed commit. */
  artifactMatchesCommit: boolean
  /** Fact 2: CI, security, code, regression, and end-to-end checks passed. */
  pipelineChecksPassed: boolean
  /** Fact 3: the target still runs the version named by the request. */
  targetVersionMatches: boolean
  /** Fact 5: rollout and Watch plans fixed, complete, and rehearsed (T13). */
  rolloutWatchPlanComplete: boolean
  /** Fact 6: tested Recovery Point coverage. */
  recoveryPointCoverage: RecoveryPointCoverage
  /** Fact 8: the company pipeline's own rules passed. */
  pipelineRulesPassed: boolean
  policyVersion: string
  tzdbVersion: string
  evaluatedAt: string
}

export type GateVerdict = "pass" | "fail" | "needs-human"

export interface FactRow {
  fact: string
  result: boolean
  evidence_refs: { kind: "receipt" | "artifact" | "approval"; ref: string }[]
  reason: string
}

/**
 * Evaluate the eight Release Gate facts and produce the deterministic
 * verdict. `needs-human` is the only flexible outcome; no model input ever
 * turns `fail` into `pass` or skips a fact.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): {
  facts: FactRow[]
  verdict: GateVerdict
  evaluation: GateEvaluation
} {
  const { proposal, verificationReport } = input

  const fact1: FactRow = {
    fact: "1",
    result: input.artifactMatchesCommit && verificationReport.hash_binding.match,
    evidence_refs: [
      { kind: "artifact", ref: `verification-report:${verificationReport.candidate_hash}` },
      { kind: "artifact", ref: `remediation-proposal:${proposal.candidate_hash}` },
    ],
    reason: input.artifactMatchesCommit && verificationReport.hash_binding.match
      ? "remediation and artifact match the reviewed commit; hash binding intact"
      : verificationReport.hash_binding.match
        ? "artifact does not match the reviewed commit"
        : "candidate hash changed after Verify sealed",
  }

  const fact2: FactRow = {
    fact: "2",
    result: input.pipelineChecksPassed,
    evidence_refs: [{ kind: "receipt", ref: "pipeline-check-receipts" }],
    reason: input.pipelineChecksPassed
      ? "CI, security, code, regression, and end-to-end checks passed"
      : "a required pipeline check did not pass",
  }

  const fact3: FactRow = {
    fact: "3",
    result: input.targetVersionMatches,
    evidence_refs: [],
    reason: input.targetVersionMatches
      ? "target still runs the expected version"
      : "target no longer runs the version named by the release request",
  }

  const policyPermits = input.policyDecision !== "denied"
  const approvalSatisfied =
    input.policyDecision !== "approval-required" || input.approval.valid
  const fact4: FactRow = {
    fact: "4",
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

  const fact5: FactRow = {
    fact: "5",
    result: input.rolloutWatchPlanComplete,
    evidence_refs: [],
    reason: input.rolloutWatchPlanComplete
      ? "rollout and Watch plans frozen, complete, and rehearsed"
      : "rollout or Watch plan incomplete or unrehearsed",
  }

  const uncovered = input.recoveryPointCoverage.changed.filter(
    (surface) => !input.recoveryPointCoverage.covered.includes(surface),
  )
  const fact6: FactRow = {
    fact: "6",
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

  const fact7: FactRow = {
    fact: "7",
    result: input.riskClass !== "barred",
    evidence_refs: [],
    reason: input.riskClass !== "barred"
      ? "no barred or irreversible action in the change set"
      : "the change set contains a barred action; the product never executes it",
  }

  const fact8: FactRow = {
    fact: "8",
    result: input.pipelineRulesPassed,
    evidence_refs: [],
    reason: input.pipelineRulesPassed
      ? "the pipeline's branch, environment, change-management, and approval rules passed"
      : "a company pipeline rule did not pass",
  }

  const facts: FactRow[] = [fact1, fact2, fact3, fact4, fact5, fact6, fact7, fact8]

  const verdict = resolveGateVerdict({
    facts,
    barred: input.riskClass === "barred",
    hashMismatch: !verificationReport.hash_binding.match,
    policyDenied: input.policyDecision === "denied",
    approvalOutstanding:
      input.policyDecision === "approval-required" && !input.approval.valid,
    staleTarget: !input.targetVersionMatches,
  })

  const evaluation = {
    gate: "release",
    candidate_hash: input.candidateHash,
    facts: facts.map(({ fact, result, evidence_refs }) => ({ fact, result, evidence_refs })),
    verdict,
    evaluated_at: input.evaluatedAt,
    policy_version: input.policyVersion,
    tzdb_version: input.tzdbVersion,
  } as GateEvaluation

  return { facts, verdict, evaluation }
}

export function resolveGateVerdict(input: {
  facts: readonly { result: boolean }[]
  barred: boolean
  hashMismatch: boolean
  policyDenied: boolean
  approvalOutstanding: boolean
  staleTarget: boolean
  missingEvidence?: boolean
}): GateVerdict {
  // Definitive false facts fail: barred action, hash change after Verify,
  // policy denial.
  if (input.barred || input.hashMismatch || input.policyDenied) {
    return "fail"
  }
  // Undecidable facts park the run for a human.
  if (input.staleTarget || input.approvalOutstanding || input.missingEvidence === true) {
    return "needs-human"
  }
  const allPass = input.facts.every((fact) => fact.result)
  if (!allPass) {
    return "fail"
  }
  return "pass"
}
