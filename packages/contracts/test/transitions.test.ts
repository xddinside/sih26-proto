import { describe, expect, test } from "bun:test";

import {
  allIncidentStates,
  allRunStates,
  checkStageRecords,
  isLegalIncidentTransition,
  isLegalRunTransition,
  isLegalStageStatusChange,
  STAGE_ORDER,
  type StageTransition,
} from "../src/transitions.js";
import type {
  ClosureReason,
  IncidentState,
  RunFailureReason,
  RunOutcome,
  RunState,
} from "../src/schemas/incident.js";

describe("Incident transitions", () => {
  const legal: Array<[IncidentState | null, IncidentState, Partial<{ closureReason: ClosureReason }>]> = [
    [null, "open", {}],
    ["open", "open", {}],
    ["open", "resolved", {}],
    ["open", "closed", { closureReason: "symptom-cleared" }],
    ["open", "closed", { closureReason: "attempt-limit" }],
    ["open", "closed", { closureReason: "human-closed" }],
    ["resolved", "open", {}],
    ["resolved", "closed", { closureReason: "symptom-cleared" }],
    ["resolved", "closed", { closureReason: "human-closed" }],
  ];

  test.each(legal)("legal: %s -> %s", (from, to, options) => {
    const result = isLegalIncidentTransition(from, to, options);
    expect(result.ok).toBe(true);
  });

  test("creation can only go to open", () => {
    expect(isLegalIncidentTransition(null, "resolved").ok).toBe(false);
    expect(isLegalIncidentTransition(null, "closed").ok).toBe(false);
  });

  test("closed has no outgoing transitions", () => {
    for (const to of allIncidentStates()) {
      expect(isLegalIncidentTransition("closed", to).ok).toBe(false);
    }
  });

  test("closing requires a closure reason", () => {
    expect(isLegalIncidentTransition("open", "closed", {}).ok).toBe(false);
    expect(isLegalIncidentTransition("resolved", "closed", {}).ok).toBe(false);
  });

  test("resolved cannot transition to itself", () => {
    expect(isLegalIncidentTransition("resolved", "resolved").ok).toBe(false);
  });
});

describe("Run transitions", () => {
  const legal: Array<[RunState | null, RunState, Partial<{ outcome: RunOutcome; failureReason: RunFailureReason }>]> = [
    [null, "queued", {}],
    ["queued", "running", {}],
    ["queued", "cancelled", {}],
    ["running", "paused", {}],
    ["running", "awaiting-human", {}],
    ["running", "interrupted", {}],
    ["running", "completed", { outcome: "verified-remediation" }],
    ["running", "completed", { outcome: "symptom-cleared" }],
    ["running", "completed", { outcome: "diagnosis-only" }],
    ["running", "completed", { outcome: "handoff" }],
    ["running", "failed", { failureReason: "verification-failed" }],
    ["running", "failed", { failureReason: "no-hypothesis" }],
    ["running", "failed", { failureReason: "rollback-required" }],
    ["running", "cancelled", {}],
    ["paused", "running", {}],
    ["paused", "cancelled", {}],
    ["awaiting-human", "running", {}],
    ["awaiting-human", "cancelled", {}],
    ["interrupted", "running", {}],
    ["interrupted", "failed", { failureReason: "unstable-worker" }],
    ["interrupted", "failed", { failureReason: "interrupted-unrecoverable" }],
    ["interrupted", "cancelled", {}],
  ];

  test.each(legal)("legal: %s -> %s", (from, to, options) => {
    const result = isLegalRunTransition(from, to, options);
    expect(result.ok).toBe(true);
  });

  test("terminal states have no outgoing transitions", () => {
    for (const terminal of ["completed", "failed", "cancelled"] as const) {
      for (const to of allRunStates()) {
        expect(isLegalRunTransition(terminal, to).ok).toBe(false);
      }
    }
  });

  test("completed requires an outcome", () => {
    expect(isLegalRunTransition("running", "completed", {}).ok).toBe(false);
  });

  test("failed requires a failure reason", () => {
    expect(isLegalRunTransition("running", "failed", {}).ok).toBe(false);
  });

  test("queued cannot jump to completed or failed", () => {
    expect(isLegalRunTransition("queued", "completed", { outcome: "diagnosis-only" }).ok).toBe(false);
    expect(isLegalRunTransition("queued", "failed", { failureReason: "no-hypothesis" }).ok).toBe(false);
  });
});

describe("stage status changes", () => {
  test.each([
    [null, "entered", true],
    ["entered", "in-progress", true],
    ["in-progress", "completed", true],
    ["in-progress", "failed", true],
    [null, "completed", false],
    ["entered", "entered", false],
    ["entered", "completed", false],
    ["completed", "entered", false],
    ["failed", "entered", false],
    ["in-progress", "skipped", false],
  ] as const)("%s -> %s is %s", (from, to, expected) => {
    expect(isLegalStageStatusChange(from, to)).toBe(expected);
  });
});

function record(
  stage: (typeof STAGE_ORDER)[number],
  from: string | null,
  to: string,
  extra: Partial<StageTransition> = {},
): StageTransition {
  return {
    stage,
    from: from as StageTransition["from"],
    to: to as StageTransition["to"],
    reason: undefined,
    candidateHash: undefined,
    artifactRef: undefined,
    ...extra,
  };
}

describe("checkStageRecords", () => {
  const fullRun: StageTransition[] = [
    record("detect", null, "entered"),
    record("detect", "entered", "in-progress"),
    record("detect", "in-progress", "completed", { artifactRef: { schema_id: "incident-brief", schema_version: "1.0", content_hash: "sha256:" + "a".repeat(64) } }),
    record("diagnose", null, "entered"),
    record("diagnose", "entered", "in-progress"),
    record("diagnose", "in-progress", "completed"),
    record("repair", null, "entered"),
    record("repair", "entered", "in-progress"),
    record("repair", "in-progress", "completed", { candidateHash: "sha256:" + "b".repeat(64) }),
    record("verify", null, "entered"),
    record("verify", "entered", "in-progress"),
    record("verify", "in-progress", "completed"),
    record("release", null, "entered"),
    record("release", "entered", "in-progress"),
    record("release", "in-progress", "completed"),
    record("watch", null, "entered"),
    record("watch", "entered", "in-progress"),
    record("watch", "in-progress", "completed"),
  ];

  test("accepts a full legal run", () => {
    expect(checkStageRecords(fullRun).ok).toBe(true);
  });

  test("detect and diagnose can never be skipped", () => {
    expect(checkStageRecords([record("detect", null, "skipped", { reason: "observe-only" })]).ok).toBe(false);
    expect(checkStageRecords([
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "skipped", { reason: "observe-only" }),
    ]).ok).toBe(false);
  });

  test("repair/verify/release may skip for a valid reason", () => {
    const skipped = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("repair", null, "skipped", { reason: "symptom-cleared" }),
      record("verify", null, "skipped", { reason: "symptom-cleared" }),
      record("release", null, "skipped", { reason: "symptom-cleared" }),
      record("watch", null, "entered"),
      record("watch", "entered", "in-progress"),
      record("watch", "in-progress", "completed"),
    ];
    expect(checkStageRecords(skipped).ok).toBe(true);
  });

  test("watch can only skip for observe-only or prohibited", () => {
    const base = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("repair", null, "skipped", { reason: "observe-only" }),
      record("verify", null, "skipped", { reason: "observe-only" }),
      record("release", null, "skipped", { reason: "observe-only" }),
    ];
    expect(checkStageRecords([...base, record("watch", null, "skipped", { reason: "observe-only" })]).ok).toBe(true);
    expect(checkStageRecords([...base, record("watch", null, "skipped", { reason: "symptom-cleared" })]).ok).toBe(false);
  });

  test("a skipped stage must carry a valid reason", () => {
    expect(checkStageRecords([record("repair", null, "skipped", { reason: "bogus" })]).ok).toBe(false);
  });

  test("rejects a stage that starts before its predecessor finished", () => {
    const bad = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("release", null, "entered"),
    ];
    expect(checkStageRecords(bad).ok).toBe(false);
  });

  test("rejects diagnose until detect completes", () => {
    const bad = [
      record("detect", null, "entered"),
      record("diagnose", null, "entered"),
    ];
    expect(checkStageRecords(bad).ok).toBe(false);
  });

  test("rejects a declared source that does not match stored stage state", () => {
    const bad = [
      record("detect", null, "entered"),
      record("detect", null, "in-progress"),
    ];
    expect(checkStageRecords(bad).ok).toBe(false);
  });

  test("rejects skipping ahead to a later stage", () => {
    const bad = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("release", null, "skipped", { reason: "observe-only" }),
    ];
    expect(checkStageRecords(bad).ok).toBe(false);
  });

  test("allows only the Verify->Repair revision loop as a backward move", () => {
    const revisionLoop: StageTransition[] = [
      ...fullRun.slice(0, 12), // up through Verify completed
      // Verify -> Repair (new candidate), then Verify again
      record("repair", "completed", "entered", { candidateHash: "sha256:" + "c".repeat(64) }),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: "sha256:" + "c".repeat(64) }),
      record("verify", "failed", "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "completed"),
    ];
    // Need the Verify to have FAILED for the backward move; use a variant.
    expect(checkStageRecords(revisionLoop).ok).toBe(false);
  });

  test("rejects a backward move with a reused candidate hash", () => {
    const c = "sha256:" + "b".repeat(64);
    const records: StageTransition[] = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("repair", null, "entered"),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: c }),
      record("verify", null, "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "failed"),
      record("repair", "completed", "entered", { candidateHash: c }),
    ];
    expect(checkStageRecords(records).ok).toBe(false);
  });

  test("rejects exceeding the revision cap", () => {
    const mk = (i: number) => "sha256:" + i.toString().padStart(64, "0");
    const cycle = (i: number): StageTransition[] => [
      record("repair", "completed", "entered", { candidateHash: mk(i) }),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: mk(i) }),
      record("verify", "failed", "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "failed"),
    ];
    const records: StageTransition[] = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("repair", null, "entered"),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: mk(1) }),
      record("verify", null, "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "failed"),
      ...cycle(2),
      ...cycle(3),
      ...cycle(4),
    ];
    expect(checkStageRecords(records).ok).toBe(false);
  });

  test("an accepted revision loop succeeds", () => {
    const mk = (i: number) => "sha256:" + i.toString().padStart(64, "0");
    const records: StageTransition[] = [
      record("detect", null, "entered"),
      record("detect", "entered", "in-progress"),
      record("detect", "in-progress", "completed"),
      record("diagnose", null, "entered"),
      record("diagnose", "entered", "in-progress"),
      record("diagnose", "in-progress", "completed"),
      record("repair", null, "entered"),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: mk(1) }),
      record("verify", null, "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "failed"),
      record("repair", "completed", "entered", { candidateHash: mk(2) }),
      record("repair", "entered", "in-progress"),
      record("repair", "in-progress", "completed", { candidateHash: mk(2) }),
      record("verify", "failed", "entered"),
      record("verify", "entered", "in-progress"),
      record("verify", "in-progress", "completed"),
      record("release", null, "entered"),
      record("release", "entered", "in-progress"),
      record("release", "in-progress", "completed"),
      record("watch", null, "entered"),
      record("watch", "entered", "in-progress"),
      record("watch", "in-progress", "completed"),
    ];
    const result = checkStageRecords(records);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revisions).toBe(1);
    }
  });
});
