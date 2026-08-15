/**
 * Hash input v1, from docs/research/hypothesis-gate.md and
 * docs/research/review-verification.md. These schemas are the canonical
 * preimage shapes for the derived hashes in the `hashes` module. They are
 * published so an integrator can reproduce any hash without re-implementing
 * the hashing code.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1 } from "./defs.js";

const CHANGE = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "base_ref", "diff_text"],
      properties: {
        kind: { const: "diff" },
        base_ref: { type: "string", minLength: 1 },
        diff_text: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "adapter", "action_class", "command"],
      properties: {
        kind: { const: "typed-action-plan" },
        adapter: { type: "string", minLength: 1 },
        action_class: { type: "string", minLength: 1 },
        command: { type: "string", minLength: 1 },
      },
    },
  ],
} as const;

/** The JSON Schema for the full candidate-hash input. */
export const candidateHashInputSchema = {
  $id: "https://contracts.sih.dev/candidate-hash-input/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Candidate Hash Input v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "base_ref",
    "change",
    "proposal",
    "changed_surfaces",
    "action_risk_class",
    "gate_path",
    "target",
    "recovery_point_hash",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    base_ref: { type: "string", minLength: 1 },
    change: CHANGE,
    proposal: {
      type: "object",
      additionalProperties: false,
      required: ["remediation_class", "disposition"],
      properties: {
        remediation_class: {
          enum: [
            "code",
            "configuration",
            "feature-flags",
            "deployment",
            "restart-scale-traffic",
            "infrastructure",
            "database-data",
            "credentials",
            "emergency-rollback",
          ],
        },
        disposition: {
          enum: ["allowed", "approval-required", "prohibited", "observe-only"],
        },
        description_hash: HASH_STRING,
      },
    },
    changed_surfaces: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    action_risk_class: { enum: ["safe", "guarded", "barred"] },
    gate_path: { enum: ["release", "action"] },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["tenant_id", "deployment_environment_name", "service_name"],
      properties: {
        tenant_id: { type: "string", minLength: 1 },
        deployment_environment_name: { type: "string", minLength: 1 },
        service_name: { type: "string", minLength: 1 },
        expected_version: { type: "string", minLength: 1 },
      },
    },
    recovery_point_hash: HASH_STRING,
  },
} as const;

/** The preimage shape of a candidate hash. */
export type CandidateHashInput = FromSchema<typeof candidateHashInputSchema>;

/** The JSON Schema for an evidence-item identity hash input. */
export const evidenceHashInputSchema = {
  $id: "https://contracts.sih.dev/evidence-hash-input/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Evidence Hash Input v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "kind", "identity", "content"],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    kind: {
      enum: [
        "metric",
        "trace",
        "log",
        "security-finding",
        "deployment-event",
        "code-location",
        "test-result",
      ],
    },
    identity: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        trace_id: { type: "string", minLength: 1 },
        span_id: { type: "string", minLength: 1 },
        metric_name: { type: "string", minLength: 1 },
        metric_labels: { type: "object" },
        window: {
          type: "object",
          additionalProperties: false,
          required: ["starts_at", "ends_at"],
          properties: {
            starts_at: { type: "string", format: "date-time" },
            ends_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        commit: { type: "string", minLength: 1 },
        diff_hash: HASH_STRING,
        flag_key: { type: "string", minLength: 1 },
        code_file_path: { type: "string", minLength: 1 },
        code_line_number: { type: "integer", minimum: 1 },
        code_function_name: { type: "string", minLength: 1 },
        before_version: { type: "string", minLength: 1 },
        after_version: { type: "string", minLength: 1 },
        applied_at: { type: "string", format: "date-time" },
        hypothesis_id: { type: "string", minLength: 1 },
        prediction_id: { type: "string", minLength: 1 },
        receipt_ref: { type: "string", minLength: 1 },
        service_name: { type: "string", minLength: 1 },
        deployment_environment_name: { type: "string", minLength: 1 },
      },
    },
    content: true,
  },
} as const;

/** The preimage shape of an evidence item id. */
export type EvidenceHashInput = FromSchema<typeof evidenceHashInputSchema>;

/** The JSON Schema for a stable Incident key input. */
export const incidentKeyInputSchema = {
  $id: "https://contracts.sih.dev/incident-key-input/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident Key Input v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "tenant_id", "deployment_environment_name", "service_name", "detector_key"],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    tenant_id: { type: "string", minLength: 1 },
    deployment_environment_name: { type: "string", minLength: 1 },
    service_name: { type: "string", minLength: 1 },
    detector_key: { type: "string", minLength: 1 },
  },
} as const;

/** The preimage shape of an incident key. */
export type IncidentKeyInput = FromSchema<typeof incidentKeyInputSchema>;

/** The JSON Schema for an exact trigger delivery key input. */
export const deliveryKeyInputSchema = {
  $id: "https://contracts.sih.dev/delivery-key-input/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Delivery Key Input v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "source", "alert_fingerprint", "status", "starts_at", "ends_at"],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    source: { type: "string", minLength: 1 },
    alert_fingerprint: { type: "string", minLength: 1 },
    status: { enum: ["firing", "resolved"] },
    starts_at: { type: "string", format: "date-time" },
    ends_at: { type: ["string", "null"], format: "date-time" },
  },
} as const;

/** The preimage shape of a delivery key. */
export type DeliveryKeyInput = FromSchema<typeof deliveryKeyInputSchema>;
