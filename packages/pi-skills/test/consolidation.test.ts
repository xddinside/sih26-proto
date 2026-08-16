/**
 * Deterministic consolidation tests against the Control Plane's own verdict
 * function (imported from the control-plane workspace package): severity
 * takes the maximum, contradictions go to needs-human, there is no majority
 * vote, and a required flaky-pass yields needs-human.
 */
import { describe, expect, test } from "bun:test"

import { computeVerdict } from "@sih/control-plane/src/verify/verdict.js"
import type { ResolverResult } from "@sih/control-plane/src/verify/resolver.js"

import {
  adjudicateContradiction,
  assembleVerdictInput,
  consolidateReviews,
  detectContradictions,
  severityMaxOf,
} from "../src/consolidation.js"
import {
  fixtureHash,
  makeFinding,
  makeReviewReport,
  makeTestReport,
} from "./helpers.js"

const CANDIDATE = fixtureHash("candidate-1")

const RESOLVER: ResolverResult = {
  required: ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
  conditional: ["T9", "T10", "T12", "T13"],
  triggered: { T9: "candidate target exists" },
  not_applicable: ["R5", "R6", "R7", "R9", "T6", "T8", "T11"],
  check_reasons: {},
  resolver_version: "applicability-resolver@1.0",
  t5_selection: null,
  needs_human: false,
  needs_human_reason: null,
}

function passReviews(): ReturnType<typeof makeReviewReport>[] {
  return [
    makeReviewReport({ role: "R1", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R3", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R4", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R8", candidateHash: CANDIDATE }),
  ]
}

function passTests(): ReturnType<typeof makeTestReport>[] {
  return [
    makeTestReport({ layer: "T1", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T2", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T3", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T4", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T5", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T7", candidateHash: CANDIDATE, outcome: "pass" }),
  ]
}

function verdictOf(options: {
  reviews: ReturnType<typeof makeReviewReport>[]
  tests: ReturnType<typeof makeTestReport>[]
  contradictionUnresolved?: boolean
  hypothesisInvalidated?: boolean
  candidateHash?: string
}) {
  const assembled = assembleVerdictInput({
    candidateHash: options.candidateHash ?? CANDIDATE,
    reports: options.reviews,
    testReports: options.tests,
    contradictions: [],
    hypothesisInvalidated: options.hypothesisInvalidated ?? false,
    guardedApprovalValid: true,
  })
  return computeVerdict({
    candidateHash: options.candidateHash ?? CANDIDATE,
    sealedCandidateHash: CANDIDATE,
    resolver: RESOLVER,
    reviews: assembled.input.reviews,
    tests: assembled.input.tests,
    actionRiskClass: "safe",
    guardedApprovalValid: true,
    hypothesisInvalidated: options.hypothesisInvalidated ?? false,
    contradictionUnresolved: options.contradictionUnresolved ?? false,
  })
}

describe("severity takes the maximum", () => {
  test("one cited blocker fails the candidate no matter how many reviews pass", () => {
    const reviews = [
      ...passReviews(),
      makeReviewReport({
        role: "R1",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F1",
            severity: "blocker",
            claim: "the diff ships a secret",
          }),
        ],
      }),
    ]
    expect(severityMaxOf(reviews)).toBe("blocker")
    const assembled = assembleVerdictInput({
      candidateHash: CANDIDATE,
      reports: reviews,
      testReports: passTests(),
      contradictions: [],
      hypothesisInvalidated: false,
      guardedApprovalValid: true,
    })
    const result = computeVerdict({
      candidateHash: CANDIDATE,
      sealedCandidateHash: CANDIDATE,
      resolver: RESOLVER,
      reviews: assembled.input.reviews,
      tests: assembled.input.tests,
      actionRiskClass: "safe",
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(result.verdict).toBe("fail")
    expect(result.reason).toContain("blocker")
  })

  test("an open cited major finding fails until resolved", () => {
    const reviews = [
      makeReviewReport({
        role: "R1",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F2",
            severity: "major",
            claim:
              "restoring the card-type check makes the removed Luhn guard reachable",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12 },
              { kind: "file-line", file: "src/payment/card.js", line: 9 },
            ],
          }),
        ],
      }),
      makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
      makeReviewReport({ role: "R3", candidateHash: CANDIDATE }),
      makeReviewReport({ role: "R4", candidateHash: CANDIDATE }),
      makeReviewReport({ role: "R8", candidateHash: CANDIDATE }),
    ]
    const verdict = verdictOf({ reviews, tests: passTests() })
    expect(verdict.verdict).toBe("fail")
    expect(verdict.reason).toContain("major")
  })

  test("an uncited blocker cannot fail outright: one rerun, then needs-human", () => {
    const reviews = [
      makeReviewReport({
        role: "R1",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F3",
            severity: "blocker",
            claim: "unverifiable claim",
            citations: [],
            uncited: true,
          }),
        ],
      }),
      ...passReviews().filter((report) => report.role !== "R1"),
    ]
    const verdict = verdictOf({ reviews, tests: passTests() })
    expect(verdict.verdict).toBe("needs-human")
    expect(verdict.reason).toContain("uncited")
  })
})

describe("no majority vote", () => {
  test("two passing reviews never cancel a failing review with a cited major", () => {
    const consolidated = consolidateReviews(
      [
        makeReviewReport({ role: "R1", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
        makeReviewReport({
          role: "R3",
          candidateHash: CANDIDATE,
          status: "fail",
          findings: [
            makeFinding({
              id: "F4",
              severity: "major",
              claim: "broken error handling",
            }),
          ],
        }),
      ],
      ["R1", "R2", "R3"]
    )
    expect(consolidated.severityMax).toBe("major")
    const verdict = verdictOf({
      reviews: [
        makeReviewReport({ role: "R1", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
        makeReviewReport({
          role: "R3",
          candidateHash: CANDIDATE,
          status: "fail",
          findings: [
            makeFinding({
              id: "F4",
              severity: "major",
              claim: "broken error handling",
            }),
          ],
        }),
        makeReviewReport({ role: "R4", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R8", candidateHash: CANDIDATE }),
      ],
      tests: passTests(),
    })
    expect(verdict.verdict).toBe("fail")
  })
})

describe("contradictions are adjudicated, never voted away", () => {
  test("two reviews contradicting on the same citation are detected", () => {
    const reviews = [
      makeReviewReport({
        role: "R1",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F5",
            severity: "major",
            claim: "this line is broken",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12 },
            ],
          }),
        ],
      }),
      makeReviewReport({
        role: "R4",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F6",
            severity: "major",
            claim: "this same line is not broken",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12 },
            ],
          }),
        ],
      }),
    ]
    const contradictions = detectContradictions(reviews)
    expect(contradictions.length).toBe(1)
    expect(contradictions[0]?.roles).toContain("R1")
    expect(contradictions[0]?.roles).toContain("R4")
  })

  test("an adjudicated contradiction resolves; an undecided one yields needs-human", () => {
    const contradiction = detectContradictions([
      makeReviewReport({
        role: "R1",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F5",
            severity: "major",
            claim: "broken",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12 },
            ],
          }),
        ],
      }),
      makeReviewReport({
        role: "R4",
        candidateHash: CANDIDATE,
        status: "fail",
        findings: [
          makeFinding({
            id: "F6",
            severity: "major",
            claim: "not broken",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12 },
            ],
          }),
        ],
      }),
    ])[0]
    expect(contradiction).toBeDefined()
    expect(
      adjudicateContradiction(contradiction, {
        deterministicCheck: "T3",
        rerunResult: "pass",
      })
    ).toBe("resolved")
    expect(
      adjudicateContradiction(contradiction, {
        deterministicCheck: "T3",
        rerunResult: null,
      })
    ).toBe("unresolved")

    const verdict = verdictOf({
      reviews: [
        makeReviewReport({ role: "R1", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R3", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R4", candidateHash: CANDIDATE }),
        makeReviewReport({ role: "R8", candidateHash: CANDIDATE }),
      ],
      tests: passTests(),
      contradictionUnresolved: true,
    })
    expect(verdict.verdict).toBe("needs-human")
    expect(verdict.reason).toContain("contradict")
  })
})

describe("coverage and flakiness", () => {
  test("a missing required review report is a gap, never an assumed pass", () => {
    const consolidated = consolidateReviews(
      passReviews().filter((report) => report.role !== "R8"),
      RESOLVER.required
    )
    expect(consolidated.missingRoles).toContain("R8")
    const verdict = verdictOf({
      reviews: passReviews().filter((report) => report.role !== "R8"),
      tests: passTests(),
    })
    expect(verdict.verdict).toBe("needs-human")
    expect(verdict.reason).toContain("missing")
  })

  test("a required flaky-pass yields needs-human, never pass", () => {
    const tests = [
      ...passTests().filter((report) => report.layer !== "T5"),
      makeTestReport({
        layer: "T5",
        candidateHash: CANDIDATE,
        outcome: "flaky-pass",
        runs: [
          {
            run_hash: fixtureHash("run-fail"),
            result: "fail",
            at: new Date().toISOString(),
          },
          {
            run_hash: fixtureHash("run-pass"),
            result: "pass",
            at: new Date().toISOString(),
          },
        ],
      }),
    ]
    const verdict = verdictOf({ reviews: passReviews(), tests })
    expect(verdict.verdict).toBe("needs-human")
    expect(verdict.reason).toContain("flaky-pass")
  })

  test("a stale candidate hash fails even with all-passing inputs", () => {
    const verdict = verdictOf({
      reviews: passReviews(),
      tests: passTests(),
      candidateHash: fixtureHash("other-candidate"),
    })
    expect(verdict.verdict).toBe("fail")
    expect(verdict.reason).toContain("changed")
  })

  test("hypothesis-invalidating evidence fails the attempt and never loops", () => {
    const verdict = verdictOf({
      reviews: passReviews(),
      tests: passTests(),
      hypothesisInvalidated: true,
    })
    expect(verdict.verdict).toBe("fail")
    expect(verdict.reason).toContain("hypothesis")
  })

  test("all-passing inputs yield pass", () => {
    const verdict = verdictOf({ reviews: passReviews(), tests: passTests() })
    expect(verdict.verdict).toBe("pass")
  })
})
