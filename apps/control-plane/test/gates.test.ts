/**
 * Pure gate tests: the eight-check Hypothesis gate table, the Action Gate risk
 * classes (safe/guarded/barred incl. barred-never-executes), and the Release
 * Gate missing-approval rejection. No PostgreSQL required.
 */
import { describe, expect, test } from "bun:test"

import { evaluateActionGate } from "../src/gates/action-gate.js"
import type { ActionGateInput } from "../src/gates/action-gate.js"
import { evaluateHypothesisGate } from "../src/gates/hypothesis-gate.js"
import type {
  HypothesisGateInput,
  MaterialAlternative,
  TestRun,
} from "../src/gates/hypothesis-gate.js"
import { evaluateReleaseGate } from "../src/gates/release-gate.js"
import type { RecoveryPointCoverage, ReleaseGateInput } from "../src/gates/release-gate.js"
import type { EvidenceItem, Hypothesis, RemediationProposal } from "@sih/contracts/types"

const H = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`

function hypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    schema_version: "1.0",
    id: "h1",
    incident_id: "inc-1",
    incident_run_id: "run-1",
    attempt: 1,
    round: 1,
    causal_claim: {
      trigger: "seed commit",
      defect: "card-type clause inverted",
      propagation: [
        { from: "trigger", to: "failure", cited_item_ids: [H(1), H(2)] },
      ],
      failure: "payment charge error ratio above 0.20",
    },
    affected_scope: {
      service_names: ["payment"],
      deployment_environment_names: ["demo"],
      versions: ["v1"],
      window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null },
    },
    predicted_observations: [
      { id: "p1", statement: "valid Visa accepted on corrected code", registered_at: "2026-08-15T15:40:00Z" },
    ],
    evidence: {
      supporting: [H(1), H(2)],
      opposing: [],
      unexplained: [],
    },
    alternatives: [],
    proposed_tests: [
      {
        id: "t1",
        procedure: "node --test card.unit.test.js",
        bounds: "pure module",
        permissions: ["read"],
        expected: { this_hypothesis: "valid Visa accepted" },
      },
    ],
    status: "testing",
    ...overrides,
  }
}

function metricItem(id: string, value: number, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id,
    kind: "metric",
    backend: "prometheus",
    identity: {
      metric_name: "traces_span_metrics_calls_total",
      metric_labels: { service_name: "payment" },
      window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null },
    },
    snapshot: { value },
    content_hash: H(99),
    links: [],
    observed_at: "2026-08-15T15:35:00Z",
    provenance: ["collector -> gateway -> prometheus"],
    trust: "backend",
    joins: { service_name: "payment", deployment_environment_name: "demo" },
    redaction: { profile_id: "none", masked_fields: [] },
    outcome: "ok",
    ...overrides,
  }
}

function baseInput(overrides: Partial<HypothesisGateInput> = {}): HypothesisGateInput {
  const items: EvidenceItem[] = [
    metricItem(H(1), 0.92),
    metricItem(H(2), 42, { identity: { metric_name: "calls_total" } }),
  ]
  return {
    hypothesis: hypothesis(),
    items,
    criticalItemIds: [H(1)],
    explainedAwayItemIds: [],
    observedScope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    materialAlternatives: [],
    testRuns: [],
    counterfactualItemIds: [],
    freshnessWindow: { starts_at: "2026-08-15T15:00:00Z", ends_at: null },
    expectedDeploymentVersion: null,
    coverage: new Map(),
    evaluationTime: "2026-08-15T16:00:00Z",
    needsHumanReason: null,
    ...overrides,
  }
}

describe("Hypothesis gate: eight checks", () => {
  test("passes when all eight checks hold", () => {
    const passedTest: TestRun = {
      prediction_id: "p1",
      registered_at: "2026-08-15T15:40:00Z",
      started_at: "2026-08-15T15:45:00Z",
      receipt_ref: "rcpt-1",
      outcome: "ok",
      prediction_matched: true,
    }
    const input = baseInput({
      materialAlternatives: [
        { hypothesis_id: "h2", eliminated_by_item_ids: [H(3)], failed_prediction_of_h: false, rejected: false },
      ],
      testRuns: [passedTest],
    })
    const result = evaluateHypothesisGate(input)
    expect(result.verdict).toBe("pass")
    expect(result.checks).toHaveLength(8)
    expect(result.checks.every((check) => check.result)).toBe(true)
  })

  test("check 1: unexplained critical item fails cited coverage", () => {
    const result = evaluateHypothesisGate(baseInput({ criticalItemIds: [H(1), H(5)] }))
    const check = result.checks.find((entry) => entry.check === "cited-coverage")
    expect(check?.result).toBe(false)
    expect(check?.counts.unexplained_critical_items).toBe(1)
    expect(result.verdict).toBe("continue")
  })

  test("check 2: a broken join fails causal edge support", () => {
    // Two items with no shared identity field cannot sit on one edge.
    const items: EvidenceItem[] = [
      metricItem(H(1), 0.92, { identity: { metric_name: "a", metric_labels: {} }, joins: { service_name: "payment" } }),
      metricItem(H(2), 42, { identity: { metric_name: "b", metric_labels: {} }, joins: { service_name: "checkout" } }),
    ]
    const result = evaluateHypothesisGate(baseInput({ items }))
    const check = result.checks.find((entry) => entry.check === "causal-edge-support")
    expect(check?.result).toBe(false)
    expect(check?.counts.unsupported_edges).toBe(1)
  })

  test("check 3: fresh contradicting item of equal trust fails", () => {
    const items: EvidenceItem[] = [
      metricItem(H(1), 0.92),
      metricItem(H(2), 42, { identity: { metric_name: "calls_total" } }),
      metricItem(H(4), 0, { contradicts: [H(1)] }),
    ]
    const result = evaluateHypothesisGate(baseInput({ items }))
    const check = result.checks.find((entry) => entry.check === "contradiction-handling")
    expect(check?.result).toBe(false)
    expect(check?.counts.unresolved_contradictions).toBe(1)
  })

  test("check 4: undiscriminated material alternative fails", () => {
    const alternative: MaterialAlternative = {
      hypothesis_id: "h2",
      eliminated_by_item_ids: [],
      failed_prediction_of_h: false,
      rejected: false,
    }
    const result = evaluateHypothesisGate(baseInput({ materialAlternatives: [alternative] }))
    const check = result.checks.find((entry) => entry.check === "alternative-elimination")
    expect(check?.result).toBe(false)
    expect(check?.counts.undiscriminated_material_alternatives).toBe(1)
  })

  test("check 5: failed discriminating test rejects", () => {
    const failedTest: TestRun = {
      prediction_id: "p1",
      registered_at: "2026-08-15T15:40:00Z",
      started_at: "2026-08-15T15:45:00Z",
      receipt_ref: "rcpt-1",
      outcome: "failed",
      prediction_matched: false,
    }
    const result = evaluateHypothesisGate(baseInput({ testRuns: [failedTest] }))
    expect(result.verdict).toBe("reject")
    const check = result.checks.find((entry) => entry.check === "reproducible-test")
    expect(check?.result).toBe(false)
  })

  test("check 5: post-registered prediction does not pass", () => {
    const lateTest: TestRun = {
      prediction_id: "p1",
      registered_at: "2026-08-15T15:50:00Z",
      started_at: "2026-08-15T15:45:00Z",
      receipt_ref: "rcpt-1",
      outcome: "ok",
      prediction_matched: true,
    }
    const result = evaluateHypothesisGate(baseInput({ testRuns: [lateTest] }))
    const check = result.checks.find((entry) => entry.check === "reproducible-test")
    expect(check?.result).toBe(false)
  })

  test("check 7: stale supporting item fails freshness", () => {
    const items: EvidenceItem[] = [
      metricItem(H(1), 0.92, { fresh_until: "2026-08-15T15:00:00Z" }),
      metricItem(H(2), 42, { identity: { metric_name: "calls_total" } }),
    ]
    const result = evaluateHypothesisGate(baseInput({ items }))
    const check = result.checks.find((entry) => entry.check === "freshness")
    expect(check?.result).toBe(false)
    expect(check?.counts.stale_items).toBe(1)
  })

  test("check 8: measured zero without coverage fails", () => {
    const items: EvidenceItem[] = [
      metricItem(H(1), 0, { identity: { metric_name: "baseline" } }),
      metricItem(H(2), 42, { identity: { metric_name: "calls_total" } }),
    ]
    const result = evaluateHypothesisGate(baseInput({ items }))
    const check = result.checks.find((entry) => entry.check === "telemetry-coverage")
    expect(check?.result).toBe(false)
  })

  test("check 8: measured zero with verified coverage passes", () => {
    const items: EvidenceItem[] = [
      metricItem(H(1), 0, { identity: { metric_name: "baseline" } }),
      metricItem(H(2), 42, { identity: { metric_name: "calls_total" } }),
    ]
    const result = evaluateHypothesisGate(
      baseInput({
        items,
        coverage: new Map([[H(1), { backend_healthy: true, scope_covered: true, window_covered: true }]]),
      }),
    )
    const check = result.checks.find((entry) => entry.check === "telemetry-coverage")
    expect(check?.result).toBe(true)
  })

  test("worker-derived item never supports a check", () => {
    // An edge citing a worker-derived id (not in the revision) is an uncited
    // claim and cannot support causal edge support.
    const result = evaluateHypothesisGate({
      ...baseInput(),
      hypothesis: hypothesis({
        causal_claim: {
          trigger: "seed commit",
          defect: "card-type clause inverted",
          propagation: [{ from: "trigger", to: "failure", cited_item_ids: [H(999)] }],
          failure: "payment charge error ratio above 0.20",
        },
      }),
    })
    const check = result.checks.find((entry) => entry.check === "cited-coverage")
    expect(check?.counts.uncited_claims).toBeGreaterThan(0)
  })
})

describe("Action Gate: risk classes", () => {
  const base: ActionGateInput = {
    candidateHash: H(1),
    action: { adapter: "compose-release", action_class: "scale-up", command: "scale payment 2", category: "scaling", target: "payment" },
    riskClass: "safe" as const,
    adapterApproved: true,
    targetVersionMatches: true,
    policyDecision: "autonomous" as const,
    policyDecisionReason: "autonomous policy permits safe actions",
    approval: { valid: false, approval_id: null },
    recoveryPointCoverage: { validated: true, changed: ["replicas"], covered: ["replicas"], uncoveredApproved: false },
    stopWatchConditionsFixed: true,
    emergencyAllowListMembership: false,
    policyVersion: "policy-v1",
    tzdbVersion: "2025b",
    evaluatedAt: "2026-08-15T16:00:00Z",
  }

  test("safe action passes", () => {
    const result = evaluateActionGate(base)
    expect(result.verdict).toBe("pass")
    expect(result.facts).toHaveLength(6)
  })

  test("guarded action without approval does not pass", () => {
    const result = evaluateActionGate({ ...base, riskClass: "guarded", approval: { valid: false, approval_id: null } })
    expect(result.verdict).toBe("needs-human")
  })

  test("guarded action with a valid approval passes", () => {
    const result = evaluateActionGate({
      ...base,
      riskClass: "guarded",
      policyDecision: "autonomous",
      approval: { valid: true, approval_id: "ap-1" },
    })
    expect(result.verdict).toBe("pass")
  })

  test("barred action never executes", () => {
    const result = evaluateActionGate({ ...base, riskClass: "barred" })
    expect(result.verdict).toBe("fail")
    const fact7 = result.facts.find((entry) => entry.fact === "6")
    expect(fact7?.result).toBe(false)
  })
})

describe("Release Gate: missing-approval rejection", () => {
  const base: ReleaseGateInput = {
    candidateHash: H(1),
    proposal: {
      schema_version: "1.0",
      incident_id: "inc-1",
      run_id: "run-1",
      attempt: 1,
      candidate_hash: H(1),
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      disposition: "allowed",
      change_description: "restore negation",
      diff: { base_ref: "abc", diff_text: "-if", diff_hash: H(2) },
      citations: [],
      test_plan: [],
      changed_surfaces: ["payment/card.js"],
      recovery_point: { id: "rp-1", changed_surfaces: ["payment/card.js"] },
      sealed_at: "2026-08-15T16:00:00Z",
    } as RemediationProposal,
    verificationReport: { candidate_hash: H(1), hash_binding: { match: true } },
    riskClass: "safe" as const,
    policyDecision: "approval-required" as const,
    policyDecisionReason: "outside autonomous window; a recorded approval lets it proceed",
    approval: { valid: false, approval_id: null },
    artifactMatchesCommit: true,
    pipelineChecksPassed: true,
    targetVersionMatches: true,
    rolloutWatchPlanComplete: true,
    recoveryPointCoverage: { validated: true, changed: ["payment/card.js"], covered: ["payment/card.js"], uncoveredApproved: false } satisfies RecoveryPointCoverage,
    pipelineRulesPassed: true,
    policyVersion: "policy-v1",
    tzdbVersion: "2025b",
    evaluatedAt: "2026-08-15T16:00:00Z",
  }

  test("approval-required without a recorded approval returns needs-human", () => {
    const result = evaluateReleaseGate(base)
    expect(result.verdict).toBe("needs-human")
    const fact4 = result.facts.find((entry) => entry.fact === "4")
    expect(fact4?.result).toBe(false)
  })

  test("approval-required with a valid approval passes", () => {
    const result = evaluateReleaseGate({ ...base, approval: { valid: true, approval_id: "ap-1" } })
    expect(result.verdict).toBe("pass")
  })

  test("a barred change set fails the gate", () => {
    const result = evaluateReleaseGate({ ...base, riskClass: "barred" })
    expect(result.verdict).toBe("fail")
  })
})
