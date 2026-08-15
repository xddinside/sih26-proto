/**
 * Deterministic fixture generator for demo/fixtures/contracts.
 *
 * Builds one valid saved bundle (two Demo Runs: Run 1 verified-remediation,
 * Run 2 failed verification) plus deterministic mutation fixtures for every
 * named integrity failure. The generator is a dev tool; it uses only the
 * public, pure contracts API and Bun's file primitives. Its output is
 * committed, so this script documents exactly how each fixture was made.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  candidateHash,
  contentHash,
  deliveryKey,
  evidenceItemId,
  incidentKey,
  sha256Hex,
} from "../src/hashes.js";
import type { ArtifactEnvelope } from "../src/schemas/artifact-envelope.js";
import type { EvidenceSet } from "../src/schemas/evidence.js";
import type { JournalEvent } from "../src/schemas/journal-event.js";
import type { SavedBundleManifest } from "../src/schemas/saved-bundle-manifest.js";
import type { JsonValue } from "../src/result.js";

const CAPTURE_TIME = "2026-08-16T12:00:00Z";
const EVAL_TIME = "2026-08-21T00:00:00Z";
const FRESH_UNTIL = "2026-09-01T00:00:00Z";
const POLICY = "policy-v1";
const TZDB = "2026a";

const hex = (s: string) => sha256Hex(s);
const hashOf = (s: string) => `sha256:${hex(s)}`;

function contentHashOf(payload: unknown): string {
  // Dev-only tool: payloads come from the typed builders; contentHash re-checks
  // JSON compatibility at runtime.
  const result = contentHash(payload as JsonValue);
  if (!result.ok) {
    throw new Error(`cannot hash payload: ${result.error.message}`);
  }
  return result.value;
}

function evidenceId(kind: string, identity: Record<string, unknown>, snapshot: unknown): string {
  const result = evidenceItemId({
    schema_version: "1.0",
    kind: kind as never,
    identity: identity as never,
    content: snapshot,
  } as never);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

interface EnvelopeSpec {
  artifact_schema_id: string;
  incident_id: string;
  run_id?: string;
  sealed_at: string;
  producer: Record<string, string>;
  redaction?: { profile_id: string; masked_fields: string[] };
  provenance?: string[];
  payload: unknown;
}

interface SealedEnvelope {
  envelope: ArtifactEnvelope;
  fileName: string;
  bytes: string;
}

function seal(spec: EnvelopeSpec): SealedEnvelope {
  const content = contentHashOf(spec.payload);
  const envelope: ArtifactEnvelope = {
    schema_version: "1.0",
    artifact_schema_id: spec.artifact_schema_id,
    artifact_schema_version: "1.0",
    content_hash: content,
    sealed_at: spec.sealed_at,
    incident_id: spec.incident_id,
    ...(spec.run_id !== undefined ? { run_id: spec.run_id } : {}),
    producer: spec.producer,
    ...(spec.redaction !== undefined ? { redaction: spec.redaction } : {}),
    ...(spec.provenance !== undefined ? { provenance: spec.provenance } : {}),
    payload: spec.payload,
  };
  const bytes = JSON.stringify(envelope);
  return {
    envelope,
    fileName: `${content.slice("sha256:".length)}.json`,
    bytes,
  };
}

const ACTOR = { id: "cp-1", kind: "control-plane" } as const;

interface BuildRun {
  incidentId: string;
  finalSequence: number;
  events: JournalEvent[];
  envelopes: SealedEnvelope[];
}

function ev(
  type: string,
  seq: number,
  incident_id: string,
  idem: string,
  rest: Record<string, unknown>,
): JournalEvent {
  return {
    type,
    sequence: seq,
    idempotency_key: idem,
    recorded_at: "2026-08-15T15:00:00Z",
    actor: ACTOR,
    policy_version: POLICY,
    incident_id,
    ...rest,
  } as JournalEvent;
}

function trigger(incidentId: string, deliveryKeyStr: string, state: "firing" | "resolved"): unknown {
  return {
    schema_version: "1.0",
    trigger_id: `trig-${incidentId}`,
    delivery_key: deliveryKeyStr,
    incident_key: incidentKeyOf(),
    received_at: "2026-08-15T15:35:20Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "git:abc123",
      source_fingerprint: "fingerprint-1",
    },
    state,
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: {
      starts_at: "2026-08-15T15:33:00Z",
      ends_at: state === "firing" ? null : "2026-08-15T16:00:00Z",
      lookback_seconds: 120,
    },
    signal_summary: {
      name: "payment error ratio",
      value: state === "firing" ? 0.92 : 0.02,
      unit: "1",
      threshold: 0.2,
    },
    evidence_refs: [
      {
        kind: "metric-query",
        backend: "prometheus",
        uri: "http://localhost:9090/graph?g0.expr=sum(rate(...))",
        query: "sum(rate(traces_span_metrics_calls_total{service_name=\"payment\",status_code=\"STATUS_CODE_ERROR\"}[2m]))",
        observed_at: "2026-08-15T15:35:00Z",
      },
      {
        kind: "trace",
        backend: "jaeger",
        uri: "http://localhost:8080/jaeger/ui/trace/abc123",
        trace_id: "abc123",
      },
    ],
  };
}

function incidentKeyOf(): string {
  const result = incidentKey({
    schema_version: "1.0",
    tenant_id: "demo",
    deployment_environment_name: "demo",
    service_name: "payment",
    detector_key: "payment-error-rate",
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function deliveryKeyOf(source: string, status: "firing" | "resolved"): string {
  const result = deliveryKey({
    schema_version: "1.0",
    source,
    alert_fingerprint: "fingerprint-1",
    status,
    starts_at: "2026-08-15T15:33:00Z",
    ends_at: status === "firing" ? null : "2026-08-15T16:00:00Z",
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

interface EvidenceParts {
  ids: string[];
  metricId: string;
  traceId: string;
  deploymentId: string;
  flagId: string;
  evidenceSet: EvidenceSet;
}

function buildEvidence(incidentId: string): EvidenceParts {
  const metricSnapshot: JsonValue = { value: 0.92, labels: { service_name: "payment" }, secret: "[REDACTED]" };
  const traceSnapshot: JsonValue = { status: "ERROR", card_valid: true, card_type: "visa" };
  const deploymentSnapshot: JsonValue = { commit: "S1", service_version: "seeded-digest" };
  const flagSnapshot: JsonValue = { paymentFailure: 0 };

  const metricId = evidenceId("metric", {
    metric_name: "traces_span_metrics_calls_total",
    metric_labels: { service_name: "payment" },
    service_name: "payment",
    deployment_environment_name: "demo",
    window: { starts_at: "2026-08-15T15:30:00Z", ends_at: "2026-08-15T15:36:00Z" },
  }, metricSnapshot);
  const traceId = evidenceId("trace", { trace_id: "abc123", span_id: "span-1" }, traceSnapshot);
  const deploymentId = evidenceId("deployment-event", {
    commit: "S1",
    diff_hash: hashOf("S1-diff"),
    before_version: "pre-seed",
    after_version: "seeded-digest",
    applied_at: "2026-08-15T15:00:00Z",
    service_name: "payment",
    deployment_environment_name: "demo",
  }, deploymentSnapshot);
  const flagId = evidenceId("metric", {
    metric_name: "feature_flag_value",
    metric_labels: { flag_key: "paymentFailure", service_name: "payment" },
    window: {
      starts_at: "2026-08-15T15:30:00Z",
      ends_at: "2026-08-15T15:36:00Z",
    },
    flag_key: "paymentFailure",
    service_name: "payment",
  }, flagSnapshot);

  const evidenceSet: EvidenceSet = {
    schema_version: "1.0",
    revision_id: hashOf(`${incidentId}-revision-1`),
    revision_number: 1,
    incident_id: incidentId,
    pinned_at: "2026-08-15T15:40:00Z",
    item_ids: [metricId, traceId, deploymentId, flagId],
    items: [
      {
        id: metricId,
        kind: "metric",
        backend: "prometheus",
        identity: {
          metric_name: "traces_span_metrics_calls_total",
          metric_labels: { service_name: "payment" },
          service_name: "payment",
          deployment_environment_name: "demo",
          window: { starts_at: "2026-08-15T15:30:00Z", ends_at: "2026-08-15T15:36:00Z" },
        },
        snapshot: metricSnapshot,
        content_hash: contentHashOf(metricSnapshot),
        links: [{ uri: "http://localhost:9090/graph?g0.expr=sum(rate(...))" }],
        observed_at: "2026-08-15T15:35:20Z",
        fresh_until: FRESH_UNTIL,
        provenance: ["collector -> gateway -> prometheus -> read-broker-receipt-1"],
        trust: "backend",
        joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
        redaction: { profile_id: "demo-profile", masked_fields: ["/snapshot/secret"] },
        outcome: "ok",
      },
      {
        id: traceId,
        kind: "trace",
        backend: "jaeger",
        identity: { trace_id: "abc123", span_id: "span-1" },
        snapshot: traceSnapshot,
        content_hash: contentHashOf(traceSnapshot),
        links: [{ uri: "http://localhost:8080/jaeger/ui/trace/abc123" }],
        observed_at: "2026-08-15T15:35:20Z",
        fresh_until: FRESH_UNTIL,
        provenance: ["collector -> gateway -> jaeger -> read-broker-receipt-2"],
        trust: "backend",
        joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
        redaction: { profile_id: "demo-profile", masked_fields: [] },
        outcome: "ok",
      },
      {
        id: deploymentId,
        kind: "deployment-event",
        backend: "git",
        identity: {
          commit: "S1",
          diff_hash: hashOf("S1-diff"),
          before_version: "pre-seed",
          after_version: "seeded-digest",
          applied_at: "2026-08-15T15:00:00Z",
          service_name: "payment",
          deployment_environment_name: "demo",
        },
        snapshot: deploymentSnapshot,
        content_hash: contentHashOf(deploymentSnapshot),
        links: [{ uri: "https://git.local/blob/S1" }],
        observed_at: "2026-08-15T15:36:00Z",
        fresh_until: FRESH_UNTIL,
        provenance: ["git adapter -> read-broker-receipt-3"],
        trust: "backend",
        joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
        redaction: { profile_id: "demo-profile", masked_fields: [] },
        outcome: "ok",
      },
      {
        id: flagId,
        kind: "metric",
        backend: "flagd",
        identity: {
          metric_name: "feature_flag_value",
          metric_labels: { flag_key: "paymentFailure", service_name: "payment" },
          window: {
            starts_at: "2026-08-15T15:30:00Z",
            ends_at: "2026-08-15T15:36:00Z",
          },
          flag_key: "paymentFailure",
          service_name: "payment",
        },
        snapshot: flagSnapshot,
        content_hash: contentHashOf(flagSnapshot),
        links: [{ uri: "http://localhost:8013/flags/paymentFailure" }],
        observed_at: "2026-08-15T15:36:10Z",
        fresh_until: FRESH_UNTIL,
        provenance: ["flagd -> read-broker-receipt-4"],
        trust: "backend",
        joins: { service_name: "payment", deployment_environment_name: "demo", tenant_id: "demo" },
        redaction: { profile_id: "demo-profile", masked_fields: [] },
        outcome: "ok",
      },
    ],
  };

  return { ids: [metricId, traceId, deploymentId, flagId], metricId, traceId, deploymentId, flagId, evidenceSet };
}

function hypothesisGateEval(metricId: string, traceId: string, deploymentId: string, flagId: string): unknown {
  return {
    gate: "hypothesis",
    hypothesis_id: "H1",
    checks: [
      { check: "cited-coverage", result: true, counts: { unexplained_critical_items: 0 }, cited_item_ids: [metricId, traceId], reason: "all critical items explained" },
      { check: "causal-edge-support", result: true, counts: { unsupported_edges: 0 }, cited_item_ids: [metricId, traceId, deploymentId] },
      { check: "contradiction-handling", result: true, counts: { unresolved_contradictions: 0 }, cited_item_ids: [] },
      { check: "alternative-elimination", result: true, counts: { undiscriminated_material_alternatives: 0 }, cited_item_ids: [flagId, deploymentId] },
      { check: "reproducible-test", result: true, counts: { executed_tests: 1, passed_tests: 1 }, cited_item_ids: [] },
      { check: "scope-match", result: true, counts: {}, cited_item_ids: [metricId] },
      { check: "freshness", result: true, counts: { stale_items: 0 }, cited_item_ids: [] },
      { check: "telemetry-coverage", result: true, counts: {}, cited_item_ids: [metricId] },
    ],
    verdict: "pass",
    evaluated_at: "2026-08-15T15:45:00Z",
    policy_version: POLICY,
  };
}

function buildRun1(): BuildRun {
  const incidentId = "inc-demo-payment-1";
  const evidence = buildEvidence(incidentId);

  const recoveryPointHash = contentHashOf({
    surfaces: ["src/payment/card.js", "compose service payment"],
    restore_command: "docker compose up -d payment",
  });

  const cand = candidateHash({
    schema_version: "1.0",
    base_ref: hashOf("base-snapshot"),
    change: {
      kind: "diff",
      base_ref: hashOf("base-snapshot"),
      diff_text: "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {",
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
  });
  if (!cand.ok) {
    throw new Error(cand.error.message);
  }
  const candidate = cand.value;

  const envelopes: SealedEnvelope[] = [];
  const sealRef = (spec: EnvelopeSpec) => {
    const sealed = seal(spec);
    envelopes.push(sealed);
    return sealed;
  };

  const brief = sealRef({
    artifact_schema_id: "incident-brief",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T15:42:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      symptom: "every charge fails on the card-type check",
      initial_evidence_item_ids: evidence.ids,
      policy_version: POLICY,
      sealed_at: "2026-08-15T15:42:00Z",
    },
  });

  const evidenceSet = sealRef({
    artifact_schema_id: "evidence-set",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T15:41:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    redaction: { profile_id: "demo-profile", masked_fields: ["/items/0/snapshot/secret"] },
    payload: evidence.evidenceSet,
  });

  const diagnosis = sealRef({
    artifact_schema_id: "diagnosis-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T15:46:00Z",
    producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      hypotheses: [
        {
          schema_version: "1.0",
          id: "H1",
          incident_id: incidentId,
          incident_run_id: "run-1",
          attempt: 1,
          round: 1,
          causal_claim: {
            trigger: "card-type clause inverted in S1",
            defect: "src/payment/card.js card-type check drops negation",
            propagation: [
              { from: "S1 commit", to: "charge fails", cited_item_ids: [evidence.deploymentId, evidence.metricId] },
            ],
            failure: "payment error ratio above threshold",
          },
          affected_scope: {
            service_names: ["payment"],
            deployment_environment_names: ["demo"],
            versions: ["seeded-digest"],
            window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null },
          },
          predicted_observations: [
            { id: "pred-1", statement: "valid Visa fails on seeded code", registered_at: "2026-08-15T15:44:00Z" },
          ],
          evidence: {
            supporting: [evidence.metricId, evidence.traceId, evidence.deploymentId],
            opposing: [],
            unexplained: [],
          },
          alternatives: ["H2", "H3", "H4"],
          proposed_tests: [
            { id: "test-1", procedure: "node --test card.unit.test.js", bounds: "pure unit suite", permissions: ["read"], expected: { this_hypothesis: "valid Visa rejected on seeded code" } },
          ],
          status: "accepted",
        },
      ],
      contradictions: [],
      gaps: [],
      next_actions: [],
      fusion_meta: {
        participant_ids: ["p1", "p2"],
        judge_id: "j1",
        synthesizer_id: "s1",
        revision_id: evidence.evidenceSet.revision_id,
        rounds: [{ round: 1, valid: true, participant_ids: ["p1", "p2"] }],
      },
      remediation_disposition: "allowed",
      sealed_at: "2026-08-15T15:46:00Z",
    },
  });

  const proposal = sealRef({
    artifact_schema_id: "remediation-proposal",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T15:50:00Z",
    producer: { skill: "sih-repair-planner", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      disposition: "allowed",
      change_description: "restore the negation in card.js card-type clause",
      diff: {
        base_ref: hashOf("base-snapshot"),
        diff_text: "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {",
        diff_hash: hashOf("diff-1"),
      },
      citations: [
        { change: "card-type clause", hypothesis_id: "H1", cited_item_ids: [evidence.metricId, evidence.traceId, evidence.deploymentId] },
      ],
      test_plan: ["card.unit.test.js", "payment.regression.test.js"],
      changed_surfaces: ["src/payment/card.js"],
      blast_radius: { services: ["payment"], environments: ["demo"], cohorts: [] },
      recovery_point: { id: hashOf("recovery-point-1"), changed_surfaces: ["src/payment/card.js", "compose service payment"] },
      sealed_at: "2026-08-15T15:50:00Z",
    },
  });

  const reviewR1 = sealRef({
    artifact_schema_id: "review-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:05:00Z",
    producer: { skill: "sih-review-correctness", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      role: "R1",
      reviewer: "reviewer-1",
      revision: 1,
      input_refs: [hashOf("diff-1"), hashOf("base-snapshot"), POLICY],
      findings: [
        {
          id: "f1",
          severity: "minor",
          claim: "restores the intended card-type gate",
          citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: "diff-1" }],
          status: "open",
        },
      ],
      status: "pass",
      sealed_at: "2026-08-15T16:05:00Z",
    },
  });

  const testT3 = sealRef({
    artifact_schema_id: "test-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:10:00Z",
    producer: { skill: "sih-test-unit", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      layer: "T3",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/card.unit.test.js",
      receipt_ref: "receipt-t3",
      runs: [{ run_hash: hashOf("t3-run"), result: "pass", at: "2026-08-15T16:10:00Z" }],
      outcome: "pass",
      flaky: false,
      coverage_checked: true,
      sealed_at: "2026-08-15T16:10:00Z",
    },
  });

  const testT5 = sealRef({
    artifact_schema_id: "test-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:12:00Z",
    producer: { skill: "sih-test-regression", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      layer: "T5",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/payment.regression.test.js",
      receipt_ref: "receipt-t5",
      runs: [{ run_hash: hashOf("t5-run"), result: "pass", at: "2026-08-15T16:12:00Z" }],
      outcome: "pass",
      flaky: false,
      coverage_checked: true,
      sealed_at: "2026-08-15T16:12:00Z",
    },
  });

  const verification = sealRef({
    artifact_schema_id: "verification-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:15:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0", resolver_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      applicability: {
        resolver_version: "1.0",
        policy_version: POLICY,
        required: ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
        conditional: ["R5", "R6", "R7", "R9", "T6", "T8", "T9", "T10", "T11", "T12", "T13"],
        triggered: { T9: "candidate target exists", T10: "storefront path", T12: "restore action", T13: "watch plan present" },
        not_applicable: ["R5", "R6", "R7", "R9", "T6", "T8", "T11"],
      },
      reviews: [
        { role: "R1", reviewer: "reviewer-1", revision: 1, status: "pass", sealed_at: "2026-08-15T16:05:00Z" },
      ],
      tests: [
        { layer: "T3", tool: "node --test", tool_version: "26.4.0", receipt_ref: "receipt-t3", outcome: "pass", flaky: false },
        { layer: "T5", tool: "node --test", tool_version: "26.4.0", receipt_ref: "receipt-t5", outcome: "pass", flaky: false },
      ],
      hash_binding: { sealed_candidate: candidate, checked_candidate: candidate, match: true },
      verdict: "pass",
      verdict_reason: "all required and triggered checks passed",
      sealed_at: "2026-08-15T16:15:00Z",
      policy_version: POLICY,
    },
  });

  const rolloutWatchPlan = sealRef({
    artifact_schema_id: "rollout-watch-plan",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:18:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: candidate,
      rollout: {
        strategy: "canary",
        stages: [
          { id: "candidate-probe", traffic_percent: 0, minimum_duration_seconds: 60, minimum_sample_count: 20 },
          { id: "demo-live", traffic_percent: 100, minimum_duration_seconds: 180, minimum_sample_count: 60 },
        ],
      },
      watch_queries: [
        {
          id: "G2",
          signal: "payment error ratio",
          backend: "prometheus",
          query: "sum(rate(payment_errors_total[1m])) / clamp_min(sum(rate(payment_requests_total[1m])), 0.001)",
          window_seconds: 60,
          minimum_sample_count: 60,
          comparator: "less-than",
          limit: 0.05,
          unit: "1",
        },
      ],
      stop_rules: [
        { id: "severe-payment-regression", condition: "payment error ratio >= 0.20", action: "rollback" },
      ],
      missing_data_rule: "needs-human",
      policy_version: POLICY,
      sealed_at: "2026-08-15T16:18:00Z",
    },
  });

  const watchReport = sealRef({
    artifact_schema_id: "watch-report",
    incident_id: incidentId,
    run_id: "run-1",
    sealed_at: "2026-08-15T16:40:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      rollout_stage: "2",
      plan_ref: rolloutWatchPlan.envelope.content_hash,
      samples: [
        {
          gate: "G2",
          query: "sum(rate(...)) / clamp_min(sum(rate(...)), 0.001)",
          time_range: { starts_at: "2026-08-15T16:30:00Z", ends_at: "2026-08-15T16:31:00Z" },
          sample_count: 60,
          value: 0.03,
          limit: 0.05,
          outcome: "pass",
        },
        {
          gate: "G5",
          query: "sum(rate(...)) / clamp_min(sum(rate(...)), 0.001)",
          baseline_cohort: "seeded-digest",
          candidate_cohort: "candidate-digest",
          time_range: { starts_at: "2026-08-15T16:30:00Z", ends_at: "2026-08-15T16:31:00Z" },
          sample_count: 60,
          value: 0.03,
          limit: 0.05,
          outcome: "pass",
        },
      ],
      stage_outcome: "pass",
      sealed_at: "2026-08-15T16:40:00Z",
    },
  });

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
    evaluated_at: "2026-08-15T16:20:00Z",
    policy_version: POLICY,
    tzdb_version: TZDB,
  };

  const events: JournalEvent[] = [];
  let seq = 0;
  const push = (type: string, idem: string, rest: Record<string, unknown>) => {
    seq += 1;
    events.push(ev(type, seq, incidentId, idem, rest));
  };

  push("trigger_received", "trig-1", { trigger: trigger(incidentId, deliveryKeyOf("prometheus-alertmanager", "firing"), "firing"), delivery_result: "incident-created" });
  push("incident_transition", "inc-t-1", { from: null, to: "open", expected_version: 0 });
  push("run_transition", "run-t-1", { run_id: "run-1", attempt: 1, from: null, to: "queued", expected_run_version: 0 });
  push("run_transition", "run-t-2", { run_id: "run-1", attempt: 1, from: "queued", to: "running", expected_run_version: 1 });

  const stage = (stage: string, from: string | null, to: string, extra: Record<string, unknown>) =>
    push("stage_transition", `stage-${stage}-${from ?? "null"}-${to}`, { run_id: "run-1", attempt: 1, stage, from, to, ...extra });

  stage("detect", null, "entered", {});
  stage("detect", "entered", "in-progress", {});
  stage("detect", "in-progress", "completed", { artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } });
  push("artifact_sealed", "art-brief", { run_id: "run-1", artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } });
  stage("diagnose", null, "entered", {});
  stage("diagnose", "entered", "in-progress", {});
  stage("diagnose", "in-progress", "completed", { artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } });
  push("gate_evaluated", "gate-hyp", { run_id: "run-1", attempt: 1, gate: "hypothesis", evaluation: hypothesisGateEval(evidence.metricId, evidence.traceId, evidence.deploymentId, evidence.flagId) });
  push("artifact_sealed", "art-diagnosis", { run_id: "run-1", artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } });
  stage("repair", null, "entered", {});
  stage("repair", "entered", "in-progress", {});
  stage("repair", "in-progress", "completed", { candidate_hash: candidate, artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } });
  push("artifact_sealed", "art-proposal", { run_id: "run-1", artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } });
  stage("verify", null, "entered", {});
  stage("verify", "entered", "in-progress", {});
  push("broker_receipt_recorded", "receipt-t3", {
    run_id: "run-1",
    stage: "verify",
    receipt: {
      kind: "test",
      receipt_id: "receipt-t3",
      idempotency_key: "test-t3",
      lease_id: "lease-1",
      stage: "verify",
      candidate_hash: candidate,
      layer: "T3",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/card.unit.test.js",
      runs: [{ run_hash: hashOf("t3-run"), result: "pass", at: "2026-08-15T16:10:00Z" }],
      outcome: "pass",
      flaky: false,
    },
  });
  push("broker_receipt_recorded", "receipt-t5", {
    run_id: "run-1",
    stage: "verify",
    receipt: {
      kind: "test",
      receipt_id: "receipt-t5",
      idempotency_key: "test-t5",
      lease_id: "lease-1",
      stage: "verify",
      candidate_hash: candidate,
      layer: "T5",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/payment.regression.test.js",
      runs: [{ run_hash: hashOf("t5-run"), result: "pass", at: "2026-08-15T16:12:00Z" }],
      outcome: "pass",
      flaky: false,
    },
  });
  stage("verify", "in-progress", "completed", { artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } });
  push("artifact_sealed", "art-review", { run_id: "run-1", artifact_ref: { schema_id: "review-report", schema_version: "1.0", content_hash: reviewR1.envelope.content_hash } });
  push("artifact_sealed", "art-verification", { run_id: "run-1", artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } });
  push("artifact_sealed", "art-rollout-watch-plan", { run_id: "run-1", artifact_ref: { schema_id: "rollout-watch-plan", schema_version: "1.0", content_hash: rolloutWatchPlan.envelope.content_hash } });
  stage("release", null, "entered", {});
  stage("release", "entered", "in-progress", {});
  push("policy_decision", "policy-1", {
    run_id: "run-1",
    decision: "approval-required",
    tzdb_version: TZDB,
    window: { iana_zone: "America/New_York", windows: [{ start_weekday: "mon", start_time: "09:00", end_weekday: "fri", end_time: "18:00" }] },
    evaluated_at: "2026-08-15T16:20:00Z",
    reason: "deploy lands outside the autonomous window",
  });
  push("approval_recorded", "approval-1", {
    run_id: "run-1",
    approval: {
      approval_id: "approval-1",
      action_digest: candidate,
      approver_identity: "demo-operator",
      approval_system: "demo-workspace",
      policy_version: POLICY,
      tzdb_version: TZDB,
      action_risk_class: "safe",
      expiry: "2026-08-15T16:50:00Z",
      scope: { target: "payment", changed_surfaces: ["src/payment/card.js"] },
      action: "granted",
    },
  });
  push("broker_receipt_recorded", "receipt-ci", {
    run_id: "run-1",
    stage: "release",
    receipt: {
      kind: "ci",
      receipt_id: "receipt-ci",
      idempotency_key: "ci-release-1",
      lease_id: "lease-1",
      stage: "release",
      candidate_hash: candidate,
      pipeline: "demo-local-ci",
      pipeline_run_id: "pipeline-run-1",
      steps: [
        { name: "required-checks", status: "success", log_ref: hashOf("ci-log") },
      ],
      status: "success",
      artifact_digest: hashOf("candidate-artifact"),
      finished_at: "2026-08-15T16:21:00Z",
    },
  });
  push("broker_receipt_recorded", "receipt-metric", {
    run_id: "run-1",
    stage: "release",
    receipt: {
      kind: "read",
      receipt_id: "receipt-metric",
      idempotency_key: "target-version-read-1",
      lease_id: "lease-1",
      stage: "release",
      candidate_hash: candidate,
      request: {
        backend: "compose-adapter",
        connection_id: "astronomy-shop-local",
        query: "payment service version",
        resource_type: "deployment-version",
      },
      result: {
        outcome: "ok",
        content_hash: hashOf("seeded-digest"),
        observed_at: "2026-08-15T16:21:30Z",
        row_count: 1,
      },
    },
  });
  push("gate_evaluated", "gate-release", { run_id: "run-1", attempt: 1, gate: "release", evaluation: releaseGateEval });
  push("approval_recorded", "approval-1-consume", {
    run_id: "run-1",
    approval: {
      approval_id: "approval-1",
      action_digest: candidate,
      approver_identity: "demo-operator",
      approval_system: "demo-workspace",
      policy_version: POLICY,
      tzdb_version: TZDB,
      action_risk_class: "safe",
      expiry: "2026-08-15T16:50:00Z",
      scope: { target: "payment", changed_surfaces: ["src/payment/card.js"] },
      action: "consumed",
    },
  });
  push("lease_event", "lease-1", { run_id: "run-1", lease_id: "lease-release-1", lease_kind: "release", action: "issued", bound_candidate_hash: candidate });
  stage("release", "in-progress", "completed", {});
  stage("watch", null, "entered", {});
  stage("watch", "entered", "in-progress", {});
  stage("watch", "in-progress", "completed", { artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: watchReport.envelope.content_hash } });
  push("artifact_sealed", "art-watch", { run_id: "run-1", artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: watchReport.envelope.content_hash } });
  push("model_use", "model-1", {
    run_id: "run-1",
    parent_agent_id: "orchestrator-1",
    agent_id: "synthesizer-1",
    agent_role: "synthesizer",
    model: "primary-model",
    token_use: { prompt_tokens: 1200, completion_tokens: 300 },
    tool_calls: [],
  });
  push("run_transition", "run-t-3", { run_id: "run-1", attempt: 1, from: "running", to: "completed", outcome: "verified-remediation", expected_run_version: 2 });
  push("incident_transition", "inc-t-2", { from: "open", to: "resolved", expected_version: 1 });
  push("trigger_received", "trig-2", { trigger: trigger(incidentId, deliveryKeyOf("prometheus-alertmanager", "resolved"), "resolved"), delivery_result: "evidence-appended" });
  push("incident_transition", "inc-t-3", { from: "resolved", to: "closed", closure_reason: "symptom-cleared", expected_version: 2 });

  return { incidentId, finalSequence: seq, events, envelopes };
}

function buildRun2(): BuildRun {
  const incidentId = "inc-demo-payment-2";
  const evidence = buildEvidence(incidentId);

  const recoveryPointHash = contentHashOf({
    surfaces: ["src/payment/card.js", "compose service payment"],
    restore_command: "docker compose up -d payment",
  });

  const cand = candidateHash({
    schema_version: "1.0",
    base_ref: hashOf("base-snapshot-s2"),
    change: {
      kind: "diff",
      base_ref: hashOf("base-snapshot-s2"),
      diff_text: "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {",
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
  });
  if (!cand.ok) {
    throw new Error(cand.error.message);
  }
  const candidate = cand.value;

  const envelopes: SealedEnvelope[] = [];
  const sealRef = (spec: EnvelopeSpec) => {
    const sealed = seal(spec);
    envelopes.push(sealed);
    return sealed;
  };

  const brief = sealRef({
    artifact_schema_id: "incident-brief",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T15:42:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      symptom: "every charge fails on the card-type check",
      initial_evidence_item_ids: evidence.ids,
      policy_version: POLICY,
      sealed_at: "2026-08-15T15:42:00Z",
    },
  });

  const evidenceSet = sealRef({
    artifact_schema_id: "evidence-set",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T15:41:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    redaction: { profile_id: "demo-profile", masked_fields: ["/items/0/snapshot/secret"] },
    payload: evidence.evidenceSet,
  });

  const diagnosis = sealRef({
    artifact_schema_id: "diagnosis-report",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T15:46:00Z",
    producer: { skill: "sih-fusion-synthesizer", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      hypotheses: [
        {
          schema_version: "1.0",
          id: "H1",
          incident_id: incidentId,
          incident_run_id: "run-2",
          attempt: 1,
          round: 1,
          causal_claim: {
            trigger: "card-type clause inverted in S2",
            defect: "src/payment/card.js card-type check drops negation",
            propagation: [{ from: "S2 commit", to: "charge fails", cited_item_ids: [evidence.deploymentId, evidence.metricId] }],
            failure: "payment error ratio above threshold",
          },
          affected_scope: {
            service_names: ["payment"],
            deployment_environment_names: ["demo"],
            versions: ["seeded-s2-digest"],
            window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null },
          },
          predicted_observations: [
            { id: "pred-1", statement: "valid Visa fails on seeded code", registered_at: "2026-08-15T15:44:00Z" },
          ],
          evidence: {
            supporting: [evidence.metricId, evidence.traceId, evidence.deploymentId],
            opposing: [],
            unexplained: [],
          },
          alternatives: ["H2", "H3", "H4"],
          proposed_tests: [
            { id: "test-1", procedure: "node --test card.unit.test.js", bounds: "pure unit suite", permissions: ["read"], expected: { this_hypothesis: "valid Visa rejected on seeded code" } },
          ],
          status: "accepted",
        },
      ],
      contradictions: [],
      gaps: [],
      next_actions: [],
      fusion_meta: {
        participant_ids: ["p1", "p2"],
        judge_id: "j1",
        synthesizer_id: "s1",
        revision_id: evidence.evidenceSet.revision_id,
        rounds: [{ round: 1, valid: true, participant_ids: ["p1", "p2"] }],
      },
      remediation_disposition: "allowed",
      sealed_at: "2026-08-15T15:46:00Z",
    },
  });

  const proposal = sealRef({
    artifact_schema_id: "remediation-proposal",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T15:50:00Z",
    producer: { skill: "sih-repair-planner", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      candidate_hash: candidate,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      disposition: "allowed",
      change_description: "restore the negation in card.js card-type clause",
      diff: {
        base_ref: hashOf("base-snapshot-s2"),
        diff_text: "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {",
        diff_hash: hashOf("diff-2"),
      },
      citations: [
        { change: "card-type clause", hypothesis_id: "H1", cited_item_ids: [evidence.metricId, evidence.traceId, evidence.deploymentId] },
      ],
      test_plan: ["card.unit.test.js", "payment.regression.test.js"],
      changed_surfaces: ["src/payment/card.js"],
      blast_radius: { services: ["payment"], environments: ["demo"], cohorts: [] },
      recovery_point: { id: hashOf("recovery-point-2"), changed_surfaces: ["src/payment/card.js", "compose service payment"] },
      sealed_at: "2026-08-15T15:50:00Z",
    },
  });

  const reviewR1 = sealRef({
    artifact_schema_id: "review-report",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T16:05:00Z",
    producer: { skill: "sih-review-correctness", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      candidate_hash: candidate,
      role: "R1",
      reviewer: "reviewer-1",
      revision: 1,
      input_refs: [hashOf("diff-2"), hashOf("base-snapshot-s2"), POLICY],
      findings: [
        {
          id: "f1",
          severity: "major",
          claim: "restoring the card-type check makes the adjacent missing Luhn guard reachable",
          citations: [{ kind: "file-line", file: "src/payment/card.js", line: 9, ref: "diff-2" }],
          status: "open",
        },
      ],
      status: "fail",
      sealed_at: "2026-08-15T16:05:00Z",
    },
  });

  const testT3 = sealRef({
    artifact_schema_id: "test-report",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T16:10:00Z",
    producer: { skill: "sih-test-unit", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      candidate_hash: candidate,
      layer: "T3",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/card.unit.test.js",
      receipt_ref: "receipt-t3",
      runs: [{ run_hash: hashOf("t3-run-2"), result: "pass", at: "2026-08-15T16:10:00Z" }],
      outcome: "pass",
      flaky: false,
      coverage_checked: true,
      sealed_at: "2026-08-15T16:10:00Z",
    },
  });

  const testT5 = sealRef({
    artifact_schema_id: "test-report",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T16:12:00Z",
    producer: { skill: "sih-test-regression", skill_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      candidate_hash: candidate,
      layer: "T5",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/payment.regression.test.js",
      receipt_ref: "receipt-t5",
      runs: [{ run_hash: hashOf("t5-run-2"), result: "fail", at: "2026-08-15T16:12:00Z", detail: "Luhn-failing Visa is rejected" }],
      outcome: "fail",
      flaky: false,
      coverage_checked: true,
      sealed_at: "2026-08-15T16:12:00Z",
    },
  });

  const verification = sealRef({
    artifact_schema_id: "verification-report",
    incident_id: incidentId,
    run_id: "run-2",
    sealed_at: "2026-08-15T16:15:00Z",
    producer: { skill: "sih-orchestrator", skill_version: "1.0", resolver_version: "1.0" },
    payload: {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-2",
      attempt: 1,
      candidate_hash: candidate,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      applicability: {
        resolver_version: "1.0",
        policy_version: POLICY,
        required: ["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"],
        conditional: ["R5", "R6", "R7", "R9", "T6", "T8", "T9", "T10", "T11", "T12", "T13"],
        triggered: { T9: "candidate target exists", T10: "storefront path", T12: "restore action", T13: "watch plan present" },
        not_applicable: ["R5", "R6", "R7", "R9", "T6", "T8", "T11"],
      },
      reviews: [
        { role: "R1", reviewer: "reviewer-1", revision: 1, status: "fail", sealed_at: "2026-08-15T16:05:00Z" },
      ],
      tests: [
        { layer: "T3", tool: "node --test", tool_version: "26.4.0", receipt_ref: "receipt-t3", outcome: "pass", flaky: false },
        { layer: "T5", tool: "node --test", tool_version: "26.4.0", receipt_ref: "receipt-t5", outcome: "fail", flaky: false },
      ],
      hash_binding: { sealed_candidate: candidate, checked_candidate: candidate, match: true },
      verdict: "fail",
      verdict_reason: "required T5 regression check failed on the Luhn-failing Visa case",
      sealed_at: "2026-08-15T16:15:00Z",
      policy_version: POLICY,
    },
  });

  const events: JournalEvent[] = [];
  let seq = 0;
  const push = (type: string, idem: string, rest: Record<string, unknown>) => {
    seq += 1;
    events.push(ev(type, seq, incidentId, idem, rest));
  };

  push("trigger_received", "trig-1", { trigger: trigger(incidentId, deliveryKeyOf("prometheus-alertmanager", "firing"), "firing"), delivery_result: "incident-created" });
  push("incident_transition", "inc-t-1", { from: null, to: "open", expected_version: 0 });
  push("run_transition", "run-t-1", { run_id: "run-2", attempt: 1, from: null, to: "queued", expected_run_version: 0 });
  push("run_transition", "run-t-2", { run_id: "run-2", attempt: 1, from: "queued", to: "running", expected_run_version: 1 });

  const stage = (stage: string, from: string | null, to: string, extra: Record<string, unknown>) =>
    push("stage_transition", `stage-${stage}-${from ?? "null"}-${to}`, { run_id: "run-2", attempt: 1, stage, from, to, ...extra });

  stage("detect", null, "entered", {});
  stage("detect", "entered", "in-progress", {});
  stage("detect", "in-progress", "completed", { artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } });
  push("artifact_sealed", "art-brief", { run_id: "run-2", artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: brief.envelope.content_hash } });
  stage("diagnose", null, "entered", {});
  stage("diagnose", "entered", "in-progress", {});
  stage("diagnose", "in-progress", "completed", { artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } });
  push("gate_evaluated", "gate-hyp", { run_id: "run-2", attempt: 1, gate: "hypothesis", evaluation: hypothesisGateEval(evidence.metricId, evidence.traceId, evidence.deploymentId, evidence.flagId) });
  push("artifact_sealed", "art-diagnosis", { run_id: "run-2", artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: diagnosis.envelope.content_hash } });
  stage("repair", null, "entered", {});
  stage("repair", "entered", "in-progress", {});
  stage("repair", "in-progress", "completed", { candidate_hash: candidate, artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } });
  push("artifact_sealed", "art-proposal", { run_id: "run-2", artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: proposal.envelope.content_hash } });
  stage("verify", null, "entered", {});
  stage("verify", "entered", "in-progress", {});
  push("broker_receipt_recorded", "receipt-t3", {
    run_id: "run-2",
    stage: "verify",
    receipt: {
      kind: "test",
      receipt_id: "receipt-t3",
      idempotency_key: "test-t3",
      lease_id: "lease-1",
      stage: "verify",
      candidate_hash: candidate,
      layer: "T3",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/card.unit.test.js",
      runs: [{ run_hash: hashOf("t3-run-2"), result: "pass", at: "2026-08-15T16:10:00Z" }],
      outcome: "pass",
      flaky: false,
    },
  });
  push("broker_receipt_recorded", "receipt-t5", {
    run_id: "run-2",
    stage: "verify",
    receipt: {
      kind: "test",
      receipt_id: "receipt-t5",
      idempotency_key: "test-t5",
      lease_id: "lease-1",
      stage: "verify",
      candidate_hash: candidate,
      layer: "T5",
      tool: "node --test",
      tool_version: "26.4.0",
      target: "src/payment/payment.regression.test.js",
      runs: [{ run_hash: hashOf("t5-run-2"), result: "fail", at: "2026-08-15T16:12:00Z", detail: "Luhn-failing Visa is rejected" }],
      outcome: "fail",
      flaky: false,
    },
  });
  stage("verify", "in-progress", "failed", { artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } });
  push("artifact_sealed", "art-review", { run_id: "run-2", artifact_ref: { schema_id: "review-report", schema_version: "1.0", content_hash: reviewR1.envelope.content_hash } });
  push("artifact_sealed", "art-verification", { run_id: "run-2", artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: verification.envelope.content_hash } });
  push("run_transition", "run-t-3", { run_id: "run-2", attempt: 1, from: "running", to: "failed", failure_reason: "verification-failed", expected_run_version: 2 });

  return { incidentId, finalSequence: seq, events, envelopes };
}

interface BundleFiles {
  files: Map<string, string>;
  incidents: Array<{ incident_id: string; final_sequence: number }>;
}

function buildBundle(runs: BuildRun[]): BundleFiles {
  const files = new Map<string, string>();
  const incidents: Array<{ incident_id: string; final_sequence: number }> = [];

  for (const run of runs) {
    const lines = run.events.map((e) => `${JSON.stringify(e)}\n`).join("");
    files.set(`incidents/${run.incidentId}/journal.jsonl`, lines);
    incidents.push({ incident_id: run.incidentId, final_sequence: run.finalSequence });
    for (const sealed of run.envelopes) {
      files.set(`artifacts/sha256/${sealed.fileName}`, sealed.bytes);
    }
  }

  const manifest = buildManifest(files, incidents);
  files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return { files, incidents };
}

const MANIFEST_PATH = "manifest.json";

function buildManifest(
  files: Map<string, string>,
  incidents: Array<{ incident_id: string; final_sequence: number }>,
  captureTime = CAPTURE_TIME,
): SavedBundleManifest {
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path) ?? "";
    fileEntries[path] = {
      sha256: `sha256:${hex(bytes)}`,
      size: new TextEncoder().encode(bytes).byteLength,
    };
  }
  return {
    format_version: "1.0",
    capture_time: captureTime,
    incident_ids: incidents,
    files: fileEntries,
  };
}


const INVALID_CASES = [
  { name: "bad-sequence", expected_code: "BAD_SEQUENCE" },
  { name: "duplicate-idempotency", expected_code: "DUPLICATE_TRANSITION" },
  { name: "illegal-run-transition", expected_code: "ILLEGAL_TRANSITION" },
  { name: "illegal-stage-transition", expected_code: "ILLEGAL_TRANSITION" },
  { name: "stale-schema", expected_code: "STALE_SCHEMA" },
  { name: "unknown-schema", expected_code: "UNKNOWN_SCHEMA" },
  { name: "redaction-mismatch", expected_code: "REDACTION_FAILURE" },
  { name: "missing-artifact", expected_code: "MISSING_ARTIFACT" },
  { name: "changed-content", expected_code: "CHANGED_CONTENT" },
  { name: "changed-payload", expected_code: "CHANGED_CONTENT" },
  { name: "bad-path", expected_code: "INVALID_PATH" },
  { name: "stale-evidence", expected_code: "STALE_DATA" },
  { name: "unlisted-file", expected_code: "MALFORMED_CONTRACT" },
  { name: "artifact-context-mismatch", expected_code: "MALFORMED_CONTRACT" },
  { name: "gate-evidence-missing", expected_code: "MISSING_ARTIFACT" },
  { name: "report-receipt-missing", expected_code: "MISSING_ARTIFACT" },
] as const;

const valid = buildBundle([buildRun1(), buildRun2()]);

// ---------- Write outputs ----------

const ROOT = join(dirname(import.meta.dir), "..", "..", "demo", "fixtures", "contracts");
const INVALID_DIR = join(ROOT, "invalid");

async function writeBundle(dir: string, files: Map<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [path, bytes] of files) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, "utf8");
  }
}

async function main(): Promise<void> {
  await rm(join(ROOT, "valid"), { recursive: true, force: true });
  await writeBundle(join(ROOT, "valid"), valid.files);
  await rm(INVALID_DIR, { recursive: true, force: true });
  await writeFile(
    join(ROOT, "invalid-cases.json"),
    `${JSON.stringify(INVALID_CASES, null, 2)}\n`,
    "utf8",
  );
  const manifest = JSON.parse(valid.files.get(MANIFEST_PATH) ?? "{}") as SavedBundleManifest;
  console.log(`wrote valid bundle: ${valid.files.size} files`);
  console.log(`incidents: ${manifest.incident_ids.map((i) => `${i.incident_id}@${i.final_sequence}`).join(", ")}`);
  console.log(`invalid cases: ${INVALID_CASES.length}`);
}

void main();
