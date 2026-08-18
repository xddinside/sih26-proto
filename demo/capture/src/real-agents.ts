/**
 * The real-agent kit for the Demo Profile capture (issue #23). It binds the
 * pi-skills real role session runners to the capture's in-process proposal
 * surface and one Model Gateway, and accumulates the per-session records the
 * capture manifest is built from.
 *
 * The kit never decides pass or fail: every terminal submission is validated
 * against the @sih/contracts registry and sealed through the stage proposals
 * surface before the session returns, exactly as the deterministic path
 * seals its artifacts.
 */
import type {
  ControlPlaneProposals,
} from "../../../packages/pi-skills/src/orchestrator/orchestrator.js"
import type { FusionRoundResult } from "../../../packages/pi-skills/src/fusion/fusion-runtime.js"
import { runRealFusionRound } from "../../../packages/pi-skills/src/fusion/fusion-real.js"
import type { FusionSealSurface } from "../../../packages/pi-skills/src/fusion/fusion-real.js"
import type { AgentSessionRecord, AgentSessionKit, WorktreeHost } from "../../../packages/pi-skills/src/agent/roles.js"
import {
  createWorktreeHost,
  runImplementerRole,
  runOrchestratorRole,
  runPlannerRole,
  runReviewRole,
  runTestRole,
} from "../../../packages/pi-skills/src/agent/roles.js"
import type {
  ImplementedDiff,
  OrchestratorReport,
  RemediationDraft,
  ReviewReport,
  TestReport,
  CaptureManifest,
  CaptureManifestRoleRecord,
  AgentRoleName,
} from "@sih/contracts/types"
import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import type { ModelGateway, ReadBroker, LeaseRef } from "@sih/brokers"
import type { ThinkingLevel } from "@earendil-works/pi-ai"
import type { RoleLimits } from "../../../packages/pi-skills/src/role/limits.js"
import type { ReviewRoleCode } from "../../../packages/pi-skills/src/reviews/review-runner.js"
import type { TestLayerCode } from "../../../packages/pi-skills/src/tests/test-runner.js"

/** One role session ran; the kit keeps these for the capture manifest. */
export type KitSessionRecord = AgentSessionRecord

export interface RealAgentKitOptions {
  gateway: ModelGateway
  model: { provider: string; id: string }
  reasoning?: ThinkingLevel
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
  readBroker?: ReadBroker
  incidentId: string
  runId: string
  attempt: number
  /** The participant perspectives in Fusion participant order. */
  perspectives: Array<{ participantId: string; perspective: string; order: number }>
  /** The seeds this run captured (S1/S2) with their diff hashes. */
  seeds: Array<{ id: string; digest: string }>
  toolCatalogVersion: string
  policyVersion: string
  /** The digests the manifest freezes. */
  skillTreeDigest: string
  piAgentCoreVersion: string
  piAiVersion: string
  budgets: {
    model_turns: number
    non_terminal_tool_calls: number
    session_wall_clock_ms: number
    run_wall_clock_ms: number
  }
  schemaVersions: Record<string, string>
  scenario: string
  mode: "rehearsal" | "full-capture"
}

/**
 * The real-agent kit for one capture run. The driver binds a stage surface
 * (proposals + lease) before each stage, runs the stage's real role sessions
 * through it, and collects every session record for the manifest.
 */
export class RealAgentKit {
  readonly sessions: KitSessionRecord[] = []
  private surface: { proposals: ControlPlaneProposals; lease: LeaseRef } | null = null
  private implementerDiff: string | null = null

  constructor(readonly options: RealAgentKitOptions) {}

  /** The diff text the implementer session applied, for the review/test
   * sessions and the diff hash. */
  implementerDiffText(): string {
    if (this.implementerDiff === null) {
      throw new Error("no implementer diff recorded yet")
    }
    return this.implementerDiff
  }

  /** Bind the current stage's proposal surface and lease. */
  bindStage(proposals: ControlPlaneProposals, lease: LeaseRef): void {
    this.surface = { proposals, lease }
  }

  private requireSurface(): { proposals: ControlPlaneProposals; lease: LeaseRef } {
    if (this.surface === null) {
      throw new Error("RealAgentKit has no stage surface bound")
    }
    return this.surface
  }

  private sealSurface(): FusionSealSurface {
    const { proposals } = this.requireSurface()
    return {
      async seal(input) {
        const sealed = await proposals.sealArtifact({
          schemaId: input.schemaId,
          schemaVersion: input.schemaVersion,
          payload: input.payload as never,
          producer: input.producer,
        })
        return { content_hash: sealed.artifact_ref.content_hash }
      },
    }
  }

  private kit(seed?: { baseRef: string; baseFiles: ReadonlyMap<string, string> }): {
    kit: AgentSessionKit
    worktree: WorktreeHost | null
  } {
    const { lease } = this.requireSurface()
    let worktree: WorktreeHost | null = null
    const agentKit: AgentSessionKit = {
      gateway: this.options.gateway,
      lease,
      candidateHash: "no-candidate-hash",
      seal: this.sealSurface(),
      model: this.options.model,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
      readBroker: this.options.readBroker,
    }
    if (seed !== undefined) {
      worktree = createWorktreeHost(seed.baseRef, seed.baseFiles)
      agentKit.worktree = worktree
    }
    return { kit: agentKit, worktree }
  }

  private record(session: AgentSessionRecord): void {
    this.sessions.push(session)
  }

  /** Run one real Fusion round through the bound stage surface. */
  async runFusionRound(options: {
    round: number
    revisionId: string
    task: string
    brief?: string
    participantIds: string[]
    judgeId: string
    synthesizerId: string
    parentAgentId: string
  }): Promise<FusionRoundResult> {
    const { lease } = this.requireSurface()
    const perspectives = options.participantIds.map((participantId, index) => {
      const configured = this.options.perspectives.find(
        (entry) => entry.participantId === participantId,
      )
      return configured?.perspective ?? `independent analysis of the shared evidence #${index + 1}`
    })
    const result = await runRealFusionRound({
      round: options.round,
      revisionId: options.revisionId,
      task: options.task,
      brief: options.brief,
      participantIds: options.participantIds,
      participantPerspectives: perspectives,
      judgeId: options.judgeId,
      synthesizerId: options.synthesizerId,
      parentAgentId: options.parentAgentId,
      gateway: this.options.gateway,
      lease,
      readBroker: this.options.readBroker,
      candidateHash: "no-candidate-hash",
      seal: this.sealSurface(),
      model: this.options.model,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
    })
    for (const session of result.sessions) {
      this.record(session)
    }
    return result
  }

  /** Run the repair planner role; returns the planner draft text the
   * deterministic Orchestrator path parses (camelCase shape). */
  async runPlanner(options: {
    incidentId: string
    runId: string
    attempt: number
    acceptedHypothesis: string
    changeSurfacePolicy: string
    recoveryPointSummary: string
    changedSurfaces: readonly string[]
    plannerTask: string
  }): Promise<string> {
    const { kit } = this.kit()
    const result = await runPlannerRole(kit, options)
    this.record(result.session)
    if (result.payload === null || result.status !== "succeeded") {
      throw new Error(`real planner session ${result.status}: ${result.failureReason ?? "no payload"}`)
    }
    const payload = result.payload
    return JSON.stringify({
      changeDescription: payload.change_description,
      citations: payload.citations.map((citation) => ({
        change: citation.change,
        cited_item_ids: citation.cited_item_ids,
      })),
      testPlan: payload.test_plan,
      changedSurfaces: payload.changed_surfaces,
      blastRadius: { services: ["payment"], environments: ["demo"], cohorts: [] },
      recoveryPointDraft: {
        id: "recovery-point-card-type",
        changed_surfaces: [
          "src/payment/card.js",
          "compose service payment (restart via docker compose up -d payment)",
        ],
      },
    })
  }

  /** Run the repair implementer role in its private worktree; returns the
   * applied diff text. */
  async runImplementer(options: {
    incidentId: string
    runId: string
    attempt: number
    baseRef: string
    changedFiles: readonly string[]
    implementerTask: string
    baseFiles: ReadonlyMap<string, string>
  }): Promise<string> {
    const { kit, worktree } = this.kit({
      baseRef: options.baseRef,
      baseFiles: options.baseFiles,
    })
    const result = await runImplementerRole(kit, options)
    this.record(result.session)
    if (result.payload === null || result.status !== "succeeded") {
      throw new Error(`real implementer session ${result.status}: ${result.failureReason ?? "no payload"}`)
    }
    const payload = result.payload
    if (worktree === null) {
      throw new Error("implementer worktree was not created")
    }
    if (payload.diff_text !== worktree.diffText()) {
      throw new Error("implementer payload diff does not match the worktree diff")
    }
    this.implementerDiff = payload.diff_text
    return payload.diff_text
  }

  /** Run every review role session for the candidate; returns the reports the
   * deterministic verdict consumes. */
  async runReviews(options: {
    incidentId: string
    runId: string
    attempt: number
    roles: readonly ReviewRoleCode[]
    candidateHash: string
    hypothesis: string
    revisionId: string
    diffText: string
    changedFiles: readonly string[]
    recoveryPointHash: string
    checkHints?: readonly string[]
    inputRefs?: readonly string[]
  }): Promise<ReviewReport[]> {
    const { kit } = this.kit()
    const reports: ReviewReport[] = []
    for (const role of options.roles) {
      const result = await runReviewRole(kit, {
        incidentId: options.incidentId,
        runId: options.runId,
        attempt: options.attempt,
        role,
        reviewer: `real-reviewer-${role}`,
        revision: 1,
        candidateHash: options.candidateHash,
        hypothesis: options.hypothesis,
        revisionId: options.revisionId,
        diffText: options.diffText,
        changedFiles: options.changedFiles,
        checkHints: options.checkHints,
        inputRefs: options.inputRefs,
      })
      this.record(result.session)
      if (result.payload === null || result.status !== "succeeded") {
        throw new Error(`real review session ${role} ${result.status}: ${result.failureReason ?? "no payload"}`)
      }
      reports.push(result.payload)
    }
    return reports
  }

  /** Run every test layer session; returns the reports the deterministic
   * verdict consumes. */
  async runTests(options: {
    incidentId: string
    runId: string
    attempt: number
    layers: readonly TestLayerCode[]
    candidateHash: string
    diffText: string
    changedFiles: readonly string[]
    runsByLayer: Record<string, { tool: string; toolVersion: string; target: string; receiptRef: string; runs: { run_hash: string; result: "pass" | "fail" | "error"; at: string; detail?: string }[] }>
  }): Promise<TestReport[]> {
    const { kit } = this.kit()
    const reports: TestReport[] = []
    for (const layer of options.layers) {
      const entry = options.runsByLayer[layer]
      if (entry === undefined) {
        throw new Error(`no receipt runs recorded for test layer ${layer}`)
      }
      const result = await runTestRole(kit, {
        incidentId: options.incidentId,
        runId: options.runId,
        attempt: options.attempt,
        layer,
        tool: entry.tool,
        toolVersion: entry.toolVersion,
        target: entry.target,
        receiptRef: entry.receiptRef,
        runs: entry.runs,
        candidateHash: options.candidateHash,
        diffText: options.diffText,
        changedFiles: options.changedFiles,
      })
      this.record(result.session)
      if (result.payload === null || result.status !== "succeeded") {
        throw new Error(`real test session ${layer} ${result.status}: ${result.failureReason ?? "no payload"}`)
      }
      reports.push(result.payload)
    }
    return reports
  }

  /** Run the end-of-run Orchestrator role session. */
  async runOrchestrator(options: {
    incidentId: string
    runId: string
    attempt: number
    stageOutcomes: { detect: string; diagnose: string; repair: string; verify: string }
    runContext: string
  }): Promise<OrchestratorReport | null> {
    const { kit } = this.kit()
    const result = await runOrchestratorRole(kit, options)
    this.record(result.session)
    if (result.payload === null || result.status !== "succeeded") {
      throw new Error(`real orchestrator session ${result.status}: ${result.failureReason ?? "no payload"}`)
    }
    return result.payload
  }

  /** The capture-manifest role records for every session that ran. */
  roleRecords(): CaptureManifestRoleRecord[] {
    return this.sessions.map((session) => ({
      role: session.role as AgentRoleName,
      agent_id: session.agentId,
      status: session.status,
      ...(session.submissionId === undefined ? {} : { submission_id: session.submissionId }),
      ...(session.submissionId === undefined ? {} : { artifact_ref: session.submissionId }),
      model_use_agent_ids: session.modelUseAgentIds,
    }))
  }

  /** Build the capture-manifest payload and seal it through the bound stage
   * surface; returns the manifest payload. */
  async sealManifest(options: {
    incidentId: string
    runId: string
    attempt: number
    mode: "rehearsal" | "full-capture"
    scenario: string
  }): Promise<CaptureManifest> {
    const payload: CaptureManifest = {
      schema_version: "1.0",
      manifest_id: `capture-manifest:${options.incidentId}:${options.runId}`,
      incident_id: options.incidentId,
      run_id: options.runId,
      attempt: options.attempt,
      mode: options.mode,
      scenario: options.scenario,
      provider_class: "real",
      provider: this.options.model.provider,
      model: this.options.model.id,
      reasoning: this.options.reasoning ?? "high",
      pi_agent_core_version: this.options.piAgentCoreVersion,
      pi_ai_version: this.options.piAiVersion,
      skill_tree_digest: this.options.skillTreeDigest,
      tool_catalog_revision: this.options.toolCatalogVersion,
      policy_revision: this.options.policyVersion,
      perspectives: this.options.perspectives.map((entry) => ({
        participant_id: entry.participantId,
        perspective: entry.perspective,
        order: entry.order,
      })),
      seeds: this.options.seeds,
      budgets: this.options.budgets,
      schema_versions: this.options.schemaVersions,
      role_records: this.roleRecords(),
      manifest_digest: "" as HashString,
      sealed_at: new Date().toISOString(),
    }
    const digest = contentHash(stripKey(payload, "manifest_digest") as never)
    if (!digest.ok) {
      throw new Error(`manifest digest failed: ${digest.error.message}`)
    }
    payload.manifest_digest = digest.value
    await this.sealSurface().seal({
      schemaId: "capture-manifest",
      schemaVersion: "1.0",
      payload,
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    return payload
  }
}

/** A deep copy without one top-level key, for the manifest self-digest. */
function stripKey<T extends Record<string, unknown>>(value: T, key: string): T {
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (k !== key) {
      copy[k] = v
    }
  }
  return copy as T
}
