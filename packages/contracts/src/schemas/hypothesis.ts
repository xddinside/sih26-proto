/**
 * Hypothesis v1, from docs/research/hypothesis-gate.md. A structured causal
 * claim with cited evidence, predicted observations, alternatives, and
 * proposed discriminating tests. An accepted Hypothesis is still a Hypothesis,
 * never called root cause until Remediation and Watch confirm it.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1, TIMESTAMP } from "./defs.js";

const HYPOTHESIS_STATUS = {
  enum: ["proposed", "testing", "accepted", "rejected", "superseded", "confirmed"],
} as const;

/** The JSON Schema for an evidence-linked root-cause Hypothesis. */
export const hypothesisSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Hypothesis v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "id",
    "incident_id",
    "incident_run_id",
    "attempt",
    "round",
    "causal_claim",
    "affected_scope",
    "predicted_observations",
    "evidence",
    "alternatives",
    "proposed_tests",
    "status",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    id: { type: "string", minLength: 1 },
    incident_id: { type: "string", minLength: 1 },
    incident_run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    round: { type: "integer", minimum: 1 },
    causal_claim: {
      type: "object",
      additionalProperties: false,
      required: ["trigger", "defect", "propagation", "failure"],
      properties: {
        trigger: { type: "string", minLength: 1 },
        defect: { type: "string", minLength: 1 },
        propagation: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "cited_item_ids"],
            properties: {
              from: { type: "string", minLength: 1 },
              to: { type: "string", minLength: 1 },
              cited_item_ids: {
                type: "array",
                items: HASH_STRING,
                uniqueItems: true,
              },
            },
          },
        },
        failure: { type: "string", minLength: 1 },
      },
    },
    affected_scope: {
      type: "object",
      additionalProperties: false,
      required: ["service_names", "deployment_environment_names", "versions", "window"],
      properties: {
        service_names: { type: "array", items: { type: "string", minLength: 1 } },
        deployment_environment_names: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        versions: { type: "array", items: { type: "string", minLength: 1 } },
        window: {
          type: "object",
          additionalProperties: false,
          required: ["starts_at", "ends_at"],
          properties: {
            starts_at: TIMESTAMP,
            ends_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        cohorts: { type: "array", items: { type: "string", minLength: 1 } },
      },
    },
    predicted_observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "registered_at"],
        properties: {
          id: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
          discriminates: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          registered_at: TIMESTAMP,
        },
      },
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["supporting", "opposing", "unexplained"],
      properties: {
        supporting: { type: "array", items: HASH_STRING, uniqueItems: true },
        opposing: { type: "array", items: HASH_STRING, uniqueItems: true },
        unexplained: { type: "array", items: HASH_STRING, uniqueItems: true },
      },
    },
    alternatives: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    proposed_tests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "procedure", "bounds", "permissions", "expected"],
        properties: {
          id: { type: "string", minLength: 1 },
          procedure: { type: "string", minLength: 1 },
          bounds: { type: "string", minLength: 1 },
          permissions: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          expected: {
            type: "object",
            additionalProperties: false,
            required: ["this_hypothesis"],
            properties: {
              this_hypothesis: { type: "string", minLength: 1 },
              alternative_id: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    status: HYPOTHESIS_STATUS,
  },
} as const;

/** The wire shape of a Hypothesis. */
export type Hypothesis = FromSchema<typeof hypothesisSchema>;
