import { describe, expect, test } from "bun:test";

import { normalizeSavedPath, validatePaths } from "../src/paths.js";

describe("normalizeSavedPath", () => {
  test.each([
    "incidents/i/journal.jsonl",
    "artifacts/sha256/abc.json",
    "a/b/c",
  ])("accepts %s", (path) => {
    expect(normalizeSavedPath(path).ok).toBe(true);
  });

  test.each([
    "/etc/passwd",
    "../x",
    "a/../b",
    "a\\b",
    "a//b",
    "a/",
    "",
    ".",
    "..",
  ])("rejects %s", (path) => {
    expect(normalizeSavedPath(path).ok).toBe(false);
  });

  test("rejects NUL bytes", () => {
    expect(normalizeSavedPath("a\u0000b").ok).toBe(false);
  });
});

describe("validatePaths", () => {
  test("accepts a distinct set", () => {
    const result = validatePaths(["a", "b/c"]);
    expect(result.ok).toBe(true);
  });

  test("rejects duplicates", () => {
    const result = validatePaths(["a", "a"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_PATH");
    }
  });

  test("rejects a dot segment inside the set", () => {
    const result = validatePaths(["a/./b"]);
    expect(result.ok).toBe(false);
  });
});
