/**
 * Review role runner from docs/research/review-verification.md and
 * docs/research/pi-agent-catalog.md. Each applicable review role runs in its
 * own specialist subagent with its matching skill: its own scratch directory,
 * no peer reports before consolidation, and read-only tools. The authoring
 * subagent never reviews, and the Orchestrator never substitutes a required
 * Review Report.
 *
 * Evidence rule: every finding cites a file and line in the diff, a
 * deterministic check output reference, an Evidence Set item id, or a named
 * Recovery Point gap. An uncited `blocker` or `major` finding makes the
 * report incomplete: the role reruns once against the same candidate hash;
 * a second uncited or malformed finding yields `needs-human`. An uncited
 * `minor` or `info` note stays non-blocking and is marked `uncited`.
 */
import { validate } from "@sih/contracts/parse"
import type { ReviewReport } from "@sih/contracts/types"

export type ReviewRoleCode = "R1" | "R2" | "R3" | "R4" | "R8"

export interface ReviewRerunDecision {
  action: "accept" | "rerun-once" | "needs-human"
  reason: string
}

/** Parse and validate a Review Report v1 against the registry schema. */
export function parseReviewReport(text: string): ReviewReport | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1))
  const result = validate("review-report", "1.0", parsed)
  return result.ok ? (result.value as ReviewReport) : null
}

/** A `blocker` or `major` finding must cite evidence. */
export function uncitedBlockingFindings(
  report: ReviewReport
): { id: string; severity: "blocker" | "major" }[] {
  return report.findings
    .filter(
      (
        finding
      ): finding is ReviewReport["findings"][number] & {
        severity: "blocker" | "major"
      } =>
        (finding.severity === "blocker" || finding.severity === "major") &&
        (finding.uncited === true || finding.citations.length === 0)
    )
    .map((finding) => ({ id: finding.id, severity: finding.severity }))
}

/** The fixed rerun rule: malformed or uncited-blocking reports rerun once
 * against the same candidate hash; still bad -> needs-human. */
export function decideReviewRerun(options: {
  report: ReviewReport | null
  rerunsSoFar: number
  candidateHash: string
}): ReviewRerunDecision {
  if (options.report === null) {
    return options.rerunsSoFar === 0
      ? {
          action: "rerun-once",
          reason:
            "malformed Review Report; rerun once against the same candidate hash",
        }
      : {
          action: "needs-human",
          reason: "Review Report still malformed after one rerun",
        }
  }
  if (options.report.candidate_hash !== options.candidateHash) {
    return {
      action: "needs-human",
      reason: "Review Report hash does not bind to the candidate",
    }
  }
  const uncited = uncitedBlockingFindings(options.report)
  if (uncited.length > 0) {
    return options.rerunsSoFar === 0
      ? {
          action: "rerun-once",
          reason: `uncited ${uncited.map((finding) => finding.severity).join(", ")} findings; rerun once`,
        }
      : {
          action: "needs-human",
          reason: `uncited blocking findings persist after one rerun (${uncited.map((finding) => finding.id).join(", ")})`,
        }
  }
  return {
    action: "accept",
    reason: "report is well-formed, hash-bound, and fully cited",
  }
}

/** The scope rule: a reviewer may flag a defect just outside the diff only
 * when the diff makes it reachable; such a finding cites both lines. */
export function validateFindingScope(
  report: ReviewReport,
  changedFiles: ReadonlySet<string>
): { outsideDiffUncited: string[] } {
  const outsideDiffUncited: string[] = []
  for (const finding of report.findings) {
    if (finding.severity === "info") {
      continue
    }
    const fileCitations = finding.citations.filter(
      (citation) => citation.file !== undefined
    )
    const inside = fileCitations.some(
      (citation) =>
        citation.file !== undefined && changedFiles.has(citation.file)
    )
    if (!inside && finding.citations.length > 0) {
      outsideDiffUncited.push(finding.id)
    }
  }
  return { outsideDiffUncited }
}
