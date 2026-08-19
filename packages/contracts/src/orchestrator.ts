/** JSON Schemas for the bounded Pi Orchestrator boundary. The public types
 * below are derived from these wire contracts so the typed tool surface and
 * runtime validation cannot silently drift apart. */
import type { FromSchema } from "json-schema-to-ts"

import { ARTIFACT_REF, STAGE_NAME, STAGE_STATUS } from "./schemas/defs.js"

export const ORCHESTRATOR_STAGES = [
  "detect",
  "diagnose",
  "repair",
  "verify",
  "release",
  "watch",
] as const

export const orchestratorStageSchema = { enum: ORCHESTRATOR_STAGES } as const
export const orchestratorStageStatusSchema = STAGE_STATUS

const NON_EMPTY_STRING = { type: "string", minLength: 1 } as const
const POSITIVE_INTEGER = { type: "integer", minimum: 1 } as const

export const orchestratorWorkBudgetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model_turns", "non_terminal_tool_calls", "session_wall_clock_ms", "run_wall_clock_ms"],
  properties: {
    model_turns: POSITIVE_INTEGER,
    non_terminal_tool_calls: POSITIVE_INTEGER,
    session_wall_clock_ms: POSITIVE_INTEGER,
    run_wall_clock_ms: POSITIVE_INTEGER,
  },
} as const

export const orchestratorWorkRequestSchema = {
  $id: "https://contracts.sih.dev/orchestrator-work-request/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Orchestrator Work Request v1",
  type: "object",
  additionalProperties: false,
  required: ["request_id", "work_id", "stage", "attempt", "depends_on", "budget"],
  properties: {
    request_id: NON_EMPTY_STRING,
    work_id: NON_EMPTY_STRING,
    stage: orchestratorStageSchema,
    attempt: POSITIVE_INTEGER,
    depends_on: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
    budget: orchestratorWorkBudgetSchema,
  },
} as const

export const orchestratorStageStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "status"],
  properties: {
    stage: orchestratorStageSchema,
    status: orchestratorStageStatusSchema,
    artifact_ref: ARTIFACT_REF,
  },
} as const

export const orchestratorBudgetStateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "run_wall_clock_ms",
    "elapsed_ms",
    "remaining_ms",
    "reserved_model_turns",
    "reserved_non_terminal_tool_calls",
    "reserved_session_wall_clock_ms",
    "reserved_run_wall_clock_ms",
  ],
  properties: {
    run_wall_clock_ms: POSITIVE_INTEGER,
    elapsed_ms: { type: "integer", minimum: 0 },
    remaining_ms: { type: "integer", minimum: 0 },
    reserved_model_turns: { type: "integer", minimum: 0 },
    reserved_non_terminal_tool_calls: { type: "integer", minimum: 0 },
    reserved_session_wall_clock_ms: { type: "integer", minimum: 0 },
    reserved_run_wall_clock_ms: { type: "integer", minimum: 0 },
  },
} as const

export const orchestratorLifecycleStateSchema = {
  $id: "https://contracts.sih.dev/orchestrator-lifecycle/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Orchestrator Lifecycle Projection v1",
  type: "object",
  additionalProperties: false,
  required: ["incident_id", "run_id", "attempt", "run_state", "current_stage", "stages", "admitted_work_ids", "admitted_artifacts", "budgets"],
  properties: {
    incident_id: NON_EMPTY_STRING,
    run_id: NON_EMPTY_STRING,
    attempt: POSITIVE_INTEGER,
    run_state: NON_EMPTY_STRING,
    current_stage: { anyOf: [{ type: "null" }, orchestratorStageSchema] },
    stages: { type: "array", items: orchestratorStageStateSchema },
    admitted_work_ids: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
    admitted_artifacts: { type: "array", items: ARTIFACT_REF, uniqueItems: true },
    budgets: orchestratorBudgetStateSchema,
  },
} as const

export const orchestratorWorkAdmissionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "request_id", "work_id", "stage", "admitted_artifacts", "budgets"],
  properties: {
    status: { const: "admitted" },
    request_id: NON_EMPTY_STRING,
    work_id: NON_EMPTY_STRING,
    stage: orchestratorStageSchema,
    admitted_artifacts: { type: "array", items: ARTIFACT_REF, uniqueItems: true },
    budgets: orchestratorBudgetStateSchema,
  },
} as const

export const orchestratorWorkRejectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "request_id", "work_id", "code", "reason"],
  properties: {
    status: { const: "rejected" },
    request_id: NON_EMPTY_STRING,
    work_id: NON_EMPTY_STRING,
    code: NON_EMPTY_STRING,
    reason: NON_EMPTY_STRING,
  },
} as const

export const orchestratorWorkResultSchema = {
  $id: "https://contracts.sih.dev/orchestrator-work-result/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Orchestrator Work Result v1",
  anyOf: [orchestratorWorkAdmissionSchema, orchestratorWorkRejectionSchema],
} as const

export type OrchestratorStage = FromSchema<typeof orchestratorStageSchema>
export type OrchestratorStageStatus = FromSchema<typeof orchestratorStageStatusSchema>
export type OrchestratorArtifactRef = FromSchema<typeof ARTIFACT_REF>
export type OrchestratorWorkBudget = FromSchema<typeof orchestratorWorkBudgetSchema>
export type OrchestratorWorkRequest = FromSchema<typeof orchestratorWorkRequestSchema>
export type OrchestratorStageState = FromSchema<typeof orchestratorStageStateSchema>
export type OrchestratorBudgetState = FromSchema<typeof orchestratorBudgetStateSchema>
export type OrchestratorLifecycleState = FromSchema<typeof orchestratorLifecycleStateSchema>
export type OrchestratorWorkAdmission = FromSchema<typeof orchestratorWorkAdmissionSchema>
export type OrchestratorWorkRejection = FromSchema<typeof orchestratorWorkRejectionSchema>
export type OrchestratorWorkResult = FromSchema<typeof orchestratorWorkResultSchema>
