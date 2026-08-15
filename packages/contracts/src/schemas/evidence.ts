/**
 * Evidence Item and Evidence Set revision metadata, from
 * docs/research/hypothesis-gate.md. Items are append-only and revision-hashed;
 * each item carries provenance, trust class, freshness, hashes, joins, and
 * redaction marks. Models never mint items.
 */
import type { FromSchema } from "json-schema-to-ts";

import {
  HASH_STRING,
  NULLABLE_TIMESTAMP,
  REDACTION,
  SCHEMA_VERSION_1,
  TIMESTAMP,
} from "./defs.js";

const EVIDENCE_KIND = {
  enum: [
    "metric",
    "trace",
    "log",
    "security-finding",
    "deployment-event",
    "code-location",
    "test-result",
  ],
} as const;

const EVIDENCE_BACKEND = {
  enum: [
    "prometheus",
    "jaeger",
    "opensearch",
    "git",
    "ci",
    "flagd",
    "broker-receipt",
    "compose-adapter",
    "local-ci-runner",
  ],
} as const;

const EVIDENCE_IDENTITY = {
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
        starts_at: TIMESTAMP,
        ends_at: NULLABLE_TIMESTAMP,
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
    applied_at: TIMESTAMP,
    hypothesis_id: { type: "string", minLength: 1 },
    prediction_id: { type: "string", minLength: 1 },
    receipt_ref: { type: "string", minLength: 1 },
    service_name: { type: "string", minLength: 1 },
    deployment_environment_name: { type: "string", minLength: 1 },
  },
} as const;

const EVIDENCE_JOINS = {
  type: "object",
  additionalProperties: false,
  properties: {
    service_name: { type: "string", minLength: 1 },
    service_version: { type: "string", minLength: 1 },
    deployment_environment_name: { type: "string", minLength: 1 },
    tenant_id: { type: "string", minLength: 1 },
    code_file_path: { type: "string", minLength: 1 },
    code_line_number: { type: "integer", minimum: 1 },
    code_function_name: { type: "string", minLength: 1 },
  },
} as const;

/** The JSON Schema for one evidence item. */
export const evidenceItemSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Evidence Item v1",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "kind",
    "backend",
    "identity",
    "snapshot",
    "content_hash",
    "links",
    "observed_at",
    "provenance",
    "trust",
    "joins",
    "redaction",
    "outcome",
  ],
  properties: {
    id: HASH_STRING,
    kind: EVIDENCE_KIND,
    backend: EVIDENCE_BACKEND,
    identity: EVIDENCE_IDENTITY,
    query: { type: "string" },
    snapshot: true,
    content_hash: HASH_STRING,
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["uri"],
        properties: {
          uri: { type: "string", format: "uri" },
          expired: { type: "boolean" },
        },
      },
    },
    observed_at: TIMESTAMP,
    window: {
      type: "object",
      additionalProperties: false,
      required: ["starts_at", "ends_at"],
      properties: {
        starts_at: TIMESTAMP,
        ends_at: NULLABLE_TIMESTAMP,
      },
    },
    fresh_until: NULLABLE_TIMESTAMP,
    provenance: { type: "array", items: { type: "string", minLength: 1 } },
    trust: { enum: ["backend", "test-result", "human"] },
    joins: EVIDENCE_JOINS,
    redaction: REDACTION,
    outcome: { enum: ["ok", "unresolved", "expired", "quarantined"] },
    supersedes: { type: "array", items: HASH_STRING, uniqueItems: true },
    contradicts: { type: "array", items: HASH_STRING, uniqueItems: true },
  },
  allOf: [
    {
      if: { properties: { kind: { const: "metric" } }, required: ["kind"] },
      then: {
        properties: {
          identity: {
            ...EVIDENCE_IDENTITY,
            required: ["metric_name", "metric_labels", "window"],
          },
        },
      },
    },
    {
      if: { properties: { kind: { enum: ["trace", "log"] } }, required: ["kind"] },
      then: {
        properties: {
          identity: { ...EVIDENCE_IDENTITY, required: ["trace_id", "span_id"] },
        },
      },
    },
    {
      if: { properties: { kind: { const: "code-location" } }, required: ["kind"] },
      then: {
        properties: {
          identity: {
            ...EVIDENCE_IDENTITY,
            required: ["commit", "code_file_path", "code_line_number"],
          },
        },
      },
    },
    {
      if: { properties: { kind: { const: "deployment-event" } }, required: ["kind"] },
      then: {
        properties: {
          identity: {
            ...EVIDENCE_IDENTITY,
            required: ["before_version", "after_version", "diff_hash", "applied_at"],
          },
        },
      },
    },
    {
      if: { properties: { kind: { const: "test-result" } }, required: ["kind"] },
      then: {
        properties: {
          identity: {
            ...EVIDENCE_IDENTITY,
            required: ["hypothesis_id", "prediction_id", "receipt_ref"],
          },
        },
      },
    },
  ],
} as const;

/** The wire shape of a single Evidence Set item. */
export type EvidenceItem = FromSchema<typeof evidenceItemSchema>;

/** The JSON Schema for an ordered, revision-bound evidence set. */
export const evidenceSetSchema = {
  $id: "https://contracts.sih.dev/evidence-set/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Evidence Set v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "revision_id",
    "revision_number",
    "incident_id",
    "pinned_at",
    "item_ids",
    "items",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    revision_id: HASH_STRING,
    revision_number: { type: "integer", minimum: 1 },
    incident_id: { type: "string", minLength: 1 },
    pinned_at: TIMESTAMP,
    item_ids: { type: "array", items: HASH_STRING, uniqueItems: true },
    items: { type: "array", items: evidenceItemSchema },
  },
} as const;

/** The wire shape of a pinned Evidence Set revision. */
export type EvidenceSet = FromSchema<typeof evidenceSetSchema>;
