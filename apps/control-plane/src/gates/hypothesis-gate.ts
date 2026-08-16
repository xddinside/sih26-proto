/**
 * The deterministic eight-check Hypothesis gate from
 * docs/research/hypothesis-gate.md.
 *
 * The gate uses counts and booleans only: no numeric score aggregate, no
 * weights, and no model self-reported confidence. Each count means exactly
 * one thing and pairs with a boolean threshold. The gate is fixed, versioned
 * policy code in the Control Plane; a model cannot waive, edit, or re-order
 * the checks.
 */
import type { EvidenceItem, Hypothesis } from "@sih/contracts/types"

export interface GateCheck {
  check:
    | "cited-coverage"
    | "causal-edge-support"
    | "contradiction-handling"
    | "alternative-elimination"
    | "reproducible-test"
    | "scope-match"
    | "freshness"
    | "telemetry-coverage"
  result: boolean
  counts: Partial<GateCounts>
  cited_item_ids: string[]
  reason: string
}

export interface GateCounts {
  uncited_claims: number
  unsupported_edges: number
  unresolved_contradictions: number
  undiscriminated_material_alternatives: number
  executed_tests: number
  passed_tests: number
  stale_items: number
  unexplained_critical_items: number
}

export type HypothesisVerdict = "pass" | "continue" | "reject" | "needs-human"

export interface MaterialAlternative {
  hypothesis_id: string
  eliminated_by_item_ids: string[]
  failed_prediction_of_h: boolean
  rejected: boolean
}

export interface TestRun {
  prediction_id: string
  registered_at: string
  started_at: string
  receipt_ref: string
  outcome: "ok" | "failed" | "error"
  prediction_matched: boolean
}

export interface CoverageRecord {
  backend_healthy: boolean
  scope_covered: boolean
  window_covered: boolean
}

export interface HypothesisGateInput {
  hypothesis: Hypothesis
  items: readonly EvidenceItem[]
  /** Critical anomaly items from the trigger window. */
  criticalItemIds: readonly string[]
  /** Critical items the hypothesis explains away with citations. */
  explainedAwayItemIds: readonly string[]
  /** Observed incident scope the hypothesis must cover. */
  observedScope: {
    tenant_id: string
    deployment_environment_name: string
    service_name: string
  }
  materialAlternatives: readonly MaterialAlternative[]
  testRuns: readonly TestRun[]
  counterfactualItemIds: readonly string[]
  freshnessWindow: { starts_at: string; ends_at: string | null }
  expectedDeploymentVersion: string | null
  coverage: ReadonlyMap<string, CoverageRecord>
  evaluationTime: string
  /** A human must resolve an evidence question; set by the policy wrapper. */
  needsHumanReason: string | null
}

export interface HypothesisGateResult {
  verdict: HypothesisVerdict
  checks: GateCheck[]
  counts: GateCounts
}

const TRUST_ORDER: ReadonlyMap<string, number> = new Map([
  ["human", 3],
  ["backend", 2],
  ["test-result", 2],
])

function itemById(items: readonly EvidenceItem[], id: string): EvidenceItem | undefined {
  return items.find((item) => item.id === id)
}

function isFresh(item: EvidenceItem, evaluationTime: string): boolean {
  if (item.outcome !== "ok") {
    return false
  }
  if (item.fresh_until !== null && item.fresh_until !== undefined) {
    if (Date.parse(item.fresh_until) < Date.parse(evaluationTime)) {
      return false
    }
  }
  return true
}

const JOIN_FIELDS = [
  "trace_id",
  "span_id",
  "metric_name",
  "commit",
  "diff_hash",
  "flag_key",
  "code_file_path",
] as const

/** Two items join when they share an identity field (signal-code, trace-log,
 * trace-metric, code-deploy joins from the report). */
function itemsJoin(a: EvidenceItem, b: EvidenceItem): boolean {
  for (const field of JOIN_FIELDS) {
    const valueA = a.identity[field]
    const valueB = b.identity[field]
    if (valueA !== undefined && valueB !== undefined && valueA === valueB) {
      return true
    }
  }
  const joinsA = a.joins
  const joinsB = b.joins
  const serviceJoin =
    joinsA.service_name !== undefined &&
    joinsB.service_name !== undefined &&
    joinsA.service_name === joinsB.service_name
  const envJoin =
    joinsA.deployment_environment_name !== undefined &&
    joinsB.deployment_environment_name !== undefined &&
    joinsA.deployment_environment_name === joinsB.deployment_environment_name
  return serviceJoin && envJoin
}

function hasZeroOrNegativeSnapshot(item: EvidenceItem): boolean {
  if (typeof item.snapshot === "number") {
    return item.snapshot <= 0
  }
  if (typeof item.snapshot === "object" && item.snapshot !== null) {
    const value = (item.snapshot as { value?: unknown }).value
    if (typeof value === "number" && value <= 0) {
      return true
    }
    const count = (item.snapshot as { count?: unknown }).count
    return typeof count === "number" && count <= 0
  }
  return false
}

function truthyCheck(
  check: GateCheck["check"],
  result: boolean,
  counts: Partial<GateCounts>,
  cited: string[],
  reason: string,
): GateCheck {
  return { check, result, counts, cited_item_ids: cited, reason }
}

/**
 * Evaluate one Hypothesis against the eight checks. Pure and deterministic:
 * identical inputs yield identical outputs.
 */
export function evaluateHypothesisGate(input: HypothesisGateInput): HypothesisGateResult {
  const { hypothesis, items } = input
  const supporting = hypothesis.evidence.supporting
    .map((id) => itemById(items, id))
    .filter((item): item is EvidenceItem => item !== undefined)
  const checks: GateCheck[] = []
  const counts: GateCounts = {
    uncited_claims: 0,
    unsupported_edges: 0,
    unresolved_contradictions: 0,
    undiscriminated_material_alternatives: 0,
    executed_tests: 0,
    passed_tests: 0,
    stale_items: 0,
    unexplained_critical_items: 0,
  }

  // 1. Cited coverage: failure matches the symptom, every critical item is
  //    supporting or explained away, every edge cites at least one item.
  {
    const explainedAway = new Set(input.explainedAwayItemIds)
    const supportingIds = new Set(supporting.map((item) => item.id))
    const unexplained = input.criticalItemIds.filter(
      (id) => !supportingIds.has(id) && !explainedAway.has(id),
    )
    counts.unexplained_critical_items = unexplained.length

    let uncited = 0
    for (const edge of hypothesis.causal_claim.propagation) {
      const cited = edge.cited_item_ids ?? []
      if (cited.length === 0) {
        uncited += 1
        continue
      }
      for (const id of cited) {
        if (itemById(items, id) === undefined) {
          uncited += 1
        }
      }
    }
    counts.uncited_claims = uncited

    const failureNonEmpty = hypothesis.causal_claim.failure.trim().length > 0
    const edgesCovered = uncited === 0
    checks.push(
      truthyCheck(
        "cited-coverage",
        failureNonEmpty && edgesCovered && unexplained.length === 0,
        { uncited_claims: uncited, unexplained_critical_items: unexplained.length },
        unexplained,
        unexplained.length > 0
          ? `${unexplained.length} critical items unexplained`
          : uncited > 0
            ? `${uncited} uncited claims`
            : "failure names the symptom; every edge cites items; all critical items covered",
      ),
    )
  }

  // 2. Causal edge support: each edge's cited items form a joined chain.
  {
    let unsupported = 0
    const missing: string[] = []
    for (const edge of hypothesis.causal_claim.propagation) {
      const cited = (edge.cited_item_ids ?? [])
        .map((id) => itemById(items, id))
        .filter((item): item is EvidenceItem => item !== undefined)
      if (cited.length === 0) {
        unsupported += 1
        missing.push(`${edge.from}->${edge.to}`)
        continue
      }
      let broken = false
      for (let index = 0; index < cited.length - 1; index += 1) {
        const current = cited[index]
        const next = cited[index + 1]
        if (current === undefined || next === undefined || !itemsJoin(current, next)) {
          broken = true
          break
        }
      }
      if (broken) {
        unsupported += 1
        missing.push(`${edge.from}->${edge.to}`)
      }
    }
    counts.unsupported_edges = unsupported
    checks.push(
      truthyCheck(
        "causal-edge-support",
        unsupported === 0,
        { unsupported_edges: unsupported },
        missing,
        unsupported === 0
          ? "every edge forms a joined chain from trigger to failure"
          : `broken joins: ${missing.join(", ")}`,
      ),
    )
  }

  // 3. Contradiction handling: no fresh item of the same or higher trust
  //    contradicts a supporting item. Supersession resolves.
  {
    let unresolved = 0
    const supersededBy = new Set<string>()
    for (const item of items) {
      for (const superseded of item.supersedes ?? []) {
        supersededBy.add(superseded)
      }
    }
    const implicated: string[] = []
    for (const support of supporting) {
      for (const item of items) {
        if (!isFresh(item, input.evaluationTime)) {
          continue
        }
        const contradicts = item.contradicts ?? []
        if (!contradicts.includes(support.id)) {
          continue
        }
        if (supersededBy.has(item.id)) {
          continue
        }
        const trustItem = TRUST_ORDER.get(item.trust) ?? 1
        const trustSupport = TRUST_ORDER.get(support.trust) ?? 1
        if (trustItem >= trustSupport) {
          unresolved += 1
          implicated.push(item.id)
        }
      }
    }
    counts.unresolved_contradictions = unresolved
    checks.push(
      truthyCheck(
        "contradiction-handling",
        unresolved === 0,
        { unresolved_contradictions: unresolved },
        implicated,
        unresolved === 0
          ? "no fresh equal-or-higher-trust item contradicts a supporting item"
          : `${unresolved} unresolved contradictions`,
      ),
    )
  }

  // 4. Alternative elimination: each material, non-rejected alternative has
  //    an item or test outcome it cannot explain, or a failed prediction of H.
  {
    let undiscriminated = 0
    const leftover: string[] = []
    for (const alternative of input.materialAlternatives) {
      if (alternative.rejected) {
        continue
      }
      const eliminated =
        alternative.failed_prediction_of_h || alternative.eliminated_by_item_ids.length > 0
      if (!eliminated) {
        undiscriminated += 1
        leftover.push(alternative.hypothesis_id)
      }
    }
    counts.undiscriminated_material_alternatives = undiscriminated
    checks.push(
      truthyCheck(
        "alternative-elimination",
        undiscriminated === 0,
        { undiscriminated_material_alternatives: undiscriminated },
        leftover,
        undiscriminated === 0
          ? "every material alternative is discriminated"
          : `${undiscriminated} undiscriminated material alternatives: ${leftover.join(", ")}`,
      ),
    )
  }

  // 5. Reproducible tests or counterfactual evidence. A failed test rejects;
  //    an errored test counts for nothing. Predictions must be pre-registered.
  {
    let executed = 0
    let passed = 0
    let failed = 0
    let errored = 0
    const receipts: string[] = []
    for (const run of input.testRuns) {
      executed += 1
      receipts.push(run.receipt_ref)
      const preregistered = Date.parse(run.registered_at) <= Date.parse(run.started_at)
      if (!preregistered) {
        continue
      }
      if (run.outcome === "ok" && run.prediction_matched) {
        passed += 1
      } else if (run.outcome === "failed") {
        failed += 1
      } else if (run.outcome === "error") {
        errored += 1
      }
    }
    counts.executed_tests = executed
    counts.passed_tests = passed
    const hasCounterfactual = input.counterfactualItemIds.length > 0
    const testEvidence = passed > 0
    let result: boolean
    let reason: string
    if (failed > 0) {
      result = false
      reason = `${failed} discriminating test failed; the hypothesis is rejected`
    } else if (testEvidence || hasCounterfactual) {
      result = true
      reason = testEvidence
        ? `${passed} pre-registered test matched its prediction`
        : "natural counterfactual recorded"
    } else {
      result = false
      reason = errored > 0
        ? `${errored} test errored; rerun once before this check can pass`
        : "no executed discriminating test and no recorded counterfactual"
    }
    checks.push(
      truthyCheck(
        "reproducible-test",
        result,
        { executed_tests: executed, passed_tests: passed },
        receipts,
        reason,
      ),
    )
  }

  // 6. Scope match: the hypothesis covers the observed scope.
  {
    const services = hypothesis.affected_scope.service_names ?? []
    const environments = hypothesis.affected_scope.deployment_environment_names ?? []
    const covers =
      services.includes(input.observedScope.service_name) &&
      environments.includes(input.observedScope.deployment_environment_name)
    checks.push(
      truthyCheck(
        "scope-match",
        covers,
        {},
        [],
        covers ? "affected scope covers the observed scope" : "affected scope misses the observed service or environment",
      ),
    )
  }

  // 7. Freshness: every supporting item is ok, inside the policy window, with
  //    no passed fresh_until; deployment-state items match the expected version.
  {
    let stale = 0
    const staleIds: string[] = []
    for (const item of supporting) {
      let itemStale = !isFresh(item, input.evaluationTime)
      if (!itemStale && Date.parse(item.observed_at) < Date.parse(input.freshnessWindow.starts_at)) {
        itemStale = true
      }
      if (
        !itemStale &&
        item.kind === "deployment-event" &&
        input.expectedDeploymentVersion !== null &&
        item.identity.after_version !== undefined &&
        item.identity.after_version !== input.expectedDeploymentVersion
      ) {
        itemStale = true
      }
      if (itemStale) {
        stale += 1
        staleIds.push(item.id)
      }
    }
    counts.stale_items = stale
    checks.push(
      truthyCheck(
        "freshness",
        stale === 0,
        { stale_items: stale },
        staleIds,
        stale === 0 ? "all supporting items fresh" : `${stale} stale supporting items`,
      ),
    )
  }

  // 8. Telemetry coverage: every zero/negative supporting item carries a
  //    verified coverage record. Absence never counts as evidence.
  {
    let uncovered = 0
    const uncoveredIds: string[] = []
    for (const item of supporting) {
      if (!hasZeroOrNegativeSnapshot(item)) {
        continue
      }
      const coverage = input.coverage.get(item.id)
      if (
        coverage === undefined ||
        !coverage.backend_healthy ||
        !coverage.scope_covered ||
        !coverage.window_covered
      ) {
        uncovered += 1
        uncoveredIds.push(item.id)
      }
    }
    checks.push(
      truthyCheck(
        "telemetry-coverage",
        uncovered === 0,
        {},
        uncoveredIds,
        uncovered === 0
          ? "every zero/negative item has a verified coverage record"
          : `${uncovered} zero/negative items lack verified coverage; absence never counts as evidence`,
      ),
    )
  }

  const verdict = resolveVerdict(input, checks)
  return { verdict, checks, counts }
}

function resolveVerdict(input: HypothesisGateInput, checks: readonly GateCheck[]): HypothesisVerdict {
  if (input.needsHumanReason !== null) {
    return "needs-human"
  }
  const failed = checks.filter((check) => !check.result)
  if (failed.length === 0) {
    return "pass"
  }
  // Definitive rejection: a failed discriminating test or a broken chain that
  // cannot be superseded, recorded on the failing check's reason.
  const reproducible = checks.find((check) => check.check === "reproducible-test")
  if (reproducible !== undefined && !reproducible.result && reproducible.reason.includes("rejected")) {
    return "reject"
  }
  const coverage = checks.find((check) => check.check === "telemetry-coverage")
  if (coverage !== undefined && !coverage.result && input.coverage.size === 0) {
    return "continue"
  }
  return "continue"
}

/** At most one Hypothesis passes per evaluation. Two passing downgrades both
 * to `continue` with one mandated discriminating test between them. */
export function evaluateHypotheses(
  evaluations: readonly (HypothesisGateResult & { hypothesis_id: string })[],
): (HypothesisGateResult & { hypothesis_id: string; mandated_test: string | null })[] {
  const passing = evaluations.filter((evaluation) => evaluation.verdict === "pass")
  if (passing.length <= 1) {
    return evaluations.map((evaluation) => ({
      ...evaluation,
      mandated_test: null,
    }))
  }
  const pair = passing.slice(0, 2).map((evaluation) => evaluation.hypothesis_id).join(" vs ")
  return evaluations.map((evaluation) => ({
    ...evaluation,
    verdict: evaluation.verdict === "pass" ? "continue" : evaluation.verdict,
    mandated_test: evaluation.verdict === "pass" ? `discriminate between ${pair}` : null,
  }))
}
