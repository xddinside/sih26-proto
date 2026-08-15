/**
 * Stage output report schemas v1, from docs/research/orchestrator-stages.md,
 * docs/research/review-verification.md, and docs/research/demo-runs.md. These
 * are the sealed artifacts the Workspace renders. Each carries a schema
 * version, incident/run identity, and a `sealed_at` timestamp.
 */
import type { FromSchema } from "json-schema-to-ts";

import {
  HASH_STRING,
  SCHEMA_VERSION_1,
  SEVERITY,
  SCOPE,
  TIMESTAMP,
} from "./defs.js";
import { hypothesisSchema } from "./hypothesis.js";

const REMEDIATION_DISPOSITION = {
  enum: ["allowed", "approval-required", "prohibited", "observe-only"],
} as const;

const ACTION_RISK_CLASS = { enum: ["safe", "guarded", "barred"] } as const;

const REMEDIATION_CLASS = {
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
} as const;

/** The JSON Schema for the Detect stage Incident Brief. */
export const incidentBriefSchema = {
  $id: "https://contracts.sih.dev/incident-brief/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident Brief v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "severity",
    "scope",
    "symptom",
    "initial_evidence_item_ids",
    "policy_version",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    severity: SEVERITY,
    scope: SCOPE,
    symptom: { type: "string", minLength: 1 },
    initial_evidence_item_ids: {
      type: "array",
      items: HASH_STRING,
      uniqueItems: true,
    },
    service_topology: { type: "string" },
    known_limits: { type: "string" },
    policy_version: { type: "string", minLength: 1 },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of an Incident Brief. */
export type IncidentBrief = FromSchema<typeof incidentBriefSchema>;

/** The JSON Schema for the Diagnosis Report. */
export const diagnosisReportSchema = {
  $id: "https://contracts.sih.dev/diagnosis-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Diagnosis Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "hypotheses",
    "contradictions",
    "gaps",
    "next_actions",
    "fusion_meta",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    hypotheses: { type: "array", items: hypothesisSchema },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hypothesis_ids", "item_ids"],
        properties: {
          hypothesis_ids: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          item_ids: { type: "array", items: HASH_STRING },
        },
      },
    },
    gaps: { type: "array", items: { type: "string", minLength: 1 } },
    next_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["procedure", "bounds", "permissions", "discriminates"],
        properties: {
          procedure: { type: "string", minLength: 1 },
          bounds: { type: "string", minLength: 1 },
          permissions: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          discriminates: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
        },
      },
    },
    fusion_meta: {
      type: "object",
      additionalProperties: false,
      required: [
        "participant_ids",
        "judge_id",
        "synthesizer_id",
        "revision_id",
        "rounds",
      ],
      properties: {
        participant_ids: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 2,
        },
        judge_id: { type: "string", minLength: 1 },
        synthesizer_id: { type: "string", minLength: 1 },
        revision_id: { type: "string", minLength: 1 },
        rounds: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["round", "valid", "participant_ids"],
            properties: {
              round: { type: "integer", minimum: 1 },
              valid: { type: "boolean" },
              participant_ids: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
    remediation_disposition: REMEDIATION_DISPOSITION,
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of a Diagnosis Report. */
export type DiagnosisReport = FromSchema<typeof diagnosisReportSchema>;

/** The JSON Schema for a recovery-bound Remediation Proposal. */
export const remediationProposalSchema = {
  $id: "https://contracts.sih.dev/remediation-proposal/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Remediation Proposal v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "remediation_class",
    "action_risk_class",
    "gate_path",
    "disposition",
    "change_description",
    "citations",
    "test_plan",
    "changed_surfaces",
    "recovery_point",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    remediation_class: REMEDIATION_CLASS,
    action_risk_class: ACTION_RISK_CLASS,
    gate_path: { enum: ["release", "action"] },
    disposition: REMEDIATION_DISPOSITION,
    change_description: { type: "string", minLength: 1 },
    diff: {
      type: "object",
      additionalProperties: false,
      required: ["base_ref", "diff_text", "diff_hash"],
      properties: {
        base_ref: { type: "string", minLength: 1 },
        diff_text: { type: "string", minLength: 1 },
        diff_hash: HASH_STRING,
      },
    },
    typed_action_plan: {
      type: "object",
      additionalProperties: false,
      required: ["adapter", "action_class", "command"],
      properties: {
        adapter: { type: "string", minLength: 1 },
        action_class: { type: "string", minLength: 1 },
        command: { type: "string", minLength: 1 },
      },
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["change", "hypothesis_id", "cited_item_ids"],
        properties: {
          change: { type: "string", minLength: 1 },
          hypothesis_id: { type: "string", minLength: 1 },
          cited_item_ids: {
            type: "array",
            items: HASH_STRING,
            uniqueItems: true,
          },
        },
      },
    },
    test_plan: { type: "array", items: { type: "string", minLength: 1 } },
    changed_surfaces: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    blast_radius: {
      type: "object",
      additionalProperties: false,
      properties: {
        services: { type: "array", items: { type: "string", minLength: 1 } },
        environments: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        cohorts: { type: "array", items: { type: "string", minLength: 1 } },
      },
    },
    recovery_point: {
      type: "object",
      additionalProperties: false,
      required: ["id", "changed_surfaces"],
      properties: {
        id: { type: "string", minLength: 1 },
        changed_surfaces: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true,
        },
      },
    },
    sealed_at: TIMESTAMP,
  },
  oneOf: [
    { properties: { diff: true }, required: ["diff"] },
    {
      properties: { typed_action_plan: true },
      required: ["typed_action_plan"],
    },
  ],
} as const;

/** The wire shape of a Remediation Proposal. */
export type RemediationProposal = FromSchema<typeof remediationProposalSchema>;

const REVIEW_ROLE = {
  enum: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"],
} as const;

/** The JSON Schema for one role-specific Review Report. */
export const reviewReportSchema = {
  $id: "https://contracts.sih.dev/review-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Review Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "role",
    "reviewer",
    "revision",
    "input_refs",
    "findings",
    "status",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    role: REVIEW_ROLE,
    reviewer: { type: "string", minLength: 1 },
    revision: { type: "integer", minimum: 1 },
    input_refs: { type: "array", items: { type: "string", minLength: 1 } },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "severity", "claim", "citations", "status"],
        properties: {
          id: { type: "string", minLength: 1 },
          severity: { enum: ["blocker", "major", "minor", "info"] },
          claim: { type: "string", minLength: 1 },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind"],
              properties: {
                kind: {
                  enum: ["file-line", "check-output", "evidence-item", "recovery-point-gap"],
                },
                file: { type: "string", minLength: 1 },
                line: { type: "integer", minimum: 1 },
                ref: { type: "string", minLength: 1 },
              },
            },
          },
          status: { enum: ["open", "retracted", "fixed-in-revision"] },
          uncited: { type: "boolean" },
        },
      },
    },
    status: { enum: ["pass", "fail"] },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of a Review Report. */
export type ReviewReport = FromSchema<typeof reviewReportSchema>;

const TEST_LAYER = {
  enum: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"],
} as const;

/** The JSON Schema for one broker-backed Test Report. */
export const testReportSchema = {
  $id: "https://contracts.sih.dev/test-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Test Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "layer",
    "tool",
    "tool_version",
    "target",
    "receipt_ref",
    "runs",
    "outcome",
    "flaky",
    "coverage_checked",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    layer: TEST_LAYER,
    tool: { type: "string", minLength: 1 },
    tool_version: { type: "string", minLength: 1 },
    target: { type: "string", minLength: 1 },
    receipt_ref: { type: "string", minLength: 1 },
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
    coverage_checked: { type: "boolean" },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of a Test Report. */
export type TestReport = FromSchema<typeof testReportSchema>;

/** The JSON Schema for the candidate-bound Verification Report. */
export const verificationReportSchema = {
  $id: "https://contracts.sih.dev/verification-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Verification Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "remediation_class",
    "action_risk_class",
    "gate_path",
    "applicability",
    "reviews",
    "tests",
    "hash_binding",
    "verdict",
    "verdict_reason",
    "sealed_at",
    "policy_version",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    remediation_class: REMEDIATION_CLASS,
    action_risk_class: ACTION_RISK_CLASS,
    gate_path: { enum: ["release", "action"] },
    applicability: {
      type: "object",
      additionalProperties: false,
      required: [
        "resolver_version",
        "policy_version",
        "required",
        "conditional",
        "triggered",
        "not_applicable",
      ],
      properties: {
        resolver_version: { type: "string", minLength: 1 },
        policy_version: { type: "string", minLength: 1 },
        required: {
          type: "array",
          items: { type: "string", pattern: "^[RT][0-9]+$" },
          uniqueItems: true,
        },
        conditional: {
          type: "array",
          items: { type: "string", pattern: "^[RT][0-9]+$" },
          uniqueItems: true,
        },
        triggered: { type: "object", additionalProperties: true },
        not_applicable: {
          type: "array",
          items: { type: "string", pattern: "^[RT][0-9]+$" },
          uniqueItems: true,
        },
      },
    },
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "reviewer", "revision", "status", "sealed_at"],
        properties: {
          role: REVIEW_ROLE,
          reviewer: { type: "string", minLength: 1 },
          revision: { type: "integer", minimum: 1 },
          status: { enum: ["pass", "fail"] },
          sealed_at: TIMESTAMP,
        },
      },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["layer", "tool", "tool_version", "receipt_ref", "outcome", "flaky"],
        properties: {
          layer: TEST_LAYER,
          tool: { type: "string", minLength: 1 },
          tool_version: { type: "string", minLength: 1 },
          receipt_ref: { type: "string", minLength: 1 },
          outcome: { enum: ["pass", "fail", "flaky-pass", "error", "not-run"] },
          flaky: { type: "boolean" },
        },
      },
    },
    hash_binding: {
      type: "object",
      additionalProperties: false,
      required: ["sealed_candidate", "checked_candidate", "match"],
      properties: {
        sealed_candidate: HASH_STRING,
        checked_candidate: HASH_STRING,
        match: { type: "boolean" },
      },
    },
    verdict: { enum: ["pass", "fail", "needs-human"] },
    verdict_reason: { type: "string", minLength: 1 },
    sealed_at: TIMESTAMP,
    policy_version: { type: "string", minLength: 1 },
  },
} as const;

/** The wire shape of a Verification Report. */
export type VerificationReport = FromSchema<typeof verificationReportSchema>;

/** The JSON Schema for one rollout-stage Watch Report. */
export const watchReportSchema = {
  $id: "https://contracts.sih.dev/watch-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Watch Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "rollout_stage",
    "samples",
    "stage_outcome",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    rollout_stage: { enum: ["1", "2", "confirmation"] },
    plan_ref: HASH_STRING,
    samples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "gate",
          "query",
          "time_range",
          "sample_count",
          "value",
          "limit",
          "outcome",
        ],
        properties: {
          gate: { enum: ["G1", "G2", "G3", "G4", "G5", "G6"] },
          query: { type: "string", minLength: 1 },
          baseline_cohort: { type: "string", minLength: 1 },
          candidate_cohort: { type: "string", minLength: 1 },
          time_range: {
            type: "object",
            additionalProperties: false,
            required: ["starts_at", "ends_at"],
            properties: {
              starts_at: TIMESTAMP,
              ends_at: TIMESTAMP,
            },
          },
          sample_count: { type: "integer", minimum: 0 },
          value: { type: "number" },
          limit: { type: "number" },
          outcome: { enum: ["pass", "fail"] },
        },
      },
    },
    stage_outcome: { enum: ["pass", "fail"] },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of a Watch Report. */
export type WatchReport = FromSchema<typeof watchReportSchema>;

/** The JSON Schema for the final concise Incident Report. */
export const incidentReportSchema = {
  $id: "https://contracts.sih.dev/incident-report/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident Report v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "closure_reason",
    "hypotheses",
    "actions_taken",
    "results",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    closure_reason: { const: "attempt-limit" },
    hypotheses: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    actions_taken: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    results: { type: "string", minLength: 1 },
    sealed_at: TIMESTAMP,
  },
} as const;

/** The wire shape of an Incident Report. */
export type IncidentReport = FromSchema<typeof incidentReportSchema>;
