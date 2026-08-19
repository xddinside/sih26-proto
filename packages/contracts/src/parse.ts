/**
 * Runtime parsing against the JSON Schema registry using Ajv 2020 in strict
 * mode. Expected failures are returned as typed `ParseError` values:
 * `UNKNOWN_SCHEMA` for a name the registry does not know, `STALE_SCHEMA` for a
 * known name with an unsupported version, and `MALFORMED_CONTRACT` for data
 * that does not validate.
 */
import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import addFormats from "ajv-formats";

import type { JsonValue } from "./result.js";
import { err, ok, type Result } from "./result.js";
import { integrityError, type IntegrityError } from "./errors.js";
import {
  classifySchema,
  SCHEMA_REGISTRY,
  schemaKey,
  type JsonSchema,
  type SchemaName,
  type SchemaVersion,
} from "./schemas/registry.js";
import type {
  ArtifactEnvelope,
} from "./schemas/artifact-envelope.js";
import type { BrokerReceipt } from "./schemas/broker-receipt.js";
import type { GateEvaluation } from "./schemas/gate-evaluation.js";
import type { IncidentTrigger } from "./schemas/incident-trigger.js";
import type { JournalEvent } from "./schemas/journal-event.js";
import type { SavedBundleManifest } from "./schemas/saved-bundle-manifest.js";
import { parseJsonTextStrict } from "./canonical.js";

/** A parse failure: stable integrity code plus schema identity and issues. */
export type ParseError = IntegrityError & {
  code: "MALFORMED_CONTRACT" | "UNKNOWN_SCHEMA" | "STALE_SCHEMA";
};

function errorMessage(errors: ErrorObject[]): string {
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
    .join("; ");
}

let ajvSingleton: Ajv2020 | null = null;

/** Build (once) the strict Ajv instance with every registered schema. */
function getAjv(): Ajv2020 {
  if (ajvSingleton !== null) {
    return ajvSingleton;
  }
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: true,
  });
  addFormats(ajv);
  for (const [name, versions] of Object.entries(SCHEMA_REGISTRY)) {
    for (const [version, schema] of Object.entries(
      versions as Record<string, JsonSchema>,
    )) {
      ajv.addSchema(schema, schemaKey(name, version));
    }
  }
  ajvSingleton = ajv;
  return ajvSingleton;
}

/** Validate data against a registered schema name and version. */
export function validate(
  name: string,
  version: string,
  data: unknown,
): Result<JsonValue, ParseError> {
  const classification = classifySchema(name, version);
  if (classification.kind === "unknown-schema") {
    return err(
      integrityError(
        "UNKNOWN_SCHEMA",
        `unknown schema name ${JSON.stringify(name)}`,
        undefined,
        { schema: name, version },
      ),
    );
  }
  if (classification.kind === "stale-schema") {
    return err(
      integrityError(
        "STALE_SCHEMA",
        `unsupported version ${JSON.stringify(version)} for schema ${JSON.stringify(name)}`,
        undefined,
        { schema: name, version },
      ),
    );
  }
  const validator = getAjv().getSchema(schemaKey(name, version));
  if (validator === undefined) {
    return err(
      integrityError(
        "MALFORMED_CONTRACT",
        `schema ${name}@${version} is registered but has no compiled validator`,
        undefined,
        { schema: name, version },
      ),
    );
  }
  const valid = validator(data);
  if (valid === true) {
    return ok(data as JsonValue);
  }
  const issues = (validator.errors ?? []).map((e) => ({
    path: e.instancePath,
    message: e.message ?? "invalid",
  }));
  return err(
    integrityError(
      "MALFORMED_CONTRACT",
      `${name}@${version} failed validation: ${errorMessage(validator.errors ?? [])}`,
      undefined,
      { schema: name, version, issues },
    ),
  );
}

function parseTyped<T>(
  name: SchemaName,
  version: SchemaVersion,
  data: unknown,
): Result<T, ParseError> {
  const result = validate(name, version, data);
  if (!result.ok) {
    return err(result.error);
  }
  return ok(result.value as T);
}

/** Parse and validate an Incident Trigger against the registry. */
export function parseIncidentTrigger(data: unknown): Result<IncidentTrigger, ParseError> {
  return parseTyped<IncidentTrigger>("incident-trigger", "1.0", data);
}

/** Parse and validate a journal event against the registry. */
export function parseJournalEvent(data: unknown): Result<JournalEvent, ParseError> {
  return parseTyped<JournalEvent>("journal-event", "1.1", data);
}

/** Parse and validate a saved bundle manifest against the registry. */
export function parseSavedBundleManifest(
  data: unknown,
): Result<SavedBundleManifest, ParseError> {
  return parseTyped<SavedBundleManifest>("saved-bundle-manifest", "1.0", data);
}

/** Parse and validate an artifact envelope against the registry. */
export function parseArtifactEnvelope(
  data: unknown,
): Result<ArtifactEnvelope, ParseError> {
  return parseTyped<ArtifactEnvelope>("artifact-envelope", "1.0", data);
}

/** Parse and validate a broker receipt against the registry. */
export function parseBrokerReceipt(data: unknown): Result<BrokerReceipt, ParseError> {
  return parseTyped<BrokerReceipt>("broker-receipt", "1.0", data);
}

/** Parse and validate a gate evaluation against the registry. */
export function parseGateEvaluation(data: unknown): Result<GateEvaluation, ParseError> {
  return parseTyped<GateEvaluation>("gate-evaluation", "1.0", data);
}

/** Parse and validate an arbitrary registered schema name/version pair. */
export function parseArtifactPayload(
  name: string,
  version: string,
  data: unknown,
): Result<JsonValue, ParseError> {
  return validate(name, version, data);
}

/** Parse one JSONL journal line (strict JSON text) into an event. */
export function parseJournalLine(line: string): Result<JournalEvent, ParseError> {
  const parsed = parseJsonTextStrict(line);
  if (!parsed.ok) {
    return err(
      integrityError(
        "MALFORMED_CONTRACT",
        `journal line is not strict JSON: ${parsed.error.message}`,
        undefined,
        { detail: parsed.error },
      ),
    );
  }
  return parseJournalEvent(parsed.value);
}

/** Parse a whole JSONL journal body into events, rejecting empty inner lines. */
export function parseJournalLines(body: string): Result<JournalEvent[], ParseError> {
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  if (trimmed.length === 0) {
    return ok([]);
  }
  const lines = trimmed.split("\n");
  const events: JournalEvent[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.length === 0) {
      return err(
        integrityError(
          "MALFORMED_CONTRACT",
          `journal has an empty line at line ${i + 1}`,
          undefined,
          { line: i + 1 },
        ),
      );
    }
    const event = parseJournalLine(line);
    if (!event.ok) {
      return event;
    }
    events.push(event.value);
  }
  return ok(events);
}
