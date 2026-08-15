/**
 * Saved bundle path rules, from docs/research/incident-workspace.md. Paths are
 * POSIX relative paths. Absolute paths, `..`, backslashes, empty segments, and
 * NUL bytes are rejected as `INVALID_PATH`.
 */
import type { IntegrityError } from "./errors.js";
import { integrityError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

/**
 * Normalize a saved bundle path to a POSIX relative path, rejecting absolute
 * paths, `..` segments, backslashes, empty segments, and NUL bytes.
 */
export function normalizeSavedPath(path: string): Result<string, IntegrityError> {
  if (path.length === 0) {
    return err(integrityError("INVALID_PATH", "path is empty"));
  }
  if (path.includes("\u0000")) {
    return err(integrityError("INVALID_PATH", "path contains a NUL byte", path));
  }
  if (path.includes("\\")) {
    return err(integrityError("INVALID_PATH", "path contains a backslash", path));
  }
  if (path.startsWith("/")) {
    return err(integrityError("INVALID_PATH", "path is absolute", path));
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return err(integrityError("INVALID_PATH", "path has an empty segment", path));
    }
    if (segment === "." || segment === "..") {
      return err(integrityError("INVALID_PATH", "path contains a dot segment", path));
    }
  }
  return ok(path);
}

/**
 * Validate that a set of paths is free of duplicates after normalization and
 * that every path is a valid POSIX relative path. Returns the normalized set
 * keyed by the original path.
 */
export function validatePaths(
  paths: readonly string[],
): Result<Map<string, string>, IntegrityError> {
  const normalized = new Map<string, string>();
  for (const path of paths) {
    const result = normalizeSavedPath(path);
    if (!result.ok) {
      return result;
    }
    if (normalized.has(result.value)) {
      return err(
        integrityError("INVALID_PATH", `duplicate normalized path ${JSON.stringify(result.value)}`, path),
      );
    }
    normalized.set(result.value, path);
  }
  return ok(normalized);
}
