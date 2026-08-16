/**
 * The deterministic verdict function from docs/research/review-verification.md.
 *
 * Severity takes the maximum; contradictions go to `needs-human`; there is no
 * majority vote. One cited `blocker` fails a candidate; a `flaky-pass` on a
 * required or triggered-conditional check yields `needs-human`; a stale hash
 * binding fails. The consolidation is fixed policy code, not model judgment.
 */
import type { ReviewReport, TestReport } from "@sih/contracts/types"

import type { ResolverResult } from "./resolver.js"

export type VerifyVerdict = "pass" | "fail" | "needs-human"

export interface ReviewInput {
  role: string
  status: "pass" | "fail"
  findings: {
    severity: "blocker" | "major" | "minor" | "info"
    citations: unknown[]
    status: "open" | "retracted" | "fixed-in-revision"
    uncited: boolean
    id: string
  }[]
  rerun_after_uncited?: boolean
}

export interface TestInput {
  layer: string
  outcome: "pass" | "fail" | "flaky-pass" | "error" | "not-run"
  flaky: boolean
  tool: string
  tool_version: string
  receipt_ref: string
}

export interface VerdictInput {
  candidateHash: string
  sealedCandidateHash: string
  resolver: ResolverResult
  reviews: ReviewInput[]
  tests: TestInput[]
  actionRiskClass: "safe" | "guarded" | "barred"
  guardedApprovalValid: boolean
  hypothesisInvalidated: boolean
  /** Two reviews contradict on a required check; true when adjudication still cannot decide. */
  contradictionUnresolved: boolean
}

export interface VerdictResult {
  verdict: VerifyVerdict
  reason: string
  severityMax: "blocker" | "major" | "minor" | "info" | null
}

/**
 * The pure consolidation: severity maximum, fixed resolution rules, and the
 * pass/fail/needs-human table.
 */
export function computeVerdict(input: VerdictInput): VerdictResult {
  // Hash binding: any change anywhere in the change set produces a new hash,
  // and a stale result fails.
  if (input.candidateHash !== input.sealedCandidateHash) {
    return {
      verdict: "fail",
      reason: "candidate hash changed after sealing; stale results invalidate the run",
      severityMax: null,
    }
  }

  if (input.actionRiskClass === "barred") {
    return {
      verdict: "fail",
      reason: "the change set contains a barred action; the product never executes it",
      severityMax: "blocker",
    }
  }

  if (input.hypothesisInvalidated) {
    return {
      verdict: "fail",
      reason: "hypothesis-invalidating evidence; the attempt fails and never enters the revision loop",
      severityMax: null,
    }
  }

  // Coverage, not consensus: every required role must be present.
  const reviewByRole = new Map(input.reviews.map((review) => [review.role, review]))
  const missingRequired: string[] = []
  for (const check of input.resolver.required) {
    if (check.startsWith("R")) {
      if (reviewByRole.get(check) === undefined) {
        missingRequired.push(check)
      }
    } else {
      if (!input.tests.some((test) => test.layer === check)) {
        missingRequired.push(check)
      }
    }
  }
  if (missingRequired.length > 0) {
    return {
      verdict: "needs-human",
      reason: `missing required check reports: ${missingRequired.join(", ")}; a missing report is a gap, never an assumed pass`,
      severityMax: null,
    }
  }

  // Severity takes the maximum: findings stand until resolved by a candidate
  // revision or the originating reviewer's cited retraction.
  let severityMax: VerdictResult["severityMax"] = null
  const severityOrder = ["info", "minor", "major", "blocker"] as const
  for (const review of input.reviews) {
    for (const finding of review.findings) {
      if (finding.status !== "open") {
        continue
      }
      const rank = severityOrder.indexOf(finding.severity)
      const currentRank = severityMax === null ? -1 : severityOrder.indexOf(severityMax)
      if (rank > currentRank) {
        severityMax = finding.severity
      }
      if (finding.uncited && (finding.severity === "blocker" || finding.severity === "major")) {
        // Uncited blocker/major: one rerun, then needs-human. The run cannot
        // pass while the finding is unresolved.
        return {
          verdict: "needs-human",
          reason: `uncited ${finding.severity} finding persists; the role reruns once and still needs a human`,
          severityMax,
        }
      }
    }
  }
  if (severityMax === "blocker") {
    return {
      verdict: "fail",
      reason: "an open cited blocker finding fails the candidate; no count of passing reviews cancels it",
      severityMax,
    }
  }
  if (severityMax === "major") {
    return {
      verdict: "fail",
      reason: "an open cited major finding must be resolved in a revision before the change ships",
      severityMax,
    }
  }

  // Contradictions are adjudicated, never voted away.
  if (input.contradictionUnresolved) {
    return {
      verdict: "needs-human",
      reason: "reviews contradict on a required check and adjudication could not decide",
      severityMax,
    }
  }

  // Test outcomes: required and triggered checks.
  const requiredSet: Set<string> = new Set(input.resolver.required)
  const triggeredSet: Set<string> = new Set(Object.keys(input.resolver.triggered))
  for (const test of input.tests) {
    const isBinding = requiredSet.has(test.layer) || triggeredSet.has(test.layer)
    if (!isBinding) {
      continue
    }
    if (test.outcome === "flaky-pass") {
      return {
        verdict: "needs-human",
        reason: `a flaky-pass on required check ${test.layer} yields needs-human; it never counts toward pass`,
        severityMax,
      }
    }
    if (test.outcome === "error" || test.outcome === "not-run") {
      return {
        verdict: "needs-human",
        reason: `required check ${test.layer} recorded ${test.outcome}; a missing tool or fixture is never a pass`,
        severityMax,
      }
    }
    if (test.outcome === "fail") {
      return {
        verdict: "fail",
        reason: `required check ${test.layer} failed`,
        severityMax,
      }
    }
  }

  // Guarded candidates carry a fresh, unexpired, scope-matching approval.
  if (input.actionRiskClass === "guarded" && !input.guardedApprovalValid) {
    return {
      verdict: "needs-human",
      reason: "guarded class without a fresh, unexpired, scope-matching approval",
      severityMax,
    }
  }

  return {
    verdict: "pass",
    reason: "every required check ran and passed; no open blocker or major; no flaky-pass; hash binding intact",
    severityMax,
  }
}

/** Convert a sealed Review Report into the consolidation input. */
export function reviewInputFromReport(report: ReviewReport): ReviewInput {
  return {
    role: report.role,
    status: report.status,
    findings: report.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      citations: finding.citations,
      status: finding.status,
      uncited: finding.uncited === true,
    })),
  }
}

/** Convert a sealed Test Report into the consolidation input. */
export function testInputFromReport(report: TestReport): TestInput {
  return {
    layer: report.layer,
    outcome: report.outcome,
    flaky: report.flaky,
    tool: report.tool,
    tool_version: report.tool_version,
    receipt_ref: report.receipt_ref,
  }
}
