/**
 * A tiny Result type for expected domain failures, mirroring the
 * `@sih/contracts` Result discipline: expected failures are returned, never
 * thrown. Internal defects (bugs) may throw.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T, E>(value: T): Result<T, E> {
  return { ok: true, value }
}

export function err<T, E>(error: E): Result<T, E> {
  return { ok: false, error }
}

/** A domain failure with a stable machine-readable code and a message. */
export interface DomainError {
  code: string
  message: string
}

export function domainError(code: string, message: string): DomainError {
  return { code, message }
}

export const ERR = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  STALE_LEASE: "STALE_LEASE",
  EXPIRED_LEASE: "EXPIRED_LEASE",
  REVOKED_LEASE: "REVOKED_LEASE",
  PERMIT_USED: "PERMIT_USED",
  PERMIT_MISMATCH: "PERMIT_MISMATCH",
  CANDIDATE_MISMATCH: "CANDIDATE_MISMATCH",
  FORGED_STAGE: "FORGED_STAGE",
  MISSING_APPROVAL: "MISSING_APPROVAL",
  BARRED_ACTION: "BARRED_ACTION",
  MODE_DENIED: "MODE_DENIED",
  POLICY_DENIED: "POLICY_DENIED",
  NEEDS_HUMAN: "NEEDS_HUMAN",
  DUPLICATE: "DUPLICATE",
  DUPLICATE_WORK: "DUPLICATE_WORK",
  STALE_ATTEMPT: "STALE_ATTEMPT",
  WRONG_STAGE: "WRONG_STAGE",
  PREREQUISITE_MISSING: "PREREQUISITE_MISSING",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  CONFLICT: "CONFLICT",
  GATE_FAILED: "GATE_FAILED",
  HASH_MISMATCH: "HASH_MISMATCH",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  UNKNOWN_ADAPTER: "UNKNOWN_ADAPTER",
  STALE_TARGET: "STALE_TARGET",
  ATTEMPT_LIMIT: "ATTEMPT_LIMIT",
  MALFORMED_CONTRACT: "MALFORMED_CONTRACT",
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]
