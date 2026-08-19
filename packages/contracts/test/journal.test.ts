import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  applyJournalCommand,
  applyJournalEvent,
  initialJournalState,
  reduceJournalEvents,
  verifyJournalSequence,
  type JournalState,
} from "../src/journal.js";
import { sha256Hex } from "../src/hashes.js";
import type { RunOutcome } from "../src/schemas/incident.js";
import type { JournalCommand, JournalEvent } from "../src/schemas/journal-event.js";

const h = (tag: string) => `sha256:${sha256Hex(tag).padEnd(64, "0").slice(0, 64)}`;
const policy = "policy-v1";
const actor = { id: "cp-1", kind: "control-plane" as const };

let idemCounter = 0;

function event(type: JournalEvent["type"], partial: Record<string, unknown>): JournalEvent {
  idemCounter += 1;
  return {
    type,
    incident_id: "inc-1",
    recorded_at: "2026-08-15T15:00:00Z",
    idempotency_key: `key-${type}-${idemCounter}`,
    actor,
    policy_version: policy,
    ...partial,
  } as JournalEvent;
}

/** A complete legal verified-remediation run, as journal events. */
function validRun(): JournalEvent[] {
  const events: JournalEvent[] = [];
  const push = (e: Omit<JournalEvent, "sequence">) => {
    events.push({ ...e, sequence: events.length + 1 } as JournalEvent);
  };

  push(event("trigger_received", {
    trigger: {
      schema_version: "1.0",
      trigger_id: "t1",
      delivery_key: h("delivery"),
      incident_key: h("incident"),
      received_at: "2026-08-15T15:00:00Z",
      detector: {
        source: "prometheus-alertmanager",
        connection_id: "c1",
        rule_id: "payment-error-rate",
        rule_version: "git:abc",
      },
      state: "firing",
      severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      window: { starts_at: "2026-08-15T15:00:00Z", ends_at: null, lookback_seconds: 120 },
      signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
      evidence_refs: [],
    },
    delivery_result: "incident-created",
  }));
  push(event("incident_transition", { from: null, to: "open", expected_version: 0 }));
  push(event("run_transition", { run_id: "run-1", attempt: 1, from: null, to: "queued", expected_run_version: 0 }));
  push(event("run_transition", { run_id: "run-1", attempt: 1, from: "queued", to: "running", expected_run_version: 1 }));

  const stages: Array<[JournalEvent["type"] extends never ? never : string, string | null, string, Record<string, unknown>]> = [
    ["detect", null, "entered", {}],
    ["detect", "entered", "in-progress", {}],
    ["detect", "in-progress", "completed", { artifact_ref: { schema_id: "incident-brief", schema_version: "1.0", content_hash: h("brief") } }],
    ["diagnose", null, "entered", {}],
    ["diagnose", "entered", "in-progress", {}],
    ["diagnose", "in-progress", "completed", { artifact_ref: { schema_id: "diagnosis-report", schema_version: "1.0", content_hash: h("diagnosis") } }],
    ["repair", null, "entered", {}],
    ["repair", "entered", "in-progress", {}],
    ["repair", "in-progress", "completed", { candidate_hash: h("cand"), artifact_ref: { schema_id: "remediation-proposal", schema_version: "1.0", content_hash: h("proposal") } }],
    ["verify", null, "entered", {}],
    ["verify", "entered", "in-progress", {}],
    ["verify", "in-progress", "completed", { artifact_ref: { schema_id: "verification-report", schema_version: "1.0", content_hash: h("verification") } }],
    ["release", null, "entered", {}],
    ["release", "entered", "in-progress", {}],
    ["release", "in-progress", "completed", {}],
    ["watch", null, "entered", {}],
    ["watch", "entered", "in-progress", {}],
    ["watch", "in-progress", "completed", { artifact_ref: { schema_id: "watch-report", schema_version: "1.0", content_hash: h("watch") } }],
  ];
  for (const [stage, from, to, extra] of stages) {
    push(event("stage_transition", { run_id: "run-1", attempt: 1, stage, from, to, ...extra }));
  }
  push(event("run_transition", { run_id: "run-1", attempt: 1, from: "running", to: "completed", outcome: "verified-remediation", expected_run_version: 2 }));
  push(event("incident_transition", { from: "open", to: "resolved", expected_version: 1 }));
  push(event("trigger_received", {
    trigger: {
      schema_version: "1.0",
      trigger_id: "t2",
      delivery_key: h("delivery-2"),
      incident_key: h("incident"),
      received_at: "2026-08-15T16:00:00Z",
      detector: { source: "prometheus-alertmanager", connection_id: "c1", rule_id: "payment-error-rate", rule_version: "git:abc" },
      state: "resolved",
      severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      window: { starts_at: "2026-08-15T15:00:00Z", ends_at: "2026-08-15T16:00:00Z", lookback_seconds: 120 },
      signal_summary: { name: "payment error ratio", value: 0.02, unit: "1", threshold: 0.2 },
      evidence_refs: [],
    },
    delivery_result: "evidence-appended",
  }));
  push(event("incident_transition", { from: "resolved", to: "closed", closure_reason: "symptom-cleared", expected_version: 2 }));
  return events;
}

type StageStep = readonly [
  stage: "detect" | "diagnose" | "repair" | "verify" | "release" | "watch",
  from: null | "entered" | "in-progress" | "completed" | "failed" | "skipped",
  to: "entered" | "in-progress" | "completed" | "failed" | "skipped",
  reason?: "symptom-cleared" | "observe-only" | "prohibited",
];

function completedStage(stage: StageStep[0]): StageStep[] {
  return [
    [stage, null, "entered"],
    [stage, "entered", "in-progress"],
    [stage, "in-progress", "completed"],
  ];
}

function settledStages(outcome: RunOutcome): StageStep[] {
  const detectAndDiagnose = [
    ...completedStage("detect"),
    ...completedStage("diagnose"),
  ];
  if (outcome === "verified-remediation") {
    return [
      ...detectAndDiagnose,
      ...completedStage("repair"),
      ...completedStage("verify"),
      ...completedStage("release"),
      ...completedStage("watch"),
    ];
  }
  if (outcome === "symptom-cleared") {
    return [
      ...detectAndDiagnose,
      ["repair", null, "skipped", "symptom-cleared"],
      ["verify", null, "skipped", "symptom-cleared"],
      ["release", null, "skipped", "symptom-cleared"],
      ...completedStage("watch"),
    ];
  }
  const reason = outcome === "diagnosis-only" ? "observe-only" : "prohibited";
  return [
    ...detectAndDiagnose,
    ["repair", null, "skipped", reason],
    ["verify", null, "skipped", reason],
    ["release", null, "skipped", reason],
    ["watch", null, "skipped", reason],
  ];
}

function runForOutcome(outcome: RunOutcome, stages: readonly StageStep[]): JournalEvent[] {
  const events = validRun().slice(0, 4);
  for (const [stage, from, to, reason] of stages) {
    events.push(
      event("stage_transition", {
        run_id: "run-1",
        attempt: 1,
        stage,
        from,
        to,
        ...(reason === undefined ? {} : { reason }),
      }),
    );
  }
  events.push(
    event("run_transition", {
      run_id: "run-1",
      attempt: 1,
      from: "running",
      to: "completed",
      outcome,
      expected_run_version: 2,
    }),
  );
  return events.map((journalEvent, index) => ({ ...journalEvent, sequence: index + 1 }));
}

describe("verifyJournalSequence", () => {
  test("accepts contiguous sequences from 1", () => {
    const events = validRun();
    expect(verifyJournalSequence(events).ok).toBe(true);
  });

  test("rejects a gap", () => {
    const events = validRun().filter((e) => e.sequence !== 3);
    const result = verifyJournalSequence(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_SEQUENCE");
    }
  });

  test("rejects starting at a sequence other than 1", () => {
    const events = validRun().map((e, i) => ({ ...e, sequence: i + 2 }));
    const result = verifyJournalSequence(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_SEQUENCE");
    }
  });

  test("rejects duplicate idempotency keys", () => {
    const events = validRun();
    const dup = events.map((e, i) => (i === 4 ? { ...e, idempotency_key: events[0]!.idempotency_key } : e));
    const result = verifyJournalSequence(dup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE_TRANSITION");
    }
  });
});

describe("reduceJournalEvents", () => {
  test("reduces a valid run to resolved then closed", () => {
    const result = reduceJournalEvents(validRun());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.incidentState).toBe("closed");
      expect(result.value.attemptsUsed).toBe(1);
      expect(result.value.detectorState).toBe("resolved");
      expect(result.value.nextSequence).toBe(validRun().length + 1);
      expect(result.value.seenIdempotencyKeys.size).toBe(validRun().length);
    }
  });

  test("rejects verified-remediation before Watch completes", () => {
    const withoutWatch = validRun()
      .filter((event) => event.type !== "stage_transition" || event.stage !== "watch")
      .map((event, index) => ({ ...event, sequence: index + 1 }));
    const result = reduceJournalEvents(withoutWatch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  for (const outcome of [
    "verified-remediation",
    "symptom-cleared",
    "diagnosis-only",
    "handoff",
  ] as const) {
    test(`accepts the settled ${outcome} stage shape`, () => {
      expect(reduceJournalEvents(runForOutcome(outcome, settledStages(outcome))).ok).toBe(true);
    });
  }

  for (const outcome of ["symptom-cleared", "diagnosis-only", "handoff"] as const) {
    test(`rejects ${outcome} with a verified-remediation stage shape`, () => {
      const result = reduceJournalEvents(
        runForOutcome(outcome, settledStages("verified-remediation")),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_TRANSITION");
      }
    });
  }

  test("rejects an illegal run transition", () => {
    const events = validRun();
    // queued -> failed is illegal.
    const illegal = events.map((e) =>
      e.type === "run_transition" && e.from === "queued"
        ? ({ ...e, to: "failed", failure_reason: "no-hypothesis" } as JournalEvent)
        : e,
    );
    const result = reduceJournalEvents(illegal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("replay requires completed work dependencies and sealed completion outputs", () => {
    const budget = {
      model_turns: 1,
      non_terminal_tool_calls: 1,
      session_wall_clock_ms: 1,
      run_wall_clock_ms: 1,
    };
    const ref = { schema_id: "incident-brief", schema_version: "1.0", content_hash: h("brief-work") };
    const request = (workId: string, dependsOn: string[] = []): JournalEvent => event("work_requested", {
      run_id: "run-1",
      attempt: 1,
      request_id: `request-${workId}`,
      work_id: workId,
      stage: "detect",
      status: "admitted",
      depends_on: dependsOn,
      budget,
      admitted_artifact_refs: [],
    });
    const completion = event("work_completed", {
      run_id: "run-1",
      attempt: 1,
      work_id: "work-a",
      artifact_refs: [ref],
    });
    const base = validRun().slice(0, 4);
    const missing = [...base, request("work-a"), request("work-b", ["work-a"])].map((item, index) => ({ ...item, sequence: index + 1 }));
    expect(reduceJournalEvents(missing).ok).toBe(false);

    const complete = [
      ...base,
      event("artifact_sealed", { run_id: "run-1", artifact_ref: ref }),
      request("work-a"),
      completion,
      request("work-b", ["work-a"]),
    ].map((item, index) => ({ ...item, sequence: index + 1 }));
    const reduced = reduceJournalEvents(complete);
    expect(reduced.ok).toBe(true);
    if (reduced.ok) expect(reduced.value.workRecords.map((work) => work.status)).toEqual(["completed", "admitted"]);
  });

  test("replays stale rejected work as an audit record", () => {
    const rejected = event("work_requested", {
      run_id: "run-1",
      attempt: 2,
      request_id: "request-stale",
      work_id: "work-stale",
      stage: "detect",
      status: "rejected",
      depends_on: [],
      budget: {
        model_turns: 1,
        non_terminal_tool_calls: 1,
        session_wall_clock_ms: 1,
        run_wall_clock_ms: 1,
      },
      admitted_artifact_refs: [],
      code: "STALE_ATTEMPT",
      reason: "request attempt 2 does not match run attempt 1",
    });
    const result = reduceJournalEvents([
      ...validRun().slice(0, 4),
      { ...rejected, sequence: 5 },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.workRecords).toMatchObject([{ workId: "work-stale", status: "rejected", attempt: 2 }]);
  });

  test("rejects expected version mismatch", () => {
    const events = validRun().map((e) =>
      e.type === "incident_transition" && e.expected_version === 1
        ? { ...e, expected_version: 99 }
        : e,
    );
    const result = reduceJournalEvents(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("requires a new Run to expect version zero", () => {
    const events = validRun().map((e) =>
      e.type === "run_transition" && e.from === null
        ? { ...e, expected_run_version: 1 }
        : e,
    );
    const result = reduceJournalEvents(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("binds later Run transitions to the created attempt", () => {
    const events = validRun().map((e) =>
      e.type === "run_transition" && e.from === "queued"
        ? { ...e, attempt: 2 }
        : e,
    );
    const result = reduceJournalEvents(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("binds stage transitions to the created attempt", () => {
    const events = validRun().map((e) =>
      e.type === "stage_transition" && e.stage === "detect" && e.to === "entered"
        ? { ...e, attempt: 2 }
        : e,
    );
    const result = reduceJournalEvents(events);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("rejects a stage transition after the run is terminal", () => {
    const events = validRun();
    const extra: JournalEvent = event("stage_transition", {
      run_id: "run-1",
      attempt: 1,
      stage: "watch",
      from: "completed",
      to: "entered",
      sequence: events.length + 1,
    });
    const result = reduceJournalEvents([...events, extra]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });

  test("rejects a second active run", () => {
    const events = validRun();
    const second: JournalEvent = event("run_transition", {
      run_id: "run-2",
      attempt: 2,
      from: null,
      to: "queued",
      expected_run_version: 0,
      sequence: 3,
    });
    const result = reduceJournalEvents([...events.slice(0, 2), second]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });
});

describe("applyJournalCommand", () => {
  function commandOf(e: JournalEvent): JournalCommand {
    const { sequence: _sequence, ...rest } = e;
    return rest as JournalCommand;
  }

  test("assigns the next sequence", () => {
    let state = initialJournalState();
    const first = validRun()[0]!;
    const result = applyJournalCommand(state, commandOf(first));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.event?.sequence).toBe(1);
      state = result.value.state;
    }
  });

  test("replaying an applied idempotency key is a no-op", () => {
    let state = initialJournalState();
    const first = validRun()[0]!;
    const a = applyJournalCommand(state, commandOf(first));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    state = a.value.state;
    const b = applyJournalCommand(state, commandOf(first));
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.value.event).toBeNull();
      expect(b.value.state.nextSequence).toBe(state.nextSequence);
      expect(b.value.state.seenIdempotencyKeys.size).toBe(state.seenIdempotencyKeys.size);
    }
  });

  test("creates no duplicate event on replay", () => {
    let state = initialJournalState();
    const first = validRun()[0]!;
    const a = applyJournalCommand(state, commandOf(first));
    expect(a.ok && a.value.event !== null).toBe(true);
    if (!a.ok || a.value.event === null) return;
    state = a.value.state;
    const b = applyJournalCommand(state, commandOf(first));
    expect(b.ok && b.value.event === null).toBe(true);
    if (b.ok) {
      state = b.value.state;
    }
    // A second, distinct command still advances.
    const second = commandOf(validRun()[1]!);
    const c = applyJournalCommand(state, second);
    expect(c.ok && c.value.event?.sequence === 2).toBe(true);
  });
});

describe("replay determinism", () => {
  test("wall-clock order never decides replay order", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        (seed) => {
          const events = validRun();
          // Shuffle a copy deterministically using the seed.
          const shuffled = [...events];
          let s = seed;
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const j = s % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          // Re-sort by sequence and confirm it reduces to the same state.
          const bySequence = [...shuffled].sort((a, b) => a.sequence - b.sequence);
          const a = reduceJournalEvents(events);
          const b = reduceJournalEvents(bySequence);
          expect(a.ok && b.ok).toBe(true);
          if (a.ok && b.ok) {
            expect(a.value.incidentState).toBe(b.value.incidentState);
            expect(a.value.attemptsUsed).toBe(b.value.attemptsUsed);
            expect(a.value.detectorState).toBe(b.value.detectorState);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  test("applying the same command stream twice is idempotent", () => {
    const events = validRun();
    let state: JournalState = initialJournalState();
    for (const e of events) {
      const { sequence: _s, ...cmd } = e;
      const result = applyJournalCommand(state, cmd as JournalCommand);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.value.state;
    }
    const before = state.attemptsUsed;
    // Reapply the whole stream; every command is a no-op.
    for (const e of events) {
      const { sequence: _s, ...cmd } = e;
      const result = applyJournalCommand(state, cmd as JournalCommand);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.value.state;
    }
    expect(state.attemptsUsed).toBe(before);
  });
});

describe("applyJournalEvent", () => {
  test("a rejected first event does not mutate the caller's state", () => {
    const state = initialJournalState();
    const invalid = event("incident_transition", {
      sequence: 1,
      from: null,
      to: "closed",
      closure_reason: "human-closed",
      expected_version: 0,
    });
    const result = applyJournalEvent(state, invalid);
    expect(result.ok).toBe(false);
    expect(state).toEqual(initialJournalState());
  });

  test("rejects an event whose incident_id does not match the journal", () => {
    const state = initialJournalState();
    const events = validRun();
    // Seed the incident id.
    const seeded = applyJournalEvent(state, events[0]!);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const wrong = { ...events[1]!, incident_id: "other-incident" };
    const result = applyJournalEvent(seeded.value, wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
    }
  });
});
