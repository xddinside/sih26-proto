/**
 * Incident, Incident Run, and Stage Record projection schemas, from
 * docs/research/orchestrator-stages.md. These describe the durable state the
 * Control Plane owns; they are the source shape for the detail projection.
 */
import type { FromSchema } from "json-schema-to-ts";

import {
  ARTIFACT_REF,
  HASH_STRING,
  SCHEMA_VERSION_1,
  SEVERITY,
  SCOPE,
  STAGE_NAME,
  STAGE_STATUS,
  TIMESTAMP,
} from "./defs.js";

const INCIDENT_STATE = { enum: ["open", "resolved", "closed"] } as const;
const DETECTOR_STATE = { enum: ["firing", "resolved"] } as const;
const CLOSURE_REASON = {
  enum: ["symptom-cleared", "attempt-limit", "human-closed"],
} as const;

/** The JSON Schema for one projected stage record. */
export const stageRecordSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Stage Record v1",
  type: "object",
  additionalProperties: false,
  required: ["stage", "status"],
  properties: {
    stage: STAGE_NAME,
    status: STAGE_STATUS,
    reason: { type: "string", minLength: 1 },
    artifact_ref: ARTIFACT_REF,
    candidate_hash: HASH_STRING,
    entered_at: TIMESTAMP,
    completed_at: TIMESTAMP,
    failed_at: TIMESTAMP,
    skipped_at: TIMESTAMP,
  },
} as const;

/** The wire shape of one stage record. */
export type StageRecord = FromSchema<typeof stageRecordSchema>;

const RUN_STATE = {
  enum: [
    "queued",
    "running",
    "paused",
    "awaiting-human",
    "interrupted",
    "completed",
    "failed",
    "cancelled",
  ],
} as const;

const RUN_OUTCOME = {
  enum: ["verified-remediation", "symptom-cleared", "diagnosis-only", "handoff"],
} as const;

const RUN_FAILURE_REASON = {
  enum: [
    "undiagnosable",
    "no-hypothesis",
    "hypothesis-invalidated",
    "no-remediation",
    "verification-failed",
    "gate-failed",
    "rollback-required",
    "unstable-worker",
    "interrupted-unrecoverable",
  ],
} as const;

/** The JSON Schema for one Incident Run projection. */
export const incidentRunSchema = {
  $id: "https://contracts.sih.dev/incident-run/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident Run v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "run_id",
    "attempt",
    "state",
    "stages",
    "restart_count",
    "policy_version",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    state: RUN_STATE,
    stages: { type: "array", items: stageRecordSchema },
    outcome: RUN_OUTCOME,
    failure_reason: RUN_FAILURE_REASON,
    restart_count: { type: "integer", minimum: 0 },
    started_at: TIMESTAMP,
    ended_at: TIMESTAMP,
    policy_version: { type: "string", minLength: 1 },
  },
  allOf: [
    {
      if: { properties: { state: { const: "completed" } }, required: ["state"] },
      then: { required: ["outcome"], properties: { outcome: RUN_OUTCOME } },
    },
    {
      if: { properties: { state: { const: "failed" } }, required: ["state"] },
      then: { required: ["failure_reason"], properties: { failure_reason: RUN_FAILURE_REASON } },
    },
  ],
} as const;

/** The wire shape of an Incident Run projection. */
export type IncidentRun = FromSchema<typeof incidentRunSchema>;

/** The JSON Schema for an Incident projection. */
export const incidentSchema = {
  $id: "https://contracts.sih.dev/incident/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "incident_key",
    "state",
    "detector_state",
    "severity",
    "scope",
    "attempt_limit",
    "attempts_used",
    "created_at",
    "updated_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    incident_key: HASH_STRING,
    state: INCIDENT_STATE,
    detector_state: DETECTOR_STATE,
    severity: SEVERITY,
    scope: SCOPE,
    attempt_limit: { type: "integer", minimum: 1 },
    attempts_used: { type: "integer", minimum: 0 },
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    closure_reason: CLOSURE_REASON,
    open_run_id: { type: ["string", "null"] },
    related_incident_ids: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
  },
  allOf: [
    {
      if: { properties: { state: { const: "closed" } }, required: ["state"] },
      then: { required: ["closure_reason"], properties: { closure_reason: CLOSURE_REASON } },
    },
  ],
} as const;

/** The wire shape of an Incident projection. */
export type Incident = FromSchema<typeof incidentSchema>;

/** Incident states, separate from detector state. */
export type IncidentState = "open" | "resolved" | "closed";
/** Run states; terminal states are completed, failed, cancelled. */
export type RunState =
  | "queued"
  | "running"
  | "paused"
  | "awaiting-human"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";
/** Run outcomes when a run completes. */
export type RunOutcome =
  | "verified-remediation"
  | "symptom-cleared"
  | "diagnosis-only"
  | "handoff";
/** Run failure reasons when a run fails. */
export type RunFailureReason =
  | "undiagnosable"
  | "no-hypothesis"
  | "hypothesis-invalidated"
  | "no-remediation"
  | "verification-failed"
  | "gate-failed"
  | "rollback-required"
  | "unstable-worker"
  | "interrupted-unrecoverable";
/** Closure reasons for a closed Incident. */
export type ClosureReason = "symptom-cleared" | "attempt-limit" | "human-closed";
