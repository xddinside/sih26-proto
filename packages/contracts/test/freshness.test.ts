import { describe, expect, test } from "bun:test";

import { checkFreshness, isFresh } from "../src/freshness.js";

const EVAL = "2026-08-21T00:00:00Z";

describe("isFresh", () => {
  test("null fresh_until is always fresh", () => {
    expect(isFresh(null, EVAL)).toBe(true);
  });

  test("a future fresh_until is fresh", () => {
    expect(isFresh("2026-09-01T00:00:00Z", EVAL)).toBe(true);
  });

  test("a past fresh_until is stale", () => {
    expect(isFresh("2026-08-01T00:00:00Z", EVAL)).toBe(false);
  });

  test("the boundary second is still fresh (not strictly after)", () => {
    expect(isFresh("2026-08-21T00:00:00Z", EVAL)).toBe(true);
  });

  test("handles offset timestamps", () => {
    expect(isFresh("2026-08-20T18:00:00-06:00", EVAL)).toBe(true);
  });

  test("invalid timestamps are never fresh", () => {
    expect(isFresh("not-a-time", "2026-08-15T00:00:00Z")).toBe(false);
    expect(isFresh("2026-08-16T00:00:00Z", "not-a-time")).toBe(false);
    expect(isFresh(null, "not-a-time")).toBe(false);
  });
});

describe("checkFreshness", () => {
  test("returns STALE_DATA naming the expired item", () => {
    const result = checkFreshness(
      [
        { id: "i1", fresh_until: "2026-09-01T00:00:00Z" },
        { id: "i2", fresh_until: "2026-08-01T00:00:00Z" },
      ],
      EVAL,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_DATA");
      expect(result.error.path).toBe("i2");
    }
  });

  test("passes when nothing is expired", () => {
    const result = checkFreshness(
      [{ id: "i1", fresh_until: null }, { id: "i2", fresh_until: "2026-09-01T00:00:00Z" }],
      EVAL,
    );
    expect(result.ok).toBe(true);
  });
});
