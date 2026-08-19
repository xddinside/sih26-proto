/**
 * Agent Run Artifact: one durable, inspectable record of one Pi role session
 * (issue #25). A sealed agent-run-artifact binds the session's identity and
 * ordered pipeline calls, the model and reasoning configuration, the settled
 * status, timing, sanitized tool activity, the terminal submission reference,
 * token usage, and failure details. It survives failed and aborted sessions:
 * every attempt is sealed and persisted, never replaced by a canned artifact.
 *
 * The artifact is diagnostic: `exclude_from_context` is always true, so the
 * transcript-derived fields (system_prompt, input_prompt, output, tool
 * activity) never enter the context assembled for later role sessions.
 * Reasoning blocks and provider secrets are never persisted. Tool results
 * are bounded and sanitized; the terminal submission is not duplicated here —
 * `submission_ref` links the sealed terminal artifact, which stays the sole
 * authority for the typed result.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, SCHEMA_VERSION_1, TIMESTAMP } from "./defs.js";

const NON_EMPTY_STRING = { type: "string", minLength: 1 } as const;

/** The settled call lifecycle statuses, mirroring the Fusion reference's
 * `FusionPipelineCall.status` vocabulary. */
export const AGENT_CALL_STATUS = { enum: [
  "pending",
  "running",
  "succeeded",
  "failed",
  "aborted",
] } as const;

/** The settled run statuses of a sealed artifact. */
const AGENT_RUN_STATUS = { enum: ["succeeded", "failed", "aborted"] } as const;

/** The role phase a call belongs to. "brief" covers future pipeline brief
 * calls; the other values mirror the capture-manifest role vocabulary. */
export const AGENT_PHASE = { enum: [
  "brief",
  "participant",
  "judge",
  "synthesizer",
  "planner",
  "implementer",
  "review",
  "test",
  "orchestrator",
] } as const;

/** Whether the session ran against a live provider or a fixture. */
const PROVIDER_CLASS = { enum: ["real", "fixture"] } as const;

const REASONING_LEVEL = { enum: ["minimal", "low", "medium", "high", "xhigh"] } as const;

/** One sanitized tool request and its bounded result, as the session saw it. */
const TOOL_ACTIVITY = {
  type: "object",
  additionalProperties: false,
  required: ["tool_call_id", "tool", "args", "result", "is_error"],
  properties: {
    tool_call_id: NON_EMPTY_STRING,
    tool: NON_EMPTY_STRING,
    /** The sanitized arguments as JSON text. */
    args: { type: "string" },
    /** The sanitized, bounded result text; null when no result was returned. */
    result: { type: ["string", "null"] },
    is_error: { type: "boolean" },
  },
} as const;

/** One ordered pipeline call inside an Agent Run Artifact. */
const AGENT_CALL = {
  type: "object",
  additionalProperties: false,
  required: [
    "call_id",
    "phase",
    "role",
    "order",
    "model",
    "status",
    "started_at",
    "completed_at",
    "system_prompt",
    "input_prompt",
    "output",
    "submission_ref",
    "token_use",
    "retry_delay_ms",
    "rate_limit_delay_ms",
    "turns",
    "tool_activity",
    "failure_reason",
  ],
  properties: {
    call_id: NON_EMPTY_STRING,
    phase: AGENT_PHASE,
    /** The role label the session ran as (e.g. `sih-fusion-participant`). */
    role: NON_EMPTY_STRING,
    /** The stable call position within the artifact, 0-based. */
    order: { type: "integer", minimum: 0 },
    model: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "id"],
      properties: {
        provider: NON_EMPTY_STRING,
        id: NON_EMPTY_STRING,
        /** The provider API used (e.g. `opencode-go`), when reported. */
        api: NON_EMPTY_STRING,
        reasoning: REASONING_LEVEL,
      },
    },
    status: AGENT_CALL_STATUS,
    started_at: TIMESTAMP,
    completed_at: TIMESTAMP,
    /** The sanitized system prompt; diagnostic only. */
    system_prompt: { type: "string" },
    /** The sanitized call prompt; diagnostic only. */
    input_prompt: { type: "string", minLength: 1 },
    /** The sanitized final assistant text; diagnostic only. */
    output: { type: ["string", "null"] },
    /** The sealed terminal artifact for the typed result, when submitted. */
    submission_ref: { anyOf: [{ type: "null" }, HASH_STRING] },
    token_use: {
      type: "object",
      additionalProperties: false,
      required: ["prompt_tokens", "completion_tokens", "total_tokens"],
      properties: {
        prompt_tokens: { type: "integer", minimum: 0 },
        completion_tokens: { type: "integer", minimum: 0 },
        total_tokens: { type: "integer", minimum: 0 },
      },
    },
    /** The retry delay applied before this call, when reported. */
    retry_delay_ms: { anyOf: [{ type: "null" }, { type: "integer", minimum: 0 }] },
    /** The rate-limit delay applied before this call, when reported. */
    rate_limit_delay_ms: { anyOf: [{ type: "null" }, { type: "integer", minimum: 0 }] },
    turns: { type: "integer", minimum: 0 },
    /** The session's non-terminal tool requests, in call order. */
    tool_activity: { type: "array", items: TOOL_ACTIVITY },
    failure_reason: { anyOf: [{ type: "null" }, NON_EMPTY_STRING] },
  },
} as const;

/**
 * The versioned SIH Agent Run Artifact. Run-level fields aggregate the call
 * records; the calls stay the source of lifecycle truth. The artifact is
 * persisted for successful, failed, and aborted sessions alike and is never
 * an alternate source of run state.
 */
export const agentRunArtifactSchema = {
  $id: "https://contracts.sih.dev/agent-run-artifact/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Agent Run Artifact v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "run_artifact_id",
    "agent_id",
    "parent_agent_id",
    "role",
    "phase",
    "provider_class",
    "provider",
    "model",
    "reasoning",
    "status",
    "failure_reason",
    "calls",
    "metrics",
    "exclude_from_context",
    "sealed_at",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    run_artifact_id: NON_EMPTY_STRING,
    agent_id: NON_EMPTY_STRING,
    parent_agent_id: NON_EMPTY_STRING,
    /** The role label the session ran as; see the call records. */
    role: NON_EMPTY_STRING,
    phase: AGENT_PHASE,
    provider_class: PROVIDER_CLASS,
    provider: NON_EMPTY_STRING,
    model: NON_EMPTY_STRING,
    reasoning: REASONING_LEVEL,
    status: AGENT_RUN_STATUS,
    failure_reason: { anyOf: [{ type: "null" }, NON_EMPTY_STRING] },
    /** The ordered pipeline call records; the lifecycle authority. */
    calls: { type: "array", minItems: 1, items: AGENT_CALL },
    metrics: {
      type: "object",
      additionalProperties: false,
      required: [
        "duration_ms",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "tool_call_count",
        "retry_delay_ms",
        "rate_limit_delay_ms",
      ],
      properties: {
        duration_ms: { type: "integer", minimum: 0 },
        prompt_tokens: { type: "integer", minimum: 0 },
        completion_tokens: { type: "integer", minimum: 0 },
        total_tokens: { type: "integer", minimum: 0 },
        tool_call_count: { type: "integer", minimum: 0 },
        retry_delay_ms: { type: "integer", minimum: 0 },
        rate_limit_delay_ms: { type: "integer", minimum: 0 },
      },
    },
    /** Always true: the artifact is inspectable, never context. */
    exclude_from_context: { const: true },
    sealed_at: TIMESTAMP,
  },
} as const;

/** Wire type for one pipeline call. */
export type AgentPhase = (typeof AGENT_PHASE)["enum"][number];
export type AgentPipelineCall = FromSchema<typeof AGENT_CALL>;

/** Wire type for a sealed Agent Run Artifact. */
export type AgentRunArtifactWire = FromSchema<typeof agentRunArtifactSchema>;