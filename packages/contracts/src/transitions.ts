/**
 * Pure domain transition rules from docs/research/orchestrator-stages.md.
 *
 * Incident, Run, and stage transitions are legal only from the listed source
 * states. These functions encode the fixed rules and nothing else; they do not
 * enforce gate verdict policy, which is out of scope for this package.
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

const INCIDENT_STATES: readonly IncidentState[] = ["open", "resolved", "closed"];
const RUN_STATES: readonly RunState[] = [
  "queued",
  "running",
  "paused",
  "awaiting-human",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
];
const RUN_TERMINAL: readonly RunState[] = ["completed", "failed", "cancelled"];
const RUN_OUTCOMES: readonly RunOutcome[] = [
  "verified-remediation",
  "symptom-cleared",
  "diagnosis-only",
  "handoff",
];
const RUN_FAILURE_REASONS: readonly RunFailureReason[] = [
  "undiagnosable",
  "no-hypothesis",
  "hypothesis-invalidated",
  "no-remediation",
  "verification-failed",
  "gate-failed",
  "rollback-required",
  "unstable-worker",
  "interrupted-unrecoverable",
];
const CLOSURE_REASONS: readonly ClosureReason[] = [
  "symptom-cleared",
  "attempt-limit",
  "human-closed",
];

/** Legal Incident transitions from orchestrator-stages.md. */
const INCIDENT_TRANSITIONS: ReadonlyMap<IncidentState, readonly IncidentState[]> =
  new Map<IncidentState, readonly IncidentState[]>([
    ["open", ["open", "resolved", "closed"]],
    ["resolved", ["open", "closed"]],
    ["closed", []],
  ]);

/** Legal Run transitions from orchestrator-stages.md. */
const RUN_TRANSITIONS: ReadonlyMap<RunState, readonly RunState[]> =
  new Map<RunState, readonly RunState[]>([
    ["queued", ["running", "cancelled"]],
    ["running", ["paused", "awaiting-human", "interrupted", "completed", "failed", "cancelled"]],
    ["paused", ["running", "cancelled"]],
    ["awaiting-human", ["running", "cancelled"]],
    ["interrupted", ["running", "failed", "cancelled"]],
    ["completed", []],
    ["failed", []],
    ["cancelled", []],
  ]);

export interface TransitionOptions {
  closureReason?: ClosureReason;
  outcome?: RunOutcome;
  failureReason?: RunFailureReason;
}

/**
 * Validate an Incident transition. `from` is null when the Incident is being
 * created. A transition into `closed` requires a closure reason.
 */
export function isLegalIncidentTransition(
  from: IncidentState | null,
  to: IncidentState,
  options: TransitionOptions = {},
): Result<true, IntegrityError> {
  if (from === null) {
    return to === "open"
      ? ok(true)
      : err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `incident cannot be created in state ${JSON.stringify(to)}`,
          ),
        );
  }
  const allowed = INCIDENT_TRANSITIONS.get(from);
  if (allowed === undefined || !allowed.includes(to)) {
    return err(
      integrityError(
        "ILLEGAL_TRANSITION",
        `illegal incident transition ${from} -> ${to}`,
      ),
    );
  }
  if (to === "closed") {
    if (options.closureReason === undefined || !CLOSURE_REASONS.includes(options.closureReason)) {
      return err(
        integrityError(
          "ILLEGAL_TRANSITION",
          `incident transition to closed requires a closure reason`,
        ),
      );
    }
  }
  return ok(true);
}

/**
 * Validate a Run transition. `from` is null when the Run is being created
 * (queued). A transition into `completed` requires an outcome; into `failed`
 * requires a failure reason.
 */
export function isLegalRunTransition(
  from: RunState | null,
  to: RunState,
  options: TransitionOptions = {},
): Result<true, IntegrityError> {
  if (from === null) {
    return to === "queued"
      ? ok(true)
      : err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `run cannot be created in state ${JSON.stringify(to)}`,
          ),
        );
  }
  const allowed = RUN_TRANSITIONS.get(from);
  if (allowed === undefined || !allowed.includes(to)) {
    return err(
      integrityError(
        "ILLEGAL_TRANSITION",
        `illegal run transition ${from} -> ${to}`,
      ),
    );
  }
  if (to === "completed") {
    if (options.outcome === undefined || !RUN_OUTCOMES.includes(options.outcome)) {
      return err(
        integrityError("ILLEGAL_TRANSITION", "run transition to completed requires an outcome"),
      );
    }
  }
  if (to === "failed") {
    if (options.failureReason === undefined || !RUN_FAILURE_REASONS.includes(options.failureReason)) {
      return err(
        integrityError(
          "ILLEGAL_TRANSITION",
          "run transition to failed requires a failure reason",
        ),
      );
    }
  }
  return ok(true);
}

/** The fixed stage order. */
export const STAGE_ORDER = ["detect", "diagnose", "repair", "verify", "release", "watch"] as const;
/** A stage name in the fixed order. */
export type StageName = (typeof STAGE_ORDER)[number];

/** A stage status. */
export type StageStatus = "entered" | "in-progress" | "completed" | "failed" | "skipped";

/** Stages that may be skipped, with the reasons that permit skipping. */
export const SKIPPABLE_REASONS: readonly string[] = [
  "symptom-cleared",
  "observe-only",
  "prohibited",
];

/** A stage transition event as recorded in the journal. */
export interface StageTransition {
  stage: StageName;
  from: StageStatus | null;
  to: StageStatus;
  reason: string | undefined;
  candidateHash: string | undefined;
  artifactRef: { schema_id: string; schema_version: string; content_hash: string } | undefined;
}

/** Validate a within-stage status change. `from` is null when entering. */
export function isLegalStageStatusChange(
  from: StageStatus | null,
  to: StageStatus,
): boolean {
  if (to === "skipped") {
    return false; // skipping is not a status change; handled separately.
  }
  if (from === null) {
    return to === "entered";
  }
  if (from === "entered") {
    return to === "in-progress";
  }
  if (from === "in-progress") {
    return to === "completed" || to === "failed";
  }
  return false;
}

/** Result of a stage-sequence check. */
export interface StageCheckResult {
  /** Number of Repair-to-Verify revision loops observed. */
  revisions: number;
  /** Every candidate hash sealed so far, in seal order. */
  candidateHashes: string[];
  /** The final stage that was reached, if any. */
  finalStage: StageName | null;
}

interface VisitState {
  status: StageStatus | null;
  skipReason: string | null;
}

/**
 * Validate the full stage sequence of one Run against the fixed order, the
 * skip rules, and the bounded Repair-to-Verify revision loop.
 *
 * Detect and Diagnose are never skipped. Repair, Verify, and Release may be
 * skipped for `symptom-cleared`, `observe-only`, or `prohibited`; Watch may be
 * skipped only for `observe-only` or `prohibited`. The only backward move is
 * Verify (failed) back to Repair with a new candidate hash, bounded by the
 * revision cap.
 */
export function checkStageRecords(
  records: readonly StageTransition[],
  options: { revisionCap?: number } = {},
): Result<StageCheckResult, IntegrityError> {
  const revisionCap = options.revisionCap ?? 2;
  let index = -1;
  let revisions = 0;
  const finalStatus = new Map<StageName, VisitState>();
  const candidateHashes: string[] = [];
  let lastFailedStage: StageName | null = null;
  let finalStage: StageName | null = null;
  let skipReason: string | null = null;

  for (const record of records) {
    const stageIndex = STAGE_ORDER.indexOf(record.stage);
    const isSkip = record.to === "skipped";

    if (isSkip) {
      const reason = record.reason ?? "";
      if (!SKIPPABLE_REASONS.includes(reason)) {
        return err(
          integrityError("ILLEGAL_TRANSITION", `stage ${record.stage} skipped without a valid reason`),
        );
      }
      if (record.stage === "detect" || record.stage === "diagnose") {
        return err(
          integrityError("ILLEGAL_TRANSITION", `stage ${record.stage} can never be skipped`),
        );
      }
      if (record.stage === "watch" && !["observe-only", "prohibited"].includes(reason)) {
        return err(
          integrityError("ILLEGAL_TRANSITION", "watch can only be skipped for observe-only or prohibited"),
        );
      }
      if (stageIndex !== index + 1) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            "skipped stages must follow the fixed stage order",
          ),
        );
      }
      const priorVisit = finalStatus.get(record.stage);
      const expectedFrom = priorVisit?.status ?? null;
      if (record.from !== expectedFrom) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `stage ${record.stage} expected source ${String(expectedFrom)}, got ${String(record.from)}`,
          ),
        );
      }
      const previousStage = STAGE_ORDER[index];
      const previous = previousStage === undefined ? undefined : finalStatus.get(previousStage);
      if (previous !== undefined && previous.status !== "completed" && previous.status !== "skipped") {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `stage ${record.stage} cannot start before ${previousStage} finishes`,
          ),
        );
      }
      if (skipReason !== null && skipReason !== reason) {
        return err(
          integrityError("ILLEGAL_TRANSITION", "consecutive skipped stages must use one reason"),
        );
      }
      skipReason = reason;
      index = stageIndex;
      finalStatus.set(record.stage, { status: "skipped", skipReason: reason });
      finalStage = record.stage;
      continue;
    }

    if (stageIndex < index) {
      // Backward move: only Verify -> Repair with a new candidate hash.
      if (
        record.stage !== "repair" ||
        lastFailedStage !== "verify" ||
        record.to !== "entered"
      ) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            "the only backward move is Verify(failed) -> Repair(entered)",
          ),
        );
      }
      const priorRepair = finalStatus.get("repair");
      if (priorRepair === undefined || record.from !== priorRepair.status) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `Repair revision expected source ${String(priorRepair?.status ?? null)}, got ${String(record.from)}`,
          ),
        );
      }
      if (record.candidateHash === undefined) {
        return err(
          integrityError("ILLEGAL_TRANSITION", "Repair revision requires a new candidate hash"),
        );
      }
      if (candidateHashes.includes(record.candidateHash)) {
        return err(
          integrityError("ILLEGAL_TRANSITION", "Repair revision candidate hash must be new"),
        );
      }
      revisions += 1;
      if (revisions > revisionCap) {
        return err(
          integrityError("ILLEGAL_TRANSITION", `revision cap of ${revisionCap} exceeded`),
        );
      }
      candidateHashes.push(record.candidateHash);
      // Start a fresh visit for repair and clear the stale verify visit.
      finalStatus.set(record.stage, { status: "entered", skipReason: null });
      lastFailedStage = null;
      skipReason = null;
      index = stageIndex;
      finalStage = record.stage;
      continue;
    }

    if (stageIndex > index + 1) {
      return err(
        integrityError(
          "ILLEGAL_TRANSITION",
          `stage ${record.stage} started before its predecessors finished`,
        ),
      );
    }

    if (stageIndex === index + 1) {
      if (record.to !== "entered") {
        return err(
          integrityError("ILLEGAL_TRANSITION", "a stage must enter before progressing"),
        );
      }
      const previousStage = STAGE_ORDER[index];
      const previous = previousStage === undefined ? undefined : finalStatus.get(previousStage);
      if (previous !== undefined && previous.status !== "completed" && previous.status !== "skipped") {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `stage ${record.stage} cannot start before ${previousStage} finishes`,
          ),
        );
      }
      if (
        skipReason !== null &&
        !(skipReason === "symptom-cleared" && record.stage === "watch")
      ) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `stage ${record.stage} must be skipped after ${skipReason}`,
          ),
        );
      }
      const priorVisit = finalStatus.get(record.stage);
      const expectedFrom = priorVisit?.status ?? null;
      if (record.from !== expectedFrom) {
        return err(
          integrityError(
            "ILLEGAL_TRANSITION",
            `stage ${record.stage} expected source ${String(expectedFrom)}, got ${String(record.from)}`,
          ),
        );
      }
      if (record.candidateHash !== undefined) {
        candidateHashes.push(record.candidateHash);
      }
      index = stageIndex;
      finalStatus.set(record.stage, { status: "entered", skipReason: null });
      skipReason = null;
      finalStage = record.stage;
      continue;
    }

    // Same stage: validate the status change within the current visit.
    const visit = finalStatus.get(record.stage);
    if (visit === undefined) {
      return err(integrityError("ILLEGAL_TRANSITION", "stage has no prior entry"));
    }
    if (record.from !== visit.status) {
      return err(
        integrityError(
          "ILLEGAL_TRANSITION",
          `stage ${record.stage} expected source ${String(visit.status)}, got ${String(record.from)}`,
        ),
      );
    }
    if (!isLegalStageStatusChange(visit.status, record.to)) {
      return err(
        integrityError(
          "ILLEGAL_TRANSITION",
          `illegal stage status change ${String(visit.status)} -> ${record.to} for ${record.stage}`,
        ),
      );
    }
    if (record.candidateHash !== undefined) {
      candidateHashes.push(record.candidateHash);
    }
    visit.status = record.to;
    if (record.to === "failed") {
      lastFailedStage = record.stage;
    } else {
      lastFailedStage = null;
    }
    finalStage = record.stage;
  }

  return ok({ revisions, candidateHashes, finalStage });
}

/** True when a Run state is terminal. */
export function isRunTerminal(state: RunState): boolean {
  return RUN_TERMINAL.includes(state);
}

/** The full list of Run states, for table tests and exhaustiveness checks. */
export function allRunStates(): readonly RunState[] {
  return RUN_STATES;
}

/** The full list of Incident states. */
export function allIncidentStates(): readonly IncidentState[] {
  return INCIDENT_STATES;
}
