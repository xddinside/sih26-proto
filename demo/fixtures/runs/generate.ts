/**
 * Deterministic generator for the richer saved-run bundle in
 * `demo/fixtures/runs/`, the replay source for the Incident Workspace panels
 * (issue #17).
 *
 * This bundle extends the settled fixture data in `demo/fixtures/contracts/
 * valid/` with the full panel evidence the two saved Demo Runs carry, from
 * docs/research/demo-runs.md and docs/research/incident-workspace.md:
 *
 * - Run 1 (`inc-demo-payment-1`): verified-remediation. Firing trigger with
 *   recorded ratio 0.92 above the 0.20 threshold; intake delivery history with
 *   a dedup no-op; Evidence Set revision 1 (trace-log join, flagd receipts,
 *   S1 deployment event and diff receipt, code-location grep receipt,
 *   pre-seed baseline); two Fusion participant outputs, Judge output, and
 *   Synthesizer output; Diagnosis Report with H1 accepted and H2/H3/H4
 *   rejected item by item; the eight-check Hypothesis gate; the one-line
 *   Remediation with citation map and PR-shaped action receipt; R1–R4 and R8
 *   Review Reports; T1–T5, T7, T9, T10, T12, T13 Test Reports with receipts;
 *   Verification Report pass with hash binding; the Release Gate's eight facts
 *   under scheduled-hybrid policy with one recorded operator approval; the
 *   frozen Watch plan; stage-1 probe ring 20/20 across three windows; stage-2
 *   service swap with G1–G6 across three windows; the confirmation-window
 *   Watch Report; the resolved trigger; run `completed: verified-remediation`;
 *   Incident `resolved`, then `closed` (`symptom-cleared`).
 * - Run 2 (`inc-demo-payment-2`): verification-failed. The same Incident and
 *   accepted Hypothesis from seed `S2`; the same one-line candidate; R1 cites
 *   a `major` reachability finding on the missing Luhn guard; T5's receipt
 *   fails "Luhn-failing Visa is rejected" bound to the candidate hash; the
 *   Verification Report verdict is `fail`; the failed evidence joins the
 *   Evidence Set as revision 2; no Release record, no production Watch Report,
 *   nothing ships; the Incident stays `open` with 2 attempts remaining.
 *
 * The generator builds every file, then re-verifies the whole bundle through
 * the same `verifySavedBundle` the replay adapter uses. It writes nothing
 * unless the verification passes. The settled outcomes and hashes are
 * deterministic: rerunning reproduces the same bytes.
 *
 * Run with `bun run demo/fixtures/runs/generate.ts` from the repo root.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  candidateHash,
  contentHash,
  deliveryKey,
  evidenceItemId,
  incidentKey,
  sha256Hex,
} from "../../../packages/contracts/src/hashes.js"
import { verifySavedBundle } from "../../../packages/contracts/src/saved-bundle.js"
import type { ArtifactEnvelope } from "../../../packages/contracts/src/schemas/artifact-envelope.js"
import type { EvidenceItem, EvidenceSet } from "../../../packages/contracts/src/schemas/evidence.js"
import type { JournalEvent } from "../../../packages/contracts/src/schemas/journal-event.js"
import type { SavedBundleManifest } from "../../../packages/contracts/src/schemas/saved-bundle-manifest.js"
import type { JsonValue } from "../../../packages/contracts/src/result.js"

const CAPTURE_TIME = "2026-08-16T12:00:00Z"
const EVAL_TIME = "2026-08-16T12:00:00Z"
const FRESH_UNTIL = "2026-09-01T00:00:00Z"
const TZDB = "2026a"
const POLICY_HYBRID = "policy-hybrid-v1"
const POLICY_AUTONOMOUS = "policy-autonomous-v1"

/** The one-line diff both candidates share (seed S1 and seed S2). */
const DIFF_TEXT = "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {"

const hex = (s: string) => sha256Hex(s)
const hashOf = (s: string) => `sha256:${hex(s)}`

function contentHashOf(payload: unknown): string {
  const result = contentHash(payload as JsonValue)
  if (!result.ok) {
    throw new Error(`cannot hash payload: ${result.error.message}`)
  }
  return result.value
}

const ACTOR_CP = { id: "cp-1", kind: "control-plane" } as const
const ACTOR_HUMAN = {
  id: "demo-operator",
  kind: "human",
  credential_scope: "demo-workspace",
} as const

// ---------------------------------------------------------------------------
// Hashes and evidence
// ---------------------------------------------------------------------------

function incidentKeyOf(): string {
  const result = incidentKey({
    schema_version: "1.0",
    tenant_id: "demo",
    deployment_environment_name: "demo",
    service_name: "payment",
    detector_key: "payment-error-rate",
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function deliveryKeyOf(status: "firing" | "resolved"): string {
  const result = deliveryKey({
    schema_version: "1.0",
    source: "prometheus-alertmanager",
    alert_fingerprint: "fingerprint-payment-error-rate",
    status,
    starts_at: "2026-08-15T15:33:00Z",
    ends_at: status === "firing" ? null : "2026-08-15T16:30:00Z",
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

interface EvidenceIds {
  metricId: string
  traceId: string
  logId: string
  deploymentId: string
  flagFailureId: string
  flagUnreachableId: string
  codeLocationId: string
  baselineId: string
  failedT5Id: string
  revisionId: string
  items: EvidenceItem[]
}

const WINDOW_FIRING = {
  starts_at: "2026-08-15T15:30:00Z",
  ends_at: "2026-08-15T15:36:00Z",
} as const

function metricItem(
  snapshot: JsonValue,
  metricName: string,
  labels: Record<string, string>,
  window: { starts_at: string; ends_at: string | null },
  extra: Record<string, unknown>,
  maskSecret: boolean,
): { id: string; item: EvidenceItem } {
  const identity = {
    metric_name: metricName,
    metric_labels: labels,
    window,
    service_name: "payment",
    deployment_environment_name: "demo",
    ...extra,
  }
  const result = evidenceItemId({
    schema_version: "1.0",
    kind: "metric",
    identity,
    content: snapshot,
  })
  if (!result.ok) throw new Error(result.error.message)
  return {
    id: result.value,
    item: {
      id: result.value,
      kind: "metric",
      backend: "prometheus",
      identity,
      query:
        'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)',
      snapshot,
      content_hash: contentHashOf(snapshot),
      links: [
        {
          uri: "http://localhost:9090/graph?g0.expr=sum(rate(traces_span_metrics_calls_total%7Bservice_name%3D%22payment%22%2Cstatus_code%3D%22STATUS_CODE_ERROR%22%7D%5B2m%5D))",
        },
      ],
      observed_at: "2026-08-15T15:35:20Z",
      window,
      fresh_until: FRESH_UNTIL,
      provenance: ["collector -> gateway -> prometheus -> read-broker-receipt-rb-metric"],
      trust: "backend",
      joins: {
        service_name: "payment",
        service_version: "seeded-digest",
        deployment_environment_name: "demo",
        tenant_id: "demo",
      },
      redaction: {
        profile_id: "demo-profile",
        masked_fields: maskSecret ? ["/snapshot/secret"] : [],
      },
      outcome: "ok",
    },
  }
}

function buildEvidence(incidentId: string, seed: "S1" | "S2", candidate: string): EvidenceIds {
  const seededVersion = seed === "S1" ? "seeded-digest" : "seeded-s2-digest"

  // 1. Metric: the detector breach (recorded ratio above the 0.20 threshold).
  const breach = metricItem(
    { value: 0.92, unit: "1", threshold: 0.2, total_calls_per_second: 0.6, secret: "[REDACTED]" },
    "traces_span_metrics_calls_total",
    { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
    WINDOW_FIRING,
    {},
    true,
  )

  // 2. Trace: the exemplar charge span in status ERROR with valid card attributes.
  const traceSnapshot: JsonValue = {
    status: "ERROR",
    "demo.payment.card_valid": true,
    "demo.payment.card_type": "visa",
    "service.name": "payment",
    "service.version": seededVersion,
  }
  const traceResult = evidenceItemId({
    schema_version: "1.0",
    kind: "trace",
    identity: { trace_id: "trace-payment-exemplar-1", span_id: "span-charge-1" },
    content: traceSnapshot,
  })
  if (!traceResult.ok) throw new Error(traceResult.error.message)
  const traceId = traceResult.value
  const traceItem: EvidenceItem = {
    id: traceId,
    kind: "trace",
    backend: "jaeger",
    identity: { trace_id: "trace-payment-exemplar-1", span_id: "span-charge-1" },
    query: "span in status ERROR under checkout.chargeCard",
    snapshot: traceSnapshot,
    content_hash: contentHashOf(traceSnapshot),
    links: [{ uri: "http://localhost:8080/jaeger/ui/trace/trace-payment-exemplar-1" }],
    observed_at: "2026-08-15T15:35:20Z",
    fresh_until: FRESH_UNTIL,
    provenance: ["collector -> gateway -> jaeger -> read-broker-receipt-rb-trace"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: seededVersion,
      deployment_environment_name: "demo",
      tenant_id: "demo",
      code_function_name: "charge",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  // 3. Log: the pino error line joined to the trace by trace_id and span_id.
  const logSnapshot: JsonValue = {
    level: "error",
    msg: "Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted.",
    trace_id: "trace-payment-exemplar-1",
    span_id: "span-charge-1",
    "service.name": "payment",
  }
  const logResult = evidenceItemId({
    schema_version: "1.0",
    kind: "log",
    identity: { trace_id: "trace-payment-exemplar-1", span_id: "span-charge-1" },
    content: logSnapshot,
  })
  if (!logResult.ok) throw new Error(logResult.error.message)
  const logId = logResult.value
  const logItem: EvidenceItem = {
    id: logId,
    kind: "log",
    backend: "opensearch",
    identity: { trace_id: "trace-payment-exemplar-1", span_id: "span-charge-1" },
    query: 'service.name:payment AND trace_id:"trace-payment-exemplar-1"',
    snapshot: logSnapshot,
    content_hash: contentHashOf(logSnapshot),
    links: [
      {
        uri: "http://localhost:8080/grafana/explore?left=%7B%22query%22%3A%22service.name%3Apayment%20AND%20trace_id%3A%5C%22trace-payment-exemplar-1%5C%22%22%7D",
      },
    ],
    observed_at: "2026-08-15T15:35:30Z",
    fresh_until: FRESH_UNTIL,
    provenance: ["collector -> gateway -> opensearch -> read-broker-receipt-rb-log"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: seededVersion,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  // 4. Deployment event: the seeded commit S1/S2 with its diff receipt.
  const diffHash = hashOf(`${seed}-diff-receipt`)
  const deploymentSnapshot: JsonValue = {
    commit: seed,
    diff_hash: diffHash,
    before_version: "pristine-digest",
    after_version: seededVersion,
  }
  const deploymentResult = evidenceItemId({
    schema_version: "1.0",
    kind: "deployment-event",
    identity: {
      commit: seed,
      diff_hash: diffHash,
      before_version: "pristine-digest",
      after_version: seededVersion,
      applied_at: "2026-08-15T15:00:00Z",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: deploymentSnapshot,
  })
  if (!deploymentResult.ok) throw new Error(deploymentResult.error.message)
  const deploymentId = deploymentResult.value
  const deploymentItem: EvidenceItem = {
    id: deploymentId,
    kind: "deployment-event",
    backend: "git",
    identity: {
      commit: seed,
      diff_hash: diffHash,
      before_version: "pristine-digest",
      after_version: seededVersion,
      applied_at: "2026-08-15T15:00:00Z",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    snapshot: deploymentSnapshot,
    content_hash: contentHashOf(deploymentSnapshot),
    links: [{ uri: `https://git.local/demo-repo/commit/${seed}` }],
    observed_at: "2026-08-15T15:36:00Z",
    fresh_until: FRESH_UNTIL,
    provenance: ["git adapter -> read-broker-receipt-rb-deploy"],
    trust: "backend",
    joins: {
      service_name: "payment",
      service_version: seededVersion,
      deployment_environment_name: "demo",
      tenant_id: "demo",
    },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }

  // 5. Flagd receipt: paymentFailure is off.
  const flagFailure = metricItem(
    { paymentFailure: 0 },
    "feature_flag_value",
    { flag_key: "paymentFailure", service_name: "payment" },
    WINDOW_FIRING,
    { flag_key: "paymentFailure" },
    false,
  )
  flagFailure.item.backend = "flagd"
  flagFailure.item.links = [{ uri: "http://localhost:8013/flags/paymentFailure" }]
  flagFailure.item.provenance = ["flagd -> read-broker-receipt-rb-flag-failure"]

  // 6. Flagd receipt: paymentUnreachable is false.
  const flagUnreachable = metricItem(
    { paymentUnreachable: false },
    "feature_flag_value",
    { flag_key: "paymentUnreachable", service_name: "payment" },
    WINDOW_FIRING,
    { flag_key: "paymentUnreachable" },
    false,
  )
  flagUnreachable.item.backend = "flagd"
  flagUnreachable.item.links = [{ uri: "http://localhost:8013/flags/paymentUnreachable" }]
  flagUnreachable.item.provenance = ["flagd -> read-broker-receipt-rb-flag-unreachable"]

  // 7. Code location: the grep receipt showing the error string occurs only in
  //    card.js's card-type clause.
  const codeSnapshot: JsonValue = {
    match: "cannot process",
    occurrences: 1,
    file: "src/payment/card.js",
    line: 12,
  }
  const codeResult = evidenceItemId({
    schema_version: "1.0",
    kind: "code-location",
    identity: {
      commit: seed,
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
      code_function_name: "validateCard",
    },
    content: codeSnapshot,
  })
  if (!codeResult.ok) throw new Error(codeResult.error.message)
  const codeLocationId = codeResult.value
  const codeLocationItem: EvidenceItem = {
    id: codeLocationId,
    kind: "code-location",
    backend: "git",
    identity: {
      commit: seed,
      code_file_path: "src/payment/card.js",
      code_line_number: 12,
      code_function_name: "validateCard",
    },
    query: "grep: 'cannot process' in src/payment",
    snapshot: codeSnapshot,
    content_hash: contentHashOf(codeSnapshot),
    links: [{ uri: `https://git.local/demo-repo/blob/${seed}/src/payment/card.js#L12` }],
    observed_at: "2026-08-15T15:38:00Z",
    fresh_until: FRESH_UNTIL,
    provenance: ["git adapter -> read-broker-receipt-rb-grep"],
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

  // 8. Pre-seed baseline: near-zero error ratio under identical traffic, with
  //    a verified coverage record.
  const baseline = metricItem(
    { value: 0.003, unit: "1", coverage_verified: true, backend_health: "healthy" },
    "traces_span_metrics_calls_total",
    { service_name: "payment", status_code: "STATUS_CODE_ERROR" },
    { starts_at: "2026-08-15T14:00:00Z", ends_at: "2026-08-15T14:30:00Z" },
    {},
    false,
  )

  // 9. Run 2 only: the failed T5 evidence that joins the Evidence Set.
  const failedSnapshot: JsonValue = {
    case: "Luhn-failing Visa is rejected",
    result: "fail",
    assertion: "invalid Visa rejected",
    candidate_hash: candidate,
  }
  const failedResult = evidenceItemId({
    schema_version: "1.0",
    kind: "test-result",
    identity: {
      hypothesis_id: "H1",
      prediction_id: "pred-t5",
      receipt_ref: "receipt-t5",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    content: failedSnapshot,
  })
  if (!failedResult.ok) throw new Error(failedResult.error.message)
  const failedT5Id = failedResult.value

  const items = [
    breach.item,
    traceItem,
    logItem,
    deploymentItem,
    flagFailure.item,
    flagUnreachable.item,
    codeLocationItem,
    baseline.item,
  ]
  const revisionId = hashOf(`${incidentId}-evidence-revision-1`)

  return {
    metricId: breach.id,
    traceId,
    logId,
    deploymentId,
    flagFailureId: flagFailure.id,
    flagUnreachableId: flagUnreachable.id,
    codeLocationId,
    baselineId: baseline.id,
    failedT5Id,
    revisionId,
    items,
  }
}

// ---------------------------------------------------------------------------
// Artifact sealing
// ---------------------------------------------------------------------------

interface EnvelopeSpec {
  artifact_schema_id: string
  incident_id: string
  run_id: string
  sealed_at: string
  producer: Record<string, string>
  redaction?: { profile_id: string; masked_fields: string[] }
  provenance?: string[]
  payload: unknown
}

interface SealedEnvelope {
  envelope: ArtifactEnvelope
  fileName: string
  bytes: string
}

function seal(spec: EnvelopeSpec): SealedEnvelope {
  const content = contentHashOf(spec.payload)
  const envelope: ArtifactEnvelope = {
    schema_version: "1.0",
    artifact_schema_id: spec.artifact_schema_id,
    artifact_schema_version: "1.0",
    content_hash: content,
    sealed_at: spec.sealed_at,
    incident_id: spec.incident_id,
    run_id: spec.run_id,
    producer: spec.producer,
    ...(spec.redaction !== undefined ? { redaction: spec.redaction } : {}),
    ...(spec.provenance !== undefined ? { provenance: spec.provenance } : {}),
    payload: spec.payload as JsonValue,
  }
  const bytes = JSON.stringify(envelope)
  return {
    envelope,
    fileName: `${content.slice("sha256:".length)}.json`,
    bytes,
  }
}

// ---------------------------------------------------------------------------
// Event building
// ---------------------------------------------------------------------------

interface EventSpec {
  time: string
  actor: { id: string; kind: string; credential_scope?: string }
  policy: string
}

class EventBuilder {
  events: JournalEvent[] = []
  seq = 0

  push(
    type: string,
    idem: string,
    spec: EventSpec,
    rest: Record<string, unknown>,
  ): JournalEvent {
    this.seq += 1
    const event = {
      type,
      sequence: this.seq,
      idempotency_key: idem,
      recorded_at: spec.time,
      actor: spec.actor,
      policy_version: spec.policy,
      ...rest,
    } as unknown as JournalEvent
    this.events.push(event)
    return event
  }
}

function stage(
  builder: EventBuilder,
  incidentId: string,
  runId: string,
  spec: EventSpec,
  stageName: string,
  from: string | null,
  to: string,
  extra: Record<string, unknown> = {},
): void {
  builder.push(
    "stage_transition",
    `stage-${stageName}-${from ?? "null"}-${to}`,
    spec,
    { incident_id: incidentId, run_id: runId, attempt: 1, stage: stageName, from, to, ...extra },
  )
}

function testReceipt(
  incidentId: string,
  runId: string,
  spec: EventSpec,
  candidate: string,
  layer: string,
  receiptId: string,
  tool: string,
  toolVersion: string,
  target: string,
  result: "pass" | "fail",
  detail: string | undefined,
  at: string,
): Record<string, unknown> {
  return {
    incident_id: incidentId,
    run_id: runId,
    stage: "verify",
    receipt: {
      kind: "test",
      receipt_id: receiptId,
      idempotency_key: `test-${receiptId}`,
      lease_id: "lease-run-1",
      stage: "verify",
      candidate_hash: candidate,
      layer,
      tool,
      tool_version: toolVersion,
      target,
      runs: [{ run_hash: hashOf(`${receiptId}-run`), result, at, ...(detail !== undefined ? { detail } : {}) }],
      outcome: result,
      flaky: false,
    },
  }
}

// ---------------------------------------------------------------------------
// Shared stage content
// ---------------------------------------------------------------------------

function hypothesisObjects(incidentId: string, runId: string, evidence: EvidenceIds, seed: string) {
  const seededVersion = seed === "S1" ? "seeded-digest" : "seeded-s2-digest"
  const base = {
    schema_version: "1.0",
    incident_id: incidentId,
    incident_run_id: runId,
    attempt: 1,
    round: 1,
    affected_scope: {
      service_names: ["payment"],
      deployment_environment_names: ["demo"],
      versions: [seededVersion],
      window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null },
    },
  } as const

  const h1 = {
    ...base,
    id: "H1",
    causal_claim: {
      trigger: `card-type clause inverted in seed commit ${seed}`,
      defect: "src/payment/card.js validateCard card-type check drops its negation",
      propagation: [
        {
          from: `${seed} commit applied`,
          to: "every valid Visa/MasterCard charge fails",
          cited_item_ids: [evidence.deploymentId, evidence.metricId],
        },
      ],
      failure: "payment error ratio 0.92 above the 0.20 threshold",
    },
    predicted_observations: [
      {
        id: "pred-1",
        statement: "on seeded code, the valid Visa case fails because the card-type clause is inverted",
        discriminates: ["H2", "H3", "H4"],
        registered_at: "2026-08-15T15:44:00Z",
      },
    ],
    evidence: {
      supporting: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.codeLocationId],
      opposing: [],
      unexplained: [],
    },
    alternatives: ["H2", "H3", "H4"],
    proposed_tests: [
      {
        id: "test-1",
        procedure: "node --test src/payment/card.unit.test.js",
        bounds: "pure unit suite; no OpenFeature, flagd, or OTel SDK",
        permissions: ["read"],
        expected: { this_hypothesis: "valid Visa rejected on seeded code; accepted after the fix" },
      },
    ],
    status: "accepted",
  } as const

  const h2 = {
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
        registered_at: "2026-08-15T15:44:00Z",
      },
    ],
    evidence: {
      supporting: [],
      opposing: [evidence.flagFailureId, evidence.traceId],
      unexplained: [evidence.metricId],
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
  } as const

  const h3 = {
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
        registered_at: "2026-08-15T15:44:00Z",
      },
    ],
    evidence: {
      supporting: [],
      opposing: [evidence.traceId],
      unexplained: [evidence.metricId],
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
  } as const

  const h4 = {
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
        registered_at: "2026-08-15T15:44:00Z",
      },
    ],
    evidence: {
      supporting: [],
      opposing: [evidence.flagUnreachableId, evidence.traceId, evidence.baselineId],
      unexplained: [evidence.metricId],
    },
    alternatives: ["H1", "H2", "H3"],
    proposed_tests: [
      {
        id: "test-h4",
        procedure: "read paymentUnreachable flag receipt and the pre-seed baseline",
        bounds: "flagd state and baseline window",
        permissions: ["read"],
        expected: { this_hypothesis: "paymentUnreachable = true", alternative_id: "H1" },
      },
    ],
    status: "rejected",
  } as const

  return { h1, h2, h3, h4 }
}

function hypothesisGateEval(evidence: EvidenceIds): unknown {
  return {
    gate: "hypothesis",
    hypothesis_id: "H1",
    checks: [
      {
        check: "cited-coverage",
        result: true,
        counts: { unexplained_critical_items: 0 },
        cited_item_ids: [evidence.metricId, evidence.traceId],
        reason: "every critical item in the trigger window is cited by an edge",
      },
      {
        check: "causal-edge-support",
        result: true,
        counts: { unsupported_edges: 0 },
        cited_item_ids: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.codeLocationId],
        reason: "trace-metric, trace-log, signal-code, and code-deploy joins all resolve",
      },
      {
        check: "contradiction-handling",
        result: true,
        counts: { unresolved_contradictions: 0 },
        cited_item_ids: [],
        reason: "no fresh item of equal or higher trust contradicts a supporting item",
      },
      {
        check: "alternative-elimination",
        result: true,
        counts: { undiscriminated_material_alternatives: 0 },
        cited_item_ids: [evidence.flagFailureId, evidence.traceId, evidence.flagUnreachableId, evidence.baselineId],
        reason: "H2, H3, and H4 eliminated item by item",
      },
      {
        check: "reproducible-test",
        result: true,
        counts: { executed_tests: 1, passed_tests: 1 },
        cited_item_ids: [],
        reason: "pre-registered card.unit.test.js predictions matched the observed seeded behavior",
      },
      {
        check: "scope-match",
        result: true,
        counts: {},
        cited_item_ids: [evidence.metricId],
        reason: "H1 covers payment in demo only; no uncited breadth",
      },
      {
        check: "freshness",
        result: true,
        counts: { stale_items: 0 },
        cited_item_ids: [],
        reason: "all supporting items collected inside the policy window",
      },
      {
        check: "telemetry-coverage",
        result: true,
        counts: {},
        cited_item_ids: [evidence.baselineId],
        reason: "the baseline item carries a verified coverage record",
      },
    ],
    verdict: "pass",
    evaluated_at: "2026-08-15T15:45:00Z",
    policy_version: POLICY_HYBRID,
  }
}

interface ApplyTestRow {
  layer: string
  skill: string
  tool: string
  toolVersion: string
  target: string
  receiptId: string
}

/** The applicability resolution shared by both Code-class candidates. */
const APPLICABILITY = {
  resolver_version: "1.0",
  required: ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
  conditional: ["R5", "R6", "R7", "R9", "T6", "T8", "T9", "T10", "T11", "T12", "T13"],
  triggered: {
    T9: "the candidate target always exists in the Demo Profile",
    T10: "the charge path is the storefront checkout path",
    T12: "the Recovery Point names a restore action",
    T13: "the candidate carries a Watch plan and a rehearsable environment",
  },
  not_applicable: ["R5", "R6", "R7", "R9", "T6", "T8", "T11"],
} as const

const TEST_ROWS: readonly ApplyTestRow[] = [
  { layer: "T1", skill: "sih-test-static-analysis", tool: "eslint", toolVersion: "9.39.5", target: "src/payment", receiptId: "receipt-t1" },
  { layer: "T2", skill: "sih-test-build", tool: "docker build", toolVersion: "27.0", target: "payment production target", receiptId: "receipt-t2" },
  { layer: "T3", skill: "sih-test-unit", tool: "node --test", toolVersion: "26.4.0", target: "src/payment/card.unit.test.js", receiptId: "receipt-t3" },
  { layer: "T4", skill: "sih-test-contract", tool: "grpc contract check", toolVersion: "1.2", target: "payment charge contract", receiptId: "receipt-t4" },
  { layer: "T5", skill: "sih-test-regression", tool: "node --test", toolVersion: "26.4.0", target: "src/payment/payment.regression.test.js", receiptId: "receipt-t5" },
  { layer: "T7", skill: "sih-test-security-scan", tool: "osv-scanner + gitleaks", toolVersion: "2.0.1", target: "payment image", receiptId: "receipt-t7" },
  { layer: "T9", skill: "sih-test-isolated-env", tool: "compose candidate deploy + probe", toolVersion: "1.0", target: "candidate payment container", receiptId: "receipt-t9" },
  { layer: "T10", skill: "sih-test-browser", tool: "playwright", toolVersion: "1.54", target: "storefront checkout", receiptId: "receipt-t10" },
  { layer: "T12", skill: "sih-test-fault-recovery", tool: "compose restore drill", toolVersion: "1.0", target: "isolated candidate environment", receiptId: "receipt-t12" },
  { layer: "T13", skill: "sih-test-watch-rehearsal", tool: "watch-plan rehearsal", toolVersion: "1.0", target: "frozen Watch queries", receiptId: "receipt-t13" },
] as const

const REVIEW_ROWS = [
  { role: "R1", skill: "sih-review-correctness", reviewer: "reviewer-r1" },
  { role: "R2", skill: "sih-review-causal-fit", reviewer: "reviewer-r2" },
  { role: "R3", skill: "sih-review-code-quality", reviewer: "reviewer-r3" },
  { role: "R4", skill: "sih-review-security", reviewer: "reviewer-r4" },
  { role: "R8", skill: "sih-review-recovery-point", reviewer: "reviewer-r8" },
] as const

// ---------------------------------------------------------------------------
// Run builders
// ---------------------------------------------------------------------------

interface BuildRun {
  incidentId: string
  finalSequence: number
  events: JournalEvent[]
  envelopes: SealedEnvelope[]
}

function buildRun1(): BuildRun {
  const incidentId = "inc-demo-payment-1"
  const runId = "run-1"
  const spec: EventSpec = { time: "2026-08-15T15:00:00Z", actor: ACTOR_CP, policy: POLICY_HYBRID }
  const envelopes: SealedEnvelope[] = []
  const sealRef = (sealed: SealedEnvelope) => {
    envelopes.push(sealed)
    return sealed
  }

  const recoveryPoint = {
    surfaces: ["src/payment/card.js", "compose service payment"],
    prior_compose_project_file_hash: hashOf("compose-project-file"),
    prior_image_digest: hashOf("image-seeded-digest"),
    prior_service_version: "seeded-digest",
    prior_environment_and_flag_files: ["src/flagd/demo.flagd.json"],
    service_definition: "compose service payment",
    restore_command: "docker compose up -d payment",
    preconditions: ["restored project file hash matches the recorded hash", "flagd defaults restored"],
    timeout_seconds: 120,
    retention_window: "demo rollback window",
    allowed_identities: ["demo-operator"],
  }
  const recoveryPointHash = contentHashOf(recoveryPoint)

  const candidateResult = candidateHash({
    schema_version: "1.0",
    base_ref: hashOf("base-snapshot-s1"),
    change: {
      kind: "diff",
      base_ref: hashOf("base-snapshot-s1"),
      diff_text: DIFF_TEXT,
    },
    proposal: { remediation_class: "code", disposition: "allowed" },
    changed_surfaces: ["src/payment/card.js"],
    action_risk_class: "safe",
    gate_path: "release",
    target: {
      tenant_id: "demo",
      deployment_environment_name: "demo",
      service_name: "payment",
      expected_version: "seeded-digest",
    },
    recovery_point_hash: recoveryPointHash,
  })
  if (!candidateResult.ok) throw new Error(candidateResult.error.message)
  const candidate = candidateResult.value

  const evidence = buildEvidence(incidentId, "S1", candidate)
  const builder = new EventBuilder()

  // Detect.
  const firingTrigger = {
    schema_version: "1.0",
    trigger_id: "trig-inc-demo-payment-1",
    delivery_key: deliveryKeyOf("firing"),
    incident_key: incidentKeyOf(),
    received_at: "2026-08-15T15:35:20Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "git:abc123",
      source_fingerprint: "fingerprint-payment-error-rate",
    },
    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [
      {
        kind: "metric-query",
        backend: "prometheus",
        uri: "http://localhost:9090/graph?g0.expr=sum(rate(traces_span_metrics_calls_total%7Bservice_name%3D%22payment%22%2Cstatus_code%3D%22STATUS_CODE_ERROR%22%7D%5B2m%5D))",
        query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m]))',
        observed_at: "2026-08-15T15:35:00Z",
      },
      {
        kind: "trace",
        backend: "jaeger",
        uri: "http://localhost:8080/jaeger/ui/trace/trace-payment-exemplar-1",
        trace_id: "trace-payment-exemplar-1",
        observed_at: "2026-08-15T15:35:10Z",
      },
      {
        kind: "log-query",
        backend: "opensearch",
        uri: "http://localhost:8080/grafana/explore?left=%7B%22query%22%3A%22service.name%3Apayment%20AND%20trace_id%3A%5C%22trace-payment-exemplar-1%5C%22%22%7D",
        query: 'service.name:payment AND trace_id:"trace-payment-exemplar-1"',
        observed_at: "2026-08-15T15:35:20Z",
      },
    ],
  }

  builder.push("trigger_received", "trig-1", { ...spec, time: "2026-08-15T15:35:25Z" }, { incident_id: incidentId, trigger: firingTrigger, delivery_result: "incident-created" })
  builder.push("incident_transition", "inc-t-1", { ...spec, time: "2026-08-15T15:35:26Z" }, { incident_id: incidentId, from: null, to: "open", expected_version: 0 })
  // Delivery history: a replayed webhook with the same delivery key is a dedup no-op.
  builder.push("trigger_received", "trig-1-dup", { ...spec, time: "2026-08-15T15:36:00Z" }, { incident_id: incidentId, trigger: firingTrigger, delivery_result: "duplicate-noop" })
  builder.push("run_transition", "run-t-1", { ...spec, time: "2026-08-15T15:36:31Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: null, to: "queued", expected_run_version: 0 })
  builder.push("lease_event", "lease-run", { ...spec, time: "2026-08-15T15:36:31Z" }, { incident_id: incidentId, run_id: runId, lease_id: "lease-run-1", lease_kind: "run", action: "issued" })
  builder.push("run_transition", "run-t-2", { ...spec, time: "2026-08-15T15:36:32Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: "queued", to: "running", expected_run_version: 1 })

  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:36:40Z" }, "detect", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:37:00Z" }, "detect", "entered", "in-progress")

  const brief = sealRef(
    seal({
      artifact_schema_id: "incident-brief",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:42:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        severity: "critical",
        scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
        symptom: "every charge fails on the card-type check",
        initial_evidence_item_ids: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.flagFailureId, evidence.flagUnreachableId, evidence.codeLocationId, evidence.baselineId],
        policy_version: POLICY_HYBRID,
        sealed_at: "2026-08-15T15:42:00Z",
      },
    }),
  )
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:05Z" }, "detect", "in-progress", "completed", {
    artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash },
  })
  builder.push("artifact_sealed", "art-brief", { ...spec, time: "2026-08-15T15:42:06Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } })

  // Diagnose: pinned Evidence Set revision, two participants, Judge, Synthesizer.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:10Z" }, "diagnose", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:20Z" }, "diagnose", "entered", "in-progress")

  const evidenceSet: EvidenceSet = {
    schema_version: "1.0",
    revision_id: evidence.revisionId,
    revision_number: 1,
    incident_id: incidentId,
    pinned_at: "2026-08-15T15:40:00Z",
    item_ids: evidence.items.map((item) => item.id),
    items: evidence.items,
  }
  const evidenceSetEnvelope = sealRef(
    seal({
      artifact_schema_id: "evidence-set",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:41:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      redaction: { profile_id: "demo-profile", masked_fields: ["/items/0/snapshot/secret"] },
      payload: evidenceSet,
    }),
  )

  const { h1, h2, h3, h4 } = hypothesisObjects(incidentId, runId, evidence, "S1")
  const proposed = (h: object, status: string) => ({ ...h, status })

  const participantP1 = sealRef(
    seal({
      artifact_schema_id: "fusion-participant-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:44:30Z",
      producer: { skill: "sih-fusion-participant", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        participant_id: "fusion-participant-p1",
        revision_id: evidence.revisionId,
        hypotheses: [proposed(h1, "proposed"), proposed(h2, "proposed"), proposed(h3, "proposed"), proposed(h4, "proposed")],
        stated_objections: [
          { statement: "the flagd receipt reads paymentFailure=0; H2 cannot explain the error text", hypothesis_id: "H2", cited_item_ids: [evidence.flagFailureId] },
          { statement: "the exemplar trace shows the throw inside the Payment service", hypothesis_id: "H3", cited_item_ids: [evidence.traceId] },
        ],
        completed_at: "2026-08-15T15:44:30Z",
      },
    }),
  )

  const participantP2 = sealRef(
    seal({
      artifact_schema_id: "fusion-participant-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:44:30Z",
      producer: { skill: "sih-fusion-participant", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        participant_id: "fusion-participant-p2",
        revision_id: evidence.revisionId,
        hypotheses: [proposed(h1, "proposed"), proposed(h2, "proposed"), proposed(h3, "proposed"), proposed(h4, "proposed")],
        stated_objections: [
          { statement: "paymentUnreachable=false and the pre-seed baseline is near zero", hypothesis_id: "H4", cited_item_ids: [evidence.flagUnreachableId, evidence.baselineId] },
        ],
        completed_at: "2026-08-15T15:44:30Z",
      },
    }),
  )

  const judge = sealRef(
    seal({
      artifact_schema_id: "fusion-judge-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:45:00Z",
      producer: { skill: "sih-fusion-judge", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        judge_id: "fusion-judge-j1",
        revision_id: evidence.revisionId,
        agreements: [
          { statement: "both participants rank the card-type regression in S1 first", hypothesis_ids: ["H1"], cited_item_ids: [evidence.deploymentId, evidence.metricId] },
        ],
        contradictions: [],
        blind_spots: [
          { statement: "no participant proposed re-reading the flagd receipt before ranking H2", hypothesis_ids: ["H2"], cited_item_ids: [evidence.flagFailureId] },
        ],
        unique_findings: [
          { statement: "p1 noted the error text matches card.js's card-type clause only", hypothesis_ids: ["H1"], cited_item_ids: [evidence.codeLocationId] },
        ],
        citation_audit: [
          { participant_id: "fusion-participant-p1", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
          { participant_id: "fusion-participant-p2", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
        ],
        completed_at: "2026-08-15T15:45:00Z",
      },
    }),
  )

  const synthesizer = sealRef(
    seal({
      artifact_schema_id: "fusion-synthesizer-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:45:30Z",
      producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        synthesizer_id: "fusion-synthesizer-s1",
        revision_id: evidence.revisionId,
        ranked_hypotheses: [
          { rank: 1, hypothesis: proposed(h1, "accepted") },
          { rank: 2, hypothesis: proposed(h2, "rejected") },
          { rank: 3, hypothesis: proposed(h3, "rejected") },
          { rank: 4, hypothesis: proposed(h4, "rejected") },
        ],
        contradictions: [],
        gaps: [],
        next_actions: [
          {
            procedure: "run the pre-registered discriminating suite node --test src/payment/card.unit.test.js",
            bounds: "pure unit suite; no OpenFeature, flagd, or OTel SDK",
            permissions: ["read"],
            discriminates: ["H1", "H2", "H3", "H4"],
          },
        ],
        fusion_meta: {
          participant_ids: ["fusion-participant-p1", "fusion-participant-p2"],
          judge_id: "fusion-judge-j1",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: evidence.revisionId,
          started_at: "2026-08-15T15:43:00Z",
          completed_at: "2026-08-15T15:45:30Z",
        },
        completed_at: "2026-08-15T15:45:30Z",
      },
    }),
  )

  const diagnosis = sealRef(
    seal({
      artifact_schema_id: "diagnosis-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:46:00Z",
      producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        hypotheses: [h1, h2, h3, h4],
        contradictions: [],
        gaps: [],
        next_actions: [
          {
            procedure: "node --test src/payment/card.unit.test.js",
            bounds: "pure unit suite",
            permissions: ["read"],
            discriminates: ["H1", "H2", "H3", "H4"],
          },
        ],
        fusion_meta: {
          participant_ids: ["fusion-participant-p1", "fusion-participant-p2"],
          judge_id: "fusion-judge-j1",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: evidence.revisionId,
          rounds: [{ round: 1, valid: true, participant_ids: ["fusion-participant-p1", "fusion-participant-p2"] }],
        },
        remediation_disposition: "allowed",
        sealed_at: "2026-08-15T15:46:00Z",
      },
    }),
  )

  builder.push("artifact_sealed", "art-evidence", { ...spec, time: "2026-08-15T15:41:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "evidence-set", schema_version: "1.0", content_hash: evidenceSetEnvelope.envelope.content_hash } })
  builder.push("artifact_sealed", "art-p1", { ...spec, time: "2026-08-15T15:44:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-participant-output", schema_version: "1.0", content_hash: participantP1.envelope.content_hash } })
  builder.push("artifact_sealed", "art-p2", { ...spec, time: "2026-08-15T15:44:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-participant-output", schema_version: "1.0", content_hash: participantP2.envelope.content_hash } })
  builder.push("artifact_sealed", "art-judge", { ...spec, time: "2026-08-15T15:45:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-judge-output", schema_version: "1.0", content_hash: judge.envelope.content_hash } })
  builder.push("artifact_sealed", "art-synth", { ...spec, time: "2026-08-15T15:45:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-synthesizer-output", schema_version: "1.0", content_hash: synthesizer.envelope.content_hash } })
  builder.push("model_use", "model-p1", { ...spec, time: "2026-08-15T15:44:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-participant-p1", agent_role: "participant", model: "primary-model", prompt_ref: hashOf("prompt-p1"), token_use: { prompt_tokens: 1800, completion_tokens: 700 }, tool_calls: [] })
  builder.push("model_use", "model-p2", { ...spec, time: "2026-08-15T15:44:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-participant-p2", agent_role: "participant", model: "primary-model", prompt_ref: hashOf("prompt-p2"), token_use: { prompt_tokens: 1800, completion_tokens: 650 }, tool_calls: [] })
  builder.push("model_use", "model-judge", { ...spec, time: "2026-08-15T15:45:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-judge-j1", agent_role: "judge", model: "primary-model", prompt_ref: hashOf("prompt-judge"), token_use: { prompt_tokens: 2400, completion_tokens: 500 }, tool_calls: [] })
  builder.push("model_use", "model-synth", { ...spec, time: "2026-08-15T15:45:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-synthesizer-s1", agent_role: "synthesizer", model: "primary-model", prompt_ref: hashOf("prompt-synth"), token_use: { prompt_tokens: 3000, completion_tokens: 800 }, tool_calls: [] })
  builder.push("gate_evaluated", "gate-hyp", { ...spec, time: "2026-08-15T15:46:30Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, gate: "hypothesis", evaluation: hypothesisGateEval(evidence) })
  builder.push("artifact_sealed", "art-diagnosis", { ...spec, time: "2026-08-15T15:46:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:46:40Z" }, "diagnose", "in-progress", "completed", {
    artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash },
  })

  // Repair: the one-line Remediation, citation map, PR-shaped record.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:46:45Z" }, "repair", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:47:00Z" }, "repair", "entered", "in-progress")

  const proposal = sealRef(
    seal({
      artifact_schema_id: "remediation-proposal",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:50:00Z",
      producer: { skill: "sih-repair-planner", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        candidate_hash: candidate,
        remediation_class: "code",
        action_risk_class: "safe",
        gate_path: "release",
        disposition: "allowed",
        change_description: "restore the negation in card.js's validateCard card-type clause",
        diff: {
          base_ref: hashOf("base-snapshot-s1"),
          diff_text: DIFF_TEXT,
          diff_hash: hashOf("diff-s1"),
        },
        citations: [
          {
            change: "card-type clause negation restored",
            hypothesis_id: "H1",
            cited_item_ids: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.codeLocationId],
          },
        ],
        test_plan: ["card.unit.test.js", "payment.regression.test.js"],
        changed_surfaces: ["src/payment/card.js"],
        blast_radius: { services: ["payment"], environments: ["demo"], cohorts: [] },
        recovery_point: { id: recoveryPointHash, changed_surfaces: ["src/payment/card.js", "compose service payment"] },
        sealed_at: "2026-08-15T15:50:00Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-proposal", { ...spec, time: "2026-08-15T15:50:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } })
  builder.push("broker_receipt_recorded", "receipt-pr", { ...spec, time: "2026-08-15T15:51:00Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "repair",
    receipt: {
      kind: "action",
      receipt_id: "receipt-pr",
      idempotency_key: "pr-submit-1",
      lease_id: "lease-run-1",
      stage: "repair",
      candidate_hash: candidate,
      action: { adapter: "source-host-adapter", action_class: "submit_remediation_pr", command: "create branch remediate/incident-inc-demo-payment-1 with the one-line card.js patch" },
      target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-digest" },
      permit_id: "permit-pr-1",
      outcome: "ok",
      executed_at: "2026-08-15T15:51:00Z",
    },
  })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:51:05Z" }, "repair", "in-progress", "completed", {
    candidate_hash: candidate,
    artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash },
  })

  // Verify: receipts, Review Reports, Test Reports, Verification Report.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:52:00Z" }, "verify", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:53:00Z" }, "verify", "entered", "in-progress")

  const testArtifacts: SealedEnvelope[] = []
  for (const row of TEST_ROWS) {
    const at = row.layer === "T5" ? "2026-08-15T16:12:00Z" : row.layer === "T3" ? "2026-08-15T16:10:00Z" : "2026-08-15T16:05:00Z"
    if (row.layer === "T12") {
      builder.push("broker_receipt_recorded", row.receiptId, { ...spec, time: at }, {
        incident_id: incidentId,
        run_id: runId,
        stage: "verify",
        receipt: {
          kind: "action",
          receipt_id: row.receiptId,
          idempotency_key: `test-${row.receiptId}`,
          lease_id: "lease-run-1",
          stage: "verify",
          candidate_hash: candidate,
          action: { adapter: "compose-release-adapter", action_class: "restore-drill", command: "docker compose up -d payment (preconditions: project file hash match, flag defaults; timeout 120s)" },
          target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-digest" },
          permit_id: `permit-${row.receiptId}`,
          outcome: "ok",
          executed_at: at,
        },
      })
    } else {
      builder.push("broker_receipt_recorded", row.receiptId, { ...spec, time: at }, testReceipt(incidentId, runId, spec, candidate, row.layer, row.receiptId, row.tool, row.toolVersion, row.target, "pass", undefined, at))
    }
    const sealed = sealRef(
      seal({
        artifact_schema_id: "test-report",
        incident_id: incidentId,
        run_id: runId,
        sealed_at: at,
        producer: { skill: row.skill, skill_version: "1.0" },
        payload: {
          schema_version: "1.0",
          incident_id: incidentId,
          run_id: runId,
          attempt: 1,
          candidate_hash: candidate,
          layer: row.layer,
          tool: row.tool,
          tool_version: row.toolVersion,
          target: row.target,
          receipt_ref: row.receiptId,
          runs: [{ run_hash: hashOf(`${row.receiptId}-run`), result: "pass", at }],
          outcome: "pass",
          flaky: false,
          coverage_checked: true,
          sealed_at: at,
        },
      }),
    )
    testArtifacts.push(sealed)
  }

  const reviewArtifacts: SealedEnvelope[] = []
  for (const row of REVIEW_ROWS) {
    const findings = row.role === "R1"
      ? [
          {
            id: "r1-f1",
            severity: "minor",
            claim: "restores the intended card-type gate and adds no unrelated edit",
            citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: hashOf("diff-s1") }],
            status: "open",
          },
        ]
      : row.role === "R2"
        ? [
            {
              id: "r2-f1",
              severity: "info",
              claim: "every change maps to H1's causal chain through the citation map",
              citations: [{ kind: "evidence-item", ref: evidence.metricId }],
              status: "open",
            },
          ]
        : row.role === "R8"
          ? [
              {
                id: "r8-f1",
                severity: "info",
                claim: "the Recovery Point names every changed surface and an exact restore command with preconditions and timeout",
                citations: [{ kind: "recovery-point-gap", ref: recoveryPointHash }],
                status: "open",
              },
            ]
          : [
              {
                id: `${row.role.toLowerCase()}-f1`,
                severity: "info",
                claim: row.role === "R4" ? "the one-line change narrows card acceptance; no new attack surface" : "no defects found in the one-line candidate",
                citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: hashOf("diff-s1") }],
                status: "open",
              },
            ]
    const sealed = sealRef(
      seal({
        artifact_schema_id: "review-report",
        incident_id: incidentId,
        run_id: runId,
        sealed_at: "2026-08-15T16:05:00Z",
        producer: { skill: row.skill, skill_version: "1.0" },
        payload: {
          schema_version: "1.0",
          incident_id: incidentId,
          run_id: runId,
          attempt: 1,
          candidate_hash: candidate,
          role: row.role,
          reviewer: row.reviewer,
          revision: 1,
          input_refs: [hashOf("diff-s1"), hashOf("base-snapshot-s1"), POLICY_HYBRID],
          findings,
          status: "pass",
          sealed_at: "2026-08-15T16:05:00Z",
        },
      }),
    )
    reviewArtifacts.push(sealed)
    builder.push("model_use", `model-${row.role.toLowerCase()}`, { ...spec, time: "2026-08-15T16:05:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: row.reviewer, agent_role: "reviewer", model: "primary-model", prompt_ref: hashOf(`prompt-${row.role}`), token_use: { prompt_tokens: 2200, completion_tokens: 400 }, tool_calls: [] })
  }

  const verification = sealRef(
    seal({
      artifact_schema_id: "verification-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:15:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0", resolver_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        candidate_hash: candidate,
        remediation_class: "code",
        action_risk_class: "safe",
        gate_path: "release",
        applicability: { ...APPLICABILITY, policy_version: POLICY_HYBRID },
        reviews: REVIEW_ROWS.map((row) => ({ role: row.role, reviewer: row.reviewer, revision: 1, status: "pass", sealed_at: "2026-08-15T16:05:00Z" })),
        tests: TEST_ROWS.map((row) => ({ layer: row.layer, tool: row.tool, tool_version: row.toolVersion, receipt_ref: row.receiptId, outcome: "pass", flaky: false })),
        hash_binding: { sealed_candidate: candidate, checked_candidate: candidate, match: true },
        verdict: "pass",
        verdict_reason: "all required and triggered checks passed against the sealed candidate hash",
        sealed_at: "2026-08-15T16:15:00Z",
        policy_version: POLICY_HYBRID,
      },
    }),
  )

  for (const sealed of reviewArtifacts) {
    builder.push("artifact_sealed", `art-review-${sealed.envelope.payload.role}`, { ...spec, time: "2026-08-15T16:05:10Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "review-report", schema_version: "1.0", content_hash: sealed.envelope.content_hash } })
  }
  for (const sealed of testArtifacts) {
    const layer = sealed.envelope.payload.layer
    builder.push("artifact_sealed", `art-test-${layer}`, { ...spec, time: "2026-08-15T16:12:30Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "test-report", schema_version: "1.0", content_hash: sealed.envelope.content_hash } })
  }
  builder.push("artifact_sealed", "art-verification", { ...spec, time: "2026-08-15T16:15:10Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:15:20Z" }, "verify", "in-progress", "completed", {
    artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash },
  })

  // Release: frozen Watch plan, scheduled-hybrid approval, eight gate facts.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:16:00Z" }, "release", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:17:00Z" }, "release", "entered", "in-progress")

  const rolloutWatchPlan = sealRef(
    seal({
      artifact_schema_id: "rollout-watch-plan",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:18:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        candidate_hash: candidate,
        rollout: {
          strategy: "ring",
          stages: [
            { id: "stage-1-candidate-probe", traffic_percent: 0, minimum_duration_seconds: 30, minimum_sample_count: 20 },
            { id: "stage-2-service-swap", traffic_percent: 100, minimum_duration_seconds: 30, minimum_sample_count: 60 },
          ],
        },
        watch_queries: [
          { id: "G1", signal: "deployment health", backend: "compose-adapter", query: "candidate or live container running; TCP/gRPC healthcheck SERVING; no crash loop", window_seconds: 30, minimum_sample_count: 1, comparator: "greater-than-or-equal", limit: 1 },
          { id: "G2", signal: "payment error ratio", backend: "prometheus", query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)', window_seconds: 30, minimum_sample_count: 60, comparator: "less-than", limit: 0.05, unit: "1" },
          { id: "G3", signal: "payment latency p95", backend: "prometheus", query: 'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))', window_seconds: 30, minimum_sample_count: 50, comparator: "less-than", limit: 0.5, unit: "s" },
          { id: "G4", signal: "telemetry arrival", backend: "prometheus", query: "span-metric counter increments for the watched version in the window; ruler freshness healthy", window_seconds: 30, minimum_sample_count: 1, comparator: "greater-than-or-equal", limit: 1 },
          { id: "G5", signal: "Incident symptom", backend: "prometheus", query: "same query as G2 against the recorded pre-release baseline", window_seconds: 30, minimum_sample_count: 60, comparator: "less-than", limit: 0.05, unit: "1" },
          { id: "G6", signal: "regression sentinels", backend: "compose-adapter", query: "no new error_type on payment spans; checkout error rate < 0.05; frontend-proxy 5xx rate < 0.05", window_seconds: 30, minimum_sample_count: 60, comparator: "less-than", limit: 0.05, unit: "1" },
        ],
        stop_rules: [
          { id: "severe-regression-stop-rule", condition: "crash loop or readiness loss, live error ratio above 0.5, a new security finding, or a business-invariant breach", action: "rollback" },
        ],
        missing_data_rule: "needs-human",
        rehearsal_receipt_refs: ["receipt-t13"],
        policy_version: POLICY_HYBRID,
        sealed_at: "2026-08-15T16:18:00Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-watch-plan", { ...spec, time: "2026-08-15T16:18:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "rollout-watch-plan", schema_version: "1.0", content_hash: rolloutWatchPlan.envelope.content_hash } })

  builder.push("policy_decision", "policy-1", { ...spec, time: "2026-08-15T16:20:00Z" }, {
    incident_id: incidentId,
    run_id: runId,
    decision: "approval-required",
    tzdb_version: TZDB,
    window: { iana_zone: "America/New_York", windows: [{ start_weekday: "mon", start_time: "09:00", end_weekday: "fri", end_time: "18:00" }] },
    evaluated_at: "2026-08-15T16:20:00Z",
    evaluated_local_time: "2026-08-15T12:20:00Z",
    reason: "scheduled hybrid: the deploy lands outside the autonomous window",
  })
  builder.push("human_action", "human-approve", { time: "2026-08-15T16:21:00Z", actor: ACTOR_HUMAN, policy: POLICY_HYBRID }, { incident_id: incidentId, run_id: runId, action: "approve", reason: "operator approved the queued hybrid-window deploy", approval_ref: "approval-1" })
  builder.push("approval_recorded", "approval-1", { ...spec, time: "2026-08-15T16:21:05Z" }, {
    incident_id: incidentId,
    run_id: runId,
    approval: {
      approval_id: "approval-1",
      action_digest: candidate,
      approver_identity: "demo-operator",
      approval_system: "demo-workspace",
      policy_version: POLICY_HYBRID,
      tzdb_version: TZDB,
      action_risk_class: "safe",
      expiry: "2026-08-15T16:50:00Z",
      scope: { target: "payment", changed_surfaces: ["src/payment/card.js"] },
      action: "granted",
    },
  })
  builder.push("broker_receipt_recorded", "receipt-ci", { ...spec, time: "2026-08-15T16:21:10Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "release",
    receipt: {
      kind: "ci",
      receipt_id: "receipt-ci",
      idempotency_key: "ci-release-1",
      lease_id: "lease-run-1",
      stage: "release",
      candidate_hash: candidate,
      pipeline: "demo-local-ci",
      pipeline_run_id: "pipeline-run-1",
      steps: [
        { name: "build", status: "success", log_ref: hashOf("ci-build-log") },
        { name: "unit", status: "success", log_ref: hashOf("ci-unit-log") },
        { name: "regression", status: "success", log_ref: hashOf("ci-regression-log") },
        { name: "security-scan", status: "success", log_ref: hashOf("ci-scan-log") },
        { name: "browser-check", status: "success", log_ref: hashOf("ci-browser-log") },
      ],
      status: "success",
      artifact_digest: hashOf("candidate-image-digest"),
      finished_at: "2026-08-15T16:21:10Z",
    },
  })
  builder.push("broker_receipt_recorded", "receipt-metric", { ...spec, time: "2026-08-15T16:21:30Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "release",
    receipt: {
      kind: "read",
      receipt_id: "receipt-metric",
      idempotency_key: "target-version-read-1",
      lease_id: "lease-run-1",
      stage: "release",
      candidate_hash: candidate,
      request: { backend: "compose-adapter", connection_id: "astronomy-shop-local", query: "payment service version", resource_type: "deployment-version" },
      result: { outcome: "ok", content_hash: hashOf("seeded-digest"), observed_at: "2026-08-15T16:21:30Z", row_count: 1 },
    },
  })

  const releaseGateEval = {
    gate: "release",
    candidate_hash: candidate,
    facts: [
      { fact: "1", result: true, evidence_refs: [{ kind: "artifact", ref: verification.envelope.content_hash }] },
      { fact: "2", result: true, evidence_refs: [{ kind: "receipt", ref: "receipt-ci" }] },
      { fact: "3", result: true, evidence_refs: [{ kind: "receipt", ref: "receipt-metric" }] },
      { fact: "4", result: true, evidence_refs: [{ kind: "approval", ref: "approval-1" }] },
      { fact: "5", result: true, evidence_refs: [{ kind: "artifact", ref: rolloutWatchPlan.envelope.content_hash }] },
      { fact: "6", result: true, evidence_refs: [{ kind: "artifact", ref: proposal.envelope.content_hash }] },
      { fact: "7", result: true, evidence_refs: [{ kind: "artifact", ref: proposal.envelope.content_hash }] },
      { fact: "8", result: true, evidence_refs: [{ kind: "receipt", ref: "receipt-ci" }] },
    ],
    verdict: "pass",
    evaluated_at: "2026-08-15T16:22:00Z",
    policy_version: POLICY_HYBRID,
    tzdb_version: TZDB,
  }
  builder.push("gate_evaluated", "gate-release", { ...spec, time: "2026-08-15T16:22:00Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, gate: "release", evaluation: releaseGateEval })
  builder.push("lease_event", "lease-release", { ...spec, time: "2026-08-15T16:22:05Z" }, { incident_id: incidentId, run_id: runId, lease_id: "lease-release-1", lease_kind: "release", action: "issued", bound_candidate_hash: candidate })
  builder.push("approval_recorded", "approval-1-consume", { ...spec, time: "2026-08-15T16:22:10Z" }, {
    incident_id: incidentId,
    run_id: runId,
    approval: {
      approval_id: "approval-1",
      action_digest: candidate,
      approver_identity: "demo-operator",
      approval_system: "demo-workspace",
      policy_version: POLICY_HYBRID,
      tzdb_version: TZDB,
      action_risk_class: "safe",
      expiry: "2026-08-15T16:50:00Z",
      scope: { target: "payment", changed_surfaces: ["src/payment/card.js"] },
      action: "consumed",
    },
  })
  builder.push("broker_receipt_recorded", "receipt-candidate-deploy", { ...spec, time: "2026-08-15T16:23:00Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "release",
    receipt: {
      kind: "action",
      receipt_id: "receipt-candidate-deploy",
      idempotency_key: "deploy-candidate-1",
      lease_id: "lease-release-1",
      stage: "release",
      candidate_hash: candidate,
      action: { adapter: "compose-release-adapter", action_class: "deploy-candidate", command: "start candidate payment container at the candidate digest on the internal network" },
      target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-digest", actual_version: "candidate-digest" },
      permit_id: "permit-release-1",
      outcome: "ok",
      executed_at: "2026-08-15T16:23:00Z",
    },
  })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:23:05Z" }, "release", "in-progress", "completed")

  // Watch: stage-1 probe ring, stage-2 service swap, confirmation window.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:23:10Z" }, "watch", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:23:20Z" }, "watch", "entered", "in-progress")

  const probeWindows = [
    { starts_at: "2026-08-15T16:24:00Z", ends_at: "2026-08-15T16:24:30Z" },
    { starts_at: "2026-08-15T16:25:00Z", ends_at: "2026-08-15T16:25:30Z" },
    { starts_at: "2026-08-15T16:26:00Z", ends_at: "2026-08-15T16:26:30Z" },
  ]
  probeWindows.forEach((window, index) => {
    builder.push("broker_receipt_recorded", `receipt-probe-w${index + 1}`, { ...spec, time: window.ends_at }, {
      incident_id: incidentId,
      run_id: runId,
      stage: "watch",
      receipt: {
        kind: "read",
        receipt_id: `receipt-probe-w${index + 1}`,
        idempotency_key: `probe-${index + 1}`,
        lease_id: "lease-release-1",
        stage: "watch",
        candidate_hash: candidate,
        request: { backend: "compose-adapter", connection_id: "astronomy-shop-local", query: "probe: 20 valid 2039 Visa charge requests against the candidate container", resource_type: "probe-run" },
        result: { outcome: "ok", content_hash: hashOf(`probe-w${index + 1}-result`), observed_at: window.ends_at, row_count: 20 },
      },
    })
  })

  const stage1Samples = probeWindows.map((window) => [
    { gate: "G1", query: "probe ring: 20 valid-card charge requests per window", time_range: window, sample_count: 20, value: 20, limit: 20, outcome: "pass" },
    { gate: "G2", query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)', time_range: window, sample_count: 24, value: 0.02, limit: 0.05, outcome: "pass" },
    { gate: "G3", query: 'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))', time_range: window, sample_count: 24, value: 0.09, limit: 0.5, outcome: "pass" },
    { gate: "G4", query: "span-metric counter increments for the candidate version; ruler freshness healthy", time_range: window, sample_count: 1, value: 1, limit: 1, outcome: "pass" },
    { gate: "G5", query: "same query as G2 against the recorded pre-release baseline (0.92)", baseline_cohort: "seeded-digest", candidate_cohort: "candidate-digest", time_range: window, sample_count: 24, value: 0.02, limit: 0.05, outcome: "pass" },
  ]).flat()

  const stage1Report = sealRef(
    seal({
      artifact_schema_id: "watch-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:27:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "1",
        plan_ref: rolloutWatchPlan.envelope.content_hash,
        samples: stage1Samples,
        stage_outcome: "pass",
        sealed_at: "2026-08-15T16:27:00Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-watch-stage1", { ...spec, time: "2026-08-15T16:27:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: stage1Report.envelope.content_hash } })

  builder.push("broker_receipt_recorded", "receipt-swap", { ...spec, time: "2026-08-15T16:28:00Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "watch",
    receipt: {
      kind: "action",
      receipt_id: "receipt-swap",
      idempotency_key: "service-swap-1",
      lease_id: "lease-release-1",
      stage: "watch",
      candidate_hash: candidate,
      action: { adapter: "compose-release-adapter", action_class: "service-swap", command: "swap the live Compose payment service to the candidate digest" },
      target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-digest", actual_version: "candidate-digest" },
      permit_id: "permit-release-1",
      outcome: "ok",
      executed_at: "2026-08-15T16:28:00Z",
    },
  })

  const liveWindows = [
    { starts_at: "2026-08-15T16:28:30Z", ends_at: "2026-08-15T16:29:00Z", ratio: 0.02 },
    { starts_at: "2026-08-15T16:29:30Z", ends_at: "2026-08-15T16:30:00Z", ratio: 0.01 },
    { starts_at: "2026-08-15T16:30:30Z", ends_at: "2026-08-15T16:31:00Z", ratio: 0.01 },
  ]
  const stage2Samples = liveWindows.map((window) => [
    { gate: "G1", query: "live container running; TCP/gRPC healthcheck SERVING; no crash loop", time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 1, value: 1, limit: 1, outcome: "pass" },
    { gate: "G2", query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)', time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 62, value: window.ratio, limit: 0.05, outcome: "pass" },
    { gate: "G3", query: 'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))', time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 62, value: 0.08, limit: 0.5, outcome: "pass" },
    { gate: "G4", query: "span-metric counter increments for the watched version; ruler freshness healthy", time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 1, value: 1, limit: 1, outcome: "pass" },
    { gate: "G5", query: "same query as G2 against the recorded pre-release baseline (0.92)", baseline_cohort: "seeded-digest", candidate_cohort: "candidate-digest", time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 62, value: window.ratio, limit: 0.05, outcome: "pass" },
    { gate: "G6", query: "no new error_type on payment spans; checkout error rate < 0.05; frontend-proxy 5xx rate < 0.05", time_range: { starts_at: window.starts_at, ends_at: window.ends_at }, sample_count: 62, value: 0.01, limit: 0.05, outcome: "pass" },
  ]).flat()

  const stage2Report = sealRef(
    seal({
      artifact_schema_id: "watch-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:32:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "2",
        plan_ref: rolloutWatchPlan.envelope.content_hash,
        samples: stage2Samples,
        stage_outcome: "pass",
        sealed_at: "2026-08-15T16:32:00Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-watch-stage2", { ...spec, time: "2026-08-15T16:32:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: stage2Report.envelope.content_hash } })

  // Detector resolves; the confirmation window runs before the run completes.
  const resolvedTrigger = {
    ...firingTrigger,
    delivery_key: deliveryKeyOf("resolved"),
    received_at: "2026-08-15T16:30:00Z",
    state: "resolved",
    window: { starts_at: "2026-08-15T15:33:00Z", ends_at: "2026-08-15T16:30:00Z", lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.01, unit: "1", threshold: 0.2 },
  }
  builder.push("trigger_received", "trig-resolved", { ...spec, time: "2026-08-15T16:30:30Z" }, { incident_id: incidentId, trigger: resolvedTrigger, delivery_result: "evidence-appended" })

  const confirmationWindow = { starts_at: "2026-08-15T16:31:00Z", ends_at: "2026-08-15T16:34:00Z" }
  const confirmationSamples = [
    { gate: "G1", query: "live container running; TCP/gRPC healthcheck SERVING; no crash loop", time_range: confirmationWindow, sample_count: 1, value: 1, limit: 1, outcome: "pass" },
    { gate: "G2", query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)', time_range: confirmationWindow, sample_count: 124, value: 0.01, limit: 0.05, outcome: "pass" },
    { gate: "G3", query: 'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))', time_range: confirmationWindow, sample_count: 124, value: 0.07, limit: 0.5, outcome: "pass" },
    { gate: "G4", query: "span-metric counter increments for the watched version; ruler freshness healthy", time_range: confirmationWindow, sample_count: 1, value: 1, limit: 1, outcome: "pass" },
    { gate: "G5", query: "same query as G2 against the recorded pre-release baseline (0.92)", baseline_cohort: "seeded-digest", candidate_cohort: "candidate-digest", time_range: confirmationWindow, sample_count: 124, value: 0.01, limit: 0.05, outcome: "pass" },
    { gate: "G6", query: "no new error_type on payment spans; checkout error rate < 0.05; frontend-proxy 5xx rate < 0.05", time_range: confirmationWindow, sample_count: 124, value: 0.01, limit: 0.05, outcome: "pass" },
  ]
  const confirmationReport = sealRef(
    seal({
      artifact_schema_id: "watch-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:34:30Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        rollout_stage: "confirmation",
        plan_ref: rolloutWatchPlan.envelope.content_hash,
        samples: confirmationSamples,
        stage_outcome: "pass",
        sealed_at: "2026-08-15T16:34:30Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-watch-confirmation", { ...spec, time: "2026-08-15T16:34:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: confirmationReport.envelope.content_hash } })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:34:40Z" }, "watch", "in-progress", "completed", {
    artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: confirmationReport.envelope.content_hash },
  })

  builder.push("model_use", "model-orchestrator", { ...spec, time: "2026-08-15T16:35:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "orchestrator-1", agent_role: "orchestrator", model: "primary-model", prompt_ref: hashOf("prompt-orch-final"), token_use: { prompt_tokens: 1600, completion_tokens: 200 }, tool_calls: [] })
  builder.push("run_transition", "run-t-3", { ...spec, time: "2026-08-15T16:35:10Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: "running", to: "completed", outcome: "verified-remediation", expected_run_version: 2 })
  builder.push("incident_transition", "inc-t-2", { ...spec, time: "2026-08-15T16:35:11Z" }, { incident_id: incidentId, from: "open", to: "resolved", expected_version: 1 })
  builder.push("incident_transition", "inc-t-3", { ...spec, time: "2026-08-15T16:38:00Z" }, { incident_id: incidentId, from: "resolved", to: "closed", closure_reason: "symptom-cleared", expected_version: 2 })

  return { incidentId, finalSequence: builder.seq, events: builder.events, envelopes }
}

function buildRun2(): BuildRun {
  const incidentId = "inc-demo-payment-2"
  const runId = "run-2"
  const spec: EventSpec = { time: "2026-08-15T15:00:00Z", actor: ACTOR_CP, policy: POLICY_AUTONOMOUS }
  const envelopes: SealedEnvelope[] = []
  const sealRef = (sealed: SealedEnvelope) => {
    envelopes.push(sealed)
    return sealed
  }

  const recoveryPoint = {
    surfaces: ["src/payment/card.js", "compose service payment"],
    prior_compose_project_file_hash: hashOf("compose-project-file"),
    prior_image_digest: hashOf("image-seeded-s2-digest"),
    prior_service_version: "seeded-s2-digest",
    prior_environment_and_flag_files: ["src/flagd/demo.flagd.json"],
    service_definition: "compose service payment",
    restore_command: "docker compose up -d payment",
    preconditions: ["restored project file hash matches the recorded hash", "flagd defaults restored"],
    timeout_seconds: 120,
    retention_window: "demo rollback window",
    allowed_identities: ["demo-operator"],
  }
  const recoveryPointHash = contentHashOf(recoveryPoint)

  const candidateResult = candidateHash({
    schema_version: "1.0",
    base_ref: hashOf("base-snapshot-s2"),
    change: {
      kind: "diff",
      base_ref: hashOf("base-snapshot-s2"),
      diff_text: DIFF_TEXT,
    },
    proposal: { remediation_class: "code", disposition: "allowed" },
    changed_surfaces: ["src/payment/card.js"],
    action_risk_class: "safe",
    gate_path: "release",
    target: {
      tenant_id: "demo",
      deployment_environment_name: "demo",
      service_name: "payment",
      expected_version: "seeded-s2-digest",
    },
    recovery_point_hash: recoveryPointHash,
  })
  if (!candidateResult.ok) throw new Error(candidateResult.error.message)
  const candidate = candidateResult.value

  const evidence = buildEvidence(incidentId, "S2", candidate)
  const builder = new EventBuilder()

  const firingTrigger = {
    schema_version: "1.0",
    trigger_id: "trig-inc-demo-payment-2",
    delivery_key: deliveryKeyOf("firing"),
    incident_key: incidentKeyOf(),
    received_at: "2026-08-15T15:35:20Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "git:abc123",
      source_fingerprint: "fingerprint-payment-error-rate",
    },
    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [
      {
        kind: "metric-query",
        backend: "prometheus",
        uri: "http://localhost:9090/graph?g0.expr=sum(rate(traces_span_metrics_calls_total%7Bservice_name%3D%22payment%22%2Cstatus_code%3D%22STATUS_CODE_ERROR%22%7D%5B2m%5D))",
        query: 'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m]))',
        observed_at: "2026-08-15T15:35:00Z",
      },
      {
        kind: "trace",
        backend: "jaeger",
        uri: "http://localhost:8080/jaeger/ui/trace/trace-payment-exemplar-1",
        trace_id: "trace-payment-exemplar-1",
        observed_at: "2026-08-15T15:35:10Z",
      },
      {
        kind: "log-query",
        backend: "opensearch",
        uri: "http://localhost:8080/grafana/explore?left=%7B%22query%22%3A%22service.name%3Apayment%20AND%20trace_id%3A%5C%22trace-payment-exemplar-1%5C%22%22%7D",
        query: 'service.name:payment AND trace_id:"trace-payment-exemplar-1"',
        observed_at: "2026-08-15T15:35:20Z",
      },
    ],
  }

  builder.push("trigger_received", "trig-1", { ...spec, time: "2026-08-15T15:35:25Z" }, { incident_id: incidentId, trigger: firingTrigger, delivery_result: "incident-created" })
  builder.push("incident_transition", "inc-t-1", { ...spec, time: "2026-08-15T15:35:26Z" }, { incident_id: incidentId, from: null, to: "open", expected_version: 0 })
  builder.push("trigger_received", "trig-1-dup", { ...spec, time: "2026-08-15T15:36:00Z" }, { incident_id: incidentId, trigger: firingTrigger, delivery_result: "duplicate-noop" })
  builder.push("run_transition", "run-t-1", { ...spec, time: "2026-08-15T15:36:31Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: null, to: "queued", expected_run_version: 0 })
  builder.push("lease_event", "lease-run", { ...spec, time: "2026-08-15T15:36:31Z" }, { incident_id: incidentId, run_id: runId, lease_id: "lease-run-1", lease_kind: "run", action: "issued" })
  builder.push("run_transition", "run-t-2", { ...spec, time: "2026-08-15T15:36:32Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: "queued", to: "running", expected_run_version: 1 })

  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:36:40Z" }, "detect", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:37:00Z" }, "detect", "entered", "in-progress")

  const brief = sealRef(
    seal({
      artifact_schema_id: "incident-brief",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:42:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        severity: "critical",
        scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
        symptom: "every charge fails on the card-type check",
        initial_evidence_item_ids: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.flagFailureId, evidence.flagUnreachableId, evidence.codeLocationId, evidence.baselineId],
        policy_version: POLICY_AUTONOMOUS,
        sealed_at: "2026-08-15T15:42:00Z",
      },
    }),
  )
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:05Z" }, "detect", "in-progress", "completed", {
    artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash },
  })
  builder.push("artifact_sealed", "art-brief", { ...spec, time: "2026-08-15T15:42:06Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } })

  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:10Z" }, "diagnose", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:42:20Z" }, "diagnose", "entered", "in-progress")

  const evidenceSet: EvidenceSet = {
    schema_version: "1.0",
    revision_id: evidence.revisionId,
    revision_number: 1,
    incident_id: incidentId,
    pinned_at: "2026-08-15T15:40:00Z",
    item_ids: evidence.items.map((item) => item.id),
    items: evidence.items,
  }
  const evidenceSetEnvelope = sealRef(
    seal({
      artifact_schema_id: "evidence-set",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:41:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      redaction: { profile_id: "demo-profile", masked_fields: ["/items/0/snapshot/secret"] },
      payload: evidenceSet,
    }),
  )

  const { h1, h2, h3, h4 } = hypothesisObjects(incidentId, runId, evidence, "S2")
  const proposed = (h: object, status: string) => ({ ...h, status })

  const participantP1 = sealRef(
    seal({
      artifact_schema_id: "fusion-participant-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:44:30Z",
      producer: { skill: "sih-fusion-participant", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        participant_id: "fusion-participant-p1",
        revision_id: evidence.revisionId,
        hypotheses: [proposed(h1, "proposed"), proposed(h2, "proposed"), proposed(h3, "proposed"), proposed(h4, "proposed")],
        stated_objections: [
          { statement: "the flagd receipt reads paymentFailure=0; H2 cannot explain the error text", hypothesis_id: "H2", cited_item_ids: [evidence.flagFailureId] },
          { statement: "the exemplar trace shows the throw inside the Payment service", hypothesis_id: "H3", cited_item_ids: [evidence.traceId] },
        ],
        completed_at: "2026-08-15T15:44:30Z",
      },
    }),
  )
  const participantP2 = sealRef(
    seal({
      artifact_schema_id: "fusion-participant-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:44:30Z",
      producer: { skill: "sih-fusion-participant", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        participant_id: "fusion-participant-p2",
        revision_id: evidence.revisionId,
        hypotheses: [proposed(h1, "proposed"), proposed(h2, "proposed"), proposed(h3, "proposed"), proposed(h4, "proposed")],
        stated_objections: [
          { statement: "paymentUnreachable=false and the pre-seed baseline is near zero", hypothesis_id: "H4", cited_item_ids: [evidence.flagUnreachableId, evidence.baselineId] },
        ],
        completed_at: "2026-08-15T15:44:30Z",
      },
    }),
  )
  const judge = sealRef(
    seal({
      artifact_schema_id: "fusion-judge-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:45:00Z",
      producer: { skill: "sih-fusion-judge", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        judge_id: "fusion-judge-j1",
        revision_id: evidence.revisionId,
        agreements: [
          { statement: "both participants rank the card-type regression in S2 first", hypothesis_ids: ["H1"], cited_item_ids: [evidence.deploymentId, evidence.metricId] },
        ],
        contradictions: [],
        blind_spots: [
          { statement: "the removed Luhn guard is silent: no Signal exposes it in the trigger window", hypothesis_ids: [], cited_item_ids: [] },
        ],
        unique_findings: [
          { statement: "p1 noted the error text matches card.js's card-type clause only", hypothesis_ids: ["H1"], cited_item_ids: [evidence.codeLocationId] },
        ],
        citation_audit: [
          { participant_id: "fusion-participant-p1", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
          { participant_id: "fusion-participant-p2", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
        ],
        completed_at: "2026-08-15T15:45:00Z",
      },
    }),
  )
  const synthesizer = sealRef(
    seal({
      artifact_schema_id: "fusion-synthesizer-output",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:45:30Z",
      producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        synthesizer_id: "fusion-synthesizer-s1",
        revision_id: evidence.revisionId,
        ranked_hypotheses: [
          { rank: 1, hypothesis: proposed(h1, "accepted") },
          { rank: 2, hypothesis: proposed(h2, "rejected") },
          { rank: 3, hypothesis: proposed(h3, "rejected") },
          { rank: 4, hypothesis: proposed(h4, "rejected") },
        ],
        contradictions: [],
        gaps: [],
        next_actions: [
          {
            procedure: "run the pre-registered discriminating suite node --test src/payment/card.unit.test.js",
            bounds: "pure unit suite; no OpenFeature, flagd, or OTel SDK",
            permissions: ["read"],
            discriminates: ["H1", "H2", "H3", "H4"],
          },
        ],
        fusion_meta: {
          participant_ids: ["fusion-participant-p1", "fusion-participant-p2"],
          judge_id: "fusion-judge-j1",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: evidence.revisionId,
          started_at: "2026-08-15T15:43:00Z",
          completed_at: "2026-08-15T15:45:30Z",
        },
        completed_at: "2026-08-15T15:45:30Z",
      },
    }),
  )
  const diagnosis = sealRef(
    seal({
      artifact_schema_id: "diagnosis-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:46:00Z",
      producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        hypotheses: [h1, h2, h3, h4],
        contradictions: [],
        gaps: [],
        next_actions: [
          {
            procedure: "node --test src/payment/card.unit.test.js",
            bounds: "pure unit suite",
            permissions: ["read"],
            discriminates: ["H1", "H2", "H3", "H4"],
          },
        ],
        fusion_meta: {
          participant_ids: ["fusion-participant-p1", "fusion-participant-p2"],
          judge_id: "fusion-judge-j1",
          synthesizer_id: "fusion-synthesizer-s1",
          revision_id: evidence.revisionId,
          rounds: [{ round: 1, valid: true, participant_ids: ["fusion-participant-p1", "fusion-participant-p2"] }],
        },
        remediation_disposition: "allowed",
        sealed_at: "2026-08-15T15:46:00Z",
      },
    }),
  )

  builder.push("artifact_sealed", "art-evidence", { ...spec, time: "2026-08-15T15:41:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "evidence-set", schema_version: "1.0", content_hash: evidenceSetEnvelope.envelope.content_hash } })
  builder.push("artifact_sealed", "art-p1", { ...spec, time: "2026-08-15T15:44:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-participant-output", schema_version: "1.0", content_hash: participantP1.envelope.content_hash } })
  builder.push("artifact_sealed", "art-p2", { ...spec, time: "2026-08-15T15:44:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-participant-output", schema_version: "1.0", content_hash: participantP2.envelope.content_hash } })
  builder.push("artifact_sealed", "art-judge", { ...spec, time: "2026-08-15T15:45:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-judge-output", schema_version: "1.0", content_hash: judge.envelope.content_hash } })
  builder.push("artifact_sealed", "art-synth", { ...spec, time: "2026-08-15T15:45:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "fusion-synthesizer-output", schema_version: "1.0", content_hash: synthesizer.envelope.content_hash } })
  builder.push("model_use", "model-p1", { ...spec, time: "2026-08-15T15:44:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-participant-p1", agent_role: "participant", model: "primary-model", prompt_ref: hashOf("prompt-p1"), token_use: { prompt_tokens: 1800, completion_tokens: 700 }, tool_calls: [] })
  builder.push("model_use", "model-p2", { ...spec, time: "2026-08-15T15:44:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-participant-p2", agent_role: "participant", model: "primary-model", prompt_ref: hashOf("prompt-p2"), token_use: { prompt_tokens: 1800, completion_tokens: 650 }, tool_calls: [] })
  builder.push("model_use", "model-judge", { ...spec, time: "2026-08-15T15:45:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-judge-j1", agent_role: "judge", model: "primary-model", prompt_ref: hashOf("prompt-judge"), token_use: { prompt_tokens: 2400, completion_tokens: 500 }, tool_calls: [] })
  builder.push("model_use", "model-synth", { ...spec, time: "2026-08-15T15:45:30Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "fusion-synthesizer-s1", agent_role: "synthesizer", model: "primary-model", prompt_ref: hashOf("prompt-synth"), token_use: { prompt_tokens: 3000, completion_tokens: 800 }, tool_calls: [] })
  builder.push("gate_evaluated", "gate-hyp", { ...spec, time: "2026-08-15T15:46:30Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, gate: "hypothesis", evaluation: hypothesisGateEval(evidence) })
  builder.push("artifact_sealed", "art-diagnosis", { ...spec, time: "2026-08-15T15:46:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:46:40Z" }, "diagnose", "in-progress", "completed", {
    artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash },
  })

  // Repair: the same correct one-line fix of the accepted card-type Hypothesis.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:46:45Z" }, "repair", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:47:00Z" }, "repair", "entered", "in-progress")

  const proposal = sealRef(
    seal({
      artifact_schema_id: "remediation-proposal",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T15:50:00Z",
      producer: { skill: "sih-repair-planner", skill_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        candidate_hash: candidate,
        remediation_class: "code",
        action_risk_class: "safe",
        gate_path: "release",
        disposition: "allowed",
        change_description: "restore the negation in card.js's validateCard card-type clause",
        diff: {
          base_ref: hashOf("base-snapshot-s2"),
          diff_text: DIFF_TEXT,
          diff_hash: hashOf("diff-s2"),
        },
        citations: [
          {
            change: "card-type clause negation restored",
            hypothesis_id: "H1",
            cited_item_ids: [evidence.metricId, evidence.traceId, evidence.logId, evidence.deploymentId, evidence.codeLocationId],
          },
        ],
        test_plan: ["card.unit.test.js", "payment.regression.test.js"],
        changed_surfaces: ["src/payment/card.js"],
        blast_radius: { services: ["payment"], environments: ["demo"], cohorts: [] },
        recovery_point: { id: recoveryPointHash, changed_surfaces: ["src/payment/card.js", "compose service payment"] },
        sealed_at: "2026-08-15T15:50:00Z",
      },
    }),
  )
  builder.push("artifact_sealed", "art-proposal", { ...spec, time: "2026-08-15T15:50:05Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } })
  builder.push("broker_receipt_recorded", "receipt-pr", { ...spec, time: "2026-08-15T15:51:00Z" }, {
    incident_id: incidentId,
    run_id: runId,
    stage: "repair",
    receipt: {
      kind: "action",
      receipt_id: "receipt-pr",
      idempotency_key: "pr-submit-1",
      lease_id: "lease-run-1",
      stage: "repair",
      candidate_hash: candidate,
      action: { adapter: "source-host-adapter", action_class: "submit_remediation_pr", command: "create branch remediate/incident-inc-demo-payment-2 with the one-line card.js patch" },
      target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-s2-digest" },
      permit_id: "permit-pr-1",
      outcome: "ok",
      executed_at: "2026-08-15T15:51:00Z",
    },
  })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:51:05Z" }, "repair", "in-progress", "completed", {
    candidate_hash: candidate,
    artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash },
  })

  // Verify: T3 passes the card-type cases; R1 cites the reachability finding;
  // T5 fails deterministically on the untouched Luhn guard.
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:52:00Z" }, "verify", null, "entered")
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T15:53:00Z" }, "verify", "entered", "in-progress")

  const testArtifacts: SealedEnvelope[] = []
  for (const row of TEST_ROWS) {
    const isT5 = row.layer === "T5"
    const isT3 = row.layer === "T3"
    const at = isT5 ? "2026-08-15T16:12:00Z" : isT3 ? "2026-08-15T16:10:00Z" : "2026-08-15T16:05:00Z"
    if (row.layer === "T12") {
      builder.push("broker_receipt_recorded", row.receiptId, { ...spec, time: at }, {
        incident_id: incidentId,
        run_id: runId,
        stage: "verify",
        receipt: {
          kind: "action",
          receipt_id: row.receiptId,
          idempotency_key: `test-${row.receiptId}`,
          lease_id: "lease-run-1",
          stage: "verify",
          candidate_hash: candidate,
          action: { adapter: "compose-release-adapter", action_class: "restore-drill", command: "docker compose up -d payment (preconditions: project file hash match, flag defaults; timeout 120s)" },
          target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment", expected_version: "seeded-s2-digest" },
          permit_id: `permit-${row.receiptId}`,
          outcome: "ok",
          executed_at: at,
        },
      })
    } else {
      builder.push(
        "broker_receipt_recorded",
        row.receiptId,
        { ...spec, time: at },
        testReceipt(incidentId, runId, spec, candidate, row.layer, row.receiptId, row.tool, row.toolVersion, row.target, isT5 ? "fail" : "pass", isT5 ? "Luhn-failing Visa is rejected" : undefined, at),
      )
    }
    const sealed = sealRef(
      seal({
        artifact_schema_id: "test-report",
        incident_id: incidentId,
        run_id: runId,
        sealed_at: at,
        producer: { skill: row.skill, skill_version: "1.0" },
        payload: {
          schema_version: "1.0",
          incident_id: incidentId,
          run_id: runId,
          attempt: 1,
          candidate_hash: candidate,
          layer: row.layer,
          tool: row.tool,
          tool_version: row.toolVersion,
          target: row.target,
          receipt_ref: row.receiptId,
          runs: [
            {
              run_hash: hashOf(`${row.receiptId}-run`),
              result: isT5 ? "fail" : "pass",
              at,
              ...(isT5 ? { detail: "Luhn-failing Visa is rejected" } : {}),
            },
          ],
          outcome: isT5 ? "fail" : "pass",
          flaky: false,
          coverage_checked: true,
          sealed_at: at,
        },
      }),
    )
    testArtifacts.push(sealed)
  }

  const reviewArtifacts: SealedEnvelope[] = []
  for (const row of REVIEW_ROWS) {
    const isR1 = row.role === "R1"
    const findings = isR1
      ? [
          {
            id: "r1-f1",
            severity: "major",
            claim: "restoring the card-type check makes the adjacent missing Luhn guard reachable, so invalid Visa numbers can now pass",
            citations: [
              { kind: "file-line", file: "src/payment/card.js", line: 12, ref: hashOf("diff-s2") },
              { kind: "file-line", file: "src/payment/card.js", line: 9, ref: hashOf("base-snapshot-s2") },
            ],
            status: "open",
          },
        ]
      : row.role === "R2"
        ? [
            {
              id: "r2-f1",
              severity: "info",
              claim: "the citation map covers only the accepted card-type causal chain and contains no unsupported Luhn change",
              citations: [{ kind: "evidence-item", ref: evidence.metricId }],
              status: "open",
            },
          ]
        : row.role === "R8"
          ? [
              {
                id: "r8-f1",
                severity: "info",
                claim: "the Recovery Point draft names every changed surface and an exact restore command with preconditions and timeout",
                citations: [{ kind: "recovery-point-gap", ref: recoveryPointHash }],
                status: "open",
              },
            ]
          : [
              {
                id: `${row.role.toLowerCase()}-f1`,
                severity: "info",
                claim: row.role === "R4" ? "the one-line change narrows card acceptance; no new attack surface" : "no defects found in the one-line candidate",
                citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: hashOf("diff-s2") }],
                status: "open",
              },
            ]
    const sealed = sealRef(
      seal({
        artifact_schema_id: "review-report",
        incident_id: incidentId,
        run_id: runId,
        sealed_at: "2026-08-15T16:05:00Z",
        producer: { skill: row.skill, skill_version: "1.0" },
        payload: {
          schema_version: "1.0",
          incident_id: incidentId,
          run_id: runId,
          attempt: 1,
          candidate_hash: candidate,
          role: row.role,
          reviewer: row.reviewer,
          revision: 1,
          input_refs: [hashOf("diff-s2"), hashOf("base-snapshot-s2"), POLICY_AUTONOMOUS],
          findings,
          status: isR1 ? "fail" : "pass",
          sealed_at: "2026-08-15T16:05:00Z",
        },
      }),
    )
    reviewArtifacts.push(sealed)
    builder.push("model_use", `model-${row.role.toLowerCase()}`, { ...spec, time: "2026-08-15T16:05:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: row.reviewer, agent_role: "reviewer", model: "primary-model", prompt_ref: hashOf(`prompt-${row.role}`), token_use: { prompt_tokens: 2200, completion_tokens: 400 }, tool_calls: [] })
  }

  const verification = sealRef(
    seal({
      artifact_schema_id: "verification-report",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:15:00Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0", resolver_version: "1.0" },
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        candidate_hash: candidate,
        remediation_class: "code",
        action_risk_class: "safe",
        gate_path: "release",
        applicability: { ...APPLICABILITY, policy_version: POLICY_AUTONOMOUS },
        reviews: REVIEW_ROWS.map((row) => ({ role: row.role, reviewer: row.reviewer, revision: 1, status: row.role === "R1" ? "fail" : "pass", sealed_at: "2026-08-15T16:05:00Z" })),
        tests: TEST_ROWS.map((row) => ({ layer: row.layer, tool: row.tool, tool_version: row.toolVersion, receipt_ref: row.receiptId, outcome: row.layer === "T5" ? "fail" : "pass", flaky: false })),
        hash_binding: { sealed_candidate: candidate, checked_candidate: candidate, match: true },
        verdict: "fail",
        verdict_reason: "required T5 regression check failed on the Luhn-failing Visa case; the cause lies outside the candidate's diff",
        sealed_at: "2026-08-15T16:15:00Z",
        policy_version: POLICY_AUTONOMOUS,
      },
    }),
  )

  // The failed evidence joins the Evidence Set as revision 2.
  const failedItem: EvidenceItem = {
    id: evidence.failedT5Id,
    kind: "test-result",
    backend: "broker-receipt",
    identity: {
      hypothesis_id: "H1",
      prediction_id: "pred-t5",
      receipt_ref: "receipt-t5",
      service_name: "payment",
      deployment_environment_name: "demo",
    },
    query: "scoped Payment regression suite under the ownership map",
    snapshot: {
      case: "Luhn-failing Visa is rejected",
      result: "fail",
      assertion: "invalid Visa rejected",
      candidate_hash: candidate,
    },
    content_hash: contentHashOf({
      case: "Luhn-failing Visa is rejected",
      result: "fail",
      assertion: "invalid Visa rejected",
      candidate_hash: candidate,
    }),
    links: [{ uri: "http://localhost:8013/flags/paymentFailure", expired: false }],
    observed_at: "2026-08-15T16:12:00Z",
    fresh_until: FRESH_UNTIL,
    provenance: ["local CI runner -> read-broker-receipt-rb-t5-fail"],
    trust: "test-result",
    joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
    redaction: { profile_id: "demo-profile", masked_fields: [] },
    outcome: "ok",
  }
  const evidenceSetRev2: EvidenceSet = {
    schema_version: "1.0",
    revision_id: hashOf(`${incidentId}-evidence-revision-2`),
    revision_number: 2,
    incident_id: incidentId,
    pinned_at: "2026-08-15T16:13:00Z",
    item_ids: [...evidence.items.map((item) => item.id), evidence.failedT5Id],
    items: [...evidence.items, failedItem],
  }
  const evidenceSetRev2Envelope = sealRef(
    seal({
      artifact_schema_id: "evidence-set",
      incident_id: incidentId,
      run_id: runId,
      sealed_at: "2026-08-15T16:13:30Z",
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
      redaction: { profile_id: "demo-profile", masked_fields: ["/items/0/snapshot/secret"] },
      payload: evidenceSetRev2,
    }),
  )

  for (const sealed of reviewArtifacts) {
    builder.push("artifact_sealed", `art-review-${sealed.envelope.payload.role}`, { ...spec, time: "2026-08-15T16:05:10Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "review-report", schema_version: "1.0", content_hash: sealed.envelope.content_hash } })
  }
  for (const sealed of testArtifacts) {
    const layer = sealed.envelope.payload.layer
    builder.push("artifact_sealed", `art-test-${layer}`, { ...spec, time: "2026-08-15T16:12:30Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "test-report", schema_version: "1.0", content_hash: sealed.envelope.content_hash } })
  }
  builder.push("artifact_sealed", "art-verification", { ...spec, time: "2026-08-15T16:15:10Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } })
  builder.push("artifact_sealed", "art-evidence-rev2", { ...spec, time: "2026-08-15T16:13:35Z" }, { incident_id: incidentId, run_id: runId, artifact_ref: { schema_id: "evidence-set", schema_version: "1.0", content_hash: evidenceSetRev2Envelope.envelope.content_hash } })
  stage(builder, incidentId, runId, { ...spec, time: "2026-08-15T16:15:20Z" }, "verify", "in-progress", "failed", {
    artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash },
  })

  builder.push("model_use", "model-orchestrator", { ...spec, time: "2026-08-15T16:16:00Z" }, { incident_id: incidentId, run_id: runId, parent_agent_id: "orchestrator-1", agent_id: "orchestrator-1", agent_role: "orchestrator", model: "primary-model", prompt_ref: hashOf("prompt-orch-final"), token_use: { prompt_tokens: 1600, completion_tokens: 200 }, tool_calls: [] })
  builder.push("run_transition", "run-t-3", { ...spec, time: "2026-08-15T16:16:10Z" }, { incident_id: incidentId, run_id: runId, attempt: 1, from: "running", to: "failed", failure_reason: "verification-failed", expected_run_version: 2 })

  return { incidentId, finalSequence: builder.seq, events: builder.events, envelopes }
}

// ---------------------------------------------------------------------------
// Bundle assembly, verification, and write
// ---------------------------------------------------------------------------

const MANIFEST_PATH = "manifest.json"

interface BundleFiles {
  files: Map<string, string>
  incidents: Array<{ incident_id: string; final_sequence: number }>
}

function buildBundle(runs: BuildRun[]): BundleFiles {
  const files = new Map<string, string>()
  const incidents: Array<{ incident_id: string; final_sequence: number }> = []

  for (const run of runs) {
    const lines = run.events.map((event) => `${JSON.stringify(event)}\n`).join("")
    files.set(`incidents/${run.incidentId}/journal.jsonl`, lines)
    incidents.push({ incident_id: run.incidentId, final_sequence: run.finalSequence })
    for (const sealed of run.envelopes) {
      files.set(`artifacts/sha256/${sealed.fileName}`, sealed.bytes)
    }
  }

  const manifest = buildManifest(files, incidents)
  files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  return { files, incidents }
}

function buildManifest(
  files: Map<string, string>,
  incidents: Array<{ incident_id: string; final_sequence: number }>,
): SavedBundleManifest {
  const fileEntries: Record<string, { sha256: string; size: number }> = {}
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path) ?? ""
    fileEntries[path] = {
      sha256: `sha256:${hex(bytes)}`,
      size: new TextEncoder().encode(bytes).byteLength,
    }
  }
  return {
    format_version: "1.0",
    capture_time: CAPTURE_TIME,
    incident_ids: incidents,
    files: fileEntries,
  }
}

async function main(): Promise<void> {
  const bundle = buildBundle([buildRun1(), buildRun2()])

  const verified = verifySavedBundle({ files: bundle.files }, { evaluationTime: EVAL_TIME })
  if (!verified.ok) {
    console.error("generated bundle failed verification:")
    for (const error of verified.error) {
      console.error(`  ${error.code}: ${error.message}${error.path !== undefined ? ` @ ${error.path}` : ""}`)
    }
    process.exit(1)
  }

  const ROOT = import.meta.dir
  for (const [path, bytes] of bundle.files) {
    const target = join(ROOT, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, "utf8")
  }

  // Remove stale generated files that no longer belong to the bundle.
  const manifest = verified.value.manifest
  console.log(`verified and wrote saved-run bundle: ${bundle.files.size} files`)
  console.log(
    `incidents: ${manifest.incident_ids.map((entry) => `${entry.incident_id}@${entry.final_sequence}`).join(", ")}`,
  )
  console.log(
    `artifacts: ${bundle.files.size - manifest.incident_ids.length - 1} sealed envelopes`,
  )
}

void main()
