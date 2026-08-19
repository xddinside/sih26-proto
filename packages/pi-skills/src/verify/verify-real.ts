/**
 * The real-agent Verify round (issue #28): every applicable review role and
 * test layer runs in its own fresh bounded Pi session, driven by the existing
 * deterministic applicability resolver — the only authority that selects the
 * required review and test roles.
 *
 * Reviewers receive the accepted Remediation, the deterministic candidate
 * identity and diff, and the relevant admitted Evidence references, but never
 * a repair-session scratchpad. Each runs with read tools plus `submit_review`.
 *
 * Test Agents receive the candidate diff and their one assigned deterministic
 * test tool, which returns the recorded receipt for that layer. A session can
 * invoke only its assigned test tool, inspect the receipt, and end with
 * `submit_test_report`. The receipt owns pass/fail: the deterministic checks
 * below reject a report that claims pass when its receipt failed, claims fail
 * when its receipt passed, alters the authorized test command or target, or
 * carries a receipt it did not receive.
 *
 * A missing, malformed, timed-out, cancelled, or failed required role returns
 * an honest invalid round with every session record and stops Verify — never
 * a canned replacement. The deterministic verdict remains the only pass/fail
 * authority; this module only shapes its input.
 */
import type { ModelGateway, LeaseRef, ReadBroker } from "@sih/brokers"
import type { ReviewReport, TestReport } from "@sih/contracts/types"
import type { ThinkingLevel } from "@earendil-works/pi-ai"

import {
  runReviewRole,
  runTestRole,
} from "../agent/roles.js"
import type {
  AgentSessionKit,
  AgentSessionRecord,
} from "../agent/roles.js"
import type { RoleLimits } from "../role/limits.js"
import type { FusionSealSurface } from "../fusion/fusion-real.js"
import type { ReviewRoleCode } from "../reviews/review-runner.js"
import type { AssignedTestReceipt, TestLayerCode } from "../tests/test-runner.js"
import {
  assertReceiptBinding,
  assertT5Selection,
  outcomeFromRuns,
  runsMatchReceipt,
} from "../tests/test-runner.js"

/** The review roles the real Verify round can run (R1..R4, R8). A required
 * role outside this set is a real gap and stops Verify. */
const REVIEW_ROLES_RUNNABLE: ReadonlySet<string> = new Set([
  "R1",
  "R2",
  "R3",
  "R4",
  "R8",
])

/** The test layers the real Verify round can run. */
const TEST_LAYERS_RUNNABLE: ReadonlySet<string> = new Set([
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T7",
  "T9",
  "T10",
  "T12",
  "T13",
])

export interface RealVerifyRoundOptions {
  incidentId: string
  runId: string
  attempt: number
  /** The deterministic candidate identity every report binds to. */
  candidateHash: string
  /** The Evidence Set revision id the reviewers cite against. */
  revisionId: string
  /** The accepted Hypothesis the reviewers consume. */
  hypothesis: string
  /** The accepted Remediation the reviewers consume, serialized. */
  acceptedRemediation?: string
  /** The deterministic candidate diff text. */
  diffText: string
  changedFiles: readonly string[]
  recoveryPointHash: string
  /** The resolver's required checks. The only role-selection authority. */
  required: readonly string[]
  /** The resolver's triggered conditional checks (may include non-test
   * codes; only test layers are selected here). */
  triggered: Readonly<Record<string, string>>
  /** The resolver's ownership-map T5 selection; required when T5 applies. */
  t5Selection: string | null
  /** Admitted Evidence references for the reviewers. */
  inputRefs?: readonly string[]
  checkHints?: readonly string[]
  /** The recorded deterministic receipts for every test layer that runs. */
  testReceipts: Readonly<Partial<Record<string, AssignedTestReceipt>>>
  parentAgentId: string
  gateway: ModelGateway
  lease: LeaseRef
  readBroker?: ReadBroker
  seal: FusionSealSurface
  model: { provider: string; id: string }
  providerClass?: "real" | "fixture"
  reasoning?: ThinkingLevel
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
}

export interface VerifyRoundResult {
  /** True when every applicable role ran and every deterministic report
   * check passed. The verdict itself is still the Control Plane's. */
  valid: boolean
  reviews: ReviewReport[]
  tests: TestReport[]
  /** Every session record, in run order, for the capture manifest. */
  sessions: AgentSessionRecord[]
  /** Present when the round failed or was aborted; no canned fallback. */
  failure?: {
    role: string
    status: "failed" | "aborted"
    message: string
  }
}

/**
 * Run the real Verify round: one fresh session per applicable review role,
 * then one fresh session per applicable test layer. Returns the sealed
 * Review and Test Reports for the deterministic verdict, or an honest
 * invalid round that stops Verify.
 */
export async function runRealVerifyRound(
  options: RealVerifyRoundOptions,
): Promise<VerifyRoundResult> {
  const sessions: AgentSessionRecord[] = []
  const reviews: ReviewReport[] = []
  const tests: TestReport[] = []

  const invalid = (failure: {
    role: string
    status: "failed" | "aborted"
    message: string
  }): VerifyRoundResult => ({ valid: false, reviews, tests, sessions, failure })

  // The resolver alone selects the roles. A required or fired role this
  // runtime cannot run is a real gap: it stops Verify rather than guessing.
  const reviewCodes = [
    ...options.required.filter((code) => code.startsWith("R")),
    ...Object.keys(options.triggered).filter((code) => code.startsWith("R")),
  ]
  const unsupportedReviews = reviewCodes.filter(
    (code) => !REVIEW_ROLES_RUNNABLE.has(code),
  )
  if (unsupportedReviews.length > 0) {
    return invalid({
      role: "review",
      status: "failed",
      message: `review role ${unsupportedReviews.join(", ")} has no real reviewer session; Verify stops`,
    })
  }
  const reviewRoles = [...new Set(reviewCodes)] as ReviewRoleCode[]

  const testCodes = [
    ...options.required.filter((code) => code.startsWith("T")),
    ...Object.keys(options.triggered).filter((code) => code.startsWith("T")),
  ]
  const unsupportedTests = testCodes.filter(
    (code) => !TEST_LAYERS_RUNNABLE.has(code),
  )
  if (unsupportedTests.length > 0) {
    return invalid({
      role: "test",
      status: "failed",
      message: `test layer ${unsupportedTests.join(", ")} has no real Test Agent session; Verify stops`,
    })
  }
  // Deterministic run order: the role list the resolver returned, not model
  // or completion order.
  const testLayers = [...new Set(testCodes)].sort() as TestLayerCode[]

  const kit: AgentSessionKit = {
    gateway: options.gateway,
    lease: options.lease,
    candidateHash: options.candidateHash,
    seal: options.seal,
    model: options.model,
    providerClass: options.providerClass,
    reasoning: options.reasoning,
    limits: options.limits,
    signal: options.signal,
    readBroker: options.readBroker,
  }

  // Review roles: one fresh session each, read tools + `submit_review`.
  for (const role of reviewRoles) {
    const result = await runReviewRole(kit, {
      incidentId: options.incidentId,
      runId: options.runId,
      attempt: options.attempt,
      role,
      reviewer: `real-reviewer-${role}`,
      revision: 1,
      candidateHash: options.candidateHash,
      hypothesis: options.hypothesis,
      acceptedRemediation: options.acceptedRemediation,
      recoveryPointHash: options.recoveryPointHash,
      revisionId: options.revisionId,
      diffText: options.diffText,
      changedFiles: options.changedFiles,
      checkHints: options.checkHints,
      inputRefs: options.inputRefs,
    })
    sessions.push(result.session)
    if (result.payload === null || result.status !== "succeeded") {
      return invalid({
        role: `review:${role}`,
        status: result.status === "aborted" ? "aborted" : "failed",
        message:
          result.status === "aborted"
            ? `review session ${role} aborted`
            : (result.failureReason ?? `review role ${role} produced no valid Review Report`),
      })
    }
    const report = result.payload
    if (report.candidate_hash !== options.candidateHash) {
      return invalid({
        role: `review:${role}`,
        status: "failed",
        message: "Review Report candidate hash does not bind to the candidate",
      })
    }
    if (report.role !== role) {
      return invalid({
        role: `review:${role}`,
        status: "failed",
        message: `Review Report role ${report.role} does not match the assigned role ${role}; a reviewer cannot file for another role`,
      })
    }
    reviews.push(report)
  }

  // Test layers: one fresh session each, its assigned test tool +
  // `submit_test_report`. The deterministic receipt owns the outcome.
  for (const layer of testLayers) {
    const receipt = options.testReceipts[layer]
    if (receipt === undefined) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: `no deterministic receipt recorded for test layer ${layer}`,
      })
    }
    const result = await runTestRole(kit, {
      incidentId: options.incidentId,
      runId: options.runId,
      attempt: options.attempt,
      layer,
      tool: receipt.tool,
      toolVersion: receipt.toolVersion,
      target: receipt.target,
      receiptRef: receipt.receiptRef,
      runs: receipt.runs,
      candidateHash: options.candidateHash,
      diffText: options.diffText,
      changedFiles: options.changedFiles,
      assignedReceipt: receipt,
    })
    sessions.push(result.session)
    if (result.payload === null || result.status !== "succeeded") {
      return invalid({
        role: `test:${layer}`,
        status: result.status === "aborted" ? "aborted" : "failed",
        message:
          result.status === "aborted"
            ? `test session ${layer} aborted`
            : (result.failureReason ?? `test layer ${layer} produced no valid Test Report`),
      })
    }
    const report = result.payload
    // Deterministic receipt binding and consistency. The model cannot claim
    // pass on a failed receipt, fail a passed receipt, or copy another
    // receipt's identity.
    const binding = assertReceiptBinding({
      reportCandidateHash: report.candidate_hash,
      receiptCandidateHash: options.candidateHash,
    })
    if (!binding.bound) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: "Test Report candidate hash does not bind to the candidate receipt",
      })
    }
    if (report.layer !== receipt.layer) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: `Test Report layer ${report.layer} does not match the assigned layer ${receipt.layer}`,
      })
    }
    if (report.receipt_ref !== receipt.receiptRef) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: "Test Report receipt reference does not match the assigned receipt",
      })
    }
    if (report.tool !== receipt.tool || report.tool_version !== receipt.toolVersion) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: "Test Report alters the authorized test command or tool version",
      })
    }
    if (report.target !== receipt.target) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: "Test Report alters the authorized test target",
      })
    }
    const expectedOutcome = outcomeFromRuns(receipt.runs)
    if (report.outcome !== expectedOutcome) {
      return invalid({
        role: `test:${layer}`,
        status: "failed",
        message: `Test Report outcome ${report.outcome} does not match the deterministic receipt outcome ${expectedOutcome}`,
      })
    }
    const runs = runsMatchReceipt(report.runs, receipt.runs)
    if (!runs.match) {
      return invalid({ role: `test:${layer}`, status: "failed", message: runs.reason })
    }
    if (layer === "T5") {
      const t5 = assertT5Selection({
        resolverSelection: options.t5Selection,
        reportTarget: report.target,
      })
      if (!t5.ok) {
        return invalid({ role: `test:${layer}`, status: "failed", message: t5.reason })
      }
    }
    tests.push(report)
  }

  return { valid: true, reviews, tests, sessions }
}
