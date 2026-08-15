/**
 * Freshness check, from docs/research/hypothesis-gate.md. Freshness is a
 * separate pure check over an item's `fresh_until` plus an explicit evaluation
 * time. Saved bundle age alone never makes replay invalid; only an expired
 * `fresh_until` does.
 */
import type { IntegrityError } from "./errors.js";
import { integrityError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

/**
 * Compare two date-time strings with `Date.parse`, which accepts the RFC 3339
 * offsets the schema allows. Returns true when `a` is strictly after `b`.
 */
function isAfter(a: string, b: string): boolean {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  return aTime > bTime;
}

/** True when an item with a possibly-null `fresh_until` is not yet expired. */
export function isFresh(freshUntil: string | null, evaluationTime: string): boolean {
  if (!Number.isFinite(Date.parse(evaluationTime))) {
    return false;
  }
  if (freshUntil === null) {
    return true;
  }
  if (!Number.isFinite(Date.parse(freshUntil))) {
    return false;
  }
  return !isAfter(evaluationTime, freshUntil);
}

/** An item that carries a possibly-null `fresh_until`. */
export interface FreshnessInput {
  id?: string;
  fresh_until: string | null;
}

/**
 * Check a list of evidence items for expiry. The first expired item produces a
 * `STALE_DATA` error naming its id.
 */
export function checkFreshness(
  items: readonly FreshnessInput[],
  evaluationTime: string,
): Result<true, IntegrityError> {
  for (const item of items) {
    if (!isFresh(item.fresh_until, evaluationTime)) {
      return err(
        integrityError(
          "STALE_DATA",
          `evidence item ${item.id ?? "(unidentified)"} is stale at ${evaluationTime}`,
          item.id,
          { fresh_until: item.fresh_until, evaluation_time: evaluationTime },
        ),
      );
    }
  }
  return ok(true);
}
