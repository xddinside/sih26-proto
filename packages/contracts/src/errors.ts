/**
 * Stable integrity error codes shared by the saved-bundle verifier, the
 * journal rules, the schema parser, and the canonicalization layer.
 *
 * These codes are the contract's public failure vocabulary. Every caller that
 * enforces saved-bundle integrity must emit these exact codes so the Incident
 * Workspace can render stable, localized error states.
 */
export const INTEGRITY_ERROR_CODES = [
  "MALFORMED_CONTRACT",
  "BAD_SEQUENCE",
  "ILLEGAL_TRANSITION",
  "DUPLICATE_TRANSITION",
  "STALE_SCHEMA",
  "UNKNOWN_SCHEMA",
  "STALE_DATA",
  "REDACTION_FAILURE",
  "MISSING_ARTIFACT",
  "CHANGED_CONTENT",
  "INVALID_PATH",
] as const;

/** One of the stable integrity error codes. */
export type IntegrityErrorCode = (typeof INTEGRITY_ERROR_CODES)[number];

/**
 * A single, stable integrity error. `path` names the bundle file, journal
 * sequence, or JSON Pointer that produced the error when one exists. `details`
 * carries machine-readable context that must never be the only signal an
 * integrator relies on: the `code` is the durable contract.
 */
export interface IntegrityError {
  /** Stable error code from {@link INTEGRITY_ERROR_CODES}. */
  code: IntegrityErrorCode;
  /** Human-readable description; prose, never evidence. */
  message: string;
  /** Bundle path, sequence number, or JSON Pointer that produced the error. */
  path?: string;
  /** Optional structured detail (schema ids, versions, pointer segments). */
  details?: Record<string, unknown>;
}

/** Build an integrity error, omitting optional fields when absent. */
export function integrityError<C extends IntegrityErrorCode>(
  code: C,
  message: string,
  path?: string,
  details?: Record<string, unknown>,
): IntegrityError & { code: C } {
  const error: IntegrityError = { code, message };
  if (path !== undefined) {
    error.path = path;
  }
  if (details !== undefined) {
    error.details = details;
  }
  return error as IntegrityError & { code: C };
}
