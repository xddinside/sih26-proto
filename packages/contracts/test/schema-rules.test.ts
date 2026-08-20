import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseArtifactEnvelope, parseJournalLines, validate } from "../src/parse.js";
import type { ArtifactEnvelope } from "../src/schemas/artifact-envelope.js";
import type { GateEvaluation } from "../src/schemas/gate-evaluation.js";
import { loadBundle } from "./fixture-helper.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "demo", "fixtures", "contracts", "valid");

function artifacts(): ArtifactEnvelope[] {
  const files = loadBundle(ROOT);
  const values: ArtifactEnvelope[] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith("artifacts/sha256/")) continue;
    const result = parseArtifactEnvelope(JSON.parse(bytes));
    if (result.ok) values.push(result.value);
  }
  return values;
}

function gates(): GateEvaluation[] {
  const files = loadBundle(ROOT);
  const journal = parseJournalLines(
    files.get("incidents/inc-demo-payment-1/journal.jsonl") ?? "",
  );
  if (!journal.ok) return [];
  return journal.value.flatMap((event) =>
    event.type === "gate_evaluated" ? [event.evaluation] : [],
  );
}

describe("fixed schema rules", () => {
  test("Hypothesis and Release gates require each fixed check exactly once", () => {
    for (const evaluation of gates()) {
      expect(validate("gate-evaluation", "1.0", evaluation).ok).toBe(true);
      const rows = evaluation.gate === "hypothesis" ? evaluation.checks : evaluation.facts;
      const duplicate = {
        ...evaluation,
        [evaluation.gate === "hypothesis" ? "checks" : "facts"]: [
          rows[0],
          rows[0],
          ...rows.slice(2),
        ],
      };
      expect(validate("gate-evaluation", "1.0", duplicate).ok).toBe(false);
    }
  });

  test("an action broker receipt may carry an optional url (issue #32 real PR)", () => {
    const base = {
      kind: "action",
      receipt_id: "receipt-pr",
      idempotency_key: "action:inc-1:run-1:repair:receipt-pr",
      lease_id: "lease-1",
      stage: "repair",
      candidate_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      action: { adapter: "source-host-adapter", action_class: "submit_remediation_pr", command: "open pull request remediate/inc-1 against main" },
      target: { tenant_id: "t", deployment_environment_name: "d", service_name: "s", expected_version: "v" },
      outcome: "ok",
      executed_at: "2026-08-19T00:00:00.000Z",
    };
    expect(validate("broker-receipt", "1.0", base).ok).toBe(true);
    expect(
      validate("broker-receipt", "1.0", {
        ...base,
        url: "https://github.com/xddinside/sih26-payment-demo/pull/1",
      }).ok,
    ).toBe(true);
  });

  test("Remediation Proposal requires a Recovery Point and exactly one change form", () => {
    const proposal = artifacts().find(
      (artifact) => artifact.artifact_schema_id === "remediation-proposal",
    );
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;
    expect(validate("remediation-proposal", "1.0", proposal.payload).ok).toBe(true);
    const payload = proposal.payload as Record<string, unknown>;
    const { recovery_point: _recoveryPoint, ...withoutRecovery } = payload;
    expect(validate("remediation-proposal", "1.0", withoutRecovery).ok).toBe(false);
    expect(
      validate("remediation-proposal", "1.0", {
        ...payload,
        typed_action_plan: {
          adapter: "demo",
          action_class: "restart",
          command: "restart payment",
        },
      }).ok,
    ).toBe(false);
  });

  test("Evidence kind controls its required identity fields", () => {
    const evidence = artifacts().find(
      (artifact) => artifact.artifact_schema_id === "evidence-set",
    );
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    const payload = evidence.payload as {
      items: Array<{ kind: string; identity: Record<string, unknown> }>;
    };
    const metric = payload.items.find((item) => item.kind === "metric");
    expect(metric).toBeDefined();
    if (metric === undefined) return;
    const { window: _window, ...identity } = metric.identity;
    expect(
      validate("evidence-item", "1.0", { ...metric, identity }).ok,
    ).toBe(false);
  });

  test("Fusion Judge output has a registered machine-checked shape", () => {
    const result = validate("fusion-judge-output", "1.0", {
      schema_version: "1.0",
      judge_id: "judge-1",
      revision_id: `sha256:${"a".repeat(64)}`,
      agreements: [],
      contradictions: [],
      blind_spots: [],
      unique_findings: [],
      citation_audit: [],
      completed_at: "2026-08-16T00:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  test("Fusion Run Artifact is registered and excludes itself from context", () => {
    const base = {
      schema_version: "1.0",
      round: 1,
      revision_id: `sha256:${"a".repeat(64)}`,
      task: "Diagnose the payment charge failure",
      calls: [
        {
          kind: "participant",
          role: "fusion-participant",
          model: "stub-participant-1",
          status: "succeeded",
          system_prompt: "You are a participant.",
          input_prompt: "Analyze from your perspective.",
          output: "participant hypotheses",
          attempts: 1,
          retry_delays_ms: [0],
          prompt_tokens: 10,
          completion_tokens: 5,
          started_at: "2026-08-16T00:00:00Z",
          duration_ms: 100,
          turns: 1,
          tool_calls: 0,
        },
        {
          kind: "judge",
          role: "fusion-judge",
          model: "stub-judge",
          status: "succeeded",
          system_prompt: "You are the Judge.",
          input_prompt: "Assess the hypotheses.",
          output: null,
          attempts: 1,
          retry_delays_ms: [0],
          prompt_tokens: 8,
          completion_tokens: 4,
          started_at: "2026-08-16T00:00:01Z",
          duration_ms: 90,
          turns: 1,
          tool_calls: 0,
        },
      ],
      status: "succeeded",
      exclude_from_context: true,
      sealed_at: "2026-08-16T00:00:02Z",
    };
    const result = validate("fusion-run-artifact", "1.0", base);
    expect(result.ok).toBe(true);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...base,
        exclude_from_context: false,
      }).ok,
    ).toBe(false);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...base,
        round: 0,
      }).ok,
    ).toBe(false);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...base,
        revision_id: "not-a-hash",
      }).ok,
    ).toBe(false);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...base,
        metrics: {
          participants: [
            {
              participant_id: "p-1",
              status: "succeeded",
              turns: 1,
              tool_calls: 0,
              duration_ms: 100,
            },
            {
              participant_id: "p-2",
              status: "succeeded",
              turns: 1,
              tool_calls: 0,
              duration_ms: 110,
            },
          ],
          judge: { status: "succeeded", turns: 1, tool_calls: 0, duration_ms: 90 },
          synthesizer: { status: "succeeded", turns: 1, tool_calls: 0, duration_ms: 80 },
          total_wall_clock_ms: 300,
        },
      }).ok,
    ).toBe(true);
  });

  test("Fusion Run Artifact rejects unknown calls, non-literal exclusion, and bad revisions", () => {
    const payload = {
      schema_version: "1.0",
      round: 1,
      revision_id: `sha256:${"a".repeat(64)}`,
      task: "Diagnose the payment charge failure",
      calls: [
        {
          kind: "brief",
          role: "fusion-briefer",
          model: "deepseek-v4-flash",
          status: "succeeded",
          system_prompt: "",
          input_prompt: "Diagnose the incident.",
          output: null,
          attempts: 1,
          retry_delays_ms: [],
          prompt_tokens: 100,
          completion_tokens: 40,
          started_at: "2026-08-16T00:00:00Z",
          duration_ms: 1200,
        },
      ],
      status: "succeeded",
      exclude_from_context: true,
      sealed_at: "2026-08-16T00:00:00Z",
    };
    expect(validate("fusion-run-artifact", "1.0", payload).ok).toBe(true);
    expect(
      validate("fusion-run-artifact", "1.0", { ...payload, calls: [] }).ok,
    ).toBe(true);
    expect(
      validate("fusion-run-artifact", "1.0", { ...payload, status: "invalid" }).ok,
    ).toBe(true);
    expect(
      validate("fusion-run-artifact", "1.0", { ...payload, round: 0 }).ok,
    ).toBe(false);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...payload,
        revision_id: "not-a-hash",
      }).ok,
    ).toBe(false);
    expect(
      validate("fusion-run-artifact", "1.0", {
        ...payload,
        calls: [{ ...payload.calls[0], kind: "observatory" }],
      }).ok,
    ).toBe(false);
  });

  test("Fusion Run Artifact accepts per-participant metrics and perspectives", () => {
    const result = validate("fusion-run-artifact", "1.0", {
      schema_version: "1.0",
      round: 1,
      revision_id: `sha256:${"a".repeat(64)}`,
      task: "Diagnose the payment charge failure",
      calls: [],
      status: "succeeded",
      exclude_from_context: true,
      sealed_at: "2026-08-16T00:00:00Z",
      perspectives: [
        { participant_id: "p-1", perspective: "card-reader specialist", order: 1 },
        { participant_id: "p-2", perspective: "merchant accountant", order: 2 },
      ],
      metrics: {
        participants: [
          { participant_id: "p-1", status: "succeeded", turns: 4, tool_calls: 2, duration_ms: 1200 },
          { participant_id: "p-2", status: "succeeded", turns: 4, tool_calls: 2, duration_ms: 1100 },
        ],
        judge: { status: "succeeded", turns: 2, tool_calls: 0, duration_ms: 800 },
        synthesizer: { status: "succeeded", turns: 2, tool_calls: 0, duration_ms: 900 },
        total_wall_clock_ms: 3000,
      },
    });
    expect(result.ok).toBe(true);
  });
});
