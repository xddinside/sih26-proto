/**
 * Broker receipt v1, from docs/research/worker-isolation.md and
 * docs/research/review-verification.md. Receipts are the only things that own
 * numbers and facts; a model can cite a receipt but never forge one. Four
 * shaped variants: read, action, test, and CI.
 */
import type { FromSchema } from "json-schema-to-ts"

import { HASH_STRING, STAGE_NAME, TIMESTAMP } from "./defs.js"

const RECEIPT_COMMON = {
  receipt_id: { type: "string", minLength: 1 },
  idempotency_key: { type: "string", minLength: 1 },
  lease_id: { type: "string", minLength: 1 },
  stage: STAGE_NAME,
  candidate_hash: HASH_STRING,
} as const

const readReceipt = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "receipt_id",
    "idempotency_key",
    "lease_id",
    "stage",
    "request",
    "result",
  ],
  properties: {
    kind: { const: "read" },
    ...RECEIPT_COMMON,
    request: {
      type: "object",
      additionalProperties: false,
      required: ["backend", "connection_id", "query"],
      properties: {
        backend: { type: "string", minLength: 1 },
        connection_id: { type: "string", minLength: 1 },
        query: { type: "string", minLength: 1 },
        resource_type: { type: "string", minLength: 1 },
        time_bounds: {
          type: "object",
          additionalProperties: false,
          required: ["starts_at", "ends_at"],
          properties: {
            starts_at: TIMESTAMP,
            ends_at: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
    },
    result: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "content_hash", "observed_at"],
      properties: {
        outcome: {
          enum: ["ok", "unresolved", "expired", "quarantined", "error"],
        },
        content_hash: HASH_STRING,
        observed_at: TIMESTAMP,
        row_count: { type: "integer", minimum: 0 },
      },
    },
  },
} as const

const actionReceipt = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "receipt_id",
    "idempotency_key",
    "lease_id",
    "stage",
    "action",
    "target",
    "outcome",
  ],
  properties: {
    kind: { const: "action" },
    ...RECEIPT_COMMON,
    action: {
      type: "object",
      additionalProperties: false,
      required: ["adapter", "action_class", "command"],
      properties: {
        adapter: { type: "string", minLength: 1 },
        action_class: { type: "string", minLength: 1 },
        command: { type: "string", minLength: 1 },
      },
    },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["expected_version"],
      properties: {
        tenant_id: { type: "string", minLength: 1 },
        deployment_environment_name: { type: "string", minLength: 1 },
        service_name: { type: "string", minLength: 1 },
        expected_version: { type: "string", minLength: 1 },
        actual_version: { type: "string", minLength: 1 },
      },
    },
    permit_id: { type: "string", minLength: 1 },
    /** Optional source-host URL recorded by issue #32's adapter. */
    url: { type: "string", format: "uri" },
    source_host: {
      type: "object",
      additionalProperties: false,
      required: [
        "provider",
        "repository",
        "pull_request_number",
        "pull_request_url",
        "title",
        "branch",
        "base_ref",
        "head_ref",
        "state",
        "diff_text",
      ],
      properties: {
        provider: { type: "string", minLength: 1 },
        repository: { type: "string", minLength: 1 },
        pull_request_number: { type: "integer", minimum: 1 },
        pull_request_url: { type: "string", format: "uri" },
        title: { type: "string", minLength: 1 },
        branch: { type: "string", minLength: 1 },
        base_ref: { type: "string", minLength: 1 },
        head_ref: { type: "string", minLength: 1 },
        state: { enum: ["open", "closed", "merged"] },
        merged_at: { type: ["string", "null"], format: "date-time" },
        checks_passed: { type: "integer", minimum: 0 },
        checks_total: { type: "integer", minimum: 0 },
        approvals: { type: "integer", minimum: 0 },
        diff_text: { type: "string", minLength: 1 },
      },
    },
    outcome: { enum: ["ok", "failed", "error", "unknown"] },
    executed_at: TIMESTAMP,
    error: { type: "string" },
  },
} as const

const testReceipt = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "receipt_id",
    "idempotency_key",
    "lease_id",
    "stage",
    "candidate_hash",
    "layer",
    "tool",
    "tool_version",
    "target",
    "runs",
    "outcome",
  ],
  properties: {
    kind: { const: "test" },
    ...RECEIPT_COMMON,
    layer: {
      enum: [
        "T1",
        "T2",
        "T3",
        "T4",
        "T5",
        "T6",
        "T7",
        "T8",
        "T9",
        "T10",
        "T11",
        "T12",
        "T13",
      ],
    },
    tool: { type: "string", minLength: 1 },
    tool_version: { type: "string", minLength: 1 },
    target: { type: "string", minLength: 1 },
    runs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["run_hash", "result", "at"],
        properties: {
          run_hash: HASH_STRING,
          result: { enum: ["pass", "fail", "error"] },
          at: TIMESTAMP,
          detail: { type: "string" },
        },
      },
    },
    outcome: { enum: ["pass", "fail", "flaky-pass", "error", "not-run"] },
    flaky: { type: "boolean" },
  },
} as const

const ciReceipt = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "receipt_id",
    "idempotency_key",
    "lease_id",
    "stage",
    "pipeline",
    "pipeline_run_id",
    "steps",
    "status",
  ],
  properties: {
    kind: { const: "ci" },
    ...RECEIPT_COMMON,
    pipeline: { type: "string", minLength: 1 },
    pipeline_run_id: { type: "string", minLength: 1 },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status"],
        properties: {
          name: { type: "string", minLength: 1 },
          status: { enum: ["success", "failure"] },
          log_ref: HASH_STRING,
        },
      },
    },
    status: { enum: ["success", "failure"] },
    artifact_digest: HASH_STRING,
    finished_at: TIMESTAMP,
  },
} as const

/** The JSON Schema for read, action, test, and CI broker receipts. */
export const brokerReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Broker Receipt v1",
  oneOf: [readReceipt, actionReceipt, testReceipt, ciReceipt],
} as const

/** The wire shape of a broker receipt. */
export type BrokerReceipt = FromSchema<typeof brokerReceiptSchema>
