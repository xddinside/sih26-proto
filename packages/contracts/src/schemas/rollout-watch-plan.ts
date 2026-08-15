/**
 * Frozen rollout and Watch plan v1, from docs/research/release-recovery.md.
 * The Release Gate cites this sealed artifact before any production action.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1, TIMESTAMP } from "./defs.js";

/** The wire schema for a fixed progressive rollout and its Watch checks. */
export const rolloutWatchPlanSchema = {
  $id: "https://contracts.sih.dev/rollout-watch-plan/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Rollout and Watch Plan v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "incident_id",
    "run_id",
    "attempt",
    "candidate_hash",
    "rollout",
    "watch_queries",
    "stop_rules",
    "missing_data_rule",
    "policy_version",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    candidate_hash: HASH_STRING,
    rollout: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "stages"],
      properties: {
        strategy: { enum: ["canary", "blue-green", "ring", "preview"] },
        stages: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "traffic_percent",
              "minimum_duration_seconds",
              "minimum_sample_count",
            ],
            properties: {
              id: { type: "string", minLength: 1 },
              traffic_percent: { type: "number", minimum: 0, maximum: 100 },
              minimum_duration_seconds: { type: "integer", minimum: 1 },
              minimum_sample_count: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
    watch_queries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "signal",
          "backend",
          "query",
          "window_seconds",
          "minimum_sample_count",
          "comparator",
          "limit",
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          signal: { type: "string", minLength: 1 },
          backend: { type: "string", minLength: 1 },
          query: { type: "string", minLength: 1 },
          window_seconds: { type: "integer", minimum: 1 },
          minimum_sample_count: { type: "integer", minimum: 1 },
          comparator: { enum: ["less-than", "less-than-or-equal", "greater-than", "greater-than-or-equal"] },
          limit: { type: "number" },
          unit: { type: "string", minLength: 1 },
        },
      },
    },
    stop_rules: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "condition", "action"],
        properties: {
          id: { type: "string", minLength: 1 },
          condition: { type: "string", minLength: 1 },
          action: { enum: ["pause", "rollback"] },
        },
      },
    },
    missing_data_rule: { const: "needs-human" },
    rehearsal_receipt_refs: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    policy_version: { type: "string", minLength: 1 },
    sealed_at: TIMESTAMP,
  },
} as const;

/** A parsed frozen rollout and Watch plan. */
export type RolloutWatchPlan = FromSchema<typeof rolloutWatchPlanSchema>;
