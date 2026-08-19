/**
 * Journal event v1, from docs/research/orchestrator-stages.md and
 * docs/research/incident-workspace.md. The append-only journal is the sole
 * source of truth for replay. Events are a discriminated union over thirteen
 * kinds; every event carries a monotonic sequence, an idempotency key, an
 * actor, and a policy version. Wall-clock order never decides replay order:
 * sequence does.
 */
import type { FromSchema } from "json-schema-to-ts";

import { brokerReceiptSchema } from "./broker-receipt.js";
import {
  ACTOR,
  ARTIFACT_REF,
  HASH_STRING,
  REDACTION,
  STAGE_NAME,
  STAGE_STATUS,
  TIMESTAMP,
} from "./defs.js";
import { gateEvaluationSchema } from "./gate-evaluation.js";
import { incidentTriggerSchema } from "./incident-trigger.js";

const COMMON = {
  sequence: { type: "integer", minimum: 1 },
  idempotency_key: {
    type: "string",
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  },
  recorded_at: TIMESTAMP,
  actor: ACTOR,
  policy_version: { type: "string", minLength: 1 },
  redaction: REDACTION,
} as const;

const INCIDENT_STATE = { enum: ["open", "resolved", "closed"] } as const;
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
const CLOSURE_REASON = {
  enum: ["symptom-cleared", "attempt-limit", "human-closed"],
} as const;

/** Build one journal event variant with the common envelope merged in. */
function variant<
  const T extends string,
  const TReq extends readonly string[],
  const TProps extends Record<string, unknown>,
  const TAllOf extends readonly object[] | undefined = undefined,
>(
  type: T,
  spec: { properties: TProps; required: TReq; allOf?: TAllOf },
) {
  const base = {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "sequence",
      "idempotency_key",
      "recorded_at",
      "actor",
      "policy_version",
      ...spec.required,
    ],
    properties: {
      type: { const: type },
      ...COMMON,
      ...spec.properties,
    },
  } as const;
  if (spec.allOf !== undefined) {
    return { ...base, allOf: spec.allOf };
  }
  return base;
}

const triggerReceived = variant("trigger_received", {
  required: ["incident_id", "trigger", "delivery_result"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    trigger: incidentTriggerSchema,
    delivery_result: {
      enum: ["incident-created", "evidence-appended", "duplicate-noop"],
    },
  },
});

const incidentTransition = variant("incident_transition", {
  required: ["incident_id", "from", "to", "expected_version"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    from: { type: ["string", "null"], enum: [...INCIDENT_STATE.enum, null] },
    to: INCIDENT_STATE,
    expected_version: { type: "integer", minimum: 0 },
    closure_reason: CLOSURE_REASON,
  },
  allOf: [
    {
      if: { properties: { to: { const: "closed" } }, required: ["to"] },
      then: { required: ["closure_reason"], properties: { closure_reason: CLOSURE_REASON } },
    },
  ],
});

const runTransition = variant("run_transition", {
  required: ["incident_id", "run_id", "attempt", "from", "to", "expected_run_version"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    from: { type: ["string", "null"], enum: [...RUN_STATE.enum, null] },
    to: RUN_STATE,
    expected_run_version: { type: "integer", minimum: 0 },
    outcome: RUN_OUTCOME,
    failure_reason: RUN_FAILURE_REASON,
    restart_count: { type: "integer", minimum: 0 },
  },
  allOf: [
    {
      if: { properties: { to: { const: "completed" } }, required: ["to"] },
      then: { required: ["outcome"], properties: { outcome: RUN_OUTCOME } },
    },
    {
      if: { properties: { to: { const: "failed" } }, required: ["to"] },
      then: { required: ["failure_reason"], properties: { failure_reason: RUN_FAILURE_REASON } },
    },
  ],
});

const stageTransition = variant("stage_transition", {
  required: ["incident_id", "run_id", "attempt", "stage", "from", "to"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    stage: STAGE_NAME,
    from: { type: ["string", "null"], enum: [...STAGE_STATUS.enum, null] },
    to: STAGE_STATUS,
    reason: { type: "string", minLength: 1 },
    artifact_ref: ARTIFACT_REF,
    candidate_hash: HASH_STRING,
    lease_id: { type: "string", minLength: 1 },
  },
  allOf: [
    {
      if: { properties: { to: { const: "skipped" } }, required: ["to"] },
      then: { required: ["reason"], properties: { reason: { type: "string", minLength: 1 } } },
    },
  ],
});

const artifactSealed = variant("artifact_sealed", {
  required: ["incident_id", "artifact_ref"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    artifact_ref: ARTIFACT_REF,
    producer: {
      type: "object",
      additionalProperties: false,
      properties: {
        skill: { type: "string", minLength: 1 },
        skill_version: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        tool_version: { type: "string", minLength: 1 },
        tool_catalog_version: { type: "string", minLength: 1 },
      },
    },
  },
});

const brokerReceiptRecorded = variant("broker_receipt_recorded", {
  required: ["incident_id", "receipt"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    stage: STAGE_NAME,
    receipt: brokerReceiptSchema,
  },
});

const gateEvaluated = variant("gate_evaluated", {
  required: ["incident_id", "attempt", "gate", "evaluation"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    gate: { enum: ["hypothesis", "release", "action"] },
    evaluation: gateEvaluationSchema,
  },
});

const policyDecision = variant("policy_decision", {
  required: ["incident_id", "decision", "tzdb_version", "evaluated_at"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    decision: { enum: ["autonomous", "approval-required", "denied", "needs-human"] },
    tzdb_version: { type: "string", minLength: 1 },
    window: {
      type: "object",
      additionalProperties: false,
      required: ["iana_zone", "windows"],
      properties: {
        iana_zone: { type: "string", minLength: 1 },
        windows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["start_weekday", "start_time", "end_weekday", "end_time"],
            properties: {
              start_weekday: {
                enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              },
              start_time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
              end_weekday: {
                enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
              },
              end_time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
            },
          },
        },
      },
    },
    evaluated_at: TIMESTAMP,
    evaluated_local_time: TIMESTAMP,
    reason: { type: "string" },
  },
});

const leaseEvent = variant("lease_event", {
  required: ["incident_id", "lease_id", "lease_kind", "action"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    lease_id: { type: "string", minLength: 1 },
    lease_kind: { enum: ["run", "release"] },
    action: { enum: ["issued", "renewed", "expired", "revoked"] },
    stage: STAGE_NAME,
    bound_candidate_hash: HASH_STRING,
  },
});

const approvalRecorded = variant("approval_recorded", {
  required: ["incident_id", "approval"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    approval: {
      type: "object",
      additionalProperties: false,
      required: [
        "approval_id",
        "action_digest",
        "approver_identity",
        "approval_system",
        "policy_version",
        "tzdb_version",
        "action_risk_class",
        "expiry",
        "action",
      ],
      properties: {
        approval_id: { type: "string", minLength: 1 },
        action_digest: HASH_STRING,
        approver_identity: { type: "string", minLength: 1 },
        approval_system: { type: "string", minLength: 1 },
        policy_version: { type: "string", minLength: 1 },
        tzdb_version: { type: "string", minLength: 1 },
        action_risk_class: { enum: ["safe", "guarded"] },
        expiry: TIMESTAMP,
        scope: {
          type: "object",
          additionalProperties: false,
          properties: {
            target: { type: "string", minLength: 1 },
            changed_surfaces: {
              type: "array",
              items: { type: "string", minLength: 1 },
              uniqueItems: true,
            },
          },
        },
        action: { enum: ["granted", "revoked", "consumed"] },
      },
    },
  },
});

const humanAction = variant("human_action", {
  required: ["incident_id", "action"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    action: {
      enum: [
        "pause",
        "resume",
        "cancel",
        "approve",
        "deny",
        "close",
        "policy-update",
        "rollback-request",
      ],
    },
    reason: { type: "string" },
    approval_ref: { type: "string", minLength: 1 },
    policy_version_after: { type: "string", minLength: 1 },
  },
});

const modelUse = variant("model_use", {
  required: ["incident_id", "parent_agent_id", "agent_id", "model", "token_use", "tool_calls"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    parent_agent_id: { type: "string", minLength: 1 },
    agent_id: { type: "string", minLength: 1 },
    agent_role: {
      enum: ["orchestrator", "participant", "judge", "synthesizer", "reviewer", "test-agent", "repair-agent"],
    },
    model: { type: "string", minLength: 1 },
    prompt_ref: HASH_STRING,
    token_use: {
      type: "object",
      additionalProperties: false,
      required: ["prompt_tokens", "completion_tokens"],
      properties: {
        prompt_tokens: { type: "integer", minimum: 0 },
        completion_tokens: { type: "integer", minimum: 0 },
      },
    },
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "tool_call_id"],
        properties: {
          tool: { type: "string", minLength: 1 },
          tool_call_id: { type: "string", minLength: 1 },
          args_ref: HASH_STRING,
          result_ref: HASH_STRING,
        },
      },
    },
    result_ref: HASH_STRING,
  },
});

const workRequested = variant("work_requested", {
  required: [
    "incident_id",
    "run_id",
    "attempt",
    "request_id",
    "work_id",
    "stage",
    "status",
    "depends_on",
    "budget",
    "admitted_artifact_refs",
  ],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    request_id: { type: "string", minLength: 1 },
    work_id: { type: "string", minLength: 1 },
    stage: STAGE_NAME,
    status: { enum: ["admitted", "rejected"] },
    depends_on: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    budget: {
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
    admitted_artifact_refs: { type: "array", items: ARTIFACT_REF, uniqueItems: true },
    code: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 },
  },
  allOf: [
    {
      if: { properties: { status: { const: "rejected" } }, required: ["status"] },
      then: {
        required: ["code", "reason"],
        properties: {
          code: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
  ],
});

const workCompleted = variant("work_completed", {
  required: ["incident_id", "run_id", "attempt", "work_id", "artifact_refs"],
  properties: {
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    attempt: { type: "integer", minimum: 1 },
    work_id: { type: "string", minLength: 1 },
    artifact_refs: { type: "array", items: ARTIFACT_REF, minItems: 1, uniqueItems: true },
  },
});

/** The JSON Schema for the fourteen-kind append-only journal event union. */
export const journalEventSchema = {
  $id: "https://contracts.sih.dev/journal-event/1.1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Journal Event v1.1",
  oneOf: [
    triggerReceived,
    incidentTransition,
    runTransition,
    stageTransition,
    artifactSealed,
    brokerReceiptRecorded,
    gateEvaluated,
    policyDecision,
    leaseEvent,
    approvalRecorded,
    humanAction,
    modelUse,
    workRequested,
    workCompleted,
  ],
} as const;

/** The pre-Orchestrator journal schema retained for replaying v1.0 exports. */
export const journalEventSchemaV1 = {
  ...journalEventSchema,
  $id: "https://contracts.sih.dev/journal-event/1.0",
  title: "Journal Event v1",
  oneOf: [
    triggerReceived,
    incidentTransition,
    runTransition,
    stageTransition,
    artifactSealed,
    brokerReceiptRecorded,
    gateEvaluated,
    policyDecision,
    leaseEvent,
    approvalRecorded,
    humanAction,
    modelUse,
  ],
} as const;

/** The wire shape of one journal event. */
export type JournalEvent = FromSchema<typeof journalEventSchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A journal event without its sequence, as produced by a command producer. */
export type JournalCommand = DistributiveOmit<JournalEvent, "sequence">;

/** The fourteen journal event kinds. */
export type JournalEventType = JournalEvent["type"];
