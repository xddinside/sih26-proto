/**
 * Agent-run-artifact verifier tests (issue #25). A minimal valid bundle is
 * built from scratch (one incident, one run, an agent-run-artifact for the
 * planner session, its remediation-draft terminal artifact, a capture
 * manifest, and the journal events that bind them), then mutated to exercise
 * every agent-run integrity check: call order, call identity, settled status,
 * terminal linkage, tool linkage, model-use linkage, metrics aggregation,
 * manifest binding, provider class, and canonical hashes.
 */
import { describe, expect, test } from "bun:test";

import { contentHash, sha256Hex } from "../src/hashes.js";
import { verifySavedBundle } from "../src/saved-bundle.js";
import type { IntegrityError } from "../src/errors.js";

const EVAL = "2026-08-21T00:00:00Z";
const INCIDENT = "inc-agent-run-1";
const RUN = "run-agent-run-1";

function contentHashOf(payload: unknown): string {
  const result = contentHash(payload as never);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function envelope(schemaId: string, payload: unknown): Record<string, unknown> {
  return {
    schema_version: "1.0",
    artifact_schema_id: schemaId,
    artifact_schema_version: "1.0",
    content_hash: contentHashOf(payload),
    sealed_at: "2026-08-18T00:00:00Z",
    incident_id: INCIDENT,
    run_id: RUN,
    producer: { skill: "sih-repair-planner", skill_version: "1.0", tool: "role-session", tool_version: "1.0" },
    payload,
  };
}

function putArtifact(files: Map<string, string>, schemaId: string, payload: unknown): string {
  const hash = contentHashOf(payload);
  files.set(`artifacts/sha256/${hash.slice("sha256:".length)}.json`, JSON.stringify(envelope(schemaId, payload)));
  return hash;
}

function trigger(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    trigger_id: "trig-agent-run-1",
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

function journal(options: { modelUse?: boolean; terminal?: boolean } = {}): Record<string, unknown>[] {
  const { modelUse = true, terminal = true } = options;
  const common = {
    actor: { id: "cp-1", kind: "control-plane" },
    policy_version: "policy-v1",
    recorded_at: "2026-08-18T00:00:00Z",
  };
  const events: Record<string, unknown>[] = [
    { type: "trigger_received", sequence: 1, idempotency_key: "trig-1", incident_id: INCIDENT, trigger: trigger(), delivery_result: "incident-created", ...common },
    { type: "incident_transition", sequence: 2, idempotency_key: "inc-t-1", incident_id: INCIDENT, from: null, to: "open", expected_version: 0, ...common },
    { type: "run_transition", sequence: 3, idempotency_key: "run-t-1", incident_id: INCIDENT, run_id: RUN, attempt: 1, from: null, to: "queued", expected_run_version: 0, ...common },
    { type: "run_transition", sequence: 4, idempotency_key: "run-t-2", incident_id: INCIDENT, run_id: RUN, attempt: 1, from: "queued", to: "running", expected_run_version: 1, ...common },
  ];
  if (modelUse) {
    events.push({ type: "model_use", sequence: events.length + 1, idempotency_key: "mu-1", incident_id: INCIDENT, run_id: RUN, parent_agent_id: "orchestrator-1", agent_id: "agent-planner", agent_role: "repair-agent", model: "opencode/deepseek-v4-flash", token_use: { prompt_tokens: 12, completion_tokens: 8 }, tool_calls: [{ tool: "read_broker_query", tool_call_id: "tc-1" }, { tool: "read_broker_query", tool_call_id: "tc-2" }], ...common });
  }
  events.push({ type: "artifact_sealed", sequence: events.length + 1, idempotency_key: "art-run", incident_id: INCIDENT, run_id: RUN, artifact_ref: { schema_id: "agent-run-artifact", schema_version: "1.0", content_hash: RUN_ARTIFACT_REF }, ...common });
  if (terminal) {
    events.push({ type: "artifact_sealed", sequence: events.length + 1, idempotency_key: "art-1", incident_id: INCIDENT, run_id: RUN, artifact_ref: { schema_id: "remediation-draft", schema_version: "1.0", content_hash: PLANNER_ARTIFACT_REF }, ...common });
  }
  return events;
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

/** One settled pipeline call record for the planner session. */
function plannerCall(): Record<string, unknown> {
  return {
    call_id: "call:agent-planner:0",
    phase: "planner",
    role: "repair-agent",
    order: 0,
    model: { provider: "opencode", id: "deepseek-v4-flash", reasoning: "medium" },
    status: "succeeded",
    started_at: "2026-08-18T00:00:00.000Z",
    completed_at: "2026-08-18T00:01:00.000Z",
    system_prompt: "You are the bounded repair planner.",
    input_prompt: "Plan the remediation for the payment charge failure.",
    output: "The card-type gate is inverted.",
    submission_ref: PLANNER_ARTIFACT_REF,
    token_use: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    retry_delay_ms: null,
    rate_limit_delay_ms: null,
    turns: 2,
    tool_activity: [
      { tool_call_id: "tc-1", tool: "read_broker_query", args: "{\"backend\":\"prometheus\"}", result: "value 0.92", is_error: false },
      { tool_call_id: "tc-2", tool: "read_broker_query", args: "{\"backend\":\"flagd\"}", result: "inverted", is_error: false },
    ],
    failure_reason: null,
  };
}

function agentRunPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema_version: "1.0",
    run_artifact_id: "agent-run:agent-planner",
    agent_id: "agent-planner",
    parent_agent_id: "orchestrator-1",
    role: "repair-agent",
    phase: "planner",
    provider_class: "real",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "medium",
    status: "succeeded",
    failure_reason: null,
    calls: [plannerCall()],
    metrics: {
      duration_ms: 60_000,
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      tool_call_count: 2,
      retry_delay_ms: 0,
      rate_limit_delay_ms: 0,
    },
    exclude_from_context: true,
    sealed_at: "2026-08-18T00:01:00.000Z",
    ...overrides,
  };
  return payload;
}

function manifestPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema_version: "1.0",
    manifest_id: "manifest-agent-run-1",
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
    schema_versions: { "remediation-draft": "1.0", "agent-run-artifact": "1.0" },
    role_records: [
      {
        role: "planner",
        agent_id: "agent-planner",
        status: "succeeded",
        submission_id: "sub-1",
        artifact_ref: PLANNER_ARTIFACT_REF,
        run_artifact_ref: RUN_ARTIFACT_REF,
        model_use_agent_ids: ["agent-planner"],
      },
    ],
    sealed_at: "2026-08-18T00:02:00Z",
    ...overrides,
  };
  return { ...payload, manifest_digest: contentHashOf(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "manifest_digest"))) };
}

/** A minimal valid bundle: one incident, one run, one session artifact, one
 * terminal artifact, one manifest, and the journal events binding them. */
function validBundle(): Map<string, string> {
  const files = new Map<string, string>();
  PLANNER_ARTIFACT_REF = putArtifact(files, "remediation-draft", plannerDraft());
  RUN_ARTIFACT_REF = putArtifact(files, "agent-run-artifact", agentRunPayload());
  const events = journal();
  const journalText = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  files.set(`incidents/${INCIDENT}/journal.jsonl`, journalText);
  putArtifact(files, "capture-manifest", manifestPayload());
  return reManifest(files, events.length);
}

/** Rewrite manifest.json to list the current file contents with hashes. */
function reManifest(files: Map<string, string>, finalSequence = 7): Map<string, string> {
  const next = new Map(files);
  next.delete("manifest.json");
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const path of [...next.keys()].sort()) {
    const bytes = next.get(path) ?? "";
    fileEntries[path] = { sha256: `sha256:${sha256Hex(bytes)}`, size: new TextEncoder().encode(bytes).byteLength };
  }
  next.set(
    "manifest.json",
    JSON.stringify({ format_version: "1.0", capture_time: EVAL, incident_ids: [{ incident_id: INCIDENT, final_sequence: finalSequence }], files: fileEntries }, null, 2),
  );
  return next;
}

let PLANNER_ARTIFACT_REF = `sha256:${"4".repeat(64)}`;
let RUN_ARTIFACT_REF = `sha256:${"5".repeat(64)}`;

function artifactPath(hash: string): string {
  return `artifacts/sha256/${hash.slice("sha256:".length)}.json`;
}

/** Read and replace one artifact envelope's payload. */
function mutatePayload(
  files: Map<string, string>,
  hash: string,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  const path = artifactPath(hash);
  const envelopeJson = JSON.parse(files.get(path) ?? "") as { payload: Record<string, unknown> };
  mutate(envelopeJson.payload);
  files.set(path, JSON.stringify(envelopeJson));
}

function codes(result: { ok: true } | { ok: false; error: IntegrityError[] }): string[] {
  if (result.ok) {
    return [];
  }
  return result.error.map((error) => error.code);
}

function messages(result: { ok: false; error: IntegrityError[] }): string[] {
  return result.error.map((error) => error.message);
}

describe("agent-run-artifact verification", () => {
  test("accepts a valid bundle with a session artifact bound to the manifest", () => {
    const result = verifySavedBundle({ files: validBundle() }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifacts.get(RUN_ARTIFACT_REF)?.artifact_schema_id).toBe("agent-run-artifact");
    }
  });

  test("accepts a failed session artifact that never reached the provider", () => {
    const files = new Map<string, string>();
    RUN_ARTIFACT_REF = putArtifact(files, "agent-run-artifact", agentRunPayload({
      status: "failed",
      failure_reason: "unknown model opencode/ghost",
      calls: [{
        ...plannerCall(),
        status: "failed",
        failure_reason: "unknown model opencode/ghost",
        submission_ref: null,
        turns: 0,
        tool_activity: [],
        token_use: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }],
      metrics: {
        duration_ms: 60_000,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        tool_call_count: 0,
        retry_delay_ms: 0,
        rate_limit_delay_ms: 0,
      },
    }));
    const events = journal({ modelUse: false, terminal: false });
    files.set(`incidents/${INCIDENT}/journal.jsonl`, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    putArtifact(files, "capture-manifest", manifestPayload({
      role_records: [
        {
          role: "planner",
          agent_id: "agent-planner",
          status: "failed",
          run_artifact_ref: RUN_ARTIFACT_REF,
          model_use_agent_ids: [],
        },
      ],
    }));
    const result = verifySavedBundle({ files: reManifest(files, events.length) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(true);
  });

  test("rejects a call whose order is not contiguous from zero", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.order = 1;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("call order is not contiguous"))).toBe(true);
    }
  });

  test("rejects duplicate call identities", () => {
    const files = validBundle();
    const second = {
      ...plannerCall(),
      call_id: "call:agent-planner:0",
      order: 1,
      started_at: "2026-08-18T00:01:00.000Z",
      completed_at: "2026-08-18T00:01:10.000Z",
      status: "failed",
      failure_reason: "judged unneeded",
      submission_ref: null,
      tool_activity: [],
      token_use: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[]).push(second);
      (payload.metrics as Record<string, unknown>).duration_ms = 70_000;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("identities are not unique"))).toBe(true);
    }
  });

  test("rejects an unsettled call status", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.status = "pending";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("is not settled"))).toBe(true);
    }
  });

  test("rejects a call status that disagrees with the artifact status", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.status = "failed";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("status does not match its final call"))).toBe(true);
    }
  });

  test("rejects a succeeded artifact whose submission was dropped", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.submission_ref = null;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("exactly one succeeded call with a submission"))).toBe(true);
    }
  });

  test("rejects a submission that references an absent terminal artifact", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.submission_ref = `sha256:${"a".repeat(64)}`;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("references an absent terminal artifact"))).toBe(true);
    }
  });

  test("rejects a submission whose schema does not match the role phase", () => {
    const files = validBundle();
    const reportHash = putArtifact(files, "orchestrator-report", {
      schema_version: "1.0",
      incident_id: INCIDENT,
      run_id: RUN,
      attempt: 1,
      stage_outcomes: { detect: "completed", diagnose: "completed", repair: "completed", verify: "completed" },
      assessments: [],
      reflections: [],
      completed_at: "2026-08-18T00:03:00Z",
    });
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.submission_ref = reportHash;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("submission schema does not match the role phase"))).toBe(true);
    }
  });

  test("rejects a submission that was never sealed in the run journal", () => {
    const files = validBundle();
    const unsealed = putArtifact(files, "remediation-draft", {
      ...plannerDraft(),
      change_description: "a second draft that was never sealed",
    });
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.submission_ref = unsealed;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("was not sealed in the same Incident Run"))).toBe(true);
    }
  });

  test("rejects tool activity that has no model_use journal record", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      ((payload.calls as Record<string, unknown>[])[0]!.tool_activity as Record<string, unknown>[])[0]!.tool_call_id = "tc-ghost";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("tc-ghost has no model_use journal record"))).toBe(true);
    }
  });

  test("rejects an artifact whose agent has no model_use journal record", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      payload.agent_id = "agent-ghost";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("agent-ghost has no model_use journal record"))).toBe(true);
    }
  });

  test("rejects run-level metrics that do not aggregate the calls", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.metrics as Record<string, unknown>).tool_call_count = 7;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("CHANGED_CONTENT");
      expect(messages(result).some((message) => message.includes("tool_call_count does not match its calls"))).toBe(true);
    }
  });

  test("rejects run-level retry delay that does not aggregate the calls", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.metrics as Record<string, unknown>).retry_delay_ms = 500;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("CHANGED_CONTENT");
      expect(messages(result).some((message) => message.includes("retry_delay_ms does not match its calls"))).toBe(true);
    }
  });

  test("rejects a failed artifact that still carries a submission", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      payload.status = "failed";
      payload.failure_reason = "provider exploded";
      const call = (payload.calls as Record<string, unknown>[])[0]!;
      call.status = "failed";
      call.failure_reason = "provider exploded";
      call.submission_ref = PLANNER_ARTIFACT_REF;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("cannot carry a submission"))).toBe(true);
    }
  });

  test("rejects a provider_class that disagrees with the capture manifest", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      payload.provider_class = "fixture";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("provider_class does not match the capture manifest"))).toBe(true);
    }
  });

  test("rejects a run artifact that no manifest role record references", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    mutatePayload(files, manifestHash, (payload) => {
      delete (payload.role_records as Record<string, unknown>[])[0]!.run_artifact_ref;
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MISSING_ARTIFACT");
      expect(messages(result).some((message) => message.includes("not referenced by any capture manifest role record"))).toBe(true);
    }
  });

  test("rejects a manifest role record whose run artifact agent does not match", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    mutatePayload(files, manifestHash, (payload) => {
      (payload.role_records as Record<string, unknown>[])[0]!.agent_id = "agent-other";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("run artifact agent does not match the record"))).toBe(true);
    }
  });

  test("rejects a manifest role record whose run artifact status does not match", () => {
    const files = validBundle();
    const manifestHash = contentHashOf(manifestPayload());
    mutatePayload(files, manifestHash, (payload) => {
      (payload.role_records as Record<string, unknown>[])[0]!.status = "aborted";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("MALFORMED_CONTRACT");
      expect(messages(result).some((message) => message.includes("run artifact status does not match the record"))).toBe(true);
    }
  });

  test("rejects tampered artifact bytes against the canonical payload hash", () => {
    const files = validBundle();
    mutatePayload(files, RUN_ARTIFACT_REF, (payload) => {
      (payload.calls as Record<string, unknown>[])[0]!.input_prompt = "a rewritten prompt";
    });
    const result = verifySavedBundle({ files: reManifest(files) }, { evaluationTime: EVAL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("CHANGED_CONTENT");
      expect(messages(result).some((message) => message.includes("content_hash does not match its payload"))).toBe(true);
    }
  });
});
