/**
 * Release, direct-action, and recovery-point records v1, from
 * docs/research/release-recovery.md and docs/research/orchestrator-stages.md.
 * The Control Plane seals these before the Release stage completes; the
 * Release Gate and the Recovery Point checks cite them as durable artifacts.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, NULLABLE_TIMESTAMP, SCHEMA_VERSION_1, TIMESTAMP } from "./defs.js";

const stageHistoryItem = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "status", "at"],
  properties: {
    stage: { type: "string", minLength: 1 },
    status: { type: "string", minLength: 1 },
    at: TIMESTAMP,
  },
} as const;

/** The wire schema for a sealed Release record (code Remediation path). */
export const releaseRecordSchema = {
  $id: "https://contracts.sih.dev/release-record/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Release Record v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "remediation_ref",
    "verification_report_ref",
    "target",
    "expected_version",
    "authority_mode",
    "policy_version",
    "action_risk_class",
    "approvals",
    "release_gate_ref",
    "recovery_point_id",
    "rollout_plan_ref",
    "watch_plan_ref",
    "permit_id",
    "adapter_receipt_ids",
    "stage_history",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    remediation_ref: HASH_STRING,
    verification_report_ref: HASH_STRING,
    target: { type: "string", minLength: 1 },
    expected_version: { type: "string", minLength: 1 },
    authority_mode: { enum: ["observe", "prepare", "repair", "emergency"] },
    policy_version: { type: "string", minLength: 1 },
    action_risk_class: { enum: ["safe", "guarded", "barred"] },
    approvals: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    release_gate_ref: HASH_STRING,
    recovery_point_id: { type: "string", minLength: 1 },
    rollout_plan_ref: HASH_STRING,
    watch_plan_ref: HASH_STRING,
    permit_id: { type: ["string", "null"] },
    adapter_receipt_ids: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    stage_history: {
      type: "array",
      items: stageHistoryItem,
    },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire schema for a sealed direct-action record (operations path). */
export const directActionRecordSchema = {
  $id: "https://contracts.sih.dev/direct-action-record/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Direct Action Record v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "action",
    "target",
    "expected_version",
    "authority_mode",
    "policy_version",
    "action_risk_class",
    "action_gate_ref",
    "recovery_point_id",
    "permit_id",
    "adapter_receipt_ids",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
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
    target: { type: "string", minLength: 1 },
    expected_version: { type: "string", minLength: 1 },
    authority_mode: { enum: ["observe", "prepare", "repair", "emergency"] },
    policy_version: { type: "string", minLength: 1 },
    action_risk_class: { enum: ["safe", "guarded", "barred"] },
    action_gate_ref: HASH_STRING,
    recovery_point_id: { type: "string", minLength: 1 },
    permit_id: { type: ["string", "null"] },
    adapter_receipt_ids: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire schema for a validated Recovery Point. */
export const recoveryPointSchema = {
  $id: "https://contracts.sih.dev/recovery-point/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Recovery Point v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "recovery_point_id",
    "incident_id",
    "run_id",
    "changed_surfaces",
    "prior_state",
    "restore_command",
    "preconditions",
    "timeout_seconds",
    "retention_deadline",
    "validated",
    "validated_at",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    recovery_point_id: { type: "string", minLength: 1 },
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    changed_surfaces: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    prior_state: {
      type: "object",
      additionalProperties: false,
      required: [
        "compose_project_file_hash",
        "image_digest",
        "service_version",
        "environment_files",
        "flag_files",
      ],
      properties: {
        compose_project_file_hash: HASH_STRING,
        image_digest: { type: "string", minLength: 1 },
        service_version: { type: "string", minLength: 1 },
        environment_files: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        flag_files: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
      },
    },
    restore_command: { type: "string", minLength: 1 },
    preconditions: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    timeout_seconds: { type: "integer", minimum: 1 },
    retention_deadline: TIMESTAMP,
    validated: { type: "boolean" },
    validated_at: NULLABLE_TIMESTAMP,
    sealed_at: TIMESTAMP,
  },
} as const;

export type ReleaseRecord = FromSchema<typeof releaseRecordSchema>;
export type DirectActionRecord = FromSchema<typeof directActionRecordSchema>;
export type RecoveryPoint = FromSchema<typeof recoveryPointSchema>;
