/**
 * Scoped T5 determinism: Demo Run 2's T5 failure stays deterministic
 * regardless of review wording. The T5 subagent confirms the ownership-map
 * selection matches the receipt and never re-scopes the suite; the report
 * copies the receipt outcome verbatim and binds to the candidate hash. The
 * Control Plane's own verdict function then fails the candidate on the
 * required T5 failure alone — the machine test keeps the outcome fixed even
 * if the review model misses the reachability finding.
 */
import { describe, expect, test } from "bun:test"

import { computeVerdict } from "@sih/control-plane/src/verify/verdict.js"
import type { ResolverResult } from "@sih/control-plane/src/verify/resolver.js"

import { assembleVerdictInput } from "../src/consolidation.js"
import {
  assertReceiptBinding,
  assertT5Selection,
  outcomeFromReceipt,
} from "../src/tests/test-runner.js"
import {
  fixtureHash,
  makeFinding,
  makeReviewReport,
  makeTestReport,
} from "./helpers.js"

const CANDIDATE = fixtureHash("candidate-run2")

const RESOLVER: ResolverResult = {
  required: ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
  conditional: ["T9", "T10", "T12", "T13"],
  triggered: {
    T9: "candidate target exists",
    T10: "the diff touches a user-facing path",
    T12: "the Recovery Point names a restore action",
    T13: "the candidate carries a Watch plan and a rehearsable environment",
  },
  not_applicable: ["R5", "R6", "R7", "R9", "T6", "T8", "T11"],
  check_reasons: {},
  resolver_version: "applicability-resolver@1.0",
  t5_selection: "payment",
  needs_human: false,
  needs_human_reason: null,
}

/** The Run-2 T5 receipt: the scoped regression suite fails the fixed
 * "Luhn-failing Visa is rejected" case, bound to the candidate hash. */
const T5_FAIL_RECEIPT = {
  receipt_id: "rcpt-t5-run2",
  candidate_hash: CANDIDATE,
  layer: "T5" as const,
  outcome: "fail" as const,
  failing_case: "Luhn-failing Visa is rejected",
}

/** R1 wording variants: the saved run must not depend on any of them. */
const R1_VARIANTS = [
  makeReviewReport({
    role: "R1",
    candidateHash: CANDIDATE,
    status: "fail",
    findings: [
      makeFinding({
        id: "F-reachability",
        severity: "major",
        claim:
          "restoring the card-type check makes the missing Luhn guard reachable; invalid Visa numbers now pass",
        citations: [
          { kind: "file-line", file: "src/payment/card.js", line: 12 },
          { kind: "file-line", file: "src/payment/card.js", line: 9 },
        ],
      }),
    ],
  }),
  makeReviewReport({
    role: "R1",
    candidateHash: CANDIDATE,
    status: "fail",
    findings: [
      makeFinding({
        id: "F-adjacent",
        severity: "major",
        claim: "the fix exposes the adjacent deleted Luhn guard",
        citations: [
          { kind: "file-line", file: "src/payment/card.js", line: 12 },
        ],
      }),
    ],
  }),
  makeReviewReport({
    role: "R1",
    candidateHash: CANDIDATE,
    status: "fail",
    findings: [
      makeFinding({
        id: "F-note",
        severity: "minor",
        claim: "worth noting the Luhn guard is gone",
        citations: [
          { kind: "file-line", file: "src/payment/card.js", line: 9 },
        ],
      }),
    ],
  }),
  // R1 misses the reachability finding entirely.
  makeReviewReport({ role: "R1", candidateHash: CANDIDATE, status: "pass" }),
]

function otherReviews(): ReturnType<typeof makeReviewReport>[] {
  return [
    makeReviewReport({ role: "R2", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R3", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R4", candidateHash: CANDIDATE }),
    makeReviewReport({ role: "R8", candidateHash: CANDIDATE }),
  ]
}

function otherTests(): ReturnType<typeof makeTestReport>[] {
  return [
    makeTestReport({ layer: "T1", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T2", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T3", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T4", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T7", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T9", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T12", candidateHash: CANDIDATE, outcome: "pass" }),
    makeTestReport({ layer: "T13", candidateHash: CANDIDATE, outcome: "pass" }),
  ]
}

describe("scoped T5 determinism (Demo Run 2)", () => {
  test("the report target must equal the ownership-map selection; the subagent never re-scopes", () => {
    expect(
      assertT5Selection({
        resolverSelection: "payment",
        reportTarget: "payment",
      }).ok
    ).toBe(true)
    expect(
      assertT5Selection({
        resolverSelection: "payment",
        reportTarget: "full-suite",
      }).ok
    ).toBe(false)
    expect(
      assertT5Selection({ resolverSelection: null, reportTarget: "anything" })
        .ok
    ).toBe(false)
  })

  test("the report copies the receipt outcome verbatim; a model cannot reinterpret a failure", () => {
    expect(outcomeFromReceipt(T5_FAIL_RECEIPT)).toBe("fail")
    expect(outcomeFromReceipt({ ...T5_FAIL_RECEIPT, outcome: "pass" })).toBe(
      "pass"
    )
  })

  test("receipt binding: a report bound to any other candidate hash is stale", () => {
    expect(
      assertReceiptBinding({
        reportCandidateHash: CANDIDATE,
        receiptCandidateHash: CANDIDATE,
      }).bound
    ).toBe(true)
    expect(
      assertReceiptBinding({
        reportCandidateHash: CANDIDATE,
        receiptCandidateHash: fixtureHash("other"),
      }).bound
    ).toBe(false)
  })

  test("every R1 wording variant leaves the verdict fail, driven by the T5 receipt", () => {
    for (const r1 of R1_VARIANTS) {
      const t5 = makeTestReport({
        layer: "T5",
        candidateHash: CANDIDATE,
        outcome: "fail",
        target: "payment",
        receiptRef: T5_FAIL_RECEIPT.receipt_id,
        runs: [
          {
            run_hash: fixtureHash("t5-run2"),
            result: "fail",
            at: new Date().toISOString(),
            detail: "Luhn-failing Visa is rejected",
          },
        ],
      })
      const assembled = assembleVerdictInput({
        candidateHash: CANDIDATE,
        reports: [r1, ...otherReviews()],
        testReports: [...otherTests(), t5],
        contradictions: [],
        hypothesisInvalidated: false,
        guardedApprovalValid: true,
      })
      const verdict = computeVerdict({
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
      // The verdict is fail regardless of R1's wording: a cited major
      // finding fails on its own, and the required T5 failure fails even
      // when R1 misses the reachability finding.
      expect(verdict.verdict).toBe("fail")
    }
  })

  test("even when R1 misses the reachability finding, T5 keeps the run deterministic", () => {
    const t5 = makeTestReport({
      layer: "T5",
      candidateHash: CANDIDATE,
      outcome: "fail",
      target: "payment",
      runs: [
        {
          run_hash: fixtureHash("t5-run2"),
          result: "fail",
          at: new Date().toISOString(),
          detail: "Luhn-failing Visa is rejected",
        },
      ],
    })
    const assembled = assembleVerdictInput({
      candidateHash: CANDIDATE,
      reports: [R1_VARIANTS[3], ...otherReviews()],
      testReports: [...otherTests(), t5],
      contradictions: [],
      hypothesisInvalidated: false,
      guardedApprovalValid: true,
    })
    const verdict = computeVerdict({
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
    expect(verdict.verdict).toBe("fail")
    expect(verdict.reason).toContain("T5")
  })

  test("the failing case name is fixed seed data, independent of any prompt", () => {
    // The receipt carries the case name; the skill never rewrites it.
    expect(T5_FAIL_RECEIPT.failing_case).toBe("Luhn-failing Visa is rejected")
  })
})
