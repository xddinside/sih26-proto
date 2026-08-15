/**
 * Journal state application and strict replay, from
 * docs/research/orchestrator-stages.md.
 *
 * The journal is append-only and ordered by sequence, never by wall clock.
 * Sequence starts at 1 per Incident export and must be contiguous. Replaying a
 * command whose idempotency key is already applied is a no-op that creates no
 * duplicate event. Illegal transitions, expected-state/version mismatches,
 * and terminal-state invariant violations are typed `ILLEGAL_TRANSITION` or
 * `MALFORMED_CONTRACT` results.
 */
import type { IntegrityError } from "./errors.js";
import { integrityError } from "./errors.js";
import { err, ok, type Result } from "./result.js";
import type {
  ClosureReason,
  IncidentState,
  RunFailureReason,
  RunOutcome,
  RunState,
} from "./schemas/incident.js";
import type { DetectorState } from "./schemas/incident-trigger.js";
import type { JournalCommand, JournalEvent } from "./schemas/journal-event.js";
import {
  checkStageRecords,
  isLegalIncidentTransition,
  isLegalRunTransition,
  isRunTerminal,
  type StageTransition,
} from "./transitions.js";

/** The durable state reconstructed from a journal replay. */
export interface RunRecord {
  runId: string;
  attempt: number;
  state: RunState;
  runVersion: number;
  outcome: RunOutcome | undefined;
  failureReason: RunFailureReason | undefined;
  restartCount: number;
  stageRecords: StageTransition[];
}

/** The aggregate state of one Incident reconstructed from its journal. */
export interface JournalState {
  incidentId: string | null;
  incidentVersion: number;
  incidentState: IncidentState | null;
  detectorState: DetectorState | null;
  closureReason: ClosureReason | undefined;
  attemptsUsed: number;
  nextSequence: number;
  runs: RunRecord[];
  seenIdempotencyKeys: Set<string>;
}

/** Create the empty initial journal state. */
export function initialJournalState(): JournalState {
  return {
    incidentId: null,
    incidentVersion: 0,
    incidentState: null,
    detectorState: null,
    closureReason: undefined,
    attemptsUsed: 0,
    nextSequence: 1,
    runs: [],
    seenIdempotencyKeys: new Set(),
  };
}

function findRun(state: JournalState, runId: string): RunRecord | undefined {
  return state.runs.find((run) => run.runId === runId);
}

function activeRun(state: JournalState): RunRecord | undefined {
  return state.runs.find((run) => !isRunTerminal(run.state));
}

function checkIncident(state: JournalState, incidentId: string): Result<true, IntegrityError> {
  if (state.incidentId === null) {
    return ok(true);
  }
  if (state.incidentId !== incidentId) {
    return err(
      integrityError("ILLEGAL_TRANSITION", "event incident_id does not match the journal"),
    );
  }
  return ok(true);
}

function checkRunId(state: JournalState, runId: string | undefined): Result<true, IntegrityError> {
  if (runId === undefined) {
    return ok(true);
  }
  if (findRun(state, runId) === undefined) {
    return err(integrityError("ILLEGAL_TRANSITION", `event references unknown run ${runId}`));
  }
  return ok(true);
}

/**
 * Apply one fully-formed journal event to the state. Sequence and idempotency
 * are the caller's responsibility. The input state stays unchanged whether
 * the event succeeds or fails.
 */
export function applyJournalEvent(
  state: JournalState,
  event: JournalEvent,
): Result<JournalState, IntegrityError> {
  return applyJournalEventMutable(cloneJournalState(state), event);
}

function cloneJournalState(state: JournalState): JournalState {
  return {
    ...state,
    runs: state.runs.map((run) => ({
      ...run,
      stageRecords: run.stageRecords.map((record) => ({
        ...record,
        artifactRef:
          record.artifactRef === undefined ? undefined : { ...record.artifactRef },
      })),
    })),
    seenIdempotencyKeys: new Set(state.seenIdempotencyKeys),
  };
}

function applyJournalEventMutable(
  state: JournalState,
  event: JournalEvent,
): Result<JournalState, IntegrityError> {
  // Every variant carries incident_id; some also carry an optional run_id.
  // Reading the shared envelope through a structural cast avoids re-narrowing
  // the discriminated union twice for these common fields.
  const common = event as unknown as { incident_id: string; run_id?: string };
  const incidentOk = checkIncident(state, common.incident_id);
  if (!incidentOk.ok) {
    return incidentOk;
  }
  if (state.incidentId === null) {
    state.incidentId = common.incident_id;
  }
  // A run_transition that creates a run (from: null) references a run id that
  // does not exist yet; every other event with a run_id must reference an
  // already-known run.
  const creatingRun = event.type === "run_transition" && event.from === null;
  if (!creatingRun) {
    const runOk = checkRunId(state, common.run_id);
    if (!runOk.ok) {
      return runOk;
    }
  }

  switch (event.type) {
    case "trigger_received": {
      state.incidentId = event.incident_id;
      state.detectorState = event.trigger.state;
      return ok(state);
    }
    case "incident_transition": {
      const legal = isLegalIncidentTransition(
        event.from,
        event.to,
        event.closure_reason === undefined ? {} : { closureReason: event.closure_reason },
      );
      if (!legal.ok) {
        return legal;
      }
      if (event.from !== state.incidentState) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `incident expected state ${JSON.stringify(state.incidentState)} but event carries ${JSON.stringify(event.from)}`,
          ),
        );
      }
      if (event.expected_version !== state.incidentVersion) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `incident expected version ${event.expected_version} does not match ${state.incidentVersion}`,
          ),
        );
      }
      state.incidentState = event.to;
      state.incidentVersion += 1;
      if (event.to === "closed") {
        state.closureReason = event.closure_reason;
      }
      return ok(state);
    }
    case "run_transition": {
      if (state.incidentState === null) {
        return err(integrityError("ILLEGAL_TRANSITION", "run transition before incident exists"));
      }
      if (event.from === null) {
        if (findRun(state, event.run_id) !== undefined) {
          return err(integrityError("ILLEGAL_TRANSITION", `run ${event.run_id} already exists`));
        }
        if (state.incidentState === "closed") {
          return err(integrityError("ILLEGAL_TRANSITION", "a closed incident cannot start a run"));
        }
        if (activeRun(state) !== undefined) {
          return err(integrityError("ILLEGAL_TRANSITION", "an active run already exists"));
        }
        if (event.attempt !== state.runs.length + 1) {
          return err(
            integrityError(
              "ILLEGAL_TRANSITION",
              `run attempt ${event.attempt} is not serial (expected ${state.runs.length + 1})`,
            ),
          );
        }
        if (event.expected_run_version !== 0) {
          return err(
            integrityError(
              "ILLEGAL_TRANSITION",
              `new run expected version must be 0, got ${event.expected_run_version}`,
            ),
          );
        }
        const legal = isLegalRunTransition(null, event.to);
        if (!legal.ok) {
          return legal;
        }
        state.runs.push({
          runId: event.run_id,
          attempt: event.attempt,
          state: event.to,
          runVersion: 1,
          outcome: undefined,
          failureReason: undefined,
          restartCount: event.restart_count ?? 0,
          stageRecords: [],
        });
        return ok(state);
      }
      const run = findRun(state, event.run_id);
      if (run === undefined) {
        return err(integrityError("ILLEGAL_TRANSITION", `run ${event.run_id} does not exist`));
      }
      if (event.attempt !== run.attempt) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `run ${event.run_id} attempt ${event.attempt} does not match ${run.attempt}`,
          ),
        );
      }
      if (event.from !== run.state) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `run ${event.run_id} expected state ${run.state} but event carries ${event.from}`,
          ),
        );
      }
      if (event.expected_run_version !== run.runVersion) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `run ${event.run_id} expected version ${event.expected_run_version} does not match ${run.runVersion}`,
          ),
        );
      }
      const transitionOptions: { outcome?: RunOutcome; failureReason?: RunFailureReason } = {};
      if (event.outcome !== undefined) {
        transitionOptions.outcome = event.outcome;
      }
      if (event.failure_reason !== undefined) {
        transitionOptions.failureReason = event.failure_reason;
      }
      const legal = isLegalRunTransition(event.from, event.to, transitionOptions);
      if (!legal.ok) {
        return legal;
      }
      if (event.to === "completed") {
        if (event.outcome === undefined) {
          return err(
            integrityError("ILLEGAL_TRANSITION", "completed Run has no outcome"),
          );
        }
        const outcomeCheck = checkTerminalOutcome(run, event.outcome);
        if (!outcomeCheck.ok) {
          return outcomeCheck;
        }
      }
      run.state = event.to;
      run.runVersion += 1;
      if (event.outcome !== undefined) {
        run.outcome = event.outcome;
      }
      if (event.failure_reason !== undefined) {
        run.failureReason = event.failure_reason;
      }
      if (event.restart_count !== undefined) {
        run.restartCount = event.restart_count;
      }
      if (event.to === "completed" || event.to === "failed") {
        state.attemptsUsed += 1;
      }
      return ok(state);
    }
    case "stage_transition": {
      const run = findRun(state, event.run_id);
      if (run === undefined) {
        return err(integrityError("ILLEGAL_TRANSITION", `run ${event.run_id} does not exist`));
      }
      if (event.attempt !== run.attempt) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `run ${event.run_id} attempt ${event.attempt} does not match ${run.attempt}`,
          ),
        );
      }
      if (run.state !== "running") {
        return err(
          integrityError("ILLEGAL_TRANSITION", `stage transition requires run running, got ${run.state}`),
        );
      }
      run.stageRecords.push({
        stage: event.stage,
        from: event.from,
        to: event.to,
        reason: event.reason,
        candidateHash: event.candidate_hash,
        artifactRef: event.artifact_ref,
      });
      const check = checkStageRecords(run.stageRecords, { revisionCap: 2 });
      if (!check.ok) {
        run.stageRecords.pop();
        return check;
      }
      return ok(state);
    }
    case "artifact_sealed":
    case "broker_receipt_recorded":
    case "gate_evaluated":
    case "policy_decision":
    case "lease_event":
    case "approval_recorded":
    case "human_action":
    case "model_use":
      return ok(state);
    default: {
      const never: never = event;
      return err(
        integrityError("MALFORMED_CONTRACT", `unknown journal event type ${JSON.stringify(never)}`),
      );
    }
  }
}

/**
 * Verify a journal's sequence: contiguous from 1, with no duplicate sequence
 * numbers and no duplicate idempotency keys.
 */
export function verifyJournalSequence(
  events: readonly JournalEvent[],
): Result<true, IntegrityError> {
  const keys = new Set<string>();
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) {
      continue;
    }
    if (event.sequence !== i + 1) {
      return err(
        integrityError(
          "BAD_SEQUENCE",
          `journal sequence gap: expected ${i + 1}, got ${event.sequence}`,
          String(i + 1),
        ),
      );
    }
    if (keys.has(event.idempotency_key)) {
      return err(
        integrityError(
          "DUPLICATE_TRANSITION",
          `duplicate idempotency key ${event.idempotency_key}`,
          String(event.sequence),
        ),
      );
    }
    keys.add(event.idempotency_key);
  }
  return ok(true);
}

/**
 * Strict replay of an ordered journal into a final state. Rejects sequence
 * gaps and duplicates, then applies every event, returning the first illegal
 * transition encountered.
 */
export function reduceJournalEvents(
  events: readonly JournalEvent[],
): Result<JournalState, IntegrityError> {
  const sequence = verifyJournalSequence(events);
  if (!sequence.ok) {
    return sequence;
  }
  let state = initialJournalState();
  for (const event of events) {
    const applied = applyJournalEvent(state, event);
    if (!applied.ok) {
      return applied;
    }
    state = applied.value;
    state.seenIdempotencyKeys.add(event.idempotency_key);
    state.nextSequence = event.sequence + 1;
  }
  return ok(state);
}

function finalStageRecord(
  run: RunRecord,
  stage: StageTransition["stage"],
): StageTransition | undefined {
  for (let index = run.stageRecords.length - 1; index >= 0; index -= 1) {
    const record = run.stageRecords[index];
    if (record?.stage === stage) {
      return record;
    }
  }
  return undefined;
}

function stageEndedAs(
  run: RunRecord,
  stage: StageTransition["stage"],
  status: "completed" | "skipped",
  reason?: "symptom-cleared" | "observe-only" | "prohibited",
): boolean {
  const record = finalStageRecord(run, stage);
  return record?.to === status && (reason === undefined || record.reason === reason);
}

function checkTerminalOutcome(
  run: RunRecord,
  outcome: RunOutcome,
): Result<true, IntegrityError> {
  const detectAndDiagnoseComplete =
    stageEndedAs(run, "detect", "completed") &&
    stageEndedAs(run, "diagnose", "completed");

  if (outcome === "verified-remediation") {
    const complete =
      detectAndDiagnoseComplete &&
      stageEndedAs(run, "repair", "completed") &&
      stageEndedAs(run, "verify", "completed") &&
      stageEndedAs(run, "release", "completed") &&
      stageEndedAs(run, "watch", "completed");
    return complete
      ? ok(true)
      : err(
          integrityError(
            "ILLEGAL_TRANSITION",
            "verified-remediation requires every stage through Watch to complete",
          ),
        );
  }

  if (outcome === "symptom-cleared") {
    const coherent =
      detectAndDiagnoseComplete &&
      stageEndedAs(run, "repair", "skipped", "symptom-cleared") &&
      stageEndedAs(run, "verify", "skipped", "symptom-cleared") &&
      stageEndedAs(run, "release", "skipped", "symptom-cleared") &&
      stageEndedAs(run, "watch", "completed");
    return coherent
      ? ok(true)
      : err(
          integrityError(
            "ILLEGAL_TRANSITION",
            "symptom-cleared requires Detect and Diagnose complete, Repair through Release skipped for symptom-cleared, and Watch complete",
          ),
        );
  }

  const skipReason = outcome === "diagnosis-only" ? "observe-only" : "prohibited";
  const coherent =
    detectAndDiagnoseComplete &&
    stageEndedAs(run, "repair", "skipped", skipReason) &&
    stageEndedAs(run, "verify", "skipped", skipReason) &&
    stageEndedAs(run, "release", "skipped", skipReason) &&
    stageEndedAs(run, "watch", "skipped", skipReason);
  return coherent
    ? ok(true)
    : err(
        integrityError(
          "ILLEGAL_TRANSITION",
          `${outcome} requires Detect and Diagnose complete and Repair through Watch skipped for ${skipReason}`,
        ),
      );
}

/**
 * Apply a command (a journal event without its sequence) to the state,
 * assigning the next sequence. Replaying a command whose idempotency key has
 * already been applied is a no-op: it returns the unchanged state and a null
 * event, creating no duplicate.
 */
export function applyJournalCommand(
  state: JournalState,
  command: JournalCommand,
): Result<{ state: JournalState; event: JournalEvent | null }, IntegrityError> {
  if (state.seenIdempotencyKeys.has(command.idempotency_key)) {
    return ok({ state, event: null });
  }
  const event = { ...command, sequence: state.nextSequence } as JournalEvent;
  const applied = applyJournalEvent(state, event);
  if (!applied.ok) {
    return applied;
  }
  const next = applied.value;
  next.seenIdempotencyKeys.add(command.idempotency_key);
  next.nextSequence += 1;
  return ok({ state: next, event });
}
