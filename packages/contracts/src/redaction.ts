/**
 * Structural redaction integrity, from docs/research/hypothesis-gate.md.
 *
 * Redaction is structural, not secret scanning: every `masked_fields` JSON
 * Pointer must resolve to the literal string `[REDACTED]`. Missing or bad
 * pointers, and resolved values that are not `[REDACTED]`, are
 * `REDACTION_FAILURE`. This deliberately does not detect undeclared secrets.
 */
import type { IntegrityError } from "./errors.js";
import { integrityError } from "./errors.js";
import type { JsonValue } from "./result.js";
import { err, ok, type Result } from "./result.js";

export const REDACTED = "[REDACTED]" as const;

/** Split a JSON Pointer into raw reference tokens (RFC 6901 section 4). */
export function splitPointer(pointer: string): Result<string[], IntegrityError> {
  if (pointer === "") {
    return ok([]);
  }
  if (!pointer.startsWith("/")) {
    return err(integrityError("REDACTION_FAILURE", "JSON Pointer must be empty or start with '/'", pointer));
  }
  const raw = pointer.slice(1).split("/");
  const tokens: string[] = [];
  for (const segment of raw) {
    if (!/^([^~]|~[01])*$/.test(segment)) {
      return err(integrityError("REDACTION_FAILURE", "invalid JSON Pointer escape", pointer));
    }
    tokens.push(segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return ok(tokens);
}

/** Resolve a JSON Pointer against a value, returning the referenced value. */
export function resolvePointer(
  value: JsonValue,
  pointer: string,
): Result<JsonValue, IntegrityError> {
  const tokens = splitPointer(pointer);
  if (!tokens.ok) {
    return tokens;
  }
  let current: JsonValue = value;
  for (const token of tokens.value) {
    if (Array.isArray(current)) {
      const index = /^(0|[1-9]\d*)$/.test(token) ? Number(token) : NaN;
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return err(
          integrityError("REDACTION_FAILURE", `array index ${JSON.stringify(token)} out of range`, pointer),
        );
      }
      const next = current[index];
      if (next === undefined) {
        return err(integrityError("REDACTION_FAILURE", "missing array element", pointer));
      }
      current = next;
      continue;
    }
    if (current !== null && typeof current === "object") {
      const object = current as { [key: string]: JsonValue };
      if (!Object.prototype.hasOwnProperty.call(object, token)) {
        return err(
          integrityError("REDACTION_FAILURE", `missing key ${JSON.stringify(token)}`, pointer),
        );
      }
      const next = object[token];
      if (next === undefined) {
        return err(integrityError("REDACTION_FAILURE", "missing key value", pointer));
      }
      current = next;
      continue;
    }
    return err(integrityError("REDACTION_FAILURE", "cannot descend into scalar", pointer));
  }
  return ok(current);
}

/** Redaction metadata passed to the integrity check. */
export interface RedactionMetadata {
  profile_id: string;
  masked_fields: string[];
}

/**
 * Verify that every masked field JSON Pointer resolves to the literal
 * `[REDACTED]`. Missing pointers or resolved values that differ are
 * `REDACTION_FAILURE`.
 */
export function verifyRedaction(
  payload: JsonValue,
  redaction: RedactionMetadata,
): Result<true, IntegrityError> {
  for (const pointer of redaction.masked_fields) {
    const resolved = resolvePointer(payload, pointer);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value !== REDACTED) {
      return err(
        integrityError(
          "REDACTION_FAILURE",
          `masked field ${JSON.stringify(pointer)} does not resolve to ${REDACTED}`,
          pointer,
        ),
      );
    }
  }
  return ok(true);
}
