/**
 * A small, shared discriminated result used across the contracts package.
 *
 * Expected failures are returned as `{ ok: false, error }` values, never
 * thrown. Internal defects (bugs, impossible states) may still throw.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Wrap a value in a successful result. */
export function ok<T, E>(value: T): Result<T, E> {
  return { ok: true, value };
}

/** Wrap an error in a failed result. */
export function err<T, E>(error: E): Result<T, E> {
  return { ok: false, error };
}

/**
 * Any JSON value as defined by I-JSON (RFC 7493 section 2.1) restricted to
 * JSON text primitives: strings, finite numbers, booleans, null, and
 * recursively nested arrays and objects whose keys are strings.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
