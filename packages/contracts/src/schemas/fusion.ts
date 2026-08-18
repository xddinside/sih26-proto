/**
 * Fusion role output schemas from the Diagnose contract. Participant and
 * Judge outputs stay inspectable but outside later model context. Only the
 * Synthesizer output becomes durable stage input.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1, TIMESTAMP } from "./defs.js";
import { hypothesisSchema } from "./hypothesis.js";

const NON_EMPTY_STRING = { type: "string", minLength: 1 } as const;
const ITEM_IDS = { type: "array", items: HASH_STRING, uniqueItems: true } as const;

/** The JSON Schema for one machine-checked Fusion participant output. */
export const fusionParticipantOutputSchema = {
  $id: "https://contracts.sih.dev/fusion-participant-output/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fusion Participant Output v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "participant_id",
    "revision_id",
    "hypotheses",
    "stated_objections",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    participant_id: NON_EMPTY_STRING,
    revision_id: HASH_STRING,
    hypotheses: { type: "array", items: hypothesisSchema, minItems: 1 },
    stated_objections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "cited_item_ids"],
        properties: {
          statement: NON_EMPTY_STRING,
          hypothesis_id: NON_EMPTY_STRING,
          cited_item_ids: ITEM_IDS,
        },
      },
    },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for a Fusion participant output. */
export type FusionParticipantOutput = FromSchema<typeof fusionParticipantOutputSchema>;

const JUDGE_FINDING = {
  type: "object",
  additionalProperties: false,
  required: ["statement", "hypothesis_ids", "cited_item_ids"],
  properties: {
    statement: NON_EMPTY_STRING,
    hypothesis_ids: {
      type: "array",
      items: NON_EMPTY_STRING,
      uniqueItems: true,
    },
    cited_item_ids: ITEM_IDS,
  },
} as const;

/** The JSON Schema for the Fusion Judge comparison; it has no winner field. */
export const fusionJudgeOutputSchema = {
  $id: "https://contracts.sih.dev/fusion-judge-output/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fusion Judge Output v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "judge_id",
    "revision_id",
    "agreements",
    "contradictions",
    "blind_spots",
    "unique_findings",
    "citation_audit",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    judge_id: NON_EMPTY_STRING,
    revision_id: HASH_STRING,
    agreements: { type: "array", items: JUDGE_FINDING },
    contradictions: { type: "array", items: JUDGE_FINDING },
    blind_spots: { type: "array", items: JUDGE_FINDING },
    unique_findings: { type: "array", items: JUDGE_FINDING },
    citation_audit: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "participant_id",
          "uncited_claims",
          "invalid_citations",
          "missing_item_citations",
        ],
        properties: {
          participant_id: NON_EMPTY_STRING,
          uncited_claims: { type: "integer", minimum: 0 },
          invalid_citations: { type: "integer", minimum: 0 },
          missing_item_citations: { type: "integer", minimum: 0 },
        },
      },
    },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for a Fusion Judge output. */
export type FusionJudgeOutput = FromSchema<typeof fusionJudgeOutputSchema>;

const CONTRADICTION = {
  type: "object",
  additionalProperties: false,
  required: ["statement", "hypothesis_ids", "cited_item_ids"],
  properties: {
    statement: NON_EMPTY_STRING,
    hypothesis_ids: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
    cited_item_ids: ITEM_IDS,
  },
} as const;

/** The JSON Schema for the durable Fusion Synthesizer output. */
export const fusionSynthesizerOutputSchema = {
  $id: "https://contracts.sih.dev/fusion-synthesizer-output/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fusion Synthesizer Output v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "synthesizer_id",
    "revision_id",
    "ranked_hypotheses",
    "contradictions",
    "gaps",
    "next_actions",
    "fusion_meta",
    "completed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    synthesizer_id: NON_EMPTY_STRING,
    revision_id: HASH_STRING,
    ranked_hypotheses: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "hypothesis"],
        properties: {
          rank: { type: "integer", minimum: 1 },
          hypothesis: hypothesisSchema,
        },
      },
    },
    contradictions: { type: "array", items: CONTRADICTION },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["missing_evidence_kind", "held_open_checks"],
        properties: {
          missing_evidence_kind: NON_EMPTY_STRING,
          held_open_checks: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
        },
      },
    },
    next_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["procedure", "bounds", "permissions", "discriminates"],
        properties: {
          query: NON_EMPTY_STRING,
          procedure: NON_EMPTY_STRING,
          bounds: NON_EMPTY_STRING,
          permissions: { type: "array", items: NON_EMPTY_STRING, uniqueItems: true },
          discriminates: { type: "array", items: NON_EMPTY_STRING, minItems: 1, uniqueItems: true },
        },
      },
    },
    fusion_meta: {
      type: "object",
      additionalProperties: false,
      required: ["participant_ids", "judge_id", "synthesizer_id", "revision_id", "started_at", "completed_at"],
      properties: {
        participant_ids: { type: "array", items: NON_EMPTY_STRING, minItems: 2, uniqueItems: true },
        judge_id: NON_EMPTY_STRING,
        synthesizer_id: NON_EMPTY_STRING,
        revision_id: HASH_STRING,
        started_at: TIMESTAMP,
        completed_at: TIMESTAMP,
      },
    },
    completed_at: TIMESTAMP,
  },
} as const;

/** Wire type for a Fusion Synthesizer output. */
export type FusionSynthesizerOutput = FromSchema<typeof fusionSynthesizerOutputSchema>;

const FUSION_CALL_STATUS = { enum: ["succeeded", "failed", "aborted"] } as const;
const FUSION_RUN_STATUS = {
  enum: ["succeeded", "invalid", "failed", "aborted"],
} as const;

/** One ordered Fusion pipeline call summary inside a Fusion Run Artifact. */
const FUSION_CALL = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "role",
    "model",
    "status",
    "system_prompt",
    "input_prompt",
    "attempts",
    "retry_delays_ms",
    "prompt_tokens",
    "completion_tokens",
    "started_at",
    "duration_ms",
  ],
  properties: {
    kind: { enum: ["brief", "participant", "judge", "synthesizer"] },
    role: NON_EMPTY_STRING,
    model: NON_EMPTY_STRING,
    status: FUSION_CALL_STATUS,
    system_prompt: { type: "string" },
    input_prompt: { type: "string", minLength: 1 },
    output: { type: ["string", "null"] },
    failure_message: NON_EMPTY_STRING,
    attempts: { type: "integer", minimum: 0 },
    retry_delays_ms: { type: "array", items: { type: "integer", minimum: 0 } },
    prompt_tokens: { type: "integer", minimum: 0 },
    completion_tokens: { type: "integer", minimum: 0 },
    started_at: TIMESTAMP,
    duration_ms: { type: "integer", minimum: 0 },
    turns: { type: "integer", minimum: 0 },
    tool_calls: { type: "integer", minimum: 0 },
  },
} as const;

const ROLE_METRIC = {
  type: "object",
  additionalProperties: false,
  required: ["status", "turns", "tool_calls", "duration_ms"],
  properties: {
    status: FUSION_CALL_STATUS,
    turns: { type: "integer", minimum: 0 },
    tool_calls: { type: "integer", minimum: 0 },
    duration_ms: { type: "integer", minimum: 0 },
  },
} as const;

const PERSPECTIVE_RECORD = {
  type: "object",
  additionalProperties: false,
  required: ["participant_id", "perspective", "order"],
  properties: {
    participant_id: NON_EMPTY_STRING,
    perspective: NON_EMPTY_STRING,
    order: { type: "integer", minimum: 1 },
  },
} as const;

/**
 * The versioned SIH Fusion Run Artifact: ordered pipeline-call summaries and
 * aggregate metrics, persisted for successful, invalid, failed, and aborted
 * Fusion rounds. `exclude_from_context` is always true; the artifact is
 * inspectable but never enters later role context.
 */
export const fusionRunArtifactSchema = {
  $id: "https://contracts.sih.dev/fusion-run-artifact/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fusion Run Artifact v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "round",
    "revision_id",
    "task",
    "calls",
    "status",
    "exclude_from_context",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    round: { type: "integer", minimum: 1 },
    revision_id: HASH_STRING,
    task: NON_EMPTY_STRING,
    brief: NON_EMPTY_STRING,
    calls: { type: "array", items: FUSION_CALL },
    status: FUSION_RUN_STATUS,
    status_reason: NON_EMPTY_STRING,
    exclude_from_context: { const: true },
    sealed_at: TIMESTAMP,
    perspectives: { type: "array", items: PERSPECTIVE_RECORD },
    metrics: {
      type: "object",
      additionalProperties: false,
      required: ["participants", "judge", "synthesizer", "total_wall_clock_ms"],
      properties: {
        participants: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["participant_id", "status", "turns", "tool_calls", "duration_ms"],
            properties: {
              participant_id: NON_EMPTY_STRING,
              ...ROLE_METRIC.properties,
            },
          },
        },
        judge: {
          anyOf: [{ type: "null" }, ROLE_METRIC],
        },
        synthesizer: {
          anyOf: [{ type: "null" }, ROLE_METRIC],
        },
        total_wall_clock_ms: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

/** Wire type for a sealed Fusion Run Artifact. */
export type FusionRunArtifactWire = FromSchema<typeof fusionRunArtifactSchema>;
