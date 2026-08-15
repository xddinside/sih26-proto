/**
 * Sealed artifact envelope v1, from docs/research/incident-workspace.md. An
 * envelope binds a redacted structured payload by `content_hash`, names its
 * schema identity and version, and records producer, redaction, and
 * provenance. The envelope's own file bytes are hashed by the saved manifest;
 * `content_hash` binds only the payload.
 */
import type { FromSchema } from "json-schema-to-ts";

import {
  HASH_STRING,
  PRODUCER,
  REDACTION,
  SCHEMA_VERSION_1,
  TIMESTAMP,
} from "./defs.js";

/** The JSON Schema for sealed artifact envelopes at version 1.0. */
export const artifactEnvelopeSchema = {
  $id: "https://contracts.sih.dev/artifact-envelope/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Artifact Envelope v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "artifact_schema_id",
    "artifact_schema_version",
    "content_hash",
    "sealed_at",
    "incident_id",
    "producer",
    "payload",
  ],
  properties: {
    schema_version: SCHEMA_VERSION_1,
    artifact_schema_id: { type: "string", minLength: 1 },
    artifact_schema_version: { type: "string", minLength: 1 },
    content_hash: HASH_STRING,
    sealed_at: TIMESTAMP,
    incident_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    producer: PRODUCER,
    redaction: REDACTION,
    provenance: { type: "array", items: { type: "string", minLength: 1 } },
    payload: true,
  },
} as const;

/** The wire shape of a sealed artifact envelope. */
export type ArtifactEnvelope = FromSchema<typeof artifactEnvelopeSchema>;
