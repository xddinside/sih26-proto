/**
 * The Control Plane: the sole durable state writer. It receives Incident
 * Triggers, starts Incident Runs, enforces policy, records state, and serves
 * the read APIs. All state writes flow through the `@sih/contracts` journal
 * reducer, which enforces transition legality, expected versions, stage
 * order, and the bounded Repair-to-Verify revision loop.
 */
import { isRunTerminal, STAGE_ORDER } from "@sih/contracts/transitions"
import type { StageName } from "@sih/contracts/transitions"
import type {
  BrokerReceipt,
  GateEvaluation,
  IncidentTrigger,
  JournalEvent,
  RemediationProposal,
  OrchestratorLifecycleState,
  OrchestratorStage,
  OrchestratorStageState,
  OrchestratorWorkBudget,
  OrchestratorWorkAdmission,
  OrchestratorWorkRequest,
  OrchestratorWorkResult,
} from "@sih/contracts/types"

import type { ArtifactService, SealInput } from "../artifacts/artifact-service.js"
import type { Clock } from "../clock.js"
import { addSeconds } from "../clock.js"
import type { Config } from "../config.js"
import type { LeaseService, LeaseClaims } from "../leases/lease-service.js"
import { ERR, err, ok } from "../result.js"
import type { DomainError, Result } from "../result.js"
import type { PolicyRow, Store } from "../store/store.js"
import type { JournalService } from "./journal-service.js"
import * as cmd from "./journal-commands.js"
import type { Actor, ArtifactRef } from "./journal-commands.js"
import {
  decidePolicyAction,
  policyVersionFor,
  resolveActionRiskClass,
  toPolicyVersion,
} from "./policy.js"
import type {
  ActionRiskClass,
  PolicyDecision,
  PolicyDraft,
  PolicyVersion,
  TypedAction,
} from "./policy.js"
import {
  DIRECT_ACTION_RECORD_SCHEMA_ID,
  RELEASE_RECORD_SCHEMA_ID,
} from "./release-types.js"
import { evaluateActionGate } from "../gates/action-gate.js"
import { evaluateHypothesisGate, evaluateHypotheses } from "../gates/hypothesis-gate.js"
import type { HypothesisGateInput } from "../gates/hypothesis-gate.js"
import { evaluateReleaseGate } from "../gates/release-gate.js"
import type { ApprovalState, RecoveryPointCoverage } from "../gates/release-gate.js"
import { resolveApplicability } from "../verify/resolver.js"
import type { ResolverInput } from "../verify/resolver.js"
import { computeVerdict } from "../verify/verdict.js"
import type {
  reviewInputFromReport,
  testInputFromReport,
  VerdictResult,
} from "../verify/verdict.js"

const CONTROL_PLANE_ACTOR: Actor = { id: "cp-1", kind: "control-plane" }
const STAGE_ARTIFACT: ReadonlyMap<StageName, string[]> = new Map([
  ["detect", ["incident-brief"]],
  ["diagnose", ["diagnosis-report"]],
  ["repair", ["remediation-proposal"]],
  ["verify", ["verification-report"]],
  ["release", [RELEASE_RECORD_SCHEMA_ID, DIRECT_ACTION_RECORD_SCHEMA_ID]],
  ["watch", ["watch-report"]],
])

const SAFE_AUTOQUEUE_FAILURES: ReadonlySet<string> = new Set([
  "undiagnosable",
  "no-hypothesis",
  "no-remediation",
  "verification-failed",
  "hypothesis-invalidated",
  "gate-failed",
])

const ORCHESTRATOR_RUN_WALL_CLOCK_MS = 120 * 60 * 1000
const ORCHESTRATOR_MAX_MODEL_TURNS = 20
const ORCHESTRATOR_MAX_NON_TERMINAL_TOOL_CALLS = 32
const ORCHESTRATOR_MAX_SESSION_WALL_CLOCK_MS = 12 * 60 * 1000

export interface IntakeResult {
  incidentId: string
  deliveryResult: "incident-created" | "evidence-appended" | "duplicate-noop"
  incidentState: string
}

export interface SealResult {
  artifactRef: ArtifactRef
}

export interface GateRunResult {
  verdict: string
  evaluation: GateEvaluation
  permit: { permitId: string; token: string } | null
}

export class ControlPlane {
  private readonly policyCache = new Map<string, string>()
  private readonly related = new Map<string, string[]>()
  /** Admission validation and its journal append must be one serialized
   * operation so concurrent Orchestrator requests cannot both reserve the
   * same remaining budget from a stale projection. */
  private readonly orchestratorAdmissionChains = new Map<string, Promise<void>>()
  private readonly cancelledOrchestratorRuns = new Set<string>()

  constructor(
    readonly store: Store,
    readonly journal: JournalService,
    readonly artifacts: ArtifactService,
    readonly leases: LeaseService,
    readonly clock: Clock,
    readonly config: Config,
  ) {}

  // ------------------------------------------------------------------
  // Policy

  async currentPolicyVersion(incidentId: string): Promise<string> {
    const cached = this.policyCache.get(incidentId)
    if (cached !== undefined) {
      return cached
    }
    const latest = await this.store.latestPolicy(incidentId)
    if (latest === null) {
      throw new Error(`no policy for incident ${incidentId}`)
    }
    this.policyCache.set(incidentId, latest.version)
    return latest.version
  }

  async getPolicy(incidentId: string): Promise<PolicyVersion> {
    const row = await this.store.getPolicy(await this.currentPolicyVersion(incidentId))
    if (row === null) {
      throw new Error(`policy row missing for ${incidentId}`)
    }
    return toPolicyVersion(row)
  }

  private async createPolicy(incidentId: string, draft: PolicyDraft): Promise<string> {
    const version = policyVersionFor(draft, incidentId)
    const row: PolicyRow = {
      version,
      incident_id: incidentId,
      authority_mode: draft.authority_mode,
      automation_policy: draft.automation_policy,
      schedule: (draft.schedule as unknown as Record<string, unknown>) ?? null,
      emergency_override: draft.emergency_override,
      attempt_limit: draft.attempt_limit,
      created_at: this.clock.nowIso(),
    }
    await this.store.insertPolicy(row)
    this.policyCache.set(incidentId, version)
    return version
  }

  private defaultPolicyDraft(): PolicyDraft {
    return {
      authority_mode: "repair",
      automation_policy: "autonomous-always",
      schedule: null,
      emergency_override: false,
      attempt_limit: this.config.attemptLimitDefault,
    }
  }

  // ------------------------------------------------------------------
  // Intake

  async handleTrigger(trigger: IncidentTrigger, draft?: PolicyDraft): Promise<Result<IntakeResult, DomainError>> {
    // Dedup by delivery_key before any state write.
    const existingByKey = await this.store.findIncidentByKey(trigger.incident_key)
    const openIncident = existingByKey.find((row) => row.state !== "closed")

    let incidentId: string
    if (trigger.state === "firing" && openIncident === undefined && existingByKey.length > 0) {
      // A firing after `closed` creates a new Incident with a related link.
      incidentId = this.newIncidentId(trigger)
      this.related.set(incidentId, existingByKey.map((row) => row.incident_id))
    } else if (openIncident !== undefined) {
      incidentId = openIncident.incident_id
    } else {
      incidentId = this.newIncidentId(trigger)
    }

    const claimed = await this.store.claimDeliveryKey(trigger.delivery_key, incidentId)
    if (!claimed) {
      return ok({ incidentId, deliveryResult: "duplicate-noop", incidentState: "noop" })
    }

    const created = openIncident === undefined && (trigger.state === "firing" || existingByKey.length === 0)
    const policyVersion = await this.ensurePolicy(incidentId, draft, created)

    const state = this.journal.state(incidentId)
    const recordedAt = this.clock.nowIso()

    if (created) {
      const openCmd = cmd.incidentTransitionCommand(
        incidentId, null, "open", 0, undefined, policyVersion, recordedAt,
        `incident-open:${incidentId}`, CONTROL_PLANE_ACTOR,
      )
      const triggerCmd = cmd.triggerReceivedCommand(
        incidentId, trigger, "incident-created", policyVersion, recordedAt,
      )
      const appliedTrigger = await this.journal.apply(incidentId, triggerCmd)
      if (appliedTrigger.kind === "error") return err(appliedTrigger.error)
      const appliedOpen = await this.journal.apply(incidentId, openCmd)
      if (appliedOpen.kind === "error") return err(appliedOpen.error)
      const run = await this.createRun(incidentId, policyVersion, recordedAt, 1)
      if (!run.ok) return run
      await this.refreshIndex(incidentId, trigger)
      return ok({ incidentId, deliveryResult: "incident-created", incidentState: "open" })
    }

    // Resolved trigger on a resolved incident restarts the confirmation window;
    // a firing trigger on a resolved incident reopens it.
    if (openIncident !== undefined && trigger.state === "firing" && openIncident.state === "resolved") {
      const version = state?.incidentVersion ?? 0
      const reopenCmd = cmd.incidentTransitionCommand(
        incidentId, "resolved", "open", version, undefined, policyVersion, recordedAt,
        `incident-reopen:${incidentId}:${trigger.delivery_key}`,
      )
      const applied = await this.journal.apply(incidentId, reopenCmd)
      if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    }

    const triggerCmd = cmd.triggerReceivedCommand(
      incidentId, trigger, "evidence-appended", policyVersion, recordedAt,
    )
    const applied = await this.journal.apply(incidentId, triggerCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    await this.refreshIndex(incidentId, trigger)
    return ok({ incidentId, deliveryResult: "evidence-appended", incidentState: openIncident?.state ?? "open" })
  }

  private async ensurePolicy(incidentId: string, draft: PolicyDraft | undefined, created: boolean): Promise<string> {
    const existing = await this.store.latestPolicy(incidentId)
    if (existing !== null) {
      this.policyCache.set(incidentId, existing.version)
      return existing.version
    }
    return this.createPolicy(incidentId, draft ?? this.defaultPolicyDraft())
  }

  private newIncidentId(trigger: IncidentTrigger): string {
    const key = trigger.incident_key.replace(/^sha256:/, "").slice(0, 12)
    const nonce = Date.now().toString(36)
    return `inc-${key}-${nonce}`
  }

  private async createRun(
    incidentId: string,
    policyVersion: string,
    recordedAt: string,
    attempt: number,
  ): Promise<Result<string, DomainError>> {
    const runId = `run-${attempt}`
    const cmdRun = cmd.runTransitionCommand(
      incidentId, runId, attempt, null, "queued", 0, policyVersion, recordedAt,
      `run-create:${incidentId}:${attempt}`, {},
    )
    const applied = await this.journal.apply(incidentId, cmdRun)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    return ok(runId)
  }

  // ------------------------------------------------------------------
  // Run start / lease issuance

  async startRun(incidentId: string, runId: string): Promise<Result<{ leaseId: string; token: string }, DomainError>> {
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === runId)
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    if (run.state !== "queued") return err({ code: ERR.ILLEGAL_TRANSITION, message: "run is not queued" })
    this.cancelledOrchestratorRuns.delete(`${incidentId}:${runId}`)
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const policy = await this.getPolicy(incidentId)
    const issued = await this.leases.issueRunLease({
      incidentId,
      runId,
      attempt: run.attempt,
      stage: "detect",
      actorId: `orchestrator-${runId}`,
      actorKind: "orchestrator",
      authorityMode: policy.authorityMode,
      policyVersion,
      toolClass: "detect",
    })
    const recordedAt = this.clock.nowIso()
    const runningCmd = cmd.runTransitionCommand(
      incidentId, runId, run.attempt, "queued", "running", run.runVersion, policyVersion, recordedAt,
      `run-start:${incidentId}:${runId}`,
    )
    const applied = await this.journal.apply(incidentId, runningCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    const leaseCmd = cmd.leaseEventCommand(
      incidentId, runId, issued.leaseId, "run", "issued", policyVersion, recordedAt,
      `lease-issued:${issued.leaseId}`, { stage: "detect" },
    )
    await this.journal.apply(incidentId, leaseCmd)
    await this.refreshIndexFromJournal(incidentId)
    return ok({ leaseId: issued.leaseId, token: issued.token })
  }

  // ------------------------------------------------------------------
  // Pi Orchestrator work boundary

  /**
   * Return the concise lifecycle projection exposed to a Pi Orchestrator.
   * Scratchpad contents, model transcripts, and hidden reasoning are not part
   * of this projection; only Control Plane state and sealed artifact refs are
   * returned.
   */
  async inspectOrchestratorState(
    incidentId: string,
    token: string,
    claims: LeaseClaims,
  ): Promise<Result<OrchestratorLifecycleState, DomainError>> {
    if (incidentId !== claims.incidentId) {
      return err({ code: ERR.UNAUTHORIZED, message: "lease is bound to a different Incident" })
    }
    await this.journal.ensureLoaded(incidentId)
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    const verified = await this.leases.verifyRunLease(token, claims, run?.state ?? null)
    if (!verified.ok) return verified
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    return ok(this.orchestratorState(incidentId, run))
  }

  /**
   * Admit a bounded unit of work. This is intentionally a proposal API: it
   * records the admission decision but cannot transition a stage, seal an
   * artifact, mint a lease or permit, change a budget, or complete a run.
   */
  async requestOrchestratorWork(
    incidentId: string,
    token: string,
    claims: LeaseClaims,
    request: OrchestratorWorkRequest,
  ): Promise<Result<OrchestratorWorkResult, DomainError>> {
    return this.withOrchestratorAdmissionLock(incidentId, () =>
      this.requestOrchestratorWorkUnlocked(incidentId, token, claims, request),
    )
  }

  private async requestOrchestratorWorkUnlocked(
    incidentId: string,
    token: string,
    claims: LeaseClaims,
    request: OrchestratorWorkRequest,
  ): Promise<Result<OrchestratorWorkResult, DomainError>> {
    if (this.cancelledOrchestratorRuns.has(`${incidentId}:${claims.runId}`)) {
      return err({ code: ERR.REVOKED_LEASE, message: "Orchestrator scheduling was cancelled for this run" })
    }
    if (incidentId !== claims.incidentId) {
      return err({ code: ERR.UNAUTHORIZED, message: "lease is bound to a different Incident" })
    }
    await this.journal.ensureLoaded(incidentId)
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    const verified = await this.leases.verifyRunLease(token, claims, run?.state ?? null)
    if (!verified.ok) return verified
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })

    const existing = this.journal.events(incidentId).find(
      (event) => event.type === "work_requested" &&
        event.run_id === claims.runId &&
        (event.request_id === request.request_id || event.work_id === request.work_id),
    )
    if (existing !== undefined) {
      return err({ code: ERR.DUPLICATE_WORK, message: `work request ${request.request_id} was already recorded` })
    }

    const invalid = this.validateWorkRequest(request, claims, run)
    if (invalid !== null) {
      const recorded = await this.recordWorkRequest(incidentId, claims, request, "rejected", invalid)
      if (!recorded.ok) return err(recorded.error)
      return ok({
        status: "rejected",
        request_id: request.request_id,
        work_id: request.work_id,
        code: invalid.code,
        reason: invalid.message,
      })
    }

    const lifecycle = this.orchestratorState(incidentId, run)
    const admittedArtifacts = this.admittedArtifactsForStage(run, request.stage)
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const applied = await this.journal.apply(
      incidentId,
      cmd.workRequestedCommand(
        incidentId,
        claims.runId,
        request,
        "admitted",
        policyVersion,
        recordedAt,
        { admittedArtifactRefs: admittedArtifacts, actorId: claims.actorId },
      ),
    )
    if (applied.kind !== "applied") {
      return err(applied.kind === "error"
        ? applied.error
        : { code: ERR.DUPLICATE_WORK, message: "work request was already recorded" })
    }
    return ok({
      status: "admitted",
      request_id: request.request_id,
      work_id: request.work_id,
      stage: request.stage,
      admitted_artifacts: admittedArtifacts,
      budgets: lifecycle.budgets,
    } satisfies OrchestratorWorkAdmission)
  }

  /** Complete an admitted work unit only after its output artifacts have
   * already been sealed through the normal Control Plane artifact boundary.
   * This is a Worker-side operation; the Pi Orchestrator has no completion
   * tool and therefore cannot self-certify work. */
  async completeOrchestratorWork(
    incidentId: string,
    token: string,
    claims: LeaseClaims,
    workId: string,
    artifactRefs: ArtifactRef[],
  ): Promise<Result<true, DomainError>> {
    if (incidentId !== claims.incidentId) {
      return err({ code: ERR.UNAUTHORIZED, message: "lease is bound to a different Incident" })
    }
    await this.journal.ensureLoaded(incidentId)
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    const verified = await this.leases.verifyRunLease(token, claims, run?.state ?? null)
    if (!verified.ok) return verified
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    const admitted = this.journal.events(incidentId).find(
      (event): event is Extract<JournalEvent, { type: "work_requested" }> =>
        event.type === "work_requested" && event.run_id === claims.runId && event.work_id === workId && event.status === "admitted",
    )
    if (admitted === undefined) return err({ code: ERR.NOT_FOUND, message: `admitted work ${workId} was not found` })
    if (admitted.attempt !== run.attempt) return err({ code: ERR.STALE_ATTEMPT, message: `work ${workId} belongs to a stale attempt` })
    const alreadyCompleted = this.journal.events(incidentId).some(
      (event) => event.type === "work_completed" && event.run_id === claims.runId && event.work_id === workId,
    )
    if (alreadyCompleted) return err({ code: ERR.DUPLICATE_WORK, message: `work ${workId} was already completed` })
    const expectedSchemas = STAGE_ARTIFACT.get(admitted.stage as StageName) ?? []
    if (artifactRefs.length === 0 || artifactRefs.some((reference) =>
      !expectedSchemas.includes(reference.schema_id) ||
      !this.sealedArtifacts(incidentId, claims.runId).some((sealed) =>
        sealed.artifactRef.schema_id === reference.schema_id &&
        sealed.artifactRef.schema_version === reference.schema_version &&
        sealed.artifactRef.content_hash === reference.content_hash,
      ))) {
      return err({ code: ERR.PREREQUISITE_MISSING, message: "work completion requires sealed output artifacts" })
    }
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const applied = await this.journal.apply(
      incidentId,
      cmd.workCompletedCommand(incidentId, claims.runId, run.attempt, workId, artifactRefs, policyVersion, this.clock.nowIso(), claims.actorId),
    )
    if (applied.kind === "error") return err(applied.error)
    if (applied.kind !== "applied") return err({ code: ERR.DUPLICATE_WORK, message: `work ${workId} was already completed` })
    return ok(true)
  }

  /** Cancellation boundary for the orchestrator's dependent work. The
   * Control Plane revokes active leases and permits; the model never gets a
   * tool for doing either operation itself. */
  async revokeOrchestratorWork(incidentId: string, runId: string): Promise<void> {
    this.cancelledOrchestratorRuns.add(`${incidentId}:${runId}`)
    await this.leases.revokeRunLeases(incidentId, runId)
    await this.store.revokePermits(incidentId, runId)
  }

  private validateWorkRequest(
    request: OrchestratorWorkRequest,
    claims: LeaseClaims,
    run: { attempt: number; state: string; stageRecords: Array<{ stage: string; to: string; artifactRef?: ArtifactRef }> },
  ): DomainError | null {
    if (request.attempt !== run.attempt) {
      return { code: ERR.STALE_ATTEMPT, message: `request attempt ${request.attempt} does not match run attempt ${run.attempt}` }
    }
    if (request.stage !== claims.stage) {
      return { code: ERR.WRONG_STAGE, message: `request stage ${request.stage} does not match lease stage ${claims.stage}` }
    }
    const currentStage = this.currentStage(run)
    if (currentStage !== request.stage) {
      return { code: ERR.WRONG_STAGE, message: `run is currently at ${currentStage ?? "no active stage"}, not ${request.stage}` }
    }
    const stageIndex = STAGE_ORDER.indexOf(request.stage)
    if (stageIndex < 0) {
      return { code: ERR.INVALID_REQUEST, message: `unknown orchestrator stage ${request.stage}` }
    }
    for (const prerequisite of STAGE_ORDER.slice(0, stageIndex)) {
      const last = this.lastStageRecord(run, prerequisite)
      if (last?.to !== "completed") {
        return { code: ERR.PREREQUISITE_MISSING, message: `stage ${request.stage} requires completed ${prerequisite}` }
      }
    }
    const completedWorkIds = new Set(
      this.journal.events(claims.incidentId)
        .filter((event): event is Extract<JournalEvent, { type: "work_completed" }> =>
          event.type === "work_completed" && event.run_id === claims.runId)
        .map((event) => event.work_id),
    )
    const missingDependency = request.depends_on.find((workId) => !completedWorkIds.has(workId))
    if (missingDependency !== undefined) {
      return { code: ERR.PREREQUISITE_MISSING, message: `work dependency ${missingDependency} has not completed with sealed artifacts` }
    }
    const reserved = this.admittedBudgetUsage(claims.incidentId, claims.runId)
    if (
      request.budget.model_turns < 1 || request.budget.model_turns > ORCHESTRATOR_MAX_MODEL_TURNS ||
      request.budget.non_terminal_tool_calls < 1 || request.budget.non_terminal_tool_calls > ORCHESTRATOR_MAX_NON_TERMINAL_TOOL_CALLS ||
      request.budget.session_wall_clock_ms < 1 || request.budget.session_wall_clock_ms > ORCHESTRATOR_MAX_SESSION_WALL_CLOCK_MS ||
      request.budget.run_wall_clock_ms < 1 || request.budget.run_wall_clock_ms > ORCHESTRATOR_RUN_WALL_CLOCK_MS ||
      request.budget.model_turns > ORCHESTRATOR_MAX_MODEL_TURNS - reserved.model_turns ||
      request.budget.non_terminal_tool_calls > ORCHESTRATOR_MAX_NON_TERMINAL_TOOL_CALLS - reserved.non_terminal_tool_calls ||
      request.budget.session_wall_clock_ms > ORCHESTRATOR_MAX_SESSION_WALL_CLOCK_MS - reserved.session_wall_clock_ms
    ) {
      return { code: ERR.BUDGET_EXCEEDED, message: "requested work exceeds the bounded Orchestrator budget" }
    }
    const runStartedAt = this.runStartedAt(claims.incidentId, claims.runId)
    const elapsed = Math.max(0, this.clock.now().getTime() - runStartedAt)
    const availableRunWallClock = ORCHESTRATOR_RUN_WALL_CLOCK_MS - elapsed - reserved.run_wall_clock_ms
    if (
      elapsed >= ORCHESTRATOR_RUN_WALL_CLOCK_MS ||
      request.budget.run_wall_clock_ms > availableRunWallClock
    ) {
      return { code: ERR.BUDGET_EXCEEDED, message: "the 120-minute run wall-clock budget is exhausted" }
    }
    return null
  }

  private async recordWorkRequest(
    incidentId: string,
    claims: LeaseClaims,
    request: OrchestratorWorkRequest,
    status: "admitted" | "rejected",
    failure: DomainError,
  ): Promise<Result<true, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const applied = await this.journal.apply(
      incidentId,
      cmd.workRequestedCommand(
        incidentId,
        claims.runId,
        request,
        status,
        policyVersion,
        this.clock.nowIso(),
        { code: failure.code, reason: failure.message, actorId: claims.actorId },
      ),
    )
    if (applied.kind === "error") return err(applied.error)
    if (applied.kind !== "applied") {
      return err({ code: ERR.DUPLICATE_WORK, message: "work request rejection was already recorded" })
    }
    return ok(true)
  }

  private async withOrchestratorAdmissionLock<T>(
    incidentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.orchestratorAdmissionChains.get(incidentId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = previous.then(() => current)
    this.orchestratorAdmissionChains.set(incidentId, chain)
    try {
      await previous
      return await operation()
    } finally {
      release()
      if (this.orchestratorAdmissionChains.get(incidentId) === chain) {
        this.orchestratorAdmissionChains.delete(incidentId)
      }
    }
  }

  private orchestratorState(
    incidentId: string,
    run: { runId: string; attempt: number; state: string; stageRecords: Array<{ stage: string; to: string; artifactRef?: ArtifactRef }> },
  ): OrchestratorLifecycleState {
    const events = this.journal.events(incidentId)
    const stages: OrchestratorStageState[] = []
    for (const stage of STAGE_ORDER) {
      const last = this.lastStageRecord(run, stage)
      if (last === undefined) continue
      stages.push({
        stage,
        status: last.to as OrchestratorStageState["status"],
        ...(last.artifactRef === undefined ? {} : { artifact_ref: last.artifactRef }),
      })
    }
    const admittedWorkIds = events
      .filter((event): event is Extract<JournalEvent, { type: "work_requested" }> =>
        event.type === "work_requested" && event.run_id === run.runId && event.status === "admitted")
      .map((event) => event.work_id)
    const admittedArtifacts = events
      .filter((event): event is Extract<JournalEvent, { type: "work_requested" }> =>
        event.type === "work_requested" && event.run_id === run.runId && event.status === "admitted")
      .flatMap((event) => event.admitted_artifact_refs)
      .concat(events
        .filter((event): event is Extract<JournalEvent, { type: "work_completed" }> =>
          event.type === "work_completed" && event.run_id === run.runId)
        .flatMap((event) => event.artifact_refs))
      .filter((artifact, index, all) => all.findIndex((candidate) => candidate.content_hash === artifact.content_hash) === index)
    const reserved = this.admittedBudgetUsage(incidentId, run.runId)
    const elapsed = Math.max(0, this.clock.now().getTime() - this.runStartedAt(incidentId, run.runId))
    return {
      incident_id: incidentId,
      run_id: run.runId,
      attempt: run.attempt,
      run_state: run.state,
      current_stage: this.currentStage(run) as OrchestratorStage | null,
      stages,
      admitted_work_ids: admittedWorkIds,
      admitted_artifacts: admittedArtifacts,
      budgets: {
        run_wall_clock_ms: ORCHESTRATOR_RUN_WALL_CLOCK_MS,
        elapsed_ms: elapsed,
        remaining_ms: Math.max(0, ORCHESTRATOR_RUN_WALL_CLOCK_MS - elapsed),
        reserved_model_turns: reserved.model_turns,
        reserved_non_terminal_tool_calls: reserved.non_terminal_tool_calls,
        reserved_session_wall_clock_ms: reserved.session_wall_clock_ms,
        reserved_run_wall_clock_ms: reserved.run_wall_clock_ms,
      },
    }
  }

  /** Sum active durable reservations before admitting another work unit. */
  private admittedBudgetUsage(incidentId: string, runId: string): OrchestratorWorkBudget {
    const usage: OrchestratorWorkBudget = {
      model_turns: 0,
      non_terminal_tool_calls: 0,
      session_wall_clock_ms: 0,
      run_wall_clock_ms: 0,
    }
    const events = this.journal.events(incidentId)
    const completedWorkIds = new Set<string>()
    for (const event of events) {
      if (event.type === "work_completed" && event.run_id === runId) {
        completedWorkIds.add(event.work_id)
      }
    }
    for (const event of events) {
      if (
        event.type !== "work_requested" ||
        event.run_id !== runId ||
        event.status !== "admitted" ||
        completedWorkIds.has(event.work_id)
      ) continue
      usage.model_turns += event.budget.model_turns
      usage.non_terminal_tool_calls += event.budget.non_terminal_tool_calls
      usage.session_wall_clock_ms += event.budget.session_wall_clock_ms
      usage.run_wall_clock_ms += event.budget.run_wall_clock_ms
    }
    return usage
  }

  private currentStage(run: { stageRecords: Array<{ stage: string; to: string }> }): string | null {
    for (const stage of STAGE_ORDER) {
      const last = this.lastStageRecord(run, stage)
      if (last !== undefined && last.to !== "completed" && last.to !== "skipped") return stage
      if (last === undefined) return stage
    }
    return null
  }

  private lastStageRecord(
    run: { stageRecords: Array<{ stage: string; to: string; artifactRef?: ArtifactRef }> },
    stage: string,
  ) {
    return [...run.stageRecords].reverse().find((record) => record.stage === stage)
  }

  private runStartedAt(incidentId: string, runId: string): number {
    const event = this.journal.events(incidentId).find(
      (candidate) => candidate.type === "run_transition" && candidate.run_id === runId && candidate.to === "running",
    )
    const parsed = event === undefined ? Number.NaN : Date.parse(event.recorded_at)
    return Number.isFinite(parsed) ? parsed : this.clock.now().getTime()
  }

  private admittedArtifactsForStage(
    run: { stageRecords: Array<{ stage: string; to: string; artifactRef?: ArtifactRef }> },
    stage: OrchestratorStage,
  ): ArtifactRef[] {
    const index = STAGE_ORDER.indexOf(stage)
    const refs: ArtifactRef[] = []
    for (const prior of STAGE_ORDER.slice(0, Math.max(0, index))) {
      const ref = this.lastStageRecord(run, prior)?.artifactRef
      if (ref !== undefined && refs.every((candidate) => candidate.content_hash !== ref.content_hash)) refs.push(ref)
    }
    return refs
  }

  // ------------------------------------------------------------------
  // Orchestrator commands (lease-bound)

  async submitCommand(
    incidentId: string,
    token: string,
    claims: LeaseClaims,
    command: OrchestratorCommand,
  ): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    const verified = await this.leases.verifyRunLease(token, claims, run?.state ?? null)
    if (!verified.ok) return verified

    switch (command.kind) {
      case "enter-stage":
        return this.proposeStage(incidentId, claims, command.stage, "entered")
      case "stage-status":
        return this.proposeStage(incidentId, claims, command.stage, command.to, {
          artifactRef: command.artifact_ref,
          reason: command.reason,
          candidateHash: command.candidate_hash,
        })
      case "skip-stage":
        return this.proposeStage(incidentId, claims, command.stage, "skipped", { reason: command.reason })
      case "complete-run":
        return this.completeRun(incidentId, claims, command.outcome)
      case "fail-run":
        return this.failRun(incidentId, claims, command.failure_reason)
    }
  }

  private async proposeStage(
    incidentId: string,
    claims: LeaseClaims,
    stage: string,
    to: string,
    options: { artifactRef?: ArtifactRef; reason?: string; candidateHash?: string } = {},
  ): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })

    // Compute the expected `from` for this stage from the last stage record.
    const last = run.stageRecords.filter((record) => record.stage === stage).at(-1)
    const expectedFrom = last?.to ?? null

    if (to === "completed") {
      const required = STAGE_ARTIFACT.get(stage as StageName) ?? []
      if (options.artifactRef === undefined && required.length > 0) {
        return err({ code: ERR.INVALID_REQUEST, message: `stage ${stage} completion requires a sealed artifact (${required.join(", ")})` })
      }
      if (options.artifactRef !== undefined && required.length > 0 && !required.includes(options.artifactRef.schema_id)) {
        return err({ code: ERR.INVALID_REQUEST, message: `stage ${stage} requires ${required.join(" or ")} artifact, got ${options.artifactRef.schema_id}` })
      }
      const gateCheck = await this.checkStageGate(incidentId, claims.runId, stage as StageName, options.artifactRef)
      if (!gateCheck.ok) return gateCheck
    }

    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const stageCmd = cmd.stageTransitionCommand(
      incidentId, claims.runId, claims.attempt, stage, expectedFrom, to,
      policyVersion, recordedAt, this.stageKey(incidentId, claims.runId, stage, to),
      {
        reason: options.reason,
        artifact_ref: options.artifactRef,
        candidate_hash: options.candidateHash,
        lease_id: claims.leaseId,
      },
      { id: claims.actorId, kind: "orchestrator" },
    )
    const applied = await this.journal.apply(incidentId, stageCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    await this.refreshIndexFromJournal(incidentId)
    return ok({ event: applied.event })
  }

  private stageKey(incidentId: string, runId: string, stage: string, to: string): string {
    return `stage:${incidentId}:${runId}:${stage}:${to}:${Date.now().toString(36)}`
  }

  private async checkStageGate(
    incidentId: string,
    runId: string,
    stage: StageName,
    artifactRef: ArtifactRef | undefined,
  ): Promise<Result<true, DomainError>> {
    if (stage === "verify" && artifactRef !== undefined) {
      const envelope = await this.artifacts.get(artifactRef.content_hash)
      if (!envelope.ok) return envelope
      const verdict = (envelope.value.payload as { verdict?: string }).verdict
      if (verdict !== "pass") {
        return err({ code: ERR.GATE_FAILED, message: `verify stage requires a verification-report with verdict pass, got ${verdict ?? "none"}` })
      }
    }
    if (stage === "release") {
      const gates = this.gateEvaluations(incidentId, runId)
      const passed = gates.some(
        (gate) => (gate.evaluation.gate === "release" || gate.evaluation.gate === "action") &&
          gate.evaluation.verdict === "pass",
      )
      if (!passed) {
        return err({ code: ERR.GATE_FAILED, message: "release stage requires a passing Release or Action Gate evaluation" })
      }
      const actionReceipt = this.receipts(incidentId, runId).find(
        (receipt) => receipt.kind === "action" && receipt.outcome === "ok",
      )
      if (actionReceipt === undefined) {
        return err({ code: ERR.PERMIT_USED, message: "release stage requires a consumed permit and a successful action receipt" })
      }
    }
    if (stage === "watch") {
      const hasRelease = this.sealedArtifacts(incidentId, runId).some(
        (artifact) => artifact.artifactRef.schema_id === RELEASE_RECORD_SCHEMA_ID ||
          artifact.artifactRef.schema_id === DIRECT_ACTION_RECORD_SCHEMA_ID,
      )
      if (!hasRelease) {
        return err({ code: ERR.GATE_FAILED, message: "watch stage requires a Release record or direct-action record" })
      }
    }
    return ok(true)
  }

  private async completeRun(
    incidentId: string,
    claims: LeaseClaims,
    outcome: string,
  ): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const runCmd = cmd.runTransitionCommand(
      incidentId, claims.runId, claims.attempt, "running", "completed", run.runVersion,
      policyVersion, recordedAt, `run-complete:${incidentId}:${claims.runId}`,
      { outcome: outcome as "verified-remediation" | "symptom-cleared" | "diagnosis-only" | "handoff" },
      { id: claims.actorId, kind: "orchestrator" },
    )
    const applied = await this.journal.apply(incidentId, runCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    await this.afterTerminalRun(incidentId, claims.runId, "completed", outcome)
    return ok({ event: applied.event })
  }

  private async failRun(
    incidentId: string,
    claims: LeaseClaims,
    failureReason: string,
  ): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    const run = state?.runs.find((candidate) => candidate.runId === claims.runId)
    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const runCmd = cmd.runTransitionCommand(
      incidentId, claims.runId, claims.attempt, "running", "failed", run.runVersion,
      policyVersion, recordedAt, `run-fail:${incidentId}:${claims.runId}`,
      { failure_reason: failureReason as never },
      { id: claims.actorId, kind: "orchestrator" },
    )
    const applied = await this.journal.apply(incidentId, runCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    await this.afterTerminalRun(incidentId, claims.runId, "failed", failureReason)
    return ok({ event: applied.event })
  }

  private async afterTerminalRun(
    incidentId: string,
    runId: string,
    terminal: "completed" | "failed",
    detail: string,
  ): Promise<void> {
    await this.leases.revokeRunLeases(incidentId, runId)
    const state = this.journal.state(incidentId)
    if (state === undefined) return

    if (terminal === "completed" && detail === "verified-remediation" && state.incidentState === "open") {
      const policyVersion = await this.currentPolicyVersion(incidentId)
      const recordedAt = this.clock.nowIso()
      const resolvedCmd = cmd.incidentTransitionCommand(
        incidentId, "open", "resolved", state.incidentVersion, undefined, policyVersion, recordedAt,
        `incident-resolve:${incidentId}:${runId}`,
      )
      await this.journal.apply(incidentId, resolvedCmd)
    } else if (terminal === "completed" && detail === "symptom-cleared") {
      const policyVersion = await this.currentPolicyVersion(incidentId)
      const recordedAt = this.clock.nowIso()
      const from = state.incidentState === "open" ? "open" : "resolved"
      const closedCmd = cmd.incidentTransitionCommand(
        incidentId, from, "closed", state.incidentVersion, "symptom-cleared", policyVersion, recordedAt,
        `incident-close-symptom-cleared:${incidentId}:${runId}`,
      )
      await this.journal.apply(incidentId, closedCmd)
    }

    if (terminal === "failed") {
      const policy = await this.getPolicy(incidentId)
      const afterFail = this.journal.state(incidentId)
      if (afterFail !== undefined && afterFail.incidentState === "open") {
        if (afterFail.attemptsUsed >= policy.attemptLimit) {
          await this.writeIncidentReportAndClose(incidentId)
        } else {
          await this.maybeAutoQueue(incidentId, detail)
        }
      }
    }
    await this.refreshIndexFromJournal(incidentId)
  }

  private async maybeAutoQueue(incidentId: string, failureReason: string): Promise<void> {
    if (!SAFE_AUTOQUEUE_FAILURES.has(failureReason)) return
    const policy = await this.getPolicy(incidentId)
    if (policy.authorityMode !== "repair") return
    if (policy.automationPolicy === "review-always") return
    if (policy.automationPolicy === "scheduled-hybrid") {
      if (policy.schedule === null) return
      const { scheduleVerdict } = await import("./policy.js")
      if (!scheduleVerdict(this.clock.nowIso(), policy.schedule).autonomous) return
    }
    const state = this.journal.state(incidentId)
    if (state === undefined) return
    const attempt = state.runs.length + 1
    await this.createRun(incidentId, policy.version, this.clock.nowIso(), attempt)
    await this.refreshIndexFromJournal(incidentId)
  }

  private async writeIncidentReportAndClose(incidentId: string): Promise<void> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const sealed = await this.artifacts.seal({
      incidentId,
      runId: null,
      schemaId: "incident-report",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        closure_reason: "attempt-limit",
        hypotheses: [],
        actions_taken: [],
        results: "Attempt Limit reached without a verified Remediation",
        sealed_at: this.clock.nowIso(),
      },
      producer: { skill: "control-plane", skill_version: "1.0", tool: "state-machine", tool_version: "1.0" },
    })
    if (!sealed.ok) return
    await this.journal.apply(incidentId, cmd.artifactSealedCommand(
      incidentId, undefined, sealed.value.artifactRef,
      { skill: "control-plane", skill_version: "1.0" },
      policyVersion, this.clock.nowIso(), `incident-report:${incidentId}`,
    ))
    const state = this.journal.state(incidentId)
    if (state === undefined || state.incidentState === "closed") return
    const closeCmd = cmd.incidentTransitionCommand(
      incidentId, state.incidentState, "closed", state.incidentVersion, "attempt-limit",
      policyVersion, this.clock.nowIso(), `incident-close-attempt-limit:${incidentId}`,
    )
    await this.journal.apply(incidentId, closeCmd)
  }

  // ------------------------------------------------------------------
  // Human actions

  async humanAction(
    incidentId: string,
    action: "pause" | "resume" | "cancel" | "close",
    options: { runId?: string; reason?: string } = {},
  ): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    if (state === undefined) return err({ code: ERR.NOT_FOUND, message: "incident not found" })
    const run = state.runs.find((candidate) => candidate.runId === options.runId)
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()

    if (action === "close") {
      if (state.incidentState === "closed") return err({ code: ERR.ILLEGAL_TRANSITION, message: "already closed" })
      const closeCmd = cmd.incidentTransitionCommand(
        incidentId, state.incidentState, "closed", state.incidentVersion, "human-closed",
        policyVersion, recordedAt, `human-close:${incidentId}`,
      )
      const applied = await this.journal.apply(incidentId, closeCmd)
      if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
      await this.refreshIndexFromJournal(incidentId)
      return ok({ event: applied.event })
    }

    if (run === undefined) return err({ code: ERR.NOT_FOUND, message: "run not found" })
    let to: string
    if (action === "pause") to = "paused"
    else if (action === "resume") to = "running"
    else to = "cancelled"
    const runCmd = cmd.runTransitionCommand(
      incidentId, run.runId, run.attempt, run.state, to, run.runVersion,
      policyVersion, recordedAt, `human-${action}:${incidentId}:${run.runId}`,
      {}, { id: "operator-1", kind: "human" },
    )
    const applied = await this.journal.apply(incidentId, runCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })

    await this.leases.revokeRunLeases(incidentId, run.runId)
    if (action === "cancel") {
      await this.store.revokePermits(incidentId, run.runId)
      await this.store.revokeApprovals(incidentId)
    }
    if (action === "resume") {
      const policy = await this.getPolicy(incidentId)
      await this.leases.issueRunLease({
        incidentId, runId: run.runId, attempt: run.attempt, stage: "detect",
        actorId: `orchestrator-${run.runId}`, actorKind: "orchestrator",
        authorityMode: policy.authorityMode, policyVersion, toolClass: "detect",
      })
    }
    const humanCmd = cmd.humanActionCommand(
      incidentId, action, policyVersion, recordedAt, `human-record:${incidentId}:${run.runId}:${action}`,
      { run_id: run.runId, reason: options.reason },
    )
    await this.journal.apply(incidentId, humanCmd)
    await this.refreshIndexFromJournal(incidentId)
    return ok({ event: applied.event })
  }

  async recordApproval(
    incidentId: string,
    approval: {
      approval_id: string
      action_digest: string
      approver_identity: string
      approval_system: string
      action_risk_class: "safe" | "guarded"
      expiry: string
      scope?: { target: string; changed_surfaces: string[] }
      run_id?: string
    },
  ): Promise<Result<CommandResult, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const now = this.clock.nowIso()
    await this.store.insertApproval({
      approval_id: approval.approval_id,
      incident_id: incidentId,
      run_id: approval.run_id ?? null,
      action_digest: approval.action_digest,
      approver_identity: approval.approver_identity,
      approval_system: approval.approval_system,
      policy_version: policyVersion,
      tzdb_version: this.config.tzdbVersion,
      action_risk_class: approval.action_risk_class,
      expiry: approval.expiry,
      scope: approval.scope ?? null,
      granted_at: now,
      consumed_at: null,
      revoked_at: null,
    })
    const approvalCmd = cmd.approvalRecordedCommand(
      incidentId, approval.run_id,
      {
        approval_id: approval.approval_id,
        action_digest: approval.action_digest,
        approver_identity: approval.approver_identity,
        approval_system: approval.approval_system,
        policy_version: policyVersion,
        tzdb_version: this.config.tzdbVersion,
        action_risk_class: approval.action_risk_class,
        expiry: approval.expiry,
        scope: approval.scope,
        action: "granted",
      },
      policyVersion, now, `approval:${approval.approval_id}`,
    )
    const applied = await this.journal.apply(incidentId, approvalCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    return ok({ event: applied.event })
  }

  /** Confirmation window timer: resolved -> closed (symptom-cleared). */
  async confirmWindow(incidentId: string): Promise<Result<CommandResult, DomainError>> {
    const state = this.journal.state(incidentId)
    if (state === undefined) return err({ code: ERR.NOT_FOUND, message: "incident not found" })
    if (state.incidentState !== "resolved") return err({ code: ERR.ILLEGAL_TRANSITION, message: "incident is not resolved" })
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const closeCmd = cmd.incidentTransitionCommand(
      incidentId, "resolved", "closed", state.incidentVersion, "symptom-cleared",
      policyVersion, recordedAt, `confirm-window:${incidentId}`,
    )
    const applied = await this.journal.apply(incidentId, closeCmd)
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    await this.refreshIndexFromJournal(incidentId)
    return ok({ event: applied.event })
  }

  // ------------------------------------------------------------------
  // Sealing and gates

  async sealArtifact(incidentId: string, runId: string | null, input: SealInput): Promise<Result<SealResult, DomainError>> {
    const sealed = await this.artifacts.seal(input)
    if (!sealed.ok) return sealed
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const recordedAt = this.clock.nowIso()
    const artifactCmd = cmd.artifactSealedCommand(
      incidentId, runId ?? undefined, sealed.value.artifactRef,
      input.producer ?? {}, policyVersion, recordedAt,
      `artifact:${sealed.value.artifactRef.content_hash}`,
    )
    await this.journal.apply(incidentId, artifactCmd)
    return ok({ artifactRef: sealed.value.artifactRef })
  }

  async evaluateHypothesis(incidentId: string, runId: string, input: HypothesisGateInput): Promise<Result<GateRunResult, DomainError>> {
    const single = evaluateHypothesisGate(input)
    const result = evaluateHypotheses([{ ...single, hypothesis_id: input.hypothesis.id }])[0]
    if (result === undefined) return err({ code: ERR.MALFORMED_CONTRACT, message: "no gate result" })
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const checks = result.checks.map((check) => ({
      check: check.check,
      result: check.result,
      ...(Object.keys(check.counts).length === 0 ? {} : { counts: check.counts }),
      cited_item_ids: check.cited_item_ids,
      reason: check.reason,
    }))
    const evaluation = {
      gate: "hypothesis",
      hypothesis_id: input.hypothesis.id,
      checks,
      verdict: result.verdict,
      evaluated_at: this.clock.nowIso(),
      policy_version: policyVersion,
    } as GateEvaluation
    await this.recordGateEvaluation(incidentId, runId, "hypothesis", evaluation)
    return ok({ verdict: result.verdict, evaluation, permit: null })
  }

  async requestReleaseGate(
    incidentId: string,
    runId: string,
    input: ReleaseGateRequest,
  ): Promise<Result<GateRunResult, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const policy = await this.getPolicy(incidentId)
    const decision = decidePolicyAction({
      action: { category: "code", action_class: "merge-deploy", adapter: "compose-release", command: "swap", target: input.target },
      stage: "release",
      riskClass: input.riskClass,
      policy,
      tzdbVersion: this.config.tzdbVersion,
      clock: this.clock,
      approval: await this.lookupApproval(incidentId, input.actionDigest),
      clockSkewToleranceSeconds: this.config.clockSkewToleranceSeconds,
      emergencyAllowListMembership: false,
    })
    const approval = await this.lookupApproval(incidentId, input.actionDigest)
    const gate = evaluateReleaseGate({
      candidateHash: input.candidateHash,
      proposal: input.proposal,
      verificationReport: input.verificationReport,
      riskClass: input.riskClass,
      policyDecision: decision.decision,
      policyDecisionReason: decision.reason,
      approval: { valid: approval !== null, approval_id: approval?.approval_id ?? null },
      artifactMatchesCommit: input.artifactMatchesCommit,
      pipelineChecksPassed: input.pipelineChecksPassed,
      targetVersionMatches: input.targetVersionMatches,
      rolloutWatchPlanComplete: input.rolloutWatchPlanComplete,
      recoveryPointCoverage: input.recoveryPointCoverage,
      pipelineRulesPassed: input.pipelineRulesPassed,
      policyVersion,
      tzdbVersion: this.config.tzdbVersion,
      evaluatedAt: this.clock.nowIso(),
    })
    await this.recordGateEvaluation(incidentId, runId, "release", gate.evaluation)
    if (gate.verdict === "pass") {
      const permit = await this.leases.issuePermit({
        kind: "release", incidentId, runId, attempt: input.attempt,
        candidateHash: input.candidateHash, target: input.target, actionDigest: input.actionDigest,
      })
      await this.journal.apply(incidentId, cmd.leaseEventCommand(
        incidentId, runId, permit.permitId, "release", "issued", policyVersion, this.clock.nowIso(),
        `permit-issued:${permit.permitId}`, { bound_candidate_hash: input.candidateHash },
      ))
      return ok({ verdict: gate.verdict, evaluation: gate.evaluation, permit: { permitId: permit.permitId, token: permit.token } })
    }
    return ok({ verdict: gate.verdict, evaluation: gate.evaluation, permit: null })
  }

  async requestActionGate(
    incidentId: string,
    runId: string,
    input: ActionGateRequest,
  ): Promise<Result<GateRunResult, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const policy = await this.getPolicy(incidentId)
    const decision = decidePolicyAction({
      action: input.action,
      stage: "release",
      riskClass: input.riskClass,
      policy,
      tzdbVersion: this.config.tzdbVersion,
      clock: this.clock,
      approval: await this.lookupApproval(incidentId, input.actionDigest),
      clockSkewToleranceSeconds: this.config.clockSkewToleranceSeconds,
      emergencyAllowListMembership: input.emergencyAllowListMembership,
    })
    const approval = await this.lookupApproval(incidentId, input.actionDigest)
    const gate = evaluateActionGate({
      candidateHash: input.candidateHash,
      action: input.action,
      riskClass: input.riskClass,
      adapterApproved: input.adapterApproved,
      targetVersionMatches: input.targetVersionMatches,
      policyDecision: decision.decision,
      policyDecisionReason: decision.reason,
      approval: { valid: approval !== null, approval_id: approval?.approval_id ?? null },
      recoveryPointCoverage: input.recoveryPointCoverage,
      stopWatchConditionsFixed: input.stopWatchConditionsFixed,
      emergencyAllowListMembership: input.emergencyAllowListMembership,
      policyVersion,
      tzdbVersion: this.config.tzdbVersion,
      evaluatedAt: this.clock.nowIso(),
    })
    await this.recordGateEvaluation(incidentId, runId, "action", gate.evaluation)
    if (gate.verdict === "pass") {
      const permit = await this.leases.issuePermit({
        kind: "release", incidentId, runId, attempt: input.attempt,
        candidateHash: input.candidateHash, target: input.action.target, actionDigest: input.actionDigest,
      })
      await this.journal.apply(incidentId, cmd.leaseEventCommand(
        incidentId, runId, permit.permitId, "release", "issued", policyVersion, this.clock.nowIso(),
        `permit-issued:${permit.permitId}`, { bound_candidate_hash: input.candidateHash },
      ))
      return ok({ verdict: gate.verdict, evaluation: gate.evaluation, permit: { permitId: permit.permitId, token: permit.token } })
    }
    return ok({ verdict: gate.verdict, evaluation: gate.evaluation, permit: null })
  }

  /** Deterministic verification verdict + sealed Verification Report. */
  async requestVerificationVerdict(
    incidentId: string,
    runId: string,
    input: VerificationRequest,
  ): Promise<Result<VerdictResult & { artifactRef: ArtifactRef }, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const resolver = resolveApplicability(input.resolver)
    if (!resolver.ok) return resolver
    if (resolver.value.needs_human) {
      return err({ code: ERR.NEEDS_HUMAN, message: resolver.value.needs_human_reason ?? "resolver needs-human" })
    }
    const verdict = computeVerdict({
      candidateHash: input.candidateHash,
      sealedCandidateHash: input.candidateHash,
      resolver: resolver.value,
      reviews: input.reviews,
      tests: input.tests,
      actionRiskClass: input.riskClass,
      guardedApprovalValid: input.guardedApprovalValid,
      hypothesisInvalidated: input.hypothesisInvalidated,
      contradictionUnresolved: input.contradictionUnresolved,
    })
    const report = {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: runId,
      attempt: input.attempt,
      candidate_hash: input.candidateHash,
      remediation_class: input.remediationClass,
      action_risk_class: input.riskClass,
      gate_path: input.gatePath,
      applicability: {
        resolver_version: resolver.value.resolver_version,
        policy_version: policyVersion,
        required: resolver.value.required,
        conditional: resolver.value.conditional,
        triggered: resolver.value.triggered,
        not_applicable: resolver.value.not_applicable,
      },
      reviews: input.reviews.map((review) => ({
        role: review.role,
        reviewer: "subagent",
        revision: 1,
        status: review.status,
        sealed_at: this.clock.nowIso(),
      })),
      tests: input.tests.map((test) => ({
        layer: test.layer,
        tool: test.tool,
        tool_version: test.tool_version,
        receipt_ref: test.receipt_ref,
        outcome: test.outcome,
        flaky: test.flaky,
      })),
      hash_binding: {
        sealed_candidate: input.candidateHash,
        checked_candidate: input.candidateHash,
        match: true,
      },
      verdict: verdict.verdict,
      verdict_reason: verdict.reason,
      sealed_at: this.clock.nowIso(),
      policy_version: policyVersion,
    }
    const sealed = await this.sealArtifact(incidentId, runId, {
      incidentId,
      runId,
      schemaId: "verification-report",
      schemaVersion: "1.0",
      payload: report,
      producer: { skill: "control-plane", skill_version: "1.0", tool: "verdict-function", tool_version: "1.0" },
    })
    if (!sealed.ok) return sealed
    return ok({ ...verdict, artifactRef: sealed.value.artifactRef })
  }

  private async recordGateEvaluation(
    incidentId: string,
    runId: string,
    gate: "hypothesis" | "release" | "action",
    evaluation: GateEvaluation,
  ): Promise<void> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const attempt = this.journal.state(incidentId)?.runs.find((run) => run.runId === runId)?.attempt
    await this.journal.apply(incidentId, cmd.gateEvaluatedCommand(
      incidentId, runId, attempt, gate, evaluation, policyVersion, this.clock.nowIso(),
      `gate:${incidentId}:${runId}:${gate}:${Date.now().toString(36)}`,
    ))
  }

  private async lookupApproval(incidentId: string, actionDigest: string) {
    const approvals = await this.store.findApprovals(incidentId)
    return approvals.find((approval) =>
      approval.action_digest === actionDigest &&
      approval.consumed_at === null &&
      approval.revoked_at === null &&
      Date.parse(approval.expiry) > this.clock.now().getTime(),
    ) ?? null
  }

  // ------------------------------------------------------------------
  // Broker-facing

  async verifyLease(token: string, claims: LeaseClaims): Promise<Result<{ runState: string | null }, DomainError>> {
    const run = this.journal.state(claims.incidentId)?.runs.find((candidate) => candidate.runId === claims.runId)
    const verified = await this.leases.verifyRunLease(token, claims, run?.state ?? null)
    if (!verified.ok) return verified
    return ok({ runState: run?.state ?? null })
  }

  async heartbeat(leaseId: string, token: string): Promise<Result<true, DomainError>> {
    return this.leases.heartbeat(leaseId, token)
  }

  async consumePermit(
    permitId: string,
    token: string,
    expected: { candidateHash: string; target: string; incidentId: string },
  ): Promise<Result<{ candidateHash: string; target: string }, DomainError>> {
    const consumed = await this.leases.consumePermit(permitId, token, expected)
    if (!consumed.ok) return consumed
    return ok({ candidateHash: consumed.value.candidate_hash, target: consumed.value.target })
  }

  async recordBrokerReceipt(
    incidentId: string,
    runId: string | undefined,
    stage: string | undefined,
    receipt: BrokerReceipt,
    actorKind: "read-broker" | "action-broker",
  ): Promise<Result<CommandResult, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const applied = await this.journal.apply(incidentId, cmd.brokerReceiptCommand(
      incidentId, runId, stage, receipt, policyVersion, this.clock.nowIso(),
      `receipt:${receipt.receipt_id}`,
      { id: `${actorKind}-1`, kind: actorKind },
    ))
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    return ok({ event: applied.event })
  }

  async recordModelUse(
    incidentId: string,
    runId: string | undefined,
    input: {
      parent_agent_id: string
      agent_id: string
      model: string
      token_use: { prompt_tokens: number; completion_tokens: number }
      tool_calls: { tool: string; tool_call_id: string }[]
      agent_role?: string
      idempotency_key: string
    },
  ): Promise<Result<CommandResult, DomainError>> {
    const policyVersion = await this.currentPolicyVersion(incidentId)
    const applied = await this.journal.apply(incidentId, cmd.modelUseCommand(
      incidentId, runId, input.parent_agent_id, input.agent_id, input.model,
      input.token_use, input.tool_calls, policyVersion, this.clock.nowIso(),
      input.idempotency_key, { agent_role: input.agent_role },
    ))
    if (applied.kind !== "applied") return err(applied.kind === "error" ? applied.error : { code: ERR.DUPLICATE, message: "idempotency key already applied" })
    return ok({ event: applied.event })
  }

  // ------------------------------------------------------------------
  // Policy decision for brokers

  async decideAction(
    incidentId: string,
    action: TypedAction,
    stage: string,
    riskClassOverride?: ActionRiskClass,
  ): Promise<Result<{ decision: PolicyDecision; reason: string; riskClass: ActionRiskClass; policyVersion: string; tzdbVersion: string }, DomainError>> {
    const policy = await this.getPolicy(incidentId)
    const riskClass = riskClassOverride ?? resolveActionRiskClass(action)
    const decision = decidePolicyAction({
      action,
      stage,
      riskClass,
      policy,
      tzdbVersion: this.config.tzdbVersion,
      clock: this.clock,
      approval: null,
      clockSkewToleranceSeconds: this.config.clockSkewToleranceSeconds,
      emergencyAllowListMembership: false,
    })
    return ok({
      decision: decision.decision,
      reason: decision.reason,
      riskClass,
      policyVersion: policy.version,
      tzdbVersion: this.config.tzdbVersion,
    })
  }

  // ------------------------------------------------------------------
  // Derived views (journal scan)

  sealedArtifacts(incidentId: string, runId?: string): { artifactRef: ArtifactRef; runId?: string }[] {
    return this.journal.events(incidentId)
      .filter((event): event is Extract<JournalEvent, { type: "artifact_sealed" }> => event.type === "artifact_sealed")
      .filter((event) => runId === undefined || event.run_id === runId)
      .map((event) => ({ artifactRef: event.artifact_ref, runId: event.run_id }))
  }

  gateEvaluations(incidentId: string, runId?: string): { runId?: string; gate: string; evaluation: GateEvaluation }[] {
    return this.journal.events(incidentId)
      .filter((event): event is Extract<JournalEvent, { type: "gate_evaluated" }> => event.type === "gate_evaluated")
      .filter((event) => runId === undefined || event.run_id === runId)
      .map((event) => ({ runId: event.run_id, gate: event.gate, evaluation: event.evaluation }))
  }

  receipts(incidentId: string, runId?: string): BrokerReceipt[] {
    return this.journal.events(incidentId)
      .filter((event): event is Extract<JournalEvent, { type: "broker_receipt_recorded" }> => event.type === "broker_receipt_recorded")
      .filter((event) => runId === undefined || event.run_id === runId)
      .map((event) => event.receipt)
  }

  // ------------------------------------------------------------------
  // Index refresh

  private async refreshIndex(incidentId: string, trigger: IncidentTrigger): Promise<void> {
    const state = this.journal.state(incidentId)
    const events = this.journal.events(incidentId)
    const first = events[0]
    const last = events[events.length - 1]
    const active = state?.runs.find((run) => !isRunTerminal(run.state))
    await this.store.upsertIncidentIndex({
      incident_id: incidentId,
      incident_key: trigger.incident_key,
      state: state?.incidentState ?? "open",
      detector_state: trigger.state,
      severity: trigger.severity,
      scope: trigger.scope as unknown as Record<string, unknown>,
      attempt_limit: (await this.getPolicy(incidentId)).attemptLimit,
      attempts_used: state?.attemptsUsed ?? 0,
      version: state?.incidentVersion ?? 0,
      created_at: first?.recorded_at ?? this.clock.nowIso(),
      updated_at: last?.recorded_at ?? this.clock.nowIso(),
      closure_reason: state?.closureReason ?? null,
      open_run_id: active?.runId ?? null,
      related_incident_ids: this.related.get(incidentId) ?? [],
    })
  }

  private async refreshIndexFromJournal(incidentId: string): Promise<void> {
    const state = this.journal.state(incidentId)
    const events = this.journal.events(incidentId)
    const triggerEvent = events.find((event) => event.type === "trigger_received")
    if (triggerEvent === undefined || state === undefined) return
    const trigger = (triggerEvent as Extract<JournalEvent, { type: "trigger_received" }>).trigger
    await this.refreshIndex(incidentId, trigger)
  }

  // ------------------------------------------------------------------
  // Projection

  async projection(incidentId: string): Promise<Record<string, unknown> | null> {
    await this.journal.ensureLoaded(incidentId)
    const state = this.journal.state(incidentId)
    if (state === undefined) return null
    const events = this.journal.events(incidentId)
    if (events.length === 0) return null
    const triggerEvent = events.find((event) => event.type === "trigger_received")
    const trigger = (triggerEvent as Extract<JournalEvent, { type: "trigger_received" }>).trigger
    const policy = await this.getPolicy(incidentId)
    const active = state.runs.find((run) => !isRunTerminal(run.state))

    const runs = state.runs.map((run) => ({
      schema_version: "1.0",
      run_id: run.runId,
      attempt: run.attempt,
      state: run.state,
      stages: this.stageProjection(events, run.runId),
      outcome: run.outcome,
      failure_reason: run.failureReason,
      restart_count: run.restartCount,
      policy_version: policy.version,
    }))

    return {
      incident: {
        schema_version: "1.0",
        incident_id: incidentId,
        incident_key: trigger.incident_key,
        state: state.incidentState,
        detector_state: state.detectorState,
        severity: trigger.severity,
        scope: trigger.scope,
        attempt_limit: policy.attemptLimit,
        attempts_used: state.attemptsUsed,
        created_at: events[0]?.recorded_at,
        updated_at: events[events.length - 1]?.recorded_at,
        closure_reason: state.closureReason,
        open_run_id: active?.runId ?? null,
        related_incident_ids: this.related.get(incidentId) ?? [],
      },
      runs,
      policy: {
        version: policy.version,
        authority_mode: policy.authorityMode,
        automation_policy: policy.automationPolicy,
        schedule: policy.schedule,
        emergency_override: policy.emergencyOverride,
        attempt_limit: policy.attemptLimit,
      },
      events,
      artifacts: this.sealedArtifacts(incidentId).map((artifact) => artifact.artifactRef),
      gate_evaluations: this.gateEvaluations(incidentId).map((gate) => gate.evaluation),
    }
  }

  private stageProjection(events: JournalEvent[], runId: string) {
    const stages: Record<string, { stage: string; status: string; reason?: string; artifact_ref?: ArtifactRef; candidate_hash?: string; entered_at?: string; completed_at?: string; failed_at?: string; skipped_at?: string }> = {}
    for (const event of events) {
      if (event.type !== "stage_transition" || event.run_id !== runId) continue
      const current = stages[event.stage] ?? { stage: event.stage, status: "entered" }
      if (event.to === "entered") current.entered_at = event.recorded_at
      if (event.to === "completed") current.completed_at = event.recorded_at
      if (event.to === "failed") current.failed_at = event.recorded_at
      if (event.to === "skipped") current.skipped_at = event.recorded_at
      current.status = event.to
      if (event.reason !== undefined) current.reason = event.reason
      if (event.artifact_ref !== undefined) current.artifact_ref = event.artifact_ref
      if (event.candidate_hash !== undefined) current.candidate_hash = event.candidate_hash
      stages[event.stage] = current
    }
    return STAGE_ORDER.filter((stage) => stages[stage] !== undefined).map((stage) => stages[stage])
  }
}

export interface CommandResult {
  event: JournalEvent
}

export type OrchestratorCommand =
  | { kind: "enter-stage"; stage: string }
  | { kind: "stage-status"; stage: string; to: "in-progress" | "completed" | "failed"; artifact_ref?: ArtifactRef; reason?: string; candidate_hash?: string }
  | { kind: "skip-stage"; stage: string; reason: string }
  | { kind: "complete-run"; outcome: string }
  | { kind: "fail-run"; failure_reason: string }

export interface ReleaseGateRequest {
  candidateHash: string
  proposal: RemediationProposal
  verificationReport: { candidate_hash: string; hash_binding: { match: boolean } }
  riskClass: ActionRiskClass
  actionDigest: string
  target: string
  attempt: number
  artifactMatchesCommit: boolean
  pipelineChecksPassed: boolean
  targetVersionMatches: boolean
  rolloutWatchPlanComplete: boolean
  recoveryPointCoverage: RecoveryPointCoverage
  pipelineRulesPassed: boolean
}

export interface ActionGateRequest {
  candidateHash: string
  action: TypedAction
  riskClass: ActionRiskClass
  actionDigest: string
  attempt: number
  adapterApproved: boolean
  targetVersionMatches: boolean
  recoveryPointCoverage: RecoveryPointCoverage
  stopWatchConditionsFixed: boolean
  emergencyAllowListMembership: boolean
}

export interface VerificationRequest {
  candidateHash: string
  attempt: number
  remediationClass: string
  riskClass: "safe" | "guarded" | "barred"
  gatePath: "release" | "action"
  resolver: ResolverInput
  reviews: ReturnType<typeof reviewInputFromReport>[]
  tests: ReturnType<typeof testInputFromReport>[]
  guardedApprovalValid: boolean
  hypothesisInvalidated: boolean
  contradictionUnresolved: boolean
}
