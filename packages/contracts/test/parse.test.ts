import { describe, expect, test } from "bun:test";

import {
  parseArtifactEnvelope,
  parseJournalEvent,
  parseJournalLines,
  parseSavedBundleManifest,
  validate,
} from "../src/parse.js";
import { allSchemas, classifySchema, SCHEMA_REGISTRY } from "../src/schemas/registry.js";
import type { JsonValue } from "../src/result.js";

describe("schema registry", () => {
  test("every schema is a pure JSON document", () => {
    for (const schema of allSchemas()) {
      const roundTripped = JSON.parse(JSON.stringify(schema));
      expect(roundTripped).toEqual(schema);
    }
  });

  test("every registry entry compiles under Ajv 2020 strict mode", () => {
    // validate() builds the strict Ajv instance and registers every schema;
    // any strict-mode violation throws during construction. Then each entry
    // must classify ok and have a compiled validator (a malformed instance
    // returns MALFORMED_CONTRACT, never a throw).
    for (const name of Object.keys(SCHEMA_REGISTRY) as Array<keyof typeof SCHEMA_REGISTRY>) {
      expect(classifySchema(name, "1.0").kind).toBe("ok");
      const result = validate(name, "1.0", {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MALFORMED_CONTRACT");
      }
    }
  });

  test("classifies unknown and stale schemas", () => {
    expect(classifySchema("nope", "1.0").kind).toBe("unknown-schema");
    expect(classifySchema("incident-trigger", "0.9").kind).toBe("stale-schema");
    expect(classifySchema("incident-trigger", "1.0").kind).toBe("ok");
  });

  test("unknown schema name returns UNKNOWN_SCHEMA", () => {
    const result = validate("nope", "1.0", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_SCHEMA");
    }
  });

  test("known schema with unsupported version returns STALE_SCHEMA", () => {
    const result = validate("incident-trigger", "2.0", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_SCHEMA");
    }
  });

  test("malformed data returns MALFORMED_CONTRACT", () => {
    const result = validate("incident-trigger", "1.0", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_CONTRACT");
    }
  });
});

describe("parseJournalLines", () => {
  test("parses a valid journal body", () => {
    const line = {
      type: "trigger_received",
      sequence: 1,
      idempotency_key: "t1",
      recorded_at: "2026-08-15T15:00:00Z",
      actor: { id: "n", kind: "intake-normalizer" },
      policy_version: "p",
      incident_id: "i",
      trigger: {
        schema_version: "1.0",
        trigger_id: "t",
        delivery_key: "sha256:" + "a".repeat(64),
        incident_key: "sha256:" + "b".repeat(64),
        received_at: "2026-08-15T15:00:00Z",
        detector: { source: "s", connection_id: "c", rule_id: "r", rule_version: "v" },
        state: "firing",
        severity: "critical",
        scope: { tenant_id: "t", deployment_environment_name: "e", service_name: "s" },
        window: { starts_at: "2026-08-15T15:00:00Z", ends_at: null, lookback_seconds: 120 },
        signal_summary: { name: "n", value: 0.9, unit: "1", threshold: 0.2 },
        evidence_refs: [],
      },
      delivery_result: "incident-created",
    };
    const result = parseJournalLines(`${JSON.stringify(line)}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.type).toBe("trigger_received");
    }
  });

  test("rejects a duplicate-key line", () => {
    const result = parseJournalLines('{"type":"trigger_received","type":"trigger_received"}\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_CONTRACT");
    }
  });

  test("rejects an empty inner line", () => {
    const result = parseJournalLines("line1\n\nline2\n");
    expect(result.ok).toBe(false);
  });
});

describe("parseJournalEvent", () => {
  test("rejects an unknown event type", () => {
    const result = parseJournalEvent({
      type: "bogus",
      sequence: 1,
      idempotency_key: "k",
      recorded_at: "2026-08-15T15:00:00Z",
      actor: { id: "a", kind: "human" },
      policy_version: "p",
      incident_id: "i",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MALFORMED_CONTRACT");
    }
  });
});

describe("parseSavedBundleManifest / parseArtifactEnvelope", () => {
  test("accepts a minimal manifest", () => {
    const manifest = {
      format_version: "1.0",
      capture_time: "2026-08-16T12:00:00Z",
      incident_ids: [{ incident_id: "i", final_sequence: 1 }],
      files: { "incidents/i/journal.jsonl": { sha256: `sha256:${"a".repeat(64)}`, size: 1 } },
    };
    const result = parseSavedBundleManifest(manifest);
    expect(result.ok).toBe(true);
  });

  test("accepts a minimal envelope", () => {
    const envelope = {
      schema_version: "1.0",
      artifact_schema_id: "incident-brief",
      artifact_schema_version: "1.0",
      content_hash: `sha256:${"a".repeat(64)}`,
      sealed_at: "2026-08-16T12:00:00Z",
      incident_id: "i",
      producer: {},
      payload: { anything: true },
    };
    const result = parseArtifactEnvelope(envelope);
    expect(result.ok).toBe(true);
  });

  test("rejects an envelope with an unknown payload (no)", () => {
    const payload: JsonValue = { a: [1, 2, 3] };
    expect(validate("incident-brief", "1.0", payload).ok).toBe(false);
  });
});
