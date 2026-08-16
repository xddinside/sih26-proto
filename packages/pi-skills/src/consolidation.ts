/**
 * Deterministic Worker-side consolidation bookkeeping from
 * docs/research/review-verification.md. This module merges parallel Review
 * Reports and Test Reports into the exact input shape the Control Plane's
 * verdict function consumes. It is advisory bookkeeping: the Control Plane's
 * `computeVerdict` is the only thing that passes or fails a candidate, and
 * the fixed rules below never admit a majority vote.
 *
 * Fixed rules implemented here:
 * - severity takes the maximum (one cited blocker beats any number of passing
 *   reviews; no count of approving reviews cancels a finding);
 * - findings stand until resolved by a candidate revision (new hash, full
 *   Verify rerun) or the originating reviewer's cited retraction;
 * - contradictions are adjudicated, never voted away: a deterministic-check
 *   rerun when one exists, else one fresh independent review; still
 *   conflicting -> needs-human;
 * - coverage is checked, not consensus: every required role must be present.
 */
import type { ReviewReport, TestReport } from "@sih/contracts/types"

export type Severity = "blocker" | "major" | "minor" | "info"
export type CheckOutcome = "pass" | "fail" | "flaky-pass" | "error" | "not-run"

export interface Contradiction {
  roles: [string, string]
  claim: string
  citation: string
}

export interface ConsolidatedReviews {
  severityMax: Severity | null
  openFindings: {
    role: string
    id: string
    severity: Severity
    claim: string
    citations: unknown[]
    status: "open" | "retracted" | "fixed-in-revision"
    uncited: boolean
  }[]
  uncitedBlockerMajor: { role: string; findingId: string; severity: Severity }[]
  contradictions: Contradiction[]
  missingRoles: string[]
}

const SEVERITY_ORDER: readonly Severity[] = [
  "info",
  "minor",
  "major",
  "blocker",
]

function rank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

/** Severity takes the maximum; no vote changes it. */
export function severityMaxOf(
  reports: readonly ReviewReport[]
): Severity | null {
  let maximum: Severity | null = null
  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.status !== "open") {
        continue
      }
      if (maximum === null || rank(finding.severity) > rank(maximum)) {
        maximum = finding.severity
      }
    }
  }
  return maximum
}

/**
 * Two reviews contradict when both issue open findings over the same
 * citation (file-line, check output, or item id) and disagree on whether the
 * candidate passes. The disputed claim goes to adjudication, never a vote.
 */
export function detectContradictions(
  reports: readonly ReviewReport[]
): Contradiction[] {
  const contradictions: Contradiction[] = []
  const seen = new Set<string>()
  for (let a = 0; a < reports.length; a += 1) {
    for (let b = a + 1; b < reports.length; b += 1) {
      const reportA = reports.at(a)
      const reportB = reports.at(b)
      if (reportA === undefined || reportB === undefined) {
        continue
      }
      const claim = `${reportA.role} ${reportA.status} vs ${reportB.role} ${reportB.status}`
      for (const findingA of reportA.findings) {
        if (findingA.status !== "open") {
          continue
        }
        for (const findingB of reportB.findings) {
          if (findingB.status !== "open") {
            continue
          }
          const citation = sharedCitation(
            findingA.citations,
            findingB.citations
          )
          if (citation === null) {
            continue
          }
          const key = [reportA.role, reportB.role, citation].sort().join("|")
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          contradictions.push({
            roles: [reportA.role, reportB.role],
            claim: `${claim}: ${citation}`,
            citation,
          })
        }
      }
    }
  }
  return contradictions
}

function sharedCitation(
  citationsA: readonly { file?: string; line?: number; ref?: string }[],
  citationsB: readonly { file?: string; line?: number; ref?: string }[]
): string | null {
  for (const a of citationsA) {
    for (const b of citationsB) {
      if (
        (a.file !== undefined && a.file === b.file && a.line === b.line) ||
        (a.ref !== undefined && a.ref === b.ref)
      ) {
        return a.file !== undefined
          ? `${a.file}:${a.line ?? "?"}`
          : (a.ref ?? "")
      }
    }
  }
  return null
}

/**
 * Adjudication: a deterministic-check rerun when one exists, else one fresh
 * independent review of the same role and claim with no prior outputs.
 * Still conflicting or undecided -> needs-human.
 */
export function adjudicateContradiction(
  contradiction: Contradiction,
  options: {
    deterministicCheck: string | null
    rerunResult: CheckOutcome | null
  }
): "resolved" | "unresolved" {
  if (options.deterministicCheck !== null && options.rerunResult !== null) {
    // The deterministic check rerun decides the disputed claim.
    return options.rerunResult === "error" || options.rerunResult === "not-run"
      ? "unresolved"
      : "resolved"
  }
  if (options.deterministicCheck === null && options.rerunResult !== null) {
    // One fresh independent review of the same role and claim decided it.
    return options.rerunResult === "error" || options.rerunResult === "not-run"
      ? "unresolved"
      : "resolved"
  }
  return "unresolved"
}

/** Consolidated review bookkeeping over the sealed Review Reports. */
export function consolidateReviews(
  reports: readonly ReviewReport[],
  requiredRoles: readonly string[],
  options: { adjudicated: readonly string[] } = { adjudicated: [] }
): ConsolidatedReviews {
  const requiredSet = new Set(requiredRoles)
  const present = new Set<string>(reports.map((report) => report.role))
  const missingRoles = requiredRoles.filter((role) => !present.has(role))

  const openFindings = reports.flatMap((report) =>
    report.findings
      .filter((finding) => finding.status === "open")
      .map((finding) => ({
        role: report.role,
        id: finding.id,
        severity: finding.severity,
        claim: finding.claim,
        citations: finding.citations,
        status: finding.status,
        uncited: finding.uncited === true,
      }))
  )
  const uncitedBlockerMajor = openFindings
    .filter(
      (finding) =>
        finding.uncited &&
        (finding.severity === "blocker" || finding.severity === "major")
    )
    .map((finding) => ({
      role: finding.role,
      findingId: finding.id,
      severity: finding.severity,
    }))
  const contradictions = detectContradictions(reports).filter(
    (contradiction) =>
      !options.adjudicated.includes(contradictionCitationKey(contradiction))
  )
  return {
    severityMax: severityMaxOf(reports),
    openFindings,
    uncitedBlockerMajor,
    contradictions,
    missingRoles,
  }
}

export function contradictionCitationKey(contradiction: Contradiction): string {
  return (
    [...contradiction.roles].sort().join("|") + "|" + contradiction.citation
  )
}

/** A retraction is the originating reviewer's own superseding report
 * revision with cited evidence. Another agent cannot retract a finding. */
export function isCitedRetraction(
  originalRole: string,
  superseding: ReviewReport,
  findingId: string
): boolean {
  if (superseding.role !== originalRole) {
    return false
  }
  const retracted = superseding.findings.find(
    (finding) => finding.id === findingId && finding.status === "retracted"
  )
  return retracted !== undefined && retracted.citations.length > 0
}

export interface AssembledVerdictInput {
  reviews: {
    role: string
    status: "pass" | "fail"
    findings: {
      severity: Severity
      citations: unknown[]
      status: "open" | "retracted" | "fixed-in-revision"
      uncited: boolean
      id: string
    }[]
  }[]
  tests: {
    layer: string
    outcome: CheckOutcome
    flaky: boolean
    tool: string
    tool_version: string
    receipt_ref: string
  }[]
  contradictionUnresolved: boolean
  hypothesisInvalidated: boolean
  guardedApprovalValid: boolean
}

/**
 * Assemble the exact input the Control Plane's verdict function consumes.
 * No vote appears anywhere in the assembled input: the Control Plane applies
 * severity-max and the fixed pass/fail/needs-human table.
 */
export function assembleVerdictInput(options: {
  candidateHash: string
  reports: readonly ReviewReport[]
  testReports: readonly TestReport[]
  contradictions: readonly Contradiction[]
  hypothesisInvalidated: boolean
  guardedApprovalValid: boolean
}): { candidateHash: string; input: AssembledVerdictInput } {
  const { reports, testReports, contradictions } = options
  return {
    candidateHash: options.candidateHash,
    input: {
      reviews: reports.map((report) => ({
        role: report.role,
        status: report.status,
        findings: report.findings.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          citations: finding.citations,
          status: finding.status,
          uncited: finding.uncited === true,
        })),
      })),
      tests: testReports.map((report) => ({
        layer: report.layer,
        outcome: report.outcome,
        flaky: report.flaky,
        tool: report.tool,
        tool_version: report.tool_version,
        receipt_ref: report.receipt_ref,
      })),
      contradictionUnresolved: contradictions.length > 0,
      hypothesisInvalidated: options.hypothesisInvalidated,
      guardedApprovalValid: options.guardedApprovalValid,
    },
  }
}
