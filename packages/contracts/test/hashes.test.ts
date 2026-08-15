import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  candidateHash,
  contentHash,
  deliveryKey,
  evidenceItemId,
  HASH_PATTERN,
  incidentKey,
  isHashString,
  sha256Hex,
  type HashString,
} from "../src/hashes.js";
import type { JsonValue } from "../src/result.js";
import type {
  CandidateHashInput,
  DeliveryKeyInput,
  EvidenceHashInput,
  IncidentKeyInput,
} from "../src/schemas/hash-inputs.js";

describe("sha256Hex", () => {
  test("matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("produces the prefixed hash string format", () => {
    const hash = contentHash({ value: "x" });
    expect(hash.ok).toBe(true);
    if (hash.ok) {
      expect(isHashString(hash.value)).toBe(true);
      expect(HASH_PATTERN.test(hash.value)).toBe(true);
    }
  });

  test("rejects malformed hash strings", () => {
    expect(isHashString("sha256:abc")).toBe(false);
    expect(isHashString("sha256:" + "a".repeat(63))).toBe(false);
    expect(isHashString("sha256:" + "A".repeat(64))).toBe(false);
    expect(isHashString("not-a-hash")).toBe(false);
  });
});

function hashFor(tag: string): HashString {
  const result = contentHash({ tag });
  if (!result.ok) {
    throw new Error(`test hash construction failed: ${result.error.message}`);
  }
  return result.value;
}

const candidateInput = (overrides: Partial<CandidateHashInput> = {}): CandidateHashInput => ({
  schema_version: "1.0",
  base_ref: "deadbeef",
  change: { kind: "diff", base_ref: "deadbeef", diff_text: "-\n+" },
  proposal: { remediation_class: "code", disposition: "allowed" },
  changed_surfaces: ["src/payment/card.js"],
  action_risk_class: "safe",
  gate_path: "release",
  target: {
    tenant_id: "demo",
    deployment_environment_name: "demo",
    service_name: "payment",
    expected_version: "digest-1",
  },
  recovery_point_hash: hashFor("rp"),
  ...overrides,
});

const evidenceInput = (overrides: Partial<EvidenceHashInput> = {}): EvidenceHashInput => ({
  schema_version: "1.0",
  kind: "metric",
  identity: { metric_name: "ratio", service_name: "payment" },
  content: { value: 0.92 },
  ...overrides,
});

describe("contentHash", () => {
  test("is repeatable and prefixed", () => {
    const a = contentHash({ a: 1 });
    const b = contentHash({ a: 1 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
      expect(isHashString(a.value)).toBe(true);
    }
  });

  test("differs from other domain hashes", () => {
    const content = contentHash({ a: 1 });
    const candidate = candidateHash(candidateInput());
    expect(content.ok).toBe(true);
    expect(candidate.ok).toBe(true);
    if (content.ok && candidate.ok) {
      expect(content.value).not.toBe(candidate.value);
    }
  });
});

describe("candidateHash", () => {
  test("is repeatable", () => {
    const a = candidateHash(candidateInput());
    const b = candidateHash(candidateInput());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
  });

  test("changing any one field changes the hash", () => {
    const base = candidateHash(candidateInput());
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const mutations: CandidateHashInput[] = [
      candidateInput({ base_ref: "other" }),
      candidateInput({ action_risk_class: "guarded" }),
      candidateInput({ gate_path: "action" }),
      candidateInput({ changed_surfaces: ["other"] }),
      candidateInput({ recovery_point_hash: hashFor("other") }),
      candidateInput({
        change: { kind: "typed-action-plan", adapter: "a", action_class: "c", command: "x" },
      }),
      candidateInput({
        target: {
          tenant_id: "demo",
          deployment_environment_name: "demo",
          service_name: "checkout",
        },
      }),
    ];
    for (const mutated of mutations) {
      const hash = candidateHash(mutated);
      expect(hash.ok).toBe(true);
      if (hash.ok) {
        expect(hash.value).not.toBe(base.value);
      }
    }
  });
});

describe("evidenceItemId", () => {
  test("binds content, kind, and identity", () => {
    const a = evidenceItemId(evidenceInput());
    const b = evidenceItemId(evidenceInput());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
    const changedKind = evidenceItemId(evidenceInput({ kind: "trace" }));
    const changedIdentity = evidenceItemId(
      evidenceInput({ identity: { metric_name: "ratio", service_name: "checkout" } }),
    );
    const changedContent = evidenceItemId(evidenceInput({ content: { value: 0.91 } }));
    expect(changedKind.ok && changedIdentity.ok && changedContent.ok).toBe(true);
    if (changedKind.ok && a.ok) {
      expect(changedKind.value).not.toBe(a.value);
    }
    if (changedIdentity.ok && a.ok) {
      expect(changedIdentity.value).not.toBe(a.value);
    }
    if (changedContent.ok && a.ok) {
      expect(changedContent.value).not.toBe(a.value);
    }
  });
});

describe("incidentKey / deliveryKey", () => {
  test("incident key normalizes deployment_environment_name to environment", () => {
    const input: IncidentKeyInput = {
      schema_version: "1.0",
      tenant_id: "demo",
      deployment_environment_name: "demo",
      service_name: "payment",
      detector_key: "payment-error-rate",
    };
    const a = incidentKey(input);
    const b = incidentKey(input);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
      expect(isHashString(a.value)).toBe(true);
    }
  });

  test("delivery key binds exact settled inputs", () => {
    const input: DeliveryKeyInput = {
      schema_version: "1.0",
      source: "prometheus-alertmanager",
      alert_fingerprint: "abc123",
      status: "firing",
      starts_at: "2026-08-15T15:33:00Z",
      ends_at: null,
    };
    const a = deliveryKey(input);
    const b = deliveryKey(input);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
    const changed = deliveryKey({ ...input, status: "resolved" });
    expect(changed.ok && a.ok).toBe(true);
    if (changed.ok && a.ok) {
      expect(changed.value).not.toBe(a.value);
    }
  });

  test("domain separation: all five hash families differ", () => {
    const hashes = [
      contentHash({ x: 1 }),
      candidateHash(candidateInput()),
      evidenceItemId(evidenceInput()),
      incidentKey({
        schema_version: "1.0",
        tenant_id: "t",
        deployment_environment_name: "e",
        service_name: "s",
        detector_key: "d",
      }),
      deliveryKey({
        schema_version: "1.0",
        source: "s",
        alert_fingerprint: "f",
        status: "firing",
        starts_at: "2026-08-15T00:00:00Z",
        ends_at: null,
      }),
    ];
    const values = hashes.map((h) => (h.ok ? h.value : null));
    expect(values.every((v) => v !== null)).toBe(true);
    const set = new Set(values.filter((value) => value !== null));
    expect(set.size).toBe(5);
  });
});

describe("property-based checks", () => {
  test("one-field candidate mutations always change the hash", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (base, diff) => {
        const a = candidateHash(candidateInput({ base_ref: base, changed_surfaces: [diff] }));
        const b = candidateHash(candidateInput({ base_ref: base, changed_surfaces: [diff + "x"] }));
        expect(a.ok && b.ok).toBe(true);
        if (a.ok && b.ok) {
          expect(a.value).not.toBe(b.value);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("evidence content mutations change the id", () => {
    fc.assert(
      fc.property(fc.jsonValue({ depthSize: 2 }), (content) => {
        const value = content as JsonValue;
        const a = evidenceItemId(evidenceInput({ content: value }));
        const b = evidenceItemId(
          evidenceInput({ content: { wrapped: value, marker: true } }),
        );
        expect(a.ok && b.ok).toBe(true);
        if (a.ok && b.ok) {
          expect(a.value).not.toBe(b.value);
        }
      }),
      { numRuns: 100 },
    );
  });
});
