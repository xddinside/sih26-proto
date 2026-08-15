/**
 * Gate evaluation v1, from docs/research/hypothesis-gate.md,
 * docs/research/review-verification.md, and docs/research/authority-action-risk.md.
 *
 * A gate evaluation carries only structured booleans, counts, timestamps, and
 * citations. No numeric score aggregate, no model self-reported confidence,
 * and no prose carries evidentiary weight: a check's `result` and its cited
 * items are the whole of the evidence.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, TIMESTAMP } from "./defs.js";

const COUNTS = {
  type: "object",
  additionalProperties: false,
  properties: {
    uncited_claims: { type: "integer", minimum: 0 },
    unsupported_edges: { type: "integer", minimum: 0 },
    unresolved_contradictions: { type: "integer", minimum: 0 },
    undiscriminated_material_alternatives: { type: "integer", minimum: 0 },
    executed_tests: { type: "integer", minimum: 0 },
    passed_tests: { type: "integer", minimum: 0 },
    stale_items: { type: "integer", minimum: 0 },
    unexplained_critical_items: { type: "integer", minimum: 0 },
  },
} as const;

const HYPOTHESIS_CHECK = {
  type: "object",
  additionalProperties: false,
  required: ["check", "result"],
  properties: {
    check: {
      enum: [
        "cited-coverage",
        "causal-edge-support",
        "contradiction-handling",
        "alternative-elimination",
        "reproducible-test",
        "scope-match",
        "freshness",
        "telemetry-coverage",
      ],
    },
    result: { type: "boolean" },
    counts: COUNTS,
    cited_item_ids: { type: "array", items: HASH_STRING, uniqueItems: true },
    reason: { type: "string" },
  },
} as const;

const FACT_EVIDENCE_REF = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "ref"],
  properties: {
    kind: { enum: ["receipt", "artifact", "approval"] },
    ref: { type: "string", minLength: 1 },
  },
} as const;

const FACT = {
  type: "object",
  additionalProperties: false,
  required: ["fact", "result", "evidence_refs"],
  properties: {
    fact: { type: "string", minLength: 1 },
    result: { type: "boolean" },
    evidence_refs: { type: "array", items: FACT_EVIDENCE_REF },
    counts: COUNTS,
    observed_at: TIMESTAMP,
  },
} as const;

function containsExactlyOne<const P extends "check" | "fact", const V extends string>(
  property: P,
  value: V,
) {
  return {
    contains: {
      type: "object",
      properties: { [property]: { const: value } },
      required: [property],
    },
    minContains: 1,
    maxContains: 1,
  } as const;
}

const hypothesisGateEvaluation = {
  type: "object",
  additionalProperties: false,
  required: ["gate", "hypothesis_id", "checks", "verdict", "evaluated_at", "policy_version"],
  properties: {
    gate: { const: "hypothesis" },
    hypothesis_id: { type: "string", minLength: 1 },
    checks: {
      type: "array",
      items: HYPOTHESIS_CHECK,
      minItems: 8,
      maxItems: 8,
      allOf: [
        containsExactlyOne("check", "cited-coverage"),
        containsExactlyOne("check", "causal-edge-support"),
        containsExactlyOne("check", "contradiction-handling"),
        containsExactlyOne("check", "alternative-elimination"),
        containsExactlyOne("check", "reproducible-test"),
        containsExactlyOne("check", "scope-match"),
        containsExactlyOne("check", "freshness"),
        containsExactlyOne("check", "telemetry-coverage"),
      ],
    },
    verdict: { enum: ["pass", "continue", "reject", "needs-human"] },
    evaluated_at: TIMESTAMP,
    policy_version: { type: "string", minLength: 1 },
  },
} as const;

const releaseGateEvaluation = {
  type: "object",
  additionalProperties: false,
  required: [
    "gate",
    "candidate_hash",
    "facts",
    "verdict",
    "evaluated_at",
    "policy_version",
    "tzdb_version",
  ],
  properties: {
    gate: { const: "release" },
    candidate_hash: HASH_STRING,
    facts: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        ...FACT,
        properties: {
          ...FACT.properties,
          fact: { enum: ["1", "2", "3", "4", "5", "6", "7", "8"] },
        },
      },
      allOf: [
        containsExactlyOne("fact", "1"),
        containsExactlyOne("fact", "2"),
        containsExactlyOne("fact", "3"),
        containsExactlyOne("fact", "4"),
        containsExactlyOne("fact", "5"),
        containsExactlyOne("fact", "6"),
        containsExactlyOne("fact", "7"),
        containsExactlyOne("fact", "8"),
      ],
    },
    verdict: { enum: ["pass", "fail", "needs-human"] },
    evaluated_at: TIMESTAMP,
    policy_version: { type: "string", minLength: 1 },
    tzdb_version: { type: "string", minLength: 1 },
  },
} as const;

const actionGateEvaluation = {
  type: "object",
  additionalProperties: false,
  required: [
    "gate",
    "candidate_hash",
    "facts",
    "verdict",
    "evaluated_at",
    "policy_version",
    "tzdb_version",
  ],
  properties: {
    gate: { const: "action" },
    candidate_hash: HASH_STRING,
    facts: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        ...FACT,
        properties: {
          ...FACT.properties,
          fact: { enum: ["1", "2", "3", "4", "5", "6"] },
        },
      },
      allOf: [
        containsExactlyOne("fact", "1"),
        containsExactlyOne("fact", "2"),
        containsExactlyOne("fact", "3"),
        containsExactlyOne("fact", "4"),
        containsExactlyOne("fact", "5"),
        containsExactlyOne("fact", "6"),
      ],
    },
    verdict: { enum: ["pass", "fail", "needs-human"] },
    evaluated_at: TIMESTAMP,
    policy_version: { type: "string", minLength: 1 },
    tzdb_version: { type: "string", minLength: 1 },
  },
} as const;

/** The JSON Schema for Hypothesis, Release, and Action Gate evaluations. */
export const gateEvaluationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Gate Evaluation v1",
  oneOf: [hypothesisGateEvaluation, releaseGateEvaluation, actionGateEvaluation],
} as const;

/** The wire shape of a gate evaluation. */
export type GateEvaluation = FromSchema<typeof gateEvaluationSchema>;
