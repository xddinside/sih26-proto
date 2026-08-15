import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  canonicalizeJsonText,
  canonicalizeJsonValue,
  canonicalizeJsonValueString,
  parseJsonTextStrict,
} from "../src/canonical.js";
import type { JsonValue } from "../src/result.js";

describe("parseJsonTextStrict", () => {
  test("parses valid JSON", () => {
    const result = parseJsonTextStrict('{"a": 1, "b": [true, null, "x"]}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1, b: [true, null, "x"] });
    }
  });

  test("rejects duplicate object keys", () => {
    const result = parseJsonTextStrict('{"a": 1, "a": 2}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_OBJECT_KEY");
    }
  });

  test("rejects duplicate keys in nested objects", () => {
    const result = parseJsonTextStrict('{"a": {"b": 1, "b": 2}}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_OBJECT_KEY");
    }
  });

  test("rejects non-finite numbers from huge exponents", () => {
    const result = parseJsonTextStrict("1e400");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_JSON_TEXT");
    }
  });

  test.each([
    "{",
    "[1,",
    '{"a": }',
    "'single'",
    '{"a": 1,}',
    "{a: 1}",
    '"unterminated',
    "01",
    "1.",
    "-",
    "NaN",
    "Infinity",
  ])("rejects malformed JSON %s", (text) => {
    const result = parseJsonTextStrict(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_JSON_TEXT");
    }
  });

  test("handles escaped strings and unicode escapes", () => {
    const result = parseJsonTextStrict('{"a": "\\u0041\\n\\t\\"\\\\"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 'A\n\t"\\' });
    }
  });

  test("preserves __proto__ as an own JSON key", () => {
    const result = parseJsonTextStrict('{"__proto__":0}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.prototype.hasOwnProperty.call(result.value, "__proto__")).toBe(true);
      expect((result.value as Record<string, number>)["__proto__"]).toBe(0);
    }
  });

  test("rejects unpaired Unicode surrogates", () => {
    expect(parseJsonTextStrict('"\\ud800"').ok).toBe(false);
    expect(parseJsonTextStrict('"\\udc00"').ok).toBe(false);
  });
});

describe("canonicalizeJsonValue", () => {
  test("rejects undefined", () => {
    const result = canonicalizeJsonValue({ a: undefined } as unknown as JsonValue);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NON_IJSON_VALUE");
    }
  });

  test("rejects NaN and Infinity", () => {
    expect(canonicalizeJsonValue(NaN).ok).toBe(false);
    expect(canonicalizeJsonValue(Infinity).ok).toBe(false);
  });

  test("rejects BigInt", () => {
    expect(canonicalizeJsonValue(1n as unknown as JsonValue).ok).toBe(false);
  });

  test("rejects sparse arrays", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3] as unknown as JsonValue;
    expect(canonicalizeJsonValue(sparse).ok).toBe(false);
  });

  test("rejects circular references", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(canonicalizeJsonValue(circular as unknown as JsonValue).ok).toBe(false);
  });

  test("rejects Date instances", () => {
    expect(canonicalizeJsonValue(new Date() as unknown as JsonValue).ok).toBe(false);
  });

  test("sorts object keys by UTF-16 code units", () => {
    const result = canonicalizeJsonValueString({ "10": 0, "1": 0, a: 0, "": 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('{"":0,"1":0,"10":0,"a":0}');
    }
  });

  test("preserves array order", () => {
    const result = canonicalizeJsonValueString([3, 1, 2]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("[3,1,2]");
    }
  });

  test("preserves unicode exactly without normalization", () => {
    const result = canonicalizeJsonValueString({ "😀": "é" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('{"😀":"é"}');
    }
  });

  test("emits no whitespace", () => {
    const result = canonicalizeJsonValueString({ a: 1, b: [2, 3], c: { d: true } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toMatch(/\s/);
    }
  });

  test("returns an error instead of throwing on an unpaired surrogate", () => {
    expect(canonicalizeJsonValueString("\ud800").ok).toBe(false);
    expect(canonicalizeJsonText('"\\ud800"').ok).toBe(false);
  });
});

describe("canonicalizeJsonText", () => {
  test("produces the same canonical form regardless of key insertion order", () => {
    const a = canonicalizeJsonText('{"a":1,"b":2,"c":3}');
    const b = canonicalizeJsonText('{"c":3,"b":2,"a":1}');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(new TextDecoder().decode(a.value)).toBe(new TextDecoder().decode(b.value));
    }
  });
});

describe("property-based checks", () => {
  test("key insertion order does not change canonicalization", () => {
    const key = fc.string({
      unit: fc.constantFrom("a", "b", "c", "d", "1", "2", "3"),
      minLength: 1,
      maxLength: 6,
    });
    fc.assert(
      fc.property(fc.dictionary(key, fc.integer({ min: -1000, max: 1000 })), (dict) => {
        const entries = Object.entries(dict);
        // A deterministic permutation: reverse the key order. RFC 8785 sorts
        // keys anyway, so canonical form must be identical.
        const reordered = Object.fromEntries([...entries].reverse());
        const a = canonicalizeJsonValueString(dict as JsonValue);
        const b = canonicalizeJsonValueString(reordered as JsonValue);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (a.ok && b.ok) {
          expect(a.value).toBe(b.value);
        }
      }),
      { numRuns: 200 },
    );
  });

  test("canonicalization is repeatable", () => {
    fc.assert(
      fc.property(fc.jsonValue({ depthSize: 3 }), (value) => {
        const a = canonicalizeJsonValue(value as JsonValue);
        const b = canonicalizeJsonValue(value as JsonValue);
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) {
          expect(new TextDecoder().decode(a.value)).toBe(new TextDecoder().decode(b.value));
        }
      }),
      { numRuns: 200 },
    );
  });
});
