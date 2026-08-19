/**
 * Deterministic capture payloads: the real-recorded Evidence Set, the four
 * settled Hypotheses, the stub Model Provider for the Fusion round, and the
 * deterministic planner/implementer texts for Repair.
 *
 * No model provider runs during capture: the Model Gateway consumes this
 * deterministic provider, exactly like packages/pi-skills/scripts/smoke.ts.
 * The values the payloads carry (ratios, counts, digests, log lines) are the
 * real rows the shop adapter recorded; everything else is fixed content.
 */
import type { ModelProvider } from "@sih/brokers"
import { contentHash, evidenceItemId } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import type { EvidenceItem, Hypothesis, ReviewReport, TestReport } from "@sih/contracts/types"

import {
  CANDIDATE_SERVICE_NAME,
  DIFF_TEXT,
  REVIEW_ROLES,
  RECEIPT_IDS,
  TEST_TOOLS,
  WATCH_GATES,
} from "./constants.js"

/** Real capture facts recorded from the live shop before the run starts. */
export interface CaptureFacts {
  seed: "S1" | "S2"
  /** The real detector breach ratio at intake (>= 0.9 settled target). */
  firingRatio: number
  firingCallsPerSecond: number
  /** The real pre-seed baseline ratio under identical traffic. */
  baselineRatio: number
  baselineCallsPerSecond: number
  /** The seeded live image id (docker image id, real). */
  seededImageId: string
  /** The pre-seed healthy image id (real). */
  baselineImageId: string
  /** Firing window start (the real alert startsAt). */
  windowStart: string
  /** When the seeded image went live (real). */
  seedAppliedAt: string
  /** The real pino error line from the live payment container logs. */
  logLine: string
  /** The real exemplar trace/span ids, when the store exposes them. */
  traceId: string | null
  spanId: string | null
  /** Real flagd evaluations. */
  paymentFailure: number
  paymentUnreachable: boolean
  /** The real T3-on-seeded run (the pre-registered prediction receipt). */
  seededT3: { passed: boolean; output: string }
  /** The real seed diff hash (git apply of the seed patch). */
  seedDiffHash: HashString
  /** The candidate image id (built during Verify). */
  candidateImageId?: string
}

export function hashOf(payload: unknown): HashString {
  const digest = contentHash(JSON.parse(JSON.stringify(payload)) as never)
  if (!digest.ok) {
    throw new Error(digest.error.message)
  }
  return digest.value
}

export interface EvidenceIds {
  metricId: HashString
  traceId: HashString
  logId: HashString
  deploymentId: HashString
  flagFailureId: HashString
  flagUnreachableId: HashString
  codeLocationId: HashString
  baselineId: HashString
  items: EvidenceItem[]
}

/** Build the Evidence Set from the real recorded rows. */
export function buildEvidence(incidentId: string, facts: CaptureFacts): EvidenceIds {
  const now = new Date().toISOString()
  const freshUntil = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()

  const metricSnapshot = {
    value: facts.firingRatio,
    unit: "1",
    threshold: 0.2,
    total_calls_per_second: facts.firingCallsPerSecond,
  }
  const metricIdentity = {
    metric_name: "traces_span_metrics_calls_total",
    metric_labels: { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
    window: { starts_at: facts.windowStart, ends_at: null },
    service_name: "payment",
    deployment_environment_name: "demo",
  }
  const metricId = evidenceItemId({
    schema_version: "1.0" as const,
    kind: "metric",
    identity: metricIdentity,
    content: metricSnapshot,
  })
  if (!metricId.ok) throw new Error(metricId.error.message)
  const metric: EvidenceItem = {
    id: metricId.value,
    kind: "metric",
    backend: "prometheus",
    identity: metricIdentity,
    query:
      'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)',
    snapshot: metricSnapshot,
    content_hash: hashOf(metricSnapshot),
    links: [
      {
        uri: "http://localhost:9090/graph?g0.expr=sum(rate(traces_span_metrics_calls_total%7Bservice_name%3D%22payment%22%2Cstatus_code%3D%22STATUS_CODE_ERROR%22%7D%5B2m%5D))",
      },
    ],
    observed_at: now,
    window: { starts_at: facts.windowStart, ends_at: null },
    fresh_until: freshUntil,
    provenance: ["collector -> gateway -> prometheus -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const traceIdValue = facts.traceId ?? `exemplar-trace-${facts.seed.toLowerCase()}`
  const spanIdValue = facts.spanId ?? "span-charge"
  const traceSnapshot = {
    status: "ERROR",
    "demo.payment.card_valid": true,
    "demo.payment.card_type": "visa",
    "service.name": "payment",
    "service.version": facts.seededImageId,
  }
  const traceIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "trace",
    identity: { trace_id: traceIdValue, span_id: spanIdValue },
    content: traceSnapshot,
  })
  if (!traceIdItem.ok) throw new Error(traceIdItem.error.message)
  const trace: EvidenceItem = {
    id: traceIdItem.value,
    kind: "trace",
    backend: "jaeger",
    identity: { trace_id: traceIdValue, span_id: spanIdValue },
    query: "span in status ERROR under checkout.chargeCard",
    snapshot: traceSnapshot,
    content_hash: hashOf(traceSnapshot),
    links: [{ uri: `http://localhost:8080/jaeger/ui/trace/${traceIdValue}` }],
    observed_at: now,
    fresh_until: freshUntil,
    provenance: ["collector -> gateway -> jaeger -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
      code_function_name: "charge",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const logSnapshot = {
    level: "error",
    msg: facts.logLine,
    trace_id: traceIdValue,
    span_id: spanIdValue,
    "service.name": "payment",
  }
  const logIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "log",
    identity: { trace_id: traceIdValue, span_id: spanIdValue },
    content: logSnapshot,
  })
  if (!logIdItem.ok) throw new Error(logIdItem.error.message)
  const log: EvidenceItem = {
    id: logIdItem.value,
    kind: "log",
    backend: "opensearch",
    identity: { trace_id: traceIdValue, span_id: spanIdValue },
    query: 'service.name:payment AND "cannot process"',
    snapshot: logSnapshot,
    content_hash: hashOf(logSnapshot),
    links: [
      { uri: "http://localhost:8080/grafana/explore?left=%7B%22query%22%3A%22service.name%3Apayment%20AND%20cannot%20process%22%7D" },
    ],
    observed_at: now,
    fresh_until: freshUntil,
    provenance: ["collector -> gateway -> opensearch -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const deploymentSnapshot = {
    commit: facts.seed,
    diff_hash: facts.seedDiffHash,
    before_version: facts.baselineImageId,
    after_version: facts.seededImageId,
  }
  const deploymentIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "deployment-event",
    identity: {
      before_version: facts.baselineImageId,
      after_version: facts.seededImageId,
      diff_hash: facts.seedDiffHash,
      applied_at: facts.seedAppliedAt,
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: deploymentSnapshot,
  })
  if (!deploymentIdItem.ok) throw new Error(deploymentIdItem.error.message)
  const deployment: EvidenceItem = {
    id: deploymentIdItem.value,
    kind: "deployment-event",
    backend: "git",
    identity: {
      before_version: facts.baselineImageId,
      after_version: facts.seededImageId,
      diff_hash: facts.seedDiffHash,
      applied_at: facts.seedAppliedAt,
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    snapshot: deploymentSnapshot,
    content_hash: hashOf(deploymentSnapshot),
    links: [{ uri: `https://git.local/demo-repo/commit/${facts.seed}` }],
    observed_at: facts.seedAppliedAt,
    fresh_until: freshUntil,
    provenance: ["git adapter -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const flagFailureIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "metric",
    identity: {
      metric_name: "feature_flag_value",
      metric_labels: { flag_key: "paymentFailure" },
      window: { starts_at: facts.windowStart, ends_at: null },
      flag_key: "paymentFailure",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: { paymentFailure: facts.paymentFailure },
  })
  if (!flagFailureIdItem.ok) throw new Error(flagFailureIdItem.error.message)
  const flagFailure: EvidenceItem = {
    id: flagFailureIdItem.value,
    kind: "metric",
    backend: "flagd",
    identity: {
      metric_name: "feature_flag_value",
      metric_labels: { flag_key: "paymentFailure" },
      window: { starts_at: facts.windowStart, ends_at: null },
      flag_key: "paymentFailure",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    snapshot: { paymentFailure: facts.paymentFailure },
    content_hash: hashOf({ paymentFailure: facts.paymentFailure }),
    links: [{ uri: "http://localhost:8013/flags/paymentFailure" }],
    observed_at: now,
    fresh_until: freshUntil,
    provenance: ["flagd -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const flagUnreachableIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "metric",
    identity: {
      metric_name: "feature_flag_value",
      metric_labels: { flag_key: "paymentUnreachable" },
      window: { starts_at: facts.windowStart, ends_at: null },
      flag_key: "paymentUnreachable",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: { paymentUnreachable: facts.paymentUnreachable },
  })
  if (!flagUnreachableIdItem.ok) throw new Error(flagUnreachableIdItem.error.message)
  const flagUnreachable: EvidenceItem = {
    id: flagUnreachableIdItem.value,
    kind: "metric",
    backend: "flagd",
    identity: {
      metric_name: "feature_flag_value",
      metric_labels: { flag_key: "paymentUnreachable" },
      window: { starts_at: facts.windowStart, ends_at: null },
      flag_key: "paymentUnreachable",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    snapshot: { paymentUnreachable: facts.paymentUnreachable },
    content_hash: hashOf({ paymentUnreachable: facts.paymentUnreachable }),
    links: [{ uri: "http://localhost:8013/flags/paymentUnreachable" }],
    observed_at: now,
    fresh_until: freshUntil,
    provenance: ["flagd -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.seededImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const codeSnapshot = {
    match: "cannot process",
    occurrences: 1,
    file: "src/payment/card.js",
    line: 12,
    function: "validateCard",
  }
  const codeIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "code-location",
    identity: {
      commit: facts.seed,
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
      code_function_name: "validateCard",
    },
    content: codeSnapshot,
  })
  if (!codeIdItem.ok) throw new Error(codeIdItem.error.message)
  const codeLocation: EvidenceItem = {
    id: codeIdItem.value,
    kind: "code-location",
    backend: "git",
    identity: {
      commit: facts.seed,
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
      code_function_name: "validateCard",
    },
    query: "grep: 'cannot process' in src/payment",
    snapshot: codeSnapshot,
    content_hash: hashOf(codeSnapshot),
    links: [{ uri: `https://git.local/demo-repo/blob/${facts.seed}/src/payment/card.js#L12` }],
    observed_at: now,
    fresh_until: freshUntil,
    provenance: ["git adapter -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      deployment_environment_name: "demo",
      tenant_id: "demo",
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
      code_function_name: "validateCard",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  const baselineSnapshot = {
    value: facts.baselineRatio,
    unit: "1",
    total_calls_per_second: facts.baselineCallsPerSecond,
    coverage_verified: true,
    backend_health: "healthy",
  }
  const baselineIdItem = evidenceItemId({
    schema_version: "1.0",
    kind: "metric",
    identity: {
      metric_name: "traces_span_metrics_calls_total",
      metric_labels: { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
      window: { starts_at: facts.windowStart, ends_at: facts.seedAppliedAt },
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: baselineSnapshot,
  })
  if (!baselineIdItem.ok) throw new Error(baselineIdItem.error.message)
  const baseline: EvidenceItem = {
    id: baselineIdItem.value,
    kind: "metric",
    backend: "prometheus",
    identity: {
      metric_name: "traces_span_metrics_calls_total",
      metric_labels: { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
      window: { starts_at: facts.windowStart, ends_at: facts.seedAppliedAt },
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    query:
      'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)',
    snapshot: baselineSnapshot,
    content_hash: hashOf(baselineSnapshot),
    links: [],
    observed_at: facts.seedAppliedAt,
    window: { starts_at: facts.windowStart, ends_at: facts.seedAppliedAt },
    fresh_until: freshUntil,
    provenance: ["collector -> gateway -> prometheus -> read-broker"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: facts.baselineImageId,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  return {
    metricId: metricId.value,
    traceId: traceIdItem.value,
    logId: logIdItem.value,
    deploymentId: deploymentIdItem.value,
    flagFailureId: flagFailureIdItem.value,
    flagUnreachableId: flagUnreachableIdItem.value,
    codeLocationId: codeIdItem.value,
    baselineId: baselineIdItem.value,
    items: [metric, trace, log, deployment, flagFailure, flagUnreachable, codeLocation, baseline],
  }
}

/** The four settled Hypotheses with the real cited items. */
export function buildHypotheses(
  incidentId: string,
  runId: string,
  ids: EvidenceIds,
  facts: CaptureFacts,
): { h1: Hypothesis; h2: Hypothesis; h3: Hypothesis; h4: Hypothesis } {
  const base = {
    schema_version: "1.0" as const,
    incident_id: incidentId,
    incident_run_id: runId,
    attempt: 1,
    round: 1,
    affected_scope: {
      service_names: ["payment"],
      deployment_environment_names: ["demo"],
      versions: [facts.seededImageId],
      window: { starts_at: facts.windowStart, ends_at: null as string | null },
    },
  }

  const h1: Hypothesis = {
    ...base,
    id: "H1",
    causal_claim: {
      trigger: `card-type clause inverted in seed commit ${facts.seed}`,
      defect: "src/payment/card.js validateCard card-type check drops its negation",
      propagation: [
        {
          from: `${facts.seed} commit applied`,
          to: "every valid Visa/MasterCard charge fails",
          cited_item_ids: [ids.deploymentId, ids.metricId],
        },
        {
          from: "error span with card_valid=true",
          to: "card-type rejection in validateCard",
          cited_item_ids: [ids.traceId, ids.codeLocationId, ids.logId],
        },
      ],
      failure: `payment error ratio ${facts.firingRatio.toFixed(2)} above the 0.20 threshold`,
    },
    predicted_observations: [
      {
        id: "P1",
        statement: "on seeded code, the valid Visa case fails because the card-type clause is inverted",
        discriminates: ["H2", "H3", "H4"],
        registered_at: facts.windowStart,
      },
    ],
    evidence: {
      supporting: [ids.metricId, ids.traceId, ids.logId, ids.deploymentId, ids.codeLocationId],
      opposing: [],
      unexplained: [],
    },
    alternatives: ["H2", "H3", "H4"],
    proposed_tests: [
      {
        id: "test-1",
        procedure: "node --test src/payment/card.unit.test.js",
        bounds: "pure unit suite; no OpenFeature, flagd, or OTel SDK",
        permissions: ["request_isolated_ci"],
        expected: { this_hypothesis: "valid Visa rejected on seeded code; accepted after the fix" },
      },
    ],
    status: "accepted",
  }

  const h2: Hypothesis = {
    ...base,
    id: "H2",
    causal_claim: {
      trigger: "paymentFailure flag enabled",
      defect: "flagd paymentFailure routes the charge handler to its failure path",
      propagation: [
        { from: "flag evaluation", to: "Invalid token error", cited_item_ids: [] },
      ],
      failure: "payment error ratio above threshold",
    },
    predicted_observations: [
      {
        id: "pred-h2-1",
        statement: "failing spans carry demo.user_context.loyalty_level=gold",
        registered_at: facts.windowStart,
      },
    ],
    evidence: {
      supporting: [],
      opposing: [ids.flagFailureId, ids.traceId],
      unexplained: [ids.metricId],
    },
    alternatives: ["H1", "H3", "H4"],
    proposed_tests: [
      {
        id: "test-h2",
        procedure: "read the flagd OFREP evaluation receipt",
        bounds: "flagd state for payment",
        permissions: ["read"],
        expected: { this_hypothesis: "paymentFailure = 1", alternative_id: "H1" },
      },
    ],
    status: "rejected",
  }

  const h3: Hypothesis = {
    ...base,
    id: "H3",
    causal_claim: {
      trigger: "upstream payment-provider or card-network outage",
      defect: "charge fails at a provider boundary outside the Payment service",
      propagation: [
        { from: "outbound provider call", to: "charge error", cited_item_ids: [] },
      ],
      failure: "payment error ratio above threshold",
    },
    predicted_observations: [
      {
        id: "pred-h3-1",
        statement: "a provider span precedes the error span",
        registered_at: facts.windowStart,
      },
    ],
    evidence: {
      supporting: [],
      opposing: [ids.traceId],
      unexplained: [ids.metricId],
    },
    alternatives: ["H1", "H2", "H4"],
    proposed_tests: [
      {
        id: "test-h3",
        procedure: "inspect the exemplar trace for outbound spans",
        bounds: "trace topology",
        permissions: ["read"],
        expected: { this_hypothesis: "provider span present", alternative_id: "H1" },
      },
    ],
    status: "rejected",
  }

  const h4: Hypothesis = {
    ...base,
    id: "H4",
    causal_claim: {
      trigger: "checkout sends malformed card data or paymentUnreachable routes checkout to a bad address",
      defect: "invalid card attributes or unreachable payment endpoint",
      propagation: [
        { from: "checkout chargeCard", to: "codes.Internal", cited_item_ids: [] },
      ],
      failure: "payment error ratio above threshold",
    },
    predicted_observations: [
      {
        id: "pred-h4-1",
        statement: "charge spans carry invalid card attributes",
        registered_at: facts.windowStart,
      },
    ],
    evidence: {
      supporting: [],
      opposing: [ids.flagUnreachableId, ids.traceId, ids.baselineId],
      unexplained: [ids.metricId],
    },
    alternatives: ["H1", "H2", "H3"],
    proposed_tests: [
      {
        id: "test-h4",
        procedure: "read the paymentUnreachable flag receipt and the pre-seed baseline",
        bounds: "flagd state and baseline window",
        permissions: ["read"],
        expected: { this_hypothesis: "paymentUnreachable = true", alternative_id: "H1" },
      },
    ],
    status: "rejected",
  }

  return { h1, h2, h3, h4 }
}

/** The deterministic stub Model Provider for the Fusion round. */
export function structuredProvider(
  incidentId: string,
  runId: string,
  revisionId: string,
  hypotheses: { h1: Hypothesis; h2: Hypothesis; h3: Hypothesis; h4: Hypothesis },
): ModelProvider {
  const { h1, h2, h3, h4 } = hypotheses
  return {
    async complete(model, prompt) {
      const now = new Date().toISOString()
      let text: string
      if (model.startsWith("stub-participant")) {
        const isFirst = model === "stub-participant-1"
        text = JSON.stringify({
          schema_version: "1.0",
          participant_id: isFirst ? "fusion-participant-p1" : "fusion-participant-p2",
          revision_id: revisionId,
          hypotheses: [
            { ...h1, status: "proposed" },
            { ...h2, status: "proposed" },
            { ...h3, status: "proposed" },
            { ...h4, status: "proposed" },
          ],
          stated_objections: isFirst
            ? [
                { statement: "the flagd receipt reads paymentFailure=0; H2 cannot explain the error text", hypothesis_id: "H2", cited_item_ids: h2.evidence.opposing },
                { statement: "the exemplar trace shows the throw inside the Payment service", hypothesis_id: "H3", cited_item_ids: h3.evidence.opposing },
              ]
            : [
                { statement: "paymentUnreachable=false and the pre-seed baseline is near zero", hypothesis_id: "H4", cited_item_ids: h4.evidence.opposing },
              ],
          completed_at: now,
        })
      } else if (model === "stub-judge") {
        text = JSON.stringify({
          schema_version: "1.0",
          judge_id: "fusion-judge-j1",
          revision_id: revisionId,
          agreements: [
            { statement: "both participants rank the card-type regression first", hypothesis_ids: ["H1"], cited_item_ids: h1.evidence.supporting.slice(0, 2) },
          ],
          contradictions: [],
          blind_spots: [
            { statement: "no participant proposed re-reading the flagd receipt before ranking H2", hypothesis_ids: ["H2"], cited_item_ids: h2.evidence.opposing },
          ],
          unique_findings: [
            { statement: "p1 noted the error text matches card.js's card-type clause only", hypothesis_ids: ["H1"], cited_item_ids: h1.evidence.supporting.slice(3, 5) },
          ],
          citation_audit: [
            { participant_id: "fusion-participant-p1", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
            { participant_id: "fusion-participant-p2", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
          ],
          completed_at: now,
        })
      } else {
        text = JSON.stringify({
          schema_version: "1.0",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: revisionId,
          ranked_hypotheses: [
            { rank: 1, hypothesis: { ...h1, status: "accepted" } },
            { rank: 2, hypothesis: { ...h2, status: "rejected" } },
            { rank: 3, hypothesis: { ...h3, status: "rejected" } },
            { rank: 4, hypothesis: { ...h4, status: "rejected" } },
          ],
          contradictions: [],
          gaps: [],
          next_actions: [
            {
              procedure: "node --test src/payment/card.unit.test.js",
              bounds: "pure unit suite; no OpenFeature, flagd, or OTel SDK",
              permissions: ["request_isolated_ci"],
              discriminates: ["H1", "H2", "H3", "H4"],
            },
          ],
          fusion_meta: {
            participant_ids: ["fusion-participant-p1", "fusion-participant-p2"],
            judge_id: "fusion-judge-j1",
            synthesizer_id: "fusion-synthesizer-s1",
            revision_id: revisionId,
            started_at: now,
            completed_at: now,
          },
          completed_at: now,
        })
      }
      return {
        text,
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
      }
    },
  }
}

/** The deterministic Repair planner draft (parsed by driveRepair). */
export function plannerDraftText(ids: EvidenceIds): string {
  return JSON.stringify({
    changeDescription: "restore the negation in card.js's validateCard card-type clause",
    citations: [
      {
        change: "card-type clause negation restored",
        cited_item_ids: [
          ids.metricId,
          ids.traceId,
          ids.logId,
          ids.deploymentId,
          ids.codeLocationId,
        ],
      },
    ],
    testPlan: [
      "node --test src/payment/card.unit.test.js",
      "node --test src/payment/payment.regression.test.js",
    ],
    changedSurfaces: ["src/payment/card.js"],
    blastRadius: { services: ["payment"], environments: ["demo"], cohorts: [] },
    recoveryPointDraft: {
      id: "recovery-point-card-type",
      changed_surfaces: ["src/payment/card.js", "compose service payment (restart via docker compose up -d payment)"],
    },
  })
}

/** The deterministic Repair implementer diff (the settled one-line fix). */
export function implementerDiffText(): string {
  return DIFF_TEXT
}

/** The settled Review Reports for one candidate. */
export function buildReviewReports(options: {
  incidentId: string
  runId: string
  candidateHash: HashString
  seed: "S1" | "S2"
  recoveryPointHash: HashString
  diffHash: HashString
  baseRef: HashString
  metricId: HashString
  r1Major: boolean
}): ReviewReport[] {
  const now = new Date().toISOString()
  const reports: ReviewReport[] = []
  for (const [role, row] of Object.entries(REVIEW_ROLES)) {
    const isR1 = role === "R1"
    const findings: ReviewReport["findings"] = isR1
      ? options.r1Major
        ? [
            {
              id: "r1-f1",
              severity: "major",
              claim:
                "restoring the card-type check makes the adjacent missing Luhn guard reachable, so invalid Visa numbers can now pass",
              citations: [
                { kind: "file-line", file: "src/payment/card.js", line: 12, ref: options.diffHash },
                { kind: "file-line", file: "src/payment/card.js", line: 9, ref: options.baseRef },
              ],
              status: "open",
            },
          ]
        : [
            {
              id: "r1-f1",
              severity: "minor",
              claim: "restores the intended card-type gate and adds no unrelated edit",
              citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: options.diffHash }],
              status: "open",
            },
          ]
      : role === "R2"
        ? [
            {
              id: "r2-f1",
              severity: "info",
              claim:
                options.r1Major
                  ? "the citation map covers only the accepted card-type causal chain and contains no unsupported Luhn change"
                  : "every change maps to H1's causal chain through the citation map",
              citations: [{ kind: "evidence-item", ref: options.metricId }],
              status: "open",
            },
          ]
        : role === "R8"
          ? [
              {
                id: "r8-f1",
                severity: "info",
                claim:
                  "the Recovery Point names every changed surface and an exact restore command with preconditions and timeout",
                citations: [{ kind: "recovery-point-gap", ref: options.recoveryPointHash }],
                status: "open",
              },
            ]
          : [
              {
                id: `${role.toLowerCase()}-f1`,
                severity: "info",
                claim:
                  role === "R4"
                    ? "the one-line change narrows card acceptance; no new attack surface"
                    : "no defects found in the one-line candidate",
                citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: options.diffHash }],
                status: "open",
              },
            ]
    reports.push({
      schema_version: "1.0",
      incident_id: options.incidentId,
      run_id: options.runId,
      attempt: 1,
      candidate_hash: options.candidateHash,
      role: role as ReviewReport["role"],
      reviewer: row.reviewer,
      revision: 1,
      input_refs: [options.diffHash, options.baseRef],
      findings,
      status: isR1 && options.r1Major ? "fail" : "pass",
      sealed_at: now,
    })
  }
  return reports
}

/** The settled Test Reports for one candidate, bound to the real run receipts. */
export function buildTestReports(options: {
  incidentId: string
  runId: string
  candidateHash: HashString
  run2: boolean
  t5Selection: string
  runsByLayer?: Record<string, Array<{ run_hash: string; result: "pass" | "fail" | "error"; at: string; detail?: string }>>
}): TestReport[] {
  const now = new Date().toISOString()
  const reports: TestReport[] = []
  for (const [layer, row] of Object.entries(TEST_TOOLS)) {
    const receiptRef =
      layer === "T1" ? RECEIPT_IDS.t1
      : layer === "T2" ? RECEIPT_IDS.t2
      : layer === "T3" ? RECEIPT_IDS.t3
      : layer === "T4" ? RECEIPT_IDS.t4
      : layer === "T5" ? RECEIPT_IDS.t5
      : layer === "T7" ? RECEIPT_IDS.t7
      : layer === "T9" ? RECEIPT_IDS.t9
      : layer === "T10" ? RECEIPT_IDS.t10
      : layer === "T12" ? RECEIPT_IDS.t12
      : RECEIPT_IDS.t13
    const runs = options.runsByLayer?.[layer] ?? [
      {
        run_hash: hashOf(`${receiptRef}-run`),
        result: layer === "T5" && options.run2 ? ("fail" as const) : ("pass" as const),
        at: now,
        ...(layer === "T5" && options.run2 ? { detail: "Luhn-failing Visa is rejected" } : {}),
      },
    ]
    const outcome =
      runs.length === 0 ? ("not-run" as const)
      : runs.some((run) => run.result === "fail")
        ? ("fail" as const)
        : ("pass" as const)
    reports.push({
      schema_version: "1.0",
      incident_id: options.incidentId,
      run_id: options.runId,
      attempt: 1,
      candidate_hash: options.candidateHash,
      layer: layer as TestReport["layer"],
      tool: row.tool,
      tool_version: row.tool_version,
      target: layer === "T5" ? options.t5Selection : row.target,
      receipt_ref: receiptRef,
      runs,
      outcome,
      flaky: false,
      coverage_checked: true,
      sealed_at: now,
    })
  }
  return reports
}

/** The frozen Watch plan payload (schema rollout-watch-plan). */
export function rolloutWatchPlanPayload(options: {
  incidentId: string
  runId: string
  candidateHash: HashString
  policyVersion: string
  t13ReceiptId: string
  expectedVersion: string
}): Record<string, unknown> {
  return {
    schema_version: "1.0",
    incident_id: options.incidentId,
    run_id: options.runId,
    attempt: 1,
    candidate_hash: options.candidateHash,
    rollout: {
      strategy: "ring",
      stages: [
        {
          id: "stage-1-candidate-probe",
          traffic_percent: 0,
          minimum_duration_seconds: 30,
          minimum_sample_count: 20,
        },
        {
          id: "stage-2-service-swap",
          traffic_percent: 100,
          minimum_duration_seconds: 30,
          minimum_sample_count: 60,
        },
      ],
    },
    watch_queries: [
      {
        id: "G1",
        signal: WATCH_GATES.G1.signal,
        backend: WATCH_GATES.G1.backend,
        query: WATCH_GATES.G1.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G1.floor,
        comparator: "greater-than-or-equal",
        limit: WATCH_GATES.G1.limit,
      },
      {
        id: "G2",
        signal: WATCH_GATES.G2.signal,
        backend: WATCH_GATES.G2.backend,
        query: WATCH_GATES.G2.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G2.floor,
        comparator: "less-than",
        limit: WATCH_GATES.G2.limit,
        unit: "1",
      },
      {
        id: "G3",
        signal: WATCH_GATES.G3.signal,
        backend: WATCH_GATES.G3.backend,
        query: WATCH_GATES.G3.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G3.floor,
        comparator: "less-than",
        limit: WATCH_GATES.G3.limit,
        unit: "s",
      },
      {
        id: "G4",
        signal: WATCH_GATES.G4.signal,
        backend: WATCH_GATES.G4.backend,
        query: WATCH_GATES.G4.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G4.floor,
        comparator: "greater-than-or-equal",
        limit: WATCH_GATES.G4.limit,
      },
      {
        id: "G5",
        signal: WATCH_GATES.G5.signal,
        backend: WATCH_GATES.G5.backend,
        query: WATCH_GATES.G5.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G5.floor,
        comparator: "less-than",
        limit: WATCH_GATES.G5.limit,
        unit: "1",
      },
      {
        id: "G6",
        signal: WATCH_GATES.G6.signal,
        backend: WATCH_GATES.G6.backend,
        query: WATCH_GATES.G6.query,
        window_seconds: 30,
        minimum_sample_count: WATCH_GATES.G6.floor,
        comparator: "less-than",
        limit: WATCH_GATES.G6.limit,
        unit: "1",
      },
    ],
    stop_rules: [
      {
        id: "severe-regression-stop-rule",
        condition:
          "crash loop or readiness loss, live error ratio above 0.5, a new security finding, or a business-invariant breach",
        action: "rollback",
      },
    ],
    missing_data_rule: "needs-human",
    rehearsal_receipt_refs: [options.t13ReceiptId],
    policy_version: options.policyVersion,
    sealed_at: new Date().toISOString(),
  }
}

/** A Watch Report sample row (schema watch-report). */
export function watchSample(spec: {
  gate: "G1" | "G2" | "G3" | "G4" | "G5" | "G6"
  query: string
  timeRange: { starts_at: string; ends_at: string }
  sampleCount: number
  value: number
  limit: number
  outcome: "pass" | "fail"
  baselineCohort?: string
  candidateCohort?: string
}): Record<string, unknown> {
  return {
    gate: spec.gate,
    query: spec.query,
    time_range: spec.timeRange,
    sample_count: spec.sampleCount,
    value: spec.value,
    limit: spec.limit,
    outcome: spec.outcome,
    ...(spec.baselineCohort === undefined ? {} : { baseline_cohort: spec.baselineCohort }),
    ...(spec.candidateCohort === undefined ? {} : { candidate_cohort: spec.candidateCohort }),
  }
}

/** The candidate-cohort queries used by the probe ring and the T13 rehearsal. */
export function candidateCohortQuery(gate: "G2" | "G3" | "G4"): string {
  if (gate === "G2") {
    return `sum(rate(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}"}[2m])), 0.001)`
  }
  if (gate === "G3") {
    return `histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="${CANDIDATE_SERVICE_NAME}"}[2m])) by (le))`
  }
  return `sum(increase(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}"}[30s]))`
}
