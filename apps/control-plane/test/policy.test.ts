/**
 * Policy Service tests: the fixed risk table, schedule windows, and the
 * deterministic decision order. Pure; no PostgreSQL.
 */
import { describe, expect, test } from "bun:test"
import { fixedClock } from "../src/clock.js"
import {
  decidePolicyAction,
  resolveActionRiskClass,
  scheduleVerdict,
  validateZone,
} from "../src/core/policy.js"
import type { PolicyVersion, TypedAction } from "../src/core/policy.js"
import { computeVerdict } from "../src/verify/verdict.js"
import type { ResolverResult } from "../src/verify/resolver.js"

describe("Action risk table", () => {
  const action = (action_class: string, command: string): TypedAction => ({
    category: "messages-payments",
    action_class,
    adapter: "compose-release",
    command,
    target: "payment",
  })

  test("messages and payments are barred", () => {
    expect(resolveActionRiskClass(action("refund-payment", "refund 123"))).toBe("barred")
    expect(resolveActionRiskClass(action("send-external-message", "email user"))).toBe("barred")
  })

  test("barred-list commands match case-insensitively", () => {
    expect(resolveActionRiskClass(action("x", "drop table orders"))).toBe("barred")
  })

  test("security containment quarantine is safe", () => {
    const quarantine: TypedAction = { category: "security-containment", action_class: "quarantine", adapter: "compose-release", command: "quarantine payment", target: "payment" }
    expect(resolveActionRiskClass(quarantine)).toBe("safe")
  })

  test("adapter overrides tighten but never loosen", () => {
    const safe: TypedAction = { category: "restart", action_class: "restart", adapter: "compose-release", command: "restart", target: "payment" }
    expect(resolveActionRiskClass(safe, new Map([["compose-release:restart", "guarded"]]))).toBe("guarded")
    // Loosening a guarded class to safe is ignored.
    const rotate: TypedAction = { category: "credentials", action_class: "rotate", adapter: "compose-release", command: "rotate", target: "payment" }
    expect(resolveActionRiskClass(rotate, new Map([["compose-release:rotate", "safe"]]))).toBe("guarded")
  })
})

describe("Schedule windows", () => {
  const zone = "America/New_York"
  const window = { iana_zone: zone, windows: [{ start_weekday: "mon" as const, start_time: "09:00", end_weekday: "fri" as const, end_time: "18:00" }] }

  test("inside a weekday window is autonomous", () => {
    // 2026-08-17 is a Monday, 14:00 UTC == 10:00 EDT.
    expect(scheduleVerdict("2026-08-17T14:00:00Z", window).autonomous).toBe(true)
  })

  test("outside the window is not autonomous", () => {
    // Saturday.
    expect(scheduleVerdict("2026-08-22T14:00:00Z", window).autonomous).toBe(false)
  })

  test("an invalid zone name is rejected at authoring", () => {
    expect(validateZone("Not/AZone")).toBe(false)
    expect(validateZone(zone)).toBe(true)
  })
})

describe("Policy decision order", () => {
  const policy: PolicyVersion = {
    version: "policy-v1",
    authorityMode: "repair",
    automationPolicy: "scheduled-hybrid",
    schedule: { iana_zone: "America/New_York", windows: [{ start_weekday: "mon", start_time: "09:00", end_weekday: "fri", end_time: "18:00" }] },
    emergencyOverride: false,
    attemptLimit: 3,
  }
  const clock = fixedClock("2026-08-17T14:00:00Z") // Monday, inside window

  test("barred actions are denied before any other check", () => {
    const result = decidePolicyAction({
      action: { category: "messages-payments", action_class: "refund-payment", adapter: "compose-release", command: "refund", target: "payment" },
      stage: "release",
      riskClass: "barred",
      policy,
      tzdbVersion: "2025b",
      clock,
      approval: null,
      clockSkewToleranceSeconds: 120,
      emergencyAllowListMembership: false,
    })
    expect(result.decision).toBe("denied")
  })

  test("guarded actions need approval in every policy", () => {
    const result = decidePolicyAction({
      action: { category: "credentials", action_class: "rotate", adapter: "compose-release", command: "rotate", target: "payment" },
      stage: "release",
      riskClass: "guarded",
      policy: { ...policy, automationPolicy: "autonomous-always" },
      tzdbVersion: "2025b",
      clock,
      approval: null,
      clockSkewToleranceSeconds: 120,
      emergencyAllowListMembership: false,
    })
    expect(result.decision).toBe("approval-required")
  })
})

describe("Verification verdict function", () => {
  const resolver: ResolverResult = {
    required: ["R1", "T3"],
    conditional: [],
    triggered: {},
    not_applicable: [],
    check_reasons: {},
    resolver_version: "r1",
    t5_selection: null,
    needs_human: false,
    needs_human_reason: null,
  }
  const passTest = { layer: "T3", outcome: "pass" as const, flaky: false, tool: "node --test", tool_version: "1", receipt_ref: "r1" }
  const passReview = { role: "R1", status: "pass" as const, findings: [] }

  test("one cited blocker fails regardless of passing reviews", () => {
    const result = computeVerdict({
      candidateHash: "sha256:" + "a".repeat(64),
      sealedCandidateHash: "sha256:" + "a".repeat(64),
      resolver,
      reviews: [
        passReview,
        {
          role: "R2",
          status: "fail",
          findings: [{ id: "f1", severity: "blocker", citations: [{ kind: "file-line" }], status: "open", uncited: false }],
        },
      ],
      tests: [passTest],
      actionRiskClass: "safe",
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(result.verdict).toBe("fail")
    expect(result.severityMax).toBe("blocker")
  })

  test("a flaky-pass on a required check yields needs-human", () => {
    const result = computeVerdict({
      candidateHash: "sha256:" + "a".repeat(64),
      sealedCandidateHash: "sha256:" + "a".repeat(64),
      resolver,
      reviews: [passReview],
      tests: [{ ...passTest, outcome: "flaky-pass" }],
      actionRiskClass: "safe",
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(result.verdict).toBe("needs-human")
  })

  test("a hash mismatch fails", () => {
    const result = computeVerdict({
      candidateHash: "sha256:" + "a".repeat(64),
      sealedCandidateHash: "sha256:" + "b".repeat(64),
      resolver,
      reviews: [passReview],
      tests: [passTest],
      actionRiskClass: "safe",
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(result.verdict).toBe("fail")
  })

  test("a missing required report yields needs-human", () => {
    const result = computeVerdict({
      candidateHash: "sha256:" + "a".repeat(64),
      sealedCandidateHash: "sha256:" + "a".repeat(64),
      resolver,
      reviews: [],
      tests: [passTest],
      actionRiskClass: "safe",
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(result.verdict).toBe("needs-human")
  })
})
