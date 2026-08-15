import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { sha256Hex } from "../src/hashes.js";
import {
  parseArtifactEnvelope,
  parseJournalLines,
  parseSavedBundleManifest,
} from "../src/parse.js";
import { loadBundle } from "./fixture-helper.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "demo", "fixtures", "contracts");

describe("fixture parity", () => {
  test("valid manifest file hashes match the actual files", () => {
    const files = loadBundle(join(ROOT, "valid"));
    const manifestText = files.get("manifest.json");
    expect(manifestText).toBeDefined();
    const manifest = parseSavedBundleManifest(JSON.parse(manifestText ?? "{}"));
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    for (const [path, entry] of Object.entries(manifest.value.files)) {
      const bytes = files.get(path);
      expect(bytes).toBeDefined();
      expect(sha256Hex(bytes ?? "")).toBe(entry.sha256.slice("sha256:".length));
      expect(new TextEncoder().encode(bytes ?? "").byteLength).toBe(entry.size);
    }
  });

  test("valid journal lines parse as journal events", () => {
    const files = loadBundle(join(ROOT, "valid"));
    for (const incidentId of ["inc-demo-payment-1", "inc-demo-payment-2"]) {
      const journal = files.get(`incidents/${incidentId}/journal.jsonl`);
      expect(journal).toBeDefined();
      const result = parseJournalLines(journal ?? "");
      expect(result.ok).toBe(true);
    }
  });

  test("every artifact filename is its payload content hash", () => {
    const files = loadBundle(join(ROOT, "valid"));
    for (const [path, bytes] of files) {
      const match = /^artifacts\/sha256\/([0-9a-f]{64})\.json$/.exec(path);
      if (match === null) continue;
      const envelope = parseArtifactEnvelope(JSON.parse(bytes));
      expect(envelope.ok).toBe(true);
      if (envelope.ok) {
        expect(envelope.value.content_hash).toBe(`sha256:${match[1] ?? ""}`);
      }
    }
  });

  test("valid Run 1 ends verified-remediation and closed; Run 2 fails verification", () => {
    const files = loadBundle(join(ROOT, "valid"));
    const run1 = parseJournalLines(files.get("incidents/inc-demo-payment-1/journal.jsonl") ?? "");
    const run2 = parseJournalLines(files.get("incidents/inc-demo-payment-2/journal.jsonl") ?? "");
    expect(run1.ok && run2.ok).toBe(true);
    if (!run1.ok || !run2.ok) return;

    const run1Outcome = run1.value.find((e) => e.type === "run_transition" && e.to === "completed");
    expect(run1Outcome?.type === "run_transition" ? run1Outcome.outcome : undefined).toBe("verified-remediation");

    const run2Fail = run2.value.find((e) => e.type === "run_transition" && e.to === "failed");
    expect(run2Fail?.type === "run_transition" ? run2Fail.failure_reason : undefined).toBe("verification-failed");

    const run2HasRelease = run2.value.some((e) => e.type === "stage_transition" && e.stage === "release");
    expect(run2HasRelease).toBe(false);
    const run2HasWatch = run2.value.some((e) => e.type === "stage_transition" && e.stage === "watch");
    expect(run2HasWatch).toBe(false);
    const run2HasReleaseGate = run2.value.some((e) => e.type === "gate_evaluated" && e.gate === "release");
    expect(run2HasReleaseGate).toBe(false);
  });

  test("Run 1 Release Gate cites only earlier journal evidence", () => {
    const files = loadBundle(join(ROOT, "valid"));
    const run = parseJournalLines(
      files.get("incidents/inc-demo-payment-1/journal.jsonl") ?? "",
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const artifacts = new Set<string>();
    const receipts = new Set<string>();
    const approvals = new Set<string>();
    let sawReleaseGate = false;
    for (const event of run.value) {
      if (
        event.type === "gate_evaluated" &&
        event.gate === "release" &&
        event.evaluation.gate === "release"
      ) {
        sawReleaseGate = true;
        for (const fact of event.evaluation.facts) {
          for (const reference of fact.evidence_refs) {
            const source =
              reference.kind === "artifact"
                ? artifacts
                : reference.kind === "receipt"
                  ? receipts
                  : approvals;
            expect(source.has(reference.ref)).toBe(true);
          }
          if (fact.fact === "5") {
            const planReference = fact.evidence_refs.find(
              (reference) => reference.kind === "artifact",
            );
            expect(planReference).toBeDefined();
            if (planReference !== undefined) {
              const digest = planReference.ref.slice("sha256:".length);
              const envelope = parseArtifactEnvelope(
                JSON.parse(files.get(`artifacts/sha256/${digest}.json`) ?? "null"),
              );
              expect(envelope.ok).toBe(true);
              if (envelope.ok) {
                expect(envelope.value.artifact_schema_id).toBe("rollout-watch-plan");
              }
            }
          }
        }
      }
      if (event.type === "artifact_sealed") {
        artifacts.add(event.artifact_ref.content_hash);
      }
      if (event.type === "broker_receipt_recorded") {
        receipts.add(event.receipt.receipt_id);
      }
      if (event.type === "approval_recorded" && event.approval.action === "granted") {
        approvals.add(event.approval.approval_id);
      }
    }
    expect(sawReleaseGate).toBe(true);
  });
});
