/**
 * Capture-manifest verifier tests (issue #23). A minimal valid bundle is
 * built from scratch (one incident, one run, a planner remediation-draft
 * artifact, a capture manifest, and the journal events that bind them), then
 * mutated to exercise every capture-manifest integrity check: digest
 * self-check, provider class, role artifact linkage, role schema match,
 * succeeded-without-artifact, and model-use journal linkage.
 */
import { describe, expect, test } from "bun:test";

import { contentHash, sha256Hex } from "../src/hashes.js";
import { verifySavedBundle } from "../src/saved-bundle.js";
import type { IntegrityError } from "../src/errors.js";

const EVAL = "2026-08-21T00:00:00Z";
const INCIDENT = "inc-capture-1";
const RUN = "run-capture-1";

function contentHashOf(payload: unknown): string {
  const result = contentHash(payload as never);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function envelope(schemaId: string, payload: unknown, artifactSchemaVersion = "1.0"): Record<string, unknown> {
  return {
    schema_version: "1.0",
    artifact_schema_id: schemaId,
    artifact_schema_version: artifactSchemaVersion,
    content_hash: contentHashOf(payload),
    sealed_at: "2026-08-18T00:00:00Z",
    incident_id: INCIDENT,
    run_id: RUN,
    producer: { skill: "pi-agent-core", skill_version: "0.79.4", tool: "capture-terminal", tool_version: "1.0" },
    payload,
  };
}

function putArtifact(files: Map<string, string>, schemaId: string, payload: unknown, artifactSchemaVersion?: string): string {
  const hash = contentHashOf(payload);
  files.set(`artifacts/sha256/${hash.slice("sha256:".length)}.json`, JSON.stringify(envelope(schemaId, payload, artifactSchemaVersion)));
  return hash;
}

function trigger(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    trigger_id: "trig-capture-1",
    delivery_key: `sha256:${"0".repeat(64)}`,
    incident_key: `sha256:${"1".repeat(64)}`,
    received_at: "2026-08-18T00:00:00Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "1",
    },
    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-18T00:00:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [],
  };
}

function journal(): Record<string, unknown>[] {
  const common = {
    actor: { id: "cp-1", kind: "control-plane" },
    policy_version: "policy-v1",
    recorded_at: "2026-08-18T00:00:00Z",
  };
  return [
    { type: "trigger_received", sequence: 1, idempotency_key: "trig-1", incident_id: INCIDENT, trigger: trigger(), delivery_result: "incident-created", ...common },
    { type: "incident_transition", sequence: 2, idempotency_key: "inc-t-1", incident_id: INCIDENT, from: null, to: "open", expected_version: 0, ...common },
    { type: "run_transition", sequence: 3, idempotency_key: "run-t-1", incident_id: INCIDENT, run_id: RUN, attempt: 1, from: null, to: "queued", expected_run_version: 0, ...common },
    { type: "run_transition", sequence: 4, idempotency_key: "run-t-2", incident_id: INCIDENT, run_id: RUN, attempt: 1, from: "queued", to: "running", expected_run_version: 1, ...common },
    { type: "artifact_sealed", sequence: 5, idempotency_key: "art-1", incident_id: INCIDENT, run_id: RUN, artifact_ref: { schema_id: "remediation-draft", schema_version: "1.0", content_hash: PLANNER_ARTIFACT_REF }, ...common },
    { type: "model_use", sequence: 6, idempotency_key: "mu-1", incident_id: INCIDENT, parent_agent_id: "orchestrator-1", agent_id: "agent-planner", model: "opencode/deepseek-v4-flash", token_use: { prompt_tokens: 10, completion_tokens: 10 }, tool_calls: [], ...common },
  ];
}

function plannerDraft(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    incident_id: INCIDENT,
    run_id: RUN,
    attempt: 1,
    remediation_class: "code",
    action_risk_class: "safe",
    gate_path: "release",
    disposition: "allowed",
    change_description: "restore the card-type gate",
    citations: [],
    test_plan: ["node --test card.unit.test.js"],
    changed_surfaces: ["src/payment/card.js"],
    typed_action_plan: { adapter: "git", action_class: "commit", command: "apply diff" },
    completed_at: "2026-08-18T00:01:00Z",
  };
}

function manifestPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema_version: "1.0",
    manifest_id: "manifest-capture-1",
    incident_id: INCIDENT,
    run_id: RUN,
    attempt: 1,
    mode: "full-capture",
    scenario: "S1",
    provider_class: "real",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "medium",
    pi_agent_core_version: "0.79.4",
    pi_ai_version: "0.79.4",
    skill_tree_digest: `sha256:${"2".repeat(64)}`,
    tool_catalog_revision: "tool-catalog-1",
    prompt_revision: "prompts@1.0",
    policy_revision: "policy-v1",
    perspectives: [
      { participant_id: "p-1", perspective: "code-level", order: 1 },
      { participant_id: "p-2", perspective: "system-level", order: 2 },
    ],
    seeds: [{ id: "S1", digest: `sha256:${"3".repeat(64)}` }],
    budgets: { model_turns: 20, non_terminal_tool_calls: 32, session_wall_clock_ms: 720_000, run_wall_clock_ms: 7_200_000 },
    schema_versions: { "remediation-draft": "1.0" },
    role_records: [
      { role: "planner", agent_id: "agent-planner", status: "succeeded", submission_id: "sub-1", artifact_ref: PLANNER_ARTIFACT_REF, model_use_agent_ids: ["agent-planner"] },
    ],
    sealed_at: "2026-08-18T00:02:00Z",
    ...overrides,
  };
  return { ...payload, manifest_digest: contentHashOf(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "manifest_digest"))) };
}

/** A minimal valid bundle: one incident, one run, one artifact, one manifest. */
function validBundle(manifestOverrides: Partial<Record<string, unknown>> = {}): Map<string, string> {
  const files = new Map<string, string>();
  PLANNER_ARTIFACT_REF = putArtifact(files, "remediation-draft", plannerDraft());
  const events = journal();
  const journalText = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  files.set(`incidents/${INCIDENT}/journal.jsonl`, journalText);
  putArtifact(files, "capture-manifest", manifestPayload(manifestOverrides));
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path) ?? "";
    fileEntries[path] = { sha256: `sha256:${sha256Hex(bytes)}`, size: new TextEncoder().encode(bytes).byteLength };
  }
  files.set(
    "manifest.json",
    JSON.stringify({
      format_version: "1.0",
      capture_time: EVAL,
      incident_ids: [{ incident_id: INCIDENT, final_sequence: events.length }],
      files: fileEntries,
    }, null, 2),
  );
  return files;
}

/** Rewrite manifest.json to list the current file contents with hashes. */
function reManifest(files: Map<string, string>): Map<string, string> {
  const next = new Map(files);
  next.delete("manifest.json");
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const path of [...next.keys()].sort()) {
    const bytes = next.get(path) ?? "";
    fileEntries[path] = { sha256: `sha256:${sha256Hex(bytes)}`, size: new TextEncoder().encode(bytes).byteLength };
  }
  next.set(
    "manifest.json",
    JSON.stringify({ format_version: "1.0", capture_time: EVAL, incident_ids: [{ incident_id: INCIDENT, final_sequence: 6 }], files: fileEntries }, null, 2),
  );
  return next;
}

let PLANNER_ARTIFACT_REF = `sha256:${"4".repeat(64)}`;

function codes(result: { ok: true } | { ok: false; error: IntegrityError[] }): string[] {
  if (result.ok) {
    return [];
  }
  return result.error.map((error) => error.code);
}

function messages(result: { ok: false; error: IntegrityError[] }): string[] {
  return result.error.map((error) => error.message);
}

describe("capture-manifest verification", () => {
  test("accepts a valid bundle with a real-provider manifest", () => {
    const result = verifySavedBundle({ files: validBundle() }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const manifest = result.value.artifacts.get(contentHashOf(manifestPayload()));
      expect(manifest?.artifact_schema_id).toBe("capture-manifest");
    }
  });

  test("rejects a tampered manifest_digest", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    const path = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`;
    const mutated = JSON.parse(files.get(path) ?? "") as { payload: Record<string, unknown> };
    mutated.payload.manifest_digest = `sha256:${"f".repeat(64)}`;
    files.set(path, JSON.stringify(mutated));
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("CHANGED_CONTENT");
      expect(messages(result).some((message) => message.includes("manifest_digest does not match"))).toBe(true);
    }
  });

  test("accepts a deterministic fixture full-capture bundle", () => {
    // A fixture (deterministic provider double) full capture is a valid
    // development fixture: it verifies and replays like any other bundle.
    // Presentation eligibility is the selection layer's decision, not an
    // integrity property.
    const files = validBundle({
      provider_class: "fixture",
      provider: "deterministic",
      mode: "full-capture",
    });
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
  });

  test("accepts a fixture provider_class for a rehearsal bundle", () => {
    const files = validBundle({ mode: "rehearsal", provider_class: "fixture" });
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
  });

  test("rejects a role record referencing an absent artifact", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    const path = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`;
    const mutated = JSON.parse(files.get(path) ?? "") as { payload: { role_records: Array<{ artifact_ref: string }> } };
    mutated.payload.role_records[0]!.artifact_ref = `sha256:${"a".repeat(64)}`;
    files.set(path, JSON.stringify(mutated));
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("role planner references an absent artifact"))).toBe(true);
    }
  });

  test("rejects a role record whose artifact schema does not match the role", () => {
    const files = validBundle();
    const orchestratorPayload = {
      schema_version: "1.0",
      incident_id: INCIDENT,
      run_id: RUN,
      attempt: 1,
      stage_outcomes: { detect: "completed", diagnose: "completed", repair: "completed", verify: "completed" },
      assessments: [],
      reflections: [],
      completed_at: "2026-08-18T00:03:00Z",
    };
    const orchestratorHash = putArtifact(files, "orchestrator-report", orchestratorPayload);
    const manifestHash = contentHashOf(manifestPayload());
    const path = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`;
    const mutated = JSON.parse(files.get(path) ?? "") as { payload: { role_records: Array<{ artifact_ref: string }> } };
    mutated.payload.role_records[0]!.artifact_ref = orchestratorHash;
    files.set(path, JSON.stringify(mutated));
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("artifact schema does not match the role"))).toBe(true);
    }
  });

  test("rejects a succeeded role record without a sealed artifact", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    const path = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`;
    const mutated = JSON.parse(files.get(path) ?? "") as { payload: { role_records: Array<Record<string, unknown>> } };
    delete mutated.payload.role_records[0]?.artifact_ref;
    files.set(path, JSON.stringify(mutated));
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("succeeded without a sealed artifact"))).toBe(true);
    }
  });

  test("rejects a role record whose model-use agent has no journal record", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    const path = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`;
    const mutated = JSON.parse(files.get(path) ?? "") as { payload: { role_records: Array<{ model_use_agent_ids: string[] }> } };
    mutated.payload.role_records[0]!.model_use_agent_ids = ["agent-ghost"];
    files.set(path, JSON.stringify(mutated));
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("no model_use journal record"))).toBe(true);
    }
  });

  test("rejects a manifest whose run does not match its envelope", () => {
    const files = validBundle({ run_id: "run-other" });
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("does not match its envelope"))).toBe(true);
    }
  });
});

/** Capture-manifest v1.2 (issue #31) freezes the resolved provider metadata
 * and the lifecycle attempt budget alongside the v1.1 identity fields. */
describe("capture-manifest v1.2", () => {
  const budgetsV12 = {
    model_turns: 20,
    non_terminal_tool_calls: 32,
    session_wall_clock_ms: 720_000,
    run_wall_clock_ms: 7_200_000,
    attempt_limit: 3,
  };

  function manifestV12(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    const v10 = manifestPayload({ schema_version: "1.2", budgets: budgetsV12 });
    const payload = {
      ...v10,
      provider_metadata: {
        provider: "opencode-go",
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        base_url: "https://opencode-go.example",
        reasoning: true,
        input: ["text"],
      },
      ...overrides,
    };
    return { ...payload, manifest_digest: contentHashOf(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "manifest_digest"))) };
  }

  /** A valid v1.2 bundle: the capture manifest is sealed at version 1.2. */
  function validBundleV12(manifestOverrides: Partial<Record<string, unknown>> = {}): Map<string, string> {
    const files = new Map<string, string>();
    putArtifact(files, "remediation-draft", plannerDraft());
    const events = journal();
    files.set(`incidents/${INCIDENT}/journal.jsonl`, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    putArtifact(files, "capture-manifest", manifestV12(manifestOverrides), "1.2");
    const fileEntries: Record<string, { sha256: string; size: number }> = {};
    for (const path of [...files.keys()].sort()) {
      const bytes = files.get(path) ?? "";
      fileEntries[path] = { sha256: `sha256:${sha256Hex(bytes)}`, size: new TextEncoder().encode(bytes).byteLength };
    }
    files.set(
      "manifest.json",
      JSON.stringify({
        format_version: "1.0",
        capture_time: EVAL,
        incident_ids: [{ incident_id: INCIDENT, final_sequence: events.length }],
        files: fileEntries,
      }, null, 2),
    );
    return files;
  }

  test("accepts a v1.2 manifest with resolved provider metadata and attempt budget", () => {
    const files = validBundleV12();
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
  });

  test("accepts a v1.2 manifest without provider metadata (not resolved)", () => {
    const { provider_metadata: _omitted, ...withoutMetadata } = manifestV12();
    const files = validBundleV12(withoutMetadata);
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
  });

  test("rejects a v1.2 manifest whose budgets omit the lifecycle attempt budget", () => {
    const files = validBundleV12({ budgets: { model_turns: 20, non_terminal_tool_calls: 32, session_wall_clock_ms: 720_000, run_wall_clock_ms: 7_200_000 } });
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(messages(result).some((message) => message.includes("budgets"))).toBe(true);
    }
  });

  test("a v1.1 budget shape is rejected by the v1.2 reader", () => {
    const files = validBundleV12({ schema_version: "1.1" });
    const result = verifySavedBundle({ files }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(messages(result).some((message) => message.includes("capture-manifest"))).toBe(true);
    }
  });
});
