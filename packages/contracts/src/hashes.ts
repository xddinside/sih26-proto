/**
 * Deterministic hashing over RFC 8785 canonical JSON.
 *
 * Every derived hash wraps its input in a structured, domain-separated object
 * rather than concatenating fields with delimiters. Hash strings are
 * lower-case `sha256:<64 hex>`. File byte hashes are computed over exact
 * bytes (no newline normalization); derived hashes are computed over canonical
 * UTF-8.
 */
import { createHash } from "node:crypto";

import { canonicalizeJsonValue } from "./canonical.js";
import type { CanonicalError } from "./canonical.js";
import type { JsonValue } from "./result.js";
import { ok, type Result } from "./result.js";
import type {
  CandidateHashInput,
  DeliveryKeyInput,
  EvidenceHashInput,
  IncidentKeyInput,
} from "./schemas/hash-inputs.js";

/** A lower-case prefixed SHA-256 digest string. */
export type HashString = `sha256:${string}`;

/** SHA-256 of a UTF-8 string, as 64 lowercase hex characters. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 of exact bytes, as 64 lowercase hex characters. */
export function sha256Bytes(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function prefixedHash(hexDigest: string): HashString {
  // sha256Hex and sha256Bytes are the only callers, so this internal helper
  // receives exactly 64 lowercase hexadecimal characters by construction.
  return `sha256:${hexDigest}`;
}

/** Regular expression matching a valid `sha256:<64 hex>` hash string. */
export const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** True when the string is a well-formed prefixed SHA-256 hash. */
export function isHashString(value: string): boolean {
  return HASH_PATTERN.test(value);
}

const DOMAIN_CONTENT = { domain: "sih.content", version: 1 };
const DOMAIN_CANDIDATE = { domain: "sih.candidate", version: 1 };
const DOMAIN_EVIDENCE = { domain: "sih.evidence-item", version: 1 };
const DOMAIN_INCIDENT_KEY = { domain: "sih.incident-key", version: 1 };
const DOMAIN_DELIVERY_KEY = { domain: "sih.delivery-key", version: 1 };

function hashWrapped(preimage: unknown): Result<HashString, CanonicalError> {
  // The preimage is built from schema-validated values; canonicalizeJsonValue
  // re-checks JSON compatibility at runtime, so the cast is safe.
  const bytes = canonicalizeJsonValue(preimage as JsonValue);
  if (!bytes.ok) {
    return bytes;
  }
  return ok(prefixedHash(sha256Bytes(bytes.value)));
}

/**
 * Content hash of a stored payload. Binds the canonical form of the payload,
 * so the payload must already be redacted by its producer. Content hashes are
 * distinct from file byte hashes: a file's exact bytes (including JSONL
 * newlines) are hashed separately by the saved manifest.
 */
export function contentHash(payload: JsonValue): Result<HashString, CanonicalError> {
  return hashWrapped({ ...DOMAIN_CONTENT, payload });
}

/**
 * Candidate hash over the full change set: base snapshot/ref, diff or typed
 * action plan, proposal fields that define the action, declared changed
 * surfaces, action-risk class, gate path, target identity, and Recovery Point.
 */
export function candidateHash(input: CandidateHashInput): Result<HashString, CanonicalError> {
  return hashWrapped({ ...DOMAIN_CANDIDATE, input });
}

/**
 * Evidence item id, binding canonical content, kind, and join identity.
 */
export function evidenceItemId(
  input: EvidenceHashInput,
): Result<HashString, CanonicalError> {
  return hashWrapped({
    ...DOMAIN_EVIDENCE,
    kind: input.kind,
    identity: input.identity,
    content: input.content,
  });
}

/**
 * Incident key. Binds tenant, environment (normalized from
 * `deployment_environment_name` to the `environment` field), service, and
 * detector key.
 */
export function incidentKey(input: IncidentKeyInput): Result<HashString, CanonicalError> {
  return hashWrapped({
    ...DOMAIN_INCIDENT_KEY,
    tenant_id: input.tenant_id,
    environment: input.deployment_environment_name,
    service_name: input.service_name,
    detector_key: input.detector_key,
  });
}

/**
 * Delivery key. Binds the exact settled intake inputs; `ends_at` may be null.
 */
export function deliveryKey(input: DeliveryKeyInput): Result<HashString, CanonicalError> {
  return hashWrapped({
    ...DOMAIN_DELIVERY_KEY,
    source: input.source,
    alert_fingerprint: input.alert_fingerprint,
    status: input.status,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
  });
}
