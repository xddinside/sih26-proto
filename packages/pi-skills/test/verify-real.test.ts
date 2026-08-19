/**
 * Deterministic provider tests for the real Verify round
 * (`runRealVerifyRound`, issue #28): one scripted streaming provider drives
 * one fresh Pi role session per applicable review role and per applicable
 * test layer, selected by the existing deterministic applicability resolver —
 * never a hard-coded list. No network, no real model.
 *
 * Covered seams: applicability-driven role selection and non-applicability;
 * independent fresh session context; self-review rejection (a review session
 * cannot reach repair tools or file another role's report); receipt/report
 * mismatch (pass on a failed receipt, fail on a passed receipt, altered test
 * command, forged receipt identity); a missing required role stopping Verify
 * honestly; Run 1 pass through the Control Plane's own verdict; and Run 2's
 * deterministic failed T5 producing `verification-failed` no matter what a
 * Test Agent claims.
 */
import { describe, expect, test } from "bun:test"

import {
  FakeControlPlaneClient,
  ModelGateway,
  ReadBroker,
  scriptedStreamingProvider,
} from "@sih/brokers"
import type { ScriptedTurn } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import { computeVerdict } from "@sih/control-plane/src/verify/verdict.js"
import { resolveApplicability } from "@sih/control-plane/src/verify/resolver.js"
import type { ResolverInput } from "@sih/control-plane/src/verify/resolver.js"

import { runRealVerifyRound } from "../src/verify/verify-real.js"
import type {
  RealVerifyRoundOptions,
  VerifyRoundResult,
} from "../src/verify/verify-real.js"
import { outcomeFromRuns } from "../src/tests/test-runner.js"
import type { AssignedTestReceipt } from "../src/tests/test-runner.js"
import {
  fixtureHash,
  makeHypothesis,
  makeLease,
  REVISION_ID,
} from "./helpers.js"

const CANDIDATE = fixtureHash("candidate-1")
const MODEL = { provider: "opencode-go", id: "deepseek-v4-flash" }
const DIFF_TEXT = [
  "--- a/src/payment/card.js",
  "+++ b/src/payment/card.js",
  "@@ -1,1 +1,1 @@",
  "-  if (card.type !== 'VISA') return true;",
  "+  if (card.type !== 'VISA') return false;",
].join("\n")

const TERMINAL_REVIEW = "submit_review"
const TERMINAL_TEST = "submit_test_report"
const TEST_TOOL_NAME = "run_assigned_test"
const READ_TOOL = "read_broker_query"

/** The settled demo applicability input (code class, one changed file). */
const DEMO_INPUT: ResolverInput = {
  remediationClass: "code",
  declaredSurfaces: ["src/payment/card.js"],
  diff: { changed_files: ["src/payment/card.js"], deleted_files: [] },
  actionRiskClass: "safe",
  policyVersion: "policy@1.0",
  toolCatalog: {
    version: "tool-catalog@1.0",
    language: "node",
    fuzzHarnessAvailable: false,
    stagingTargetExists: true,
    serviceUserFacing: true,
    pipelineHasE2E: true,
    performanceSuiteExists: false,
    performanceSensitivePaths: [],
    ownershipMap: {
      "src/payment/card.js": "src/payment/payment.regression.test.js",
    },
  },
  recoveryPointSurfaces: [
    "src/payment/card.js",
    "compose service payment (restart via docker compose up -d payment)",
  ],
  watchPlanExists: true,
}

const RESOLVER = resolveApplicability(DEMO_INPUT)
if (!RESOLVER.ok) {
  throw new Error(RESOLVER.error.message)
}
const RESOLVER_VALUE = RESOLVER.value
const DEFAULT_REQUIRED = RESOLVER_VALUE.required
const DEFAULT_TRIGGERED = RESOLVER_VALUE.triggered
const T5_SELECTION =
  RESOLVER_VALUE.t5_selection ??
  `scoped regression suites: ${DEMO_INPUT.toolCatalog.ownershipMap["src/payment/card.js"]}`

/** The applicable test layers the resolver selected for the demo inputs. */
const APPLICABLE_TEST_LAYERS = [
  ...new Set([
    ...DEFAULT_REQUIRED.filter((code) => code.startsWith("T")),
    ...Object.keys(DEFAULT_TRIGGERED).filter((code) => code.startsWith("T")),
  ]),
].sort()

/** The applicable review roles the resolver selected for the demo inputs. */
const APPLICABLE_REVIEW_ROLES = DEFAULT_REQUIRED.filter((code) =>
  code.startsWith("R"),
)

/** The deterministic verdict the Control Plane computes from the round's
 * reports; the round itself never votes. */
function verdictOf(result: VerifyRoundResult) {
  return computeVerdict({
    candidateHash: CANDIDATE,
    sealedCandidateHash: CANDIDATE,
    resolver: RESOLVER_VALUE,
    reviews: result.reviews.map((report) => ({
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
    tests: result.tests.map((report) => ({
      layer: report.layer,
      outcome: report.outcome,
      flaky: report.flaky,
      tool: report.tool,
      tool_version: report.tool_version,
      receipt_ref: report.receipt_ref,
    })),
    actionRiskClass: "safe",
    guardedApprovalValid: true,
    hypothesisInvalidated: false,
    contradictionUnresolved: false,
  })
}

function receiptFor(
  layer: string,
  result: "pass" | "fail" = "pass",
  overrides: Partial<AssignedTestReceipt> = {},
): AssignedTestReceipt {
  return {
    layer: layer as AssignedTestReceipt["layer"],
    tool: `tool-${layer}`,
    toolVersion: "1.0.0",
    target: layer === "T5" ? T5_SELECTION : `target-${layer}`,
    receiptRef: `rcpt-${layer}`,
    runs: [
      {
        run_hash: fixtureHash(`run-${layer}`),
        result,
        at: new Date().toISOString(),
        ...(result === "fail" ? { detail: "deterministic failure" } : {}),
      },
    ],
    ...overrides,
  }
}

function defaultReceipts(): Record<string, AssignedTestReceipt> {
  const receipts: Record<string, AssignedTestReceipt> = {}
  for (const layer of APPLICABLE_TEST_LAYERS) {
    receipts[layer] = receiptFor(layer)
  }
  return receipts
}

function reviewReport(
  role: string,
  candidateHash: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    incident_id: "inc-test",
    run_id: "run-1",
    attempt: 1,
    candidate_hash: candidateHash,
    role,
    reviewer: `real-reviewer-${role}`,
    revision: 1,
    input_refs: ["diff-hash"],
    findings: [],
    status: "pass",
    sealed_at: new Date().toISOString(),
    ...overrides,
  }
}

function testReport(
  layer: string,
  candidateHash: string,
  receipt: AssignedTestReceipt,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    incident_id: "inc-test",
    run_id: "run-1",
    attempt: 1,
    candidate_hash: candidateHash,
    layer,
    tool: receipt.tool,
    tool_version: receipt.toolVersion,
    target: receipt.target,
    receipt_ref: receipt.receiptRef,
    runs: receipt.runs,
    outcome: outcomeFromRuns(receipt.runs),
    flaky: false,
    coverage_checked: true,
    sealed_at: new Date().toISOString(),
    ...overrides,
  }
}

function readTurn(id: string): ScriptedTurn {
  return {
    kind: "tool-call",
    id,
    name: READ_TOOL,
    args: { backend: "git", connection_id: "demo-repo", query: "grep card-type clause" },
  }
}

function terminalTurn(id: string, name: string, payload: unknown): ScriptedTurn {
  return { kind: "tool-call", id, name, args: { submission: payload } }
}

/** The scripted sessions of a fully passing round, keyed by agent id. */
function passingTurns(options: {
  candidateHash?: string
  receipts?: Record<string, AssignedTestReceipt>
  reviewOverrides?: Record<string, Record<string, unknown>>
  testOverrides?: Record<string, Record<string, unknown>>
} = {}): Record<string, readonly ScriptedTurn[]> {
  const candidateHash = options.candidateHash ?? CANDIDATE
  const receipts = options.receipts ?? defaultReceipts()
  const turns: Record<string, readonly ScriptedTurn[]> = {}
  for (const role of APPLICABLE_REVIEW_ROLES) {
    turns[`review-${role}-run-1`] = [
      readTurn(`rv-${role}-1`),
      terminalTurn(
        `rv-${role}-2`,
        TERMINAL_REVIEW,
        reviewReport(role, candidateHash, options.reviewOverrides?.[role]),
      ),
    ]
  }
  for (const layer of APPLICABLE_TEST_LAYERS) {
    const receipt = receipts[layer]
    turns[`test-${layer}-run-1`] = [
      { kind: "tool-call", id: `tt-${layer}-1`, name: TEST_TOOL_NAME, args: {} },
      terminalTurn(
        `tt-${layer}-2`,
        TERMINAL_TEST,
        testReport(layer, candidateHash, receipt, options.testOverrides?.[layer]),
      ),
    ]
  }
  return turns
}

function sealSurface(sealed: unknown[] = []): RealVerifyRoundOptions["seal"] {
  return {
    async seal(input) {
      const digest = contentHash(
        JSON.parse(JSON.stringify(input.payload)) as never,
      )
      if (!digest.ok) {
        throw new Error(`seal digest failed: ${digest.error.message}`)
      }
      sealed.push({ schema_id: input.schemaId, payload: input.payload })
      return { content_hash: digest.value }
    },
  }
}

interface VerifyHarness {
  cp: FakeControlPlaneClient
  sealed: unknown[]
  run: () => Promise<VerifyRoundResult>
}

function makeHarness(options: {
  turns: Record<string, readonly ScriptedTurn[]>
  required?: readonly string[]
  triggered?: Readonly<Record<string, string>>
  t5Selection?: string | null
  testReceipts?: Record<string, AssignedTestReceipt>
  signal?: AbortSignal
  candidateHash?: string
}): VerifyHarness {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const gateway = new ModelGateway(
    cp,
    undefined,
    scriptedStreamingProvider({ turns: options.turns, honorSignal: true }),
    "sk-test-0123456789abcdef",
  )
  const broker = new ReadBroker(cp)
  const sealed: unknown[] = []
  const candidateHash = options.candidateHash ?? CANDIDATE
  return {
    cp,
    sealed,
    run: () =>
      runRealVerifyRound({
        incidentId: "inc-test",
        runId: "run-1",
        attempt: 1,
        candidateHash,
        revisionId: REVISION_ID,
        hypothesis: makeHypothesis().causal_claim.defect,
        diffText: DIFF_TEXT,
        changedFiles: ["src/payment/card.js"],
        recoveryPointHash: fixtureHash("recovery-point"),
        required: options.required ?? [...DEFAULT_REQUIRED],
        triggered: options.triggered ?? { ...DEFAULT_TRIGGERED },
        t5Selection: options.t5Selection ?? T5_SELECTION,
        inputRefs: ["diff-hash"],
        testReceipts: options.testReceipts ?? defaultReceipts(),
        parentAgentId: "orchestrator-run-1",
        gateway,
        lease: makeLease("verify"),
        readBroker: broker,
        seal: sealSurface(sealed),
        model: MODEL,
        reasoning: "high",
        signal: options.signal,
      }),
  }
}

/** The sealed terminal submissions of a given schema, in seal order. */
function sealedSubmissions(sealed: unknown[], schemaId: string): unknown[] {
  return sealed
    .filter((entry) => (entry as { schema_id: string }).schema_id === schemaId)
    .map((entry) => (entry as { payload: unknown }).payload)
}

describe("runRealVerifyRound", () => {
  test("the applicability resolver alone selects the roles that run", async () => {
    const { run, sealed } = makeHarness({ turns: passingTurns() })
    const result = await run()

    expect(result.valid).toBe(true)
    // Exactly the resolver's required reviews and required+triggered tests.
    const reviewSessions = result.sessions.filter((s) => s.role === "review")
    const testSessions = result.sessions.filter((s) => s.role === "test")
    expect(reviewSessions.map((s) => s.agentId).sort()).toEqual(
      APPLICABLE_REVIEW_ROLES.map((role) => `review-${role}-run-1`).sort(),
    )
    expect(testSessions.map((s) => s.agentId).sort()).toEqual(
      APPLICABLE_TEST_LAYERS.map((layer) => `test-${layer}-run-1`).sort(),
    )
    // One report per selected role; no non-applicable role reported.
    const reportedReviews: string[] = result.reviews.map((r) => r.role)
    const reportedTests: string[] = result.tests.map((t) => t.layer)
    expect(reportedReviews.sort()).toEqual([...APPLICABLE_REVIEW_ROLES].sort())
    expect(reportedTests.sort()).toEqual([...APPLICABLE_TEST_LAYERS].sort())
    // Non-applicable codes never ran and never sealed a report.
    expect(
      sealedSubmissions(sealed, "review-report").some(
        (payload) => ["R5", "R6", "R7", "R9"].includes((payload as { role: string }).role),
      ),
    ).toBe(false)
    expect(
      sealedSubmissions(sealed, "test-report").some(
        (payload) => ["T6", "T8", "T11"].includes((payload as { layer: string }).layer),
      ),
    ).toBe(false)
  })

  test("a reduced required set runs only the roles the resolver selects", async () => {
    const { run } = makeHarness({
      turns: {
        "review-R1-run-1": [
          terminalTurn("rv-1", TERMINAL_REVIEW, reviewReport("R1", CANDIDATE)),
        ],
      },
      required: ["R1"],
      triggered: {},
      testReceipts: {},
    })
    const result = await run()
    expect(result.valid).toBe(true)
    expect(result.reviews.map((r) => r.role)).toEqual(["R1"])
    expect(result.tests).toHaveLength(0)
    expect(result.sessions.map((s) => s.agentId)).toEqual(["review-R1-run-1"])
  })

  test("a required role the runtime cannot run stops Verify honestly", async () => {
    const { run } = makeHarness({
      turns: {},
      required: [...DEFAULT_REQUIRED, "T6"],
      triggered: { ...DEFAULT_TRIGGERED },
      testReceipts: defaultReceipts(),
    })
    const result = await run()
    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test")
    expect(result.failure?.message).toContain("T6")
    expect(result.failure?.message).toContain("no real Test Agent session")
    expect(result.sessions).toHaveLength(0)
  })

  test("a fired conditional review or test with no runner stops Verify honestly", async () => {
    // A dependency-manifest diff fires R5; a data surface fires T8. Neither
    // has a real runner in this runtime, so Verify stops rather than passing.
    const firedReview = makeHarness({
      turns: {},
      required: [...DEFAULT_REQUIRED],
      triggered: { ...DEFAULT_TRIGGERED, R5: "dependency-manifest diff" },
      testReceipts: defaultReceipts(),
    })
    const reviewResult = await firedReview.run()
    expect(reviewResult.valid).toBe(false)
    expect(reviewResult.failure?.role).toBe("review")
    expect(reviewResult.failure?.message).toContain("R5")

    const firedTest = makeHarness({
      turns: {},
      required: [...DEFAULT_REQUIRED],
      triggered: { ...DEFAULT_TRIGGERED, T8: "data surface changed" },
      testReceipts: defaultReceipts(),
    })
    const testResult = await firedTest.run()
    expect(testResult.valid).toBe(false)
    expect(testResult.failure?.role).toBe("test")
    expect(testResult.failure?.message).toContain("T8")
  })

  test("every role runs in its own fresh session with its own sealed run artifact", async () => {
    const { run, sealed } = makeHarness({ turns: passingTurns() })
    const result = await run()

    expect(result.valid).toBe(true)
    // Distinct agent ids: no session reuses another session's identity.
    const agentIds = result.sessions.map((s) => s.agentId)
    expect(new Set(agentIds).size).toBe(agentIds.length)
    // Every session sealed its own agent-run-artifact.
    expect(
      sealedSubmissions(sealed, "agent-run-artifact"),
    ).toHaveLength(result.sessions.length)
    // Each report binds to the assigned role/layer only.
    expect(
      result.reviews.every((r, index) =>
        result.sessions[index].agentId.includes(`review-${r.role}`),
      ),
    ).toBe(true)
    expect(result.reviews.every((r) => r.candidate_hash === CANDIDATE)).toBe(true)
    expect(result.tests.every((t) => t.candidate_hash === CANDIDATE)).toBe(true)
  })

  test("a review session cannot reach repair tools and is blocked before any report", async () => {
    const turns = passingTurns()
    // The R1 reviewer only ever tries a worktree mutation — a repair
    // implementer's tool, never granted to a reviewer.
    turns["review-R1-run-1"] = [
      {
        kind: "tool-call",
        id: "rv-1",
        name: "worktree_write",
        args: { path: "src/payment/card.js", content: "x" },
      },
    ]
    const { run, sealed } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("review:R1")
    expect(result.reviews).toHaveLength(0)
    // No review report ever sealed: the blocked session could not fabricate one.
    expect(sealedSubmissions(sealed, "review-report")).toHaveLength(0)
  })

  test("a reviewer cannot file another required role's report", async () => {
    const turns = passingTurns({
      reviewOverrides: {
        R1: { role: "R2", status: "pass" },
      },
    })
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("review:R1")
    expect(result.failure?.message).toContain("cannot file for another role")
    expect(result.reviews).toHaveLength(0)
  })

  test("a Test Report cannot claim pass when its receipt failed (Run 2 T5)", async () => {
    const receipts = defaultReceipts()
    receipts.T5 = receiptFor("T5", "fail")
    const turns = passingTurns({
      receipts,
      testOverrides: {
        T5: { outcome: "pass" },
      },
    })
    const { run, sealed } = makeHarness({ turns, testReceipts: receipts })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T5")
    expect(result.failure?.message).toContain(
      "does not match the deterministic receipt outcome",
    )
    // The lying report never reaches the verdict: the round rejected it.
    expect(result.tests.some((t) => t.layer === "T5")).toBe(false)
  })

  test("a Test Report cannot claim fail when its receipt passed", async () => {
    const turns = passingTurns({
      testOverrides: {
        T1: { outcome: "fail" },
      },
    })
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T1")
    expect(result.failure?.message).toContain("does not match")
  })

  test("a Test Report cannot alter the authorized test command", async () => {
    const turns = passingTurns({
      testOverrides: {
        T3: { tool: "docker build", tool_version: "99.0.0" },
      },
    })
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T3")
    expect(result.failure?.message).toContain("authorized test command")
  })

  test("a Test Report cannot alter the authorized test target", async () => {
    const turns = passingTurns({
      testOverrides: {
        T9: { target: "another-environment" },
      },
    })
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T9")
    expect(result.failure?.message).toContain("authorized test target")
  })

  test("a Test Report cannot create its own receipt", async () => {
    const turns = passingTurns({
      testOverrides: {
        T7: { receipt_ref: "receipt-forged" },
      },
    })
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T7")
    expect(result.failure?.message).toContain("receipt reference")
  })

  test("a missing required review role stops Verify and preserves the honest sessions", async () => {
    const turns = passingTurns()
    turns["review-R2-run-1"] = [
      { kind: "error", message: "provider exploded", stopReason: "error" },
    ]
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("review:R2")
    expect(result.sessions.length).toBeGreaterThan(0)
    expect(result.sessions.at(-1)?.status).toBe("failed")
    // No canned replacement: R2's report is absent, not substituted.
    expect(result.reviews.some((r) => r.role === "R2")).toBe(false)
  })

  test("a missing required test layer stops Verify after the reviews ran", async () => {
    const turns = passingTurns()
    turns["test-T5-run-1"] = [
      { kind: "error", message: "provider exploded", stopReason: "error" },
    ]
    const { run } = makeHarness({ turns })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("test:T5")
    expect(result.reviews).toHaveLength(5)
    expect(result.sessions.at(-1)?.status).toBe("failed")
    expect(result.tests.some((t) => t.layer === "T5")).toBe(false)
  })

  test("an aborted round records the honest aborted status", async () => {
    const abort = new AbortController()
    abort.abort()
    const { run } = makeHarness({
      turns: passingTurns(),
      signal: abort.signal,
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.status).toBe("aborted")
    expect(result.sessions[0]?.status).toBe("aborted")
  })

  test("Run 1: every applicable role passes and the Control Plane verdict is pass", async () => {
    const { run, sealed } = makeHarness({ turns: passingTurns() })
    const result = await run()

    expect(result.valid).toBe(true)
    expect(result.failure).toBeUndefined()

    const verdict = verdictOf(result)
    expect(verdict.verdict).toBe("pass")
    // All reports sealed; the deterministic verdict consumed them.
    expect(sealedSubmissions(sealed, "review-report")).toHaveLength(
      APPLICABLE_REVIEW_ROLES.length,
    )
    expect(sealedSubmissions(sealed, "test-report")).toHaveLength(
      APPLICABLE_TEST_LAYERS.length,
    )
  })

  test("Run 2: the failed T5 receipt yields verification-failed through the verdict", async () => {
    const receipts = defaultReceipts()
    receipts.T5 = receiptFor("T5", "fail")
    // The Test Agent reports the receipt truthfully: outcome fail.
    const { run } = makeHarness({
      turns: passingTurns({ receipts }),
      testReceipts: receipts,
    })
    const result = await run()

    expect(result.valid).toBe(true)
    const t5 = result.tests.find((t) => t.layer === "T5")
    expect(t5?.outcome).toBe("fail")

    const verdict = verdictOf(result)
    expect(verdict.verdict).toBe("fail")
    expect(verdict.reason).toContain("T5")
  })
})
