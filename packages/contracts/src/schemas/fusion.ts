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
