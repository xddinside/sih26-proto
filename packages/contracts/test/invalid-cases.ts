/**
 * Deterministic in-memory mutations for the saved-bundle verifier tests.
 *
 * Each case corrupts the committed valid bundle (`demo/fixtures/contracts/valid`)
 * in memory, without ever writing a second copy to disk. The case list lives in
 * `demo/fixtures/contracts/invalid-cases.json`; each name maps to a mutator
 * here that produces exactly the named integrity failure.
 */
import { contentHash, sha256Hex } from "../src/hashes.js";
import type { ArtifactEnvelope } from "../src/schemas/artifact-envelope.js";
import type { EvidenceSet } from "../src/schemas/evidence.js";
import type { JournalEvent } from "../src/schemas/journal-event.js";
import type { SavedBundleManifest } from "../src/schemas/saved-bundle-manifest.js";

export interface InvalidCase {
  name: string;
  expected_code: string;
}

const MANIFEST_PATH = "manifest.json";

function hex(s: string): string {
  return sha256Hex(s);
}

function contentHashOf(payload: unknown): string {
  const result = contentHash(payload as never);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function manifestOf(files: Map<string, string>): SavedBundleManifest {
  const text = files.get(MANIFEST_PATH);
  if (text === undefined) {
    throw new Error("missing manifest.json");
  }
  return JSON.parse(text) as SavedBundleManifest;
}

/** Rewrite manifest.json to match the current file contents. */
function reManifest(files: Map<string, string>): Map<string, string> {
  const manifest = manifestOf(files);
  const next = new Map(files);
  next.delete(MANIFEST_PATH);
  const fileEntries: Record<string, { sha256: string; size: number }> = {};
  for (const path of [...next.keys()].sort()) {
    const bytes = next.get(path) ?? "";
    fileEntries[path] = {
      sha256: `sha256:${hex(bytes)}`,
      size: new TextEncoder().encode(bytes).byteLength,
    };
  }
  const rewritten: SavedBundleManifest = { ...manifest, files: fileEntries };
  next.set(MANIFEST_PATH, JSON.stringify(rewritten, null, 2));
  return next;
}

function journalEventsOf(files: Map<string, string>, incidentId: string): JournalEvent[] {
  const lines = files.get(`incidents/${incidentId}/journal.jsonl`);
  if (lines === undefined) {
    throw new Error(`missing journal for ${incidentId}`);
  }
  return lines.trimEnd().split("\n").map((line) => JSON.parse(line) as JournalEvent);
}

function writeJournal(files: Map<string, string>, incidentId: string, events: JournalEvent[]): Map<string, string> {
  const next = new Map(files);
  next.set(`incidents/${incidentId}/journal.jsonl`, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return next;
}

function rewriteJournal(files: Map<string, string>, incidentId: string, events: JournalEvent[]): Map<string, string> {
  return reManifest(writeJournal(files, incidentId, events));
}

function bumpFinalSequence(manifest: SavedBundleManifest, incidentId: string, delta: number): SavedBundleManifest {
  return {
    ...manifest,
    incident_ids: manifest.incident_ids.map((i) =>
      i.incident_id === incidentId ? { ...i, final_sequence: i.final_sequence + delta } : i,
    ),
  };
}

type Mutator = (files: Map<string, string>) => Map<string, string>;

/** The deterministic mutators, keyed by the case name in invalid-cases.json. */
export const MUTATORS: Record<string, Mutator> = {
  "bad-sequence": (files) => {
    const events = journalEventsOf(files, "inc-demo-payment-1");
    const withGap = events.filter((e) => e.sequence !== 3);
    return rewriteJournal(files, "inc-demo-payment-1", withGap);
  },

  "duplicate-idempotency": (files) => {
    const events = journalEventsOf(files, "inc-demo-payment-1");
    const source = events[1];
    if (source === undefined) {
      throw new Error("no second event");
    }
    const dup = [...events];
    dup.splice(3, 0, { ...source, sequence: 0 } as JournalEvent);
    const renumbered = dup.map((e, i) => ({ ...e, sequence: i + 1 }));
    const manifest = bumpFinalSequence(manifestOf(files), "inc-demo-payment-1", 1);
    const withJournal = writeJournal(files, "inc-demo-payment-1", renumbered);
    const next = new Map(withJournal);
    next.delete(MANIFEST_PATH);
    const fileEntries: Record<string, { sha256: string; size: number }> = {};
    for (const path of [...next.keys()].sort()) {
      const bytes = next.get(path) ?? "";
      fileEntries[path] = {
        sha256: `sha256:${hex(bytes)}`,
        size: new TextEncoder().encode(bytes).byteLength,
      };
    }
    next.set(MANIFEST_PATH, JSON.stringify({ ...manifest, files: fileEntries }, null, 2));
    return next;
  },

  "illegal-run-transition": (files) => {
    const events = journalEventsOf(files, "inc-demo-payment-2");
    const changed = events.map((e) =>
      e.type === "run_transition" && e.from === "queued"
        ? ({ ...e, to: "failed", failure_reason: "no-hypothesis" } as JournalEvent)
        : e,
    );
    return rewriteJournal(files, "inc-demo-payment-2", changed);
  },

  "illegal-stage-transition": (files) => {
    const events = journalEventsOf(files, "inc-demo-payment-2");
    const changed = events.map((e) =>
      e.type === "stage_transition" && e.stage === "verify" && e.to === "entered"
        ? ({ ...e, stage: "release" } as JournalEvent)
        : e,
    );
    return rewriteJournal(files, "inc-demo-payment-2", changed);
  },

  "stale-schema": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "incident-brief") {
        next.set(path, JSON.stringify({ ...envelope, artifact_schema_version: "0.9" }));
        break;
      }
    }
    return reManifest(next);
  },

  "unknown-schema": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "incident-brief") {
        next.set(path, JSON.stringify({ ...envelope, artifact_schema_id: "mystery-artifact" }));
        break;
      }
    }
    return reManifest(next);
  },

  "redaction-mismatch": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "evidence-set" && envelope.redaction !== undefined) {
        const payload = envelope.payload as EvidenceSet;
        const first = payload.items[0];
        if (first !== undefined) {
          const snapshot = first.snapshot as Record<string, unknown>;
          const leaked = { ...snapshot, secret: "leaked-secret" };
          const updatedItem = { ...first, snapshot: leaked, content_hash: contentHashOf(leaked) };
          const updatedPayload: EvidenceSet = { ...payload, items: [updatedItem, ...payload.items.slice(1)] };
          next.set(path, JSON.stringify({ ...envelope, content_hash: contentHashOf(updatedPayload), payload: updatedPayload }));
        }
        break;
      }
    }
    return reManifest(next);
  },

  "missing-artifact": (files) => {
    const next = new Map(files);
    const referenced = journalEventsOf(files, "inc-demo-payment-1").find(
      (event) => event.type === "artifact_sealed",
    );
    if (referenced?.type === "artifact_sealed") {
      const digest = referenced.artifact_ref.content_hash.slice("sha256:".length);
      next.delete(`artifacts/sha256/${digest}.json`);
    }
    return reManifest(next);
  },

  "changed-content": (files) => {
    const next = new Map(files);
    const journalPath = "incidents/inc-demo-payment-1/journal.jsonl";
    const bytes = next.get(journalPath);
    if (bytes !== undefined) {
      next.set(journalPath, `${bytes}EXTRA`);
    }
    // Manifest is NOT regenerated: its hash is now stale.
    return next;
  },

  "changed-payload": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "verification-report") {
        const payload = envelope.payload as Record<string, unknown>;
        const tampered = { ...payload, verdict_reason: `${String(payload.verdict_reason ?? "")} TAMPERED` };
        next.set(path, JSON.stringify({ ...envelope, payload: tampered }));
        break;
      }
    }
    return reManifest(next);
  },

  "bad-path": (files) => {
    const next = reManifest(new Map(files));
    const manifest = JSON.parse(next.get(MANIFEST_PATH) ?? "{}") as SavedBundleManifest;
    const withBadPath: SavedBundleManifest = {
      ...manifest,
      files: { ...manifest.files, "/etc/passwd": { sha256: `sha256:${hex("bad")}`, size: 4 } },
    };
    next.set(MANIFEST_PATH, JSON.stringify(withBadPath, null, 2));
    return next;
  },

  "stale-evidence": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "evidence-set") {
        const payload = envelope.payload as EvidenceSet;
        const items = payload.items.map((item) => ({ ...item, fresh_until: "2026-08-01T00:00:00Z" }));
        const updatedPayload: EvidenceSet = { ...payload, items };
        next.set(path, JSON.stringify({ ...envelope, content_hash: contentHashOf(updatedPayload), payload: updatedPayload }));
        break;
      }
    }
    return reManifest(next);
  },

  "unlisted-file": (files) => {
    const next = new Map(files);
    let artifactPath: string | null = null;
    for (const path of next.keys()) {
      if (path.startsWith("artifacts/sha256/")) {
        artifactPath = path;
        break;
      }
    }
    const manifest = JSON.parse(next.get(MANIFEST_PATH) ?? "{}") as SavedBundleManifest;
    const filesEntry = { ...manifest.files };
    if (artifactPath !== null) {
      delete filesEntry[artifactPath];
    }
    next.set(MANIFEST_PATH, JSON.stringify({ ...manifest, files: filesEntry }, null, 2));
    return next;
  },

  "artifact-context-mismatch": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id === "incident-brief" && envelope.run_id === "run-1") {
        next.set(path, JSON.stringify({ ...envelope, run_id: "run-other" }));
        break;
      }
    }
    return reManifest(next);
  },

  "gate-evidence-missing": (files) => {
    const events = journalEventsOf(files, "inc-demo-payment-1");
    const changed = events.map((event) => {
      if (
        event.type !== "gate_evaluated" ||
        event.gate !== "release" ||
        event.evaluation.gate !== "release"
      ) {
        return event;
      }
      return {
        ...event,
        evaluation: {
          ...event.evaluation,
          facts: event.evaluation.facts.map((fact) =>
            fact.fact === "2"
              ? {
                  ...fact,
                  evidence_refs: [{ kind: "receipt" as const, ref: "receipt-does-not-exist" }],
                }
              : fact,
          ),
        },
      };
    });
    return rewriteJournal(files, "inc-demo-payment-1", changed);
  },

  "report-receipt-missing": (files) => {
    const next = new Map(files);
    for (const [path, bytes] of next) {
      if (!path.startsWith("artifacts/sha256/")) continue;
      const envelope = JSON.parse(bytes) as ArtifactEnvelope;
      if (envelope.artifact_schema_id !== "test-report" || envelope.run_id !== "run-1") {
        continue;
      }
      const payload = envelope.payload as Record<string, unknown>;
      const updatedPayload = { ...payload, receipt_ref: "receipt-does-not-exist" };
      const updatedContentHash = contentHashOf(updatedPayload);
      const updatedEnvelope = {
        ...envelope,
        content_hash: updatedContentHash,
        payload: updatedPayload,
      };
      next.delete(path);
      next.set(
        `artifacts/sha256/${updatedContentHash.slice("sha256:".length)}.json`,
        JSON.stringify(updatedEnvelope),
      );
      break;
    }
    return reManifest(next);
  },
};
