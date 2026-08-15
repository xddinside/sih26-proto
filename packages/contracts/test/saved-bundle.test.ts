import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { verifySavedBundle } from "../src/saved-bundle.js";
import type { IntegrityError } from "../src/errors.js";
import { loadBundle } from "./fixture-helper.js";
import { MUTATORS, type InvalidCase } from "./invalid-cases.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "demo", "fixtures", "contracts");
const EVAL = "2026-08-21T00:00:00Z";

function codes(result: { ok: true } | { ok: false; error: IntegrityError[] }): string[] {
  if (result.ok) {
    return [];
  }
  return result.error.map((e) => e.code);
}

const INVALID_CASES = JSON.parse(
  readFileSync(join(ROOT, "invalid-cases.json"), "utf8"),
) as InvalidCase[];

describe("saved bundle verifier", () => {
  test("accepts the valid bundle", () => {
    const files = loadBundle(join(ROOT, "valid"));
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.incidents).toHaveLength(2);
      const run1 = result.value.incidents.find((i) => i.incidentId === "inc-demo-payment-1");
      const run2 = result.value.incidents.find((i) => i.incidentId === "inc-demo-payment-2");
      expect(run1?.finalSequence).toBe(44);
      expect(run2?.finalSequence).toBe(25);
    }
  });

  test("every invalid case has a deterministic mutator", () => {
    for (const c of INVALID_CASES) {
      expect(MUTATORS[c.name]).toBeDefined();
    }
    expect(Object.keys(MUTATORS).sort()).toEqual(INVALID_CASES.map((c) => c.name).sort());
  });

  for (const c of INVALID_CASES) {
    test(`${c.name} fails with ${c.expected_code}`, () => {
      const files = loadBundle(join(ROOT, "valid"));
      const mutator = MUTATORS[c.name];
      if (mutator === undefined) {
        throw new Error(`missing mutator for ${c.name}`);
      }
      const mutated = mutator(files);
      const result = verifySavedBundle({ files: mutated }, { evaluationTime: EVAL });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(codes(result)).toContain(c.expected_code);
      }
    });
  }
});
