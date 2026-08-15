/**
 * Incident Trigger v1, from docs/research/incident-intake.md. The Intake
 * Normalizer produces it; the Control Plane accepts it. The trigger binds the
 * detector rule version, the delivery/incident keys, and the intake evidence
 * references.
 */
import type { FromSchema } from "json-schema-to-ts";

import {
  HASH_STRING,
  NULLABLE_TIMESTAMP,
  SCHEMA_VERSION_1,
  SEVERITY,
  SCOPE,
  TIMESTAMP,
  WINDOW,
} from "./defs.js";

/** The JSON Schema for a normalized Incident Trigger. */
export const incidentTriggerSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Incident Trigger v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "trigger_id",
    "delivery_key",
    "incident_key",
    "received_at",
    "detector",
    "state",
    "severity",
    "scope",
    "window",
    "signal_summary",
    "evidence_refs",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    trigger_id: { type: "string", minLength: 1 },
    delivery_key: HASH_STRING,
    incident_key: HASH_STRING,
    received_at: TIMESTAMP,
    detector: {
      type: "object",
      additionalProperties: false,
      required: ["source", "connection_id", "rule_id", "rule_version"],
      properties: {
        source: { type: "string", minLength: 1 },
        connection_id: { type: "string", minLength: 1 },
        rule_id: { type: "string", minLength: 1 },
        rule_version: { type: "string", minLength: 1 },
        source_fingerprint: { type: "string", minLength: 1 },
      },
    },
    state: { enum: ["firing", "resolved"] },
    severity: SEVERITY,
    scope: SCOPE,
    window: {
      type: "object",
      additionalProperties: false,
      required: ["starts_at", "ends_at", "lookback_seconds"],
      properties: {
        starts_at: TIMESTAMP,
        ends_at: NULLABLE_TIMESTAMP,
        lookback_seconds: { type: "number", minimum: 0 },
      },
    },
    signal_summary: {
      type: "object",
      additionalProperties: false,
      required: ["name", "value", "unit", "threshold"],
      properties: {
        name: { type: "string", minLength: 1 },
        value: { type: "number" },
        unit: { type: "string", minLength: 1 },
        threshold: { type: "number" },
      },
    },
    evidence_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "backend", "uri"],
        properties: {
          kind: { enum: ["metric-query", "trace", "log-query"] },
          backend: { type: "string", minLength: 1 },
          uri: { type: "string", format: "uri" },
          query: { type: "string" },
          trace_id: { type: "string", minLength: 1 },
          observed_at: TIMESTAMP,
        },
      },
    },
  },
} as const;

/** The wire shape of an Incident Trigger. */
export type IncidentTrigger = FromSchema<typeof incidentTriggerSchema>;

/** Detector state, separate from Incident state, per orchestrator-stages.md. */
export type DetectorState = "firing" | "resolved";
