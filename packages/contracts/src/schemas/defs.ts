/**
 * Shared JSON Schema fragments used across the contract schemas.
 *
 * Every fragment is a plain, JSON-compatible object frozen with `as const` so
 * `json-schema-to-ts` can derive exact literal types and Ajv can validate in
 * strict mode. The fragments are embedded by reference into each schema
 * document so each schema stays self-contained on the wire.
 */

/** A lower-case prefixed SHA-256 digest: `sha256:<64 hex chars>`. */
export const HASH_STRING = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
} as const;

/** RFC 3339 / JSON Schema `date-time` string. */
export const TIMESTAMP = {
  type: "string",
  format: "date-time",
} as const;

/** A timestamp that may be explicitly null (open windows). */
export const NULLABLE_TIMESTAMP = {
  type: ["string", "null"],
  format: "date-time",
} as const;

/** An RFC 6901 JSON Pointer. */
export const JSON_POINTER = {
  type: "string",
  pattern: "^(?:/(?:[^~/]|~[01])*)*$",
} as const;

/** The durable schema version emitted by this package. */
export const SCHEMA_VERSION_1 = {
  type: "string",
  const: "1.0",
} as const;

/** The durable schema version for the Orchestrator-aware journal and capture manifest. */
export const SCHEMA_VERSION_1_1 = {
  type: "string",
  const: "1.1",
} as const;

/** The capture-manifest schema version that freezes resolved provider
 * metadata and the lifecycle attempt budget. */
export const SCHEMA_VERSION_1_2 = {
  type: "string",
  const: "1.2",
} as const;

/** Identity of the actor that authored a journal event. */
export const ACTOR_KIND = {
  enum: [
    "intake-normalizer",
    "orchestrator",
    "human",
    "control-plane",
    "read-broker",
    "action-broker",
    "model-gateway",
  ],
} as const;

/** A journal actor identity with an optional credential scope. */
export const ACTOR = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind"],
  properties: {
    id: { type: "string", minLength: 1 },
    kind: ACTOR_KIND,
    credential_scope: { type: "string", minLength: 1 },
  },
} as const;

/** Structural redaction metadata; `masked_fields` are JSON Pointers. */
export const REDACTION = {
  type: "object",
  additionalProperties: false,
  required: ["profile_id", "masked_fields"],
  properties: {
    profile_id: { type: "string", minLength: 1 },
    masked_fields: { type: "array", items: JSON_POINTER, uniqueItems: true },
  },
} as const;

/** The settled severity vocabulary. */
export const SEVERITY = {
  enum: ["critical", "high", "medium", "low", "info"],
} as const;

/** Identity of the affected scope: tenant, environment, service. */
export const SCOPE = {
  type: "object",
  additionalProperties: false,
  required: ["tenant_id", "deployment_environment_name", "service_name"],
  properties: {
    tenant_id: { type: "string", minLength: 1 },
    deployment_environment_name: { type: "string", minLength: 1 },
    service_name: { type: "string", minLength: 1 },
  },
} as const;

/** An absolute observation window. */
export const WINDOW = {
  type: "object",
  additionalProperties: false,
  required: ["starts_at", "ends_at"],
  properties: {
    starts_at: TIMESTAMP,
    ends_at: NULLABLE_TIMESTAMP,
  },
} as const;

/** A reference to a sealed artifact by schema identity and content hash. */
export const ARTIFACT_REF = {
  type: "object",
  additionalProperties: false,
  required: ["schema_id", "schema_version", "content_hash"],
  properties: {
    schema_id: { type: "string", minLength: 1 },
    schema_version: { type: "string", minLength: 1 },
    content_hash: HASH_STRING,
  },
} as const;

/** Producer provenance: skill and tool versions where recorded. */
export const PRODUCER = {
  type: "object",
  additionalProperties: false,
  properties: {
    skill: { type: "string", minLength: 1 },
    skill_version: { type: "string", minLength: 1 },
    tool: { type: "string", minLength: 1 },
    tool_version: { type: "string", minLength: 1 },
    tool_catalog_version: { type: "string", minLength: 1 },
    resolver_version: { type: "string", minLength: 1 },
  },
} as const;

/** The six fixed Orchestrator stages, in order. */
export const STAGE_NAME = {
  enum: ["detect", "diagnose", "repair", "verify", "release", "watch"],
} as const;

/** Per-stage status. */
export const STAGE_STATUS = {
  enum: ["entered", "in-progress", "completed", "failed", "skipped"],
} as const;
