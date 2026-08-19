/**
 * Agent session output schemas for the real-agent capture pipeline. These are
 * the sealed terminal-tool artifacts produced by Pi role sessions: the repair
 * planner draft, the implementer diff, the orchestrator report, and the
 * capture manifest that binds a run to its provider, model, skill and tool
 * revisions, perspectives, budgets, seeds, and role session records.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1, SCHEMA_VERSION_1_1, TIMESTAMP } from "./defs.js";

const NON_EMPTY_STRING = { type: "string", minLength: 1 } as const;
const ROLE_NAME = { enum: [
  "participant",
  "judge",
  "synthesizer",
  "planner",
  "implementer",
  "review",
  "test",
  "orchestrator",
] } as const;

/** The JSON Schema for the repair planner's remediation draft. */
export const remediationDraftSchema = {
  $id: "https://contracts.sih.dev/remediation-draft/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Remediation Draft v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "remediation_class",
    "action_risk_class",
    "gate_path",
    "disposition",
    "change_description",
    "citations",
    "test_plan",
    "changed_surfaces",
    "typed_action_plan",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: NON_EMPTY_STRING,
    run_id: NON_EMPTY_STRING,
    attempt: { type: "integer", minimum: 1 },
    // The candidate hash does not exist when the planner drafts the change;
    // the proposal carries it after the implementer applies the diff.
    candidate_hash: HASH_STRING,
    remediation_class: { enum: [
      "code",
      "configuration",
      "feature-flags",
      "deployment",
      "restart-scale-traffic",
      "infrastructure",
      "database-data",
      "credentials",
      "emergency-rollback",
    ] },
    action_risk_class: { enum: ["safe", "guarded", "barred"] },
    gate_path: { enum: ["release", "action"] },
    disposition: { enum: ["allowed", "approval-required", "prohibited", "observe-only"] },
    change_description: NON_EMPTY_STRING,
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["change", "hypothesis_id", "cited_item_ids"],
        properties: {
          change: NON_EMPTY_STRING,
          hypothesis_id: NON_EMPTY_STRING,
          cited_item_ids: { type: "array", items: HASH_STRING, uniqueItems: true },
        },
      },
    },
    test_plan: { type: "array", items: NON_EMPTY_STRING },
    changed_surfaces: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
    typed_action_plan: {
      type: "object",
      additionalProperties: false,
      required: ["adapter", "action_class", "command"],
      properties: {
        adapter: NON_EMPTY_STRING,
        action_class: NON_EMPTY_STRING,
        command: NON_EMPTY_STRING,
      },
    },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for a remediation draft. */
export type RemediationDraft = FromSchema<typeof remediationDraftSchema>;

/** The JSON Schema for the repair implementer's applied diff. */
export const implementedDiffSchema = {
  $id: "https://contracts.sih.dev/implemented-diff/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Implemented Diff v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "base_ref",
    "diff_text",
    "diff_hash",
    "changed_files",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: NON_EMPTY_STRING,
    run_id: NON_EMPTY_STRING,
    attempt: { type: "integer", minimum: 1 },
    base_ref: NON_EMPTY_STRING,
    diff_text: NON_EMPTY_STRING,
    diff_hash: HASH_STRING,
    changed_files: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for an implemented diff. */
export type ImplementedDiff = FromSchema<typeof implementedDiffSchema>;

/** The JSON Schema for the orchestrator's end-of-run report. */
export const orchestratorReportSchema = {
  $id: "https://contracts.sih.dev/orchestrator-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Orchestrator Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "stage_outcomes",
    "assessments",
    "reflections",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: NON_EMPTY_STRING,
    run_id: NON_EMPTY_STRING,
    attempt: { type: "integer", minimum: 1 },
    stage_outcomes: {
      type: "object",
      additionalProperties: false,
      required: ["detect", "diagnose", "repair", "verify"],
      properties: {
        detect: { type: "string", minLength: 1 },
        diagnose: { type: "string", minLength: 1 },
        repair: { type: "string", minLength: 1 },
        verify: { type: "string", minLength: 1 },
      },
    },
    assessments: { type: "array", items: NON_EMPTY_STRING },
    reflections: { type: "array", items: NON_EMPTY_STRING },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for an orchestrator report. */
export type OrchestratorReport = FromSchema<typeof orchestratorReportSchema>;

const REASONING_LEVEL = { enum: ["minimal", "low", "medium", "high", "xhigh"] } as const;
const CAPTURE_MODE = { enum: ["rehearsal", "full-capture"] } as const;
const PROVIDER_CLASS = { enum: ["real", "fixture"] } as const;

const ROLE_RECORD = {
  type: "object",
  additionalProperties: false,
  required: ["role", "agent_id", "status", "model_use_agent_ids"],
  properties: {
    role: ROLE_NAME,
    agent_id: NON_EMPTY_STRING,
    status: { enum: ["succeeded", "failed", "aborted"] },
    submission_id: NON_EMPTY_STRING,
    artifact_ref: HASH_STRING,
    /** The sealed agent-run-artifact for this session, when recorded. */
    run_artifact_ref: HASH_STRING,
    model_use_agent_ids: {
      type: "array",
      items: NON_EMPTY_STRING,
      uniqueItems: true,
    },
  },
} as const;

/** The JSON Schema for the capture manifest sealed at the end of a run. */
export const captureManifestSchema = {
  $id: "https://contracts.sih.dev/capture-manifest/1.1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Capture Manifest v1.1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "manifest_id",
    "incident_id",
    "run_id",
    "attempt",
    "mode",
    "scenario",
    "provider_class",
    "provider",
    "model",
    "reasoning",
    "pi_agent_core_version",
    "pi_ai_version",
    "skill_tree_digest",
    "tool_catalog_revision",
    "prompt_revision",
    "policy_revision",
    "perspectives",
    "seeds",
    "budgets",
    "schema_versions",
    "role_records",
    "manifest_digest",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1_1,
    manifest_id: NON_EMPTY_STRING,
    incident_id: NON_EMPTY_STRING,
    run_id: NON_EMPTY_STRING,
    attempt: { type: "integer", minimum: 1 },
    mode: CAPTURE_MODE,
    scenario: NON_EMPTY_STRING,
    provider_class: PROVIDER_CLASS,
    provider: NON_EMPTY_STRING,
    model: NON_EMPTY_STRING,
    reasoning: REASONING_LEVEL,
    pi_agent_core_version: NON_EMPTY_STRING,
    pi_ai_version: NON_EMPTY_STRING,
    skill_tree_digest: HASH_STRING,
    tool_catalog_revision: NON_EMPTY_STRING,
    /** Version of the role prompt catalog used for this capture. */
    prompt_revision: NON_EMPTY_STRING,
    policy_revision: NON_EMPTY_STRING,
    perspectives: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["participant_id", "perspective", "order"],
        properties: {
          participant_id: NON_EMPTY_STRING,
          perspective: NON_EMPTY_STRING,
          order: { type: "integer", minimum: 1 },
        },
      },
    },
    seeds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "digest"],
        properties: {
          id: NON_EMPTY_STRING,
          digest: HASH_STRING,
        },
      },
    },
    budgets: {
      type: "object",
      additionalProperties: false,
      required: ["model_turns", "non_terminal_tool_calls", "session_wall_clock_ms", "run_wall_clock_ms"],
      properties: {
        model_turns: { type: "integer", minimum: 1 },
        non_terminal_tool_calls: { type: "integer", minimum: 1 },
        session_wall_clock_ms: { type: "integer", minimum: 1 },
        run_wall_clock_ms: { type: "integer", minimum: 1 },
      },
    },
    schema_versions: {
      type: "object",
      additionalProperties: { type: "string", minLength: 1 },
    },
    role_records: {
      type: "array",
      items: ROLE_RECORD,
    },
    manifest_digest: HASH_STRING,
    sealed_at: TIMESTAMP,
  },
} as const;

/** The v1.0 capture manifest remains readable for older retained attempts. */
export const captureManifestSchemaV1 = {
  ...captureManifestSchema,
  $id: "https://contracts.sih.dev/capture-manifest/1.0",
  title: "Capture Manifest v1",
  required: captureManifestSchema.required.filter((name) => name !== "prompt_revision"),
  properties: {
    ...captureManifestSchema.properties,
    schema_version: SCHEMA_VERSION_1,
  },
} as const;

/** Wire type for a capture manifest. */
export type CaptureManifest = FromSchema<typeof captureManifestSchema>;

export type CaptureManifestRoleRecord = CaptureManifest["role_records"][number];

/** The role names a capture run can record. */
export type AgentRoleName = (typeof ROLE_NAME)["enum"][number];

/**
 * The terminal artifact schema each role must seal to complete its session,
 * keyed by the role name used in a capture manifest role record.
 */
export const TERMINAL_SCHEMA_BY_ROLE = {
  participant: "fusion-participant-output",
  judge: "fusion-judge-output",
  synthesizer: "fusion-synthesizer-output",
  planner: "remediation-draft",
  implementer: "implemented-diff",
  review: "review-report",
  test: "test-report",
  orchestrator: "orchestrator-report",
} as const;

/** The artifact schema id a given role is required to seal. */
export type TerminalSchemaByRole = (typeof TERMINAL_SCHEMA_BY_ROLE)[AgentRoleName];
