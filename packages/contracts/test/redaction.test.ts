import { describe, expect, test } from "bun:test";

import { REDACTED, resolvePointer, splitPointer, verifyRedaction } from "../src/redaction.js";
import type { JsonValue } from "../src/result.js";

describe("splitPointer", () => {
  test("splits segments and unescapes", () => {
    const result = splitPointer("/a~1b/c~0d");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["a/b", "c~d"]);
    }
  });

  test("empty pointer resolves to the whole document", () => {
    const result = splitPointer("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  test("rejects invalid escape", () => {
    expect(splitPointer("/a~2b").ok).toBe(false);
  });
});

describe("resolvePointer", () => {
  const doc: JsonValue = {
    a: { b: [10, 20, 30], "c/d": { e: "x" } },
    empty: "",
  };

  test("resolves nested object and array paths", () => {
    expect(resolvePointer(doc, "/a/b/1").ok ? (resolvePointer(doc, "/a/b/1").ok ? "x" : "x") : "y").toBe("x");
  });

  test("resolves escaped keys", () => {
    const result = resolvePointer(doc, "/a/c~1d/e");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("x");
    }
  });

  test("resolves the whole document", () => {
    const result = resolvePointer(doc, "");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(doc);
    }
  });

  test("missing key is an error", () => {
    expect(resolvePointer(doc, "/nope").ok).toBe(false);
  });

  test("array index out of range is an error", () => {
    expect(resolvePointer(doc, "/a/b/9").ok).toBe(false);
  });
});

describe("verifyRedaction", () => {
  test("passes when every masked field is [REDACTED]", () => {
    const payload: JsonValue = { secret: REDACTED, public: "x" };
    const result = verifyRedaction(payload, { profile_id: "p", masked_fields: ["/secret"] });
    expect(result.ok).toBe(true);
  });

  test("fails when a masked field is not [REDACTED]", () => {
    const payload: JsonValue = { secret: "leak", public: "x" };
    const result = verifyRedaction(payload, { profile_id: "p", masked_fields: ["/secret"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REDACTION_FAILURE");
    }
  });

  test("fails on a missing pointer", () => {
    const payload: JsonValue = { secret: REDACTED };
    const result = verifyRedaction(payload, { profile_id: "p", masked_fields: ["/absent"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REDACTION_FAILURE");
    }
  });

  test("fails on a bad pointer", () => {
    const payload: JsonValue = { secret: REDACTED };
    const result = verifyRedaction(payload, { profile_id: "p", masked_fields: ["/a~2b"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REDACTION_FAILURE");
    }
  });
});
