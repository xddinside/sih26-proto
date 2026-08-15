/**
 * Saved bundle manifest v1, from docs/research/incident-workspace.md. The
 * manifest records the export format version, capture time, Incident ids with
 * their expected final journal sequence, and the exact byte hash and size of
 * every file. It never lists its own hash.
 */
import type { FromSchema } from "json-schema-to-ts";

import { HASH_STRING, TIMESTAMP } from "./defs.js";

/** The JSON Schema for a byte-accurate saved-bundle manifest. */
export const savedBundleManifestSchema = {
  $id: "https://contracts.sih.dev/saved-bundle-manifest/1.0",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Saved Bundle Manifest v1",
  type: "object",
  additionalProperties: false,
  required: ["format_version", "capture_time", "incident_ids", "files"],
  properties: {
    format_version: { type: "string", const: "1.0" },
    capture_time: TIMESTAMP,
    incident_ids: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["incident_id", "final_sequence"],
        properties: {
          incident_id: { type: "string", minLength: 1 },
          final_sequence: { type: "integer", minimum: 1 },
        },
      },
    },
    files: {
      type: "object",
      additionalProperties: false,
      patternProperties: {
        ".*": {
          type: "object",
          additionalProperties: false,
          required: ["sha256", "size"],
          properties: {
            sha256: HASH_STRING,
            size: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
} as const;

/** The wire shape of a saved bundle manifest. */
export type SavedBundleManifest = FromSchema<typeof savedBundleManifestSchema>;
