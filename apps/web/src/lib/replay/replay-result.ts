/**
 * Local result vocabulary for the static saved-bundle replay adapter.
 *
 * The adapter's expected failures are named `IntegrityError` values from
 * `@sih/contracts/errors`, returned as results, never thrown. The contracts
 * package does not export its internal `Result` helpers, so the adapter
 * declares a structurally identical one of its own.
 */
import type { IntegrityError } from "@sih/contracts/errors"

/** A discriminated result used across the replay adapter. */
export type ReplayResult<T, TError = IntegrityError[]> =
  | { ok: true; value: T }
  | { ok: false; error: TError }

/** Wrap a value in a successful replay result. */
export function replayOk<T, TError = IntegrityError[]>(
  value: T,
): ReplayResult<T, TError> {
  return { ok: true, value }
}

/** Wrap errors in a failed replay result. */
export function replayErr<T, TError = IntegrityError[]>(
  error: TError,
): ReplayResult<T, TError> {
  return { ok: false, error }
}
