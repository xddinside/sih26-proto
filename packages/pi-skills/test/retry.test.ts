/**
 * Retry, malformed-output, and receipt-binding tests for review and test
 * subagents: exactly one rerun, then needs-human; timeouts record error and
 * rerun once; a malformed output never silently passes.
 */
import { describe, expect, test } from "bun:test"

import {
  decideReviewRerun,
  parseReviewReport,
  uncitedBlockingFindings,
} from "../src/reviews/review-runner.js"
import {
  decideTestRerun,
  detectFlakyPass,
  flakyPassNeedsHuman,
  parseTestReport,
} from "../src/tests/test-runner.js"
import {
  fixtureHash,
  makeFinding,
  makeReviewReport,
  makeTestReport,
} from "./helpers.js"

const CANDIDATE = fixtureHash("candidate-retry")

describe("review rerun rules", () => {
  test("a malformed Review Report reruns once, then needs-human", () => {
    expect(
      decideReviewRerun({
        report: null,
        rerunsSoFar: 0,
        candidateHash: CANDIDATE,
      }).action
    ).toBe("rerun-once")
    expect(
      decideReviewRerun({
        report: null,
        rerunsSoFar: 1,
        candidateHash: CANDIDATE,
      }).action
    ).toBe("needs-human")
  })

  test("an uncited blocker or major finding reruns the role once", () => {
    const report = makeReviewReport({
      role: "R1",
      candidateHash: CANDIDATE,
      status: "fail",
      findings: [
        makeFinding({
          id: "F1",
          severity: "blocker",
          claim: "x",
          citations: [],
          uncited: true,
        }),
      ],
    })
    expect(uncitedBlockingFindings(report)).toHaveLength(1)
    expect(
      decideReviewRerun({ report, rerunsSoFar: 0, candidateHash: CANDIDATE })
        .action
    ).toBe("rerun-once")
    expect(
      decideReviewRerun({ report, rerunsSoFar: 1, candidateHash: CANDIDATE })
        .action
    ).toBe("needs-human")
  })

  test("a report bound to another candidate hash is never accepted", () => {
    const report = makeReviewReport({
      role: "R1",
      candidateHash: fixtureHash("other"),
    })
    expect(
      decideReviewRerun({ report, rerunsSoFar: 0, candidateHash: CANDIDATE })
        .action
    ).toBe("needs-human")
  })

  test("parseReviewReport round-trips a valid report and rejects prose", () => {
    const report = makeReviewReport({ role: "R2", candidateHash: CANDIDATE })
    expect(parseReviewReport(JSON.stringify(report))).toEqual(report)
    expect(parseReviewReport("no json here")).toBeNull()
  })
})

describe("test layer rerun rules", () => {
  test("a malformed Test Report reruns once, then needs-human", () => {
    expect(decideTestRerun({ report: null, rerunsSoFar: 0 }).action).toBe(
      "rerun-once"
    )
    expect(decideTestRerun({ report: null, rerunsSoFar: 1 }).action).toBe(
      "needs-human"
    )
  })

  test("an errored run records error, reruns once, then needs-human", () => {
    const report = makeTestReport({
      layer: "T3",
      candidateHash: CANDIDATE,
      outcome: "error",
    })
    expect(decideTestRerun({ report, rerunsSoFar: 0 }).action).toBe(
      "rerun-once"
    )
    expect(decideTestRerun({ report, rerunsSoFar: 1 }).action).toBe(
      "needs-human"
    )
  })

  test("fail-then-pass on the same hash is flaky-pass with both runs", () => {
    const runs = [
      {
        run_hash: fixtureHash("r1"),
        result: "fail" as const,
        at: new Date().toISOString(),
      },
      {
        run_hash: fixtureHash("r2"),
        result: "pass" as const,
        at: new Date().toISOString(),
      },
    ]
    expect(detectFlakyPass(runs).flaky).toBe(true)
    expect(detectFlakyPass(runs).runs).toHaveLength(2)
  })

  test("a flaky-pass on a required or triggered check yields needs-human; on not-applicable it does not", () => {
    expect(
      flakyPassNeedsHuman({ outcome: "flaky-pass", binding: "required" })
    ).toBe(true)
    expect(
      flakyPassNeedsHuman({ outcome: "flaky-pass", binding: "triggered" })
    ).toBe(true)
    expect(
      flakyPassNeedsHuman({ outcome: "flaky-pass", binding: "not-applicable" })
    ).toBe(false)
    expect(flakyPassNeedsHuman({ outcome: "pass", binding: "required" })).toBe(
      false
    )
  })

  test("parseTestReport round-trips a valid report", () => {
    const report = makeTestReport({
      layer: "T5",
      candidateHash: CANDIDATE,
      outcome: "fail",
    })
    expect(parseTestReport(JSON.stringify(report))).toEqual(report)
  })
})
