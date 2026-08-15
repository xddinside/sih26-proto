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
});
