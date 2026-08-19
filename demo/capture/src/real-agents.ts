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
import type { AgentSessionRecord, AgentSessionKit } from "../../../packages/pi-skills/src/agent/roles.js"
import {
  runOrchestratorRole,
} from "../../../packages/pi-skills/src/agent/roles.js"
import { runRealRepairRound } from "../../../packages/pi-skills/src/repair/repair-real.js"
import type { RepairRoundResult } from "../../../packages/pi-skills/src/repair/repair-real.js"
import { runRealVerifyRound } from "../../../packages/pi-skills/src/verify/verify-real.js"
import type { VerifyRoundResult } from "../../../packages/pi-skills/src/verify/verify-real.js"
import type { AssignedTestReceipt } from "../../../packages/pi-skills/src/tests/test-runner.js"
import type {
  OrchestratorReport,
  CaptureManifest,
  CaptureManifestRoleRecord,
  AgentRoleName,
} from "@sih/contracts/types"
import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import type { ModelGateway, ReadBroker, LeaseRef } from "@sih/brokers"
import type { ThinkingLevel } from "@earendil-works/pi-ai"
import type { RoleLimits } from "../../../packages/pi-skills/src/role/limits.js"
import type { OrchestratorToolService } from "../../../packages/pi-skills/src/orchestrator/tools.js"
import {
  BRIEF_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  PARTICIPANT_SYSTEM_PROMPT,
  REPAIR_IMPLEMENTER_SYSTEM_PROMPT,
  REPAIR_PLANNER_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
} from "../../../packages/pi-skills/src/prompts.js"

const PROMPT_REVISION = (() => {
  const digest = contentHash({
    brief: BRIEF_SYSTEM_PROMPT,
    orchestrator: ORCHESTRATOR_SYSTEM_PROMPT,
    fusionParticipant: PARTICIPANT_SYSTEM_PROMPT,
    fusionJudge: JUDGE_SYSTEM_PROMPT,
    fusionSynthesizer: SYNTHESIZER_SYSTEM_PROMPT,
    repairPlanner: REPAIR_PLANNER_SYSTEM_PROMPT,
    repairImplementer: REPAIR_IMPLEMENTER_SYSTEM_PROMPT,
    review: REVIEW_SYSTEM_PROMPT,
    test: TEST_SYSTEM_PROMPT,
  })
  return digest.ok ? digest.value : "prompts@1.0"
})()

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
  /** Version of the role prompt catalog used by every fresh session. */
  promptRevision?: string
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
  providerClass?: "real" | "fixture"
  manifestProvider?: string
  orchestrator?: OrchestratorToolService
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

  private kit(): AgentSessionKit {
    const { lease } = this.requireSurface()
    return {
      gateway: this.options.gateway,
      lease,
      candidateHash: "no-candidate-hash",
      seal: this.sealSurface(),
      model: this.options.model,
      providerClass: this.options.providerClass,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
      readBroker: this.options.readBroker,
      orchestrator: this.options.orchestrator,
    }
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
      providerClass: this.options.providerClass,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
    })
    for (const session of result.sessions) {
      this.record(session)
    }
    return result
  }

  /** Run the real repair round: one bounded planner session then one bounded
   * implementer session in its isolated worktree. Records every session and
   * keeps the applied diff for the review/test stages. A failed or aborted
   * round is returned honestly and stops the run; no canned fallback. */
  async runRepair(options: {
    incidentId: string
    runId: string
    attempt: number
    revisionId: string
    acceptedHypothesis: string
    changeSurfacePolicy: string
    recoveryPointSummary: string
    declaredSurfaces: readonly string[]
    allowedChangedFiles: readonly string[]
    baseRef: string
    baseFiles: ReadonlyMap<string, string>
    plannerTask: string
    implementerTask: string
    parentAgentId: string
  }): Promise<RepairRoundResult> {
    const { lease } = this.requireSurface()
    const result = await runRealRepairRound({
      ...options,
      gateway: this.options.gateway,
      lease,
      readBroker: this.options.readBroker,
      seal: this.sealSurface(),
      model: this.options.model,
      providerClass: this.options.providerClass,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
    })
    for (const session of result.sessions) {
      this.record(session)
    }
    if (result.implementer !== undefined) {
      this.implementerDiff = result.implementer.diffText
    }
    return result
  }

  /** Run the full real Verify round: one fresh session per applicable review
   * role and per applicable test layer, selected by the deterministic
   * applicability resolver. Records every session and returns the reports the
   * deterministic verdict consumes. A failed or aborted round returns an
   * honest invalid result that stops Verify; no canned fallback. */
  async runVerify(options: {
    incidentId: string
    runId: string
    attempt: number
    candidateHash: string
    revisionId: string
    hypothesis: string
    diffText: string
    changedFiles: readonly string[]
    recoveryPointHash: string
    required: readonly string[]
    triggered: Readonly<Record<string, string>>
    t5Selection: string | null
    acceptedRemediation?: string
    checkHints?: readonly string[]
    inputRefs?: readonly string[]
    testReceipts: Readonly<Record<string, AssignedTestReceipt>>
  }): Promise<VerifyRoundResult> {
    const { lease } = this.requireSurface()
    const result = await runRealVerifyRound({
      incidentId: options.incidentId,
      runId: options.runId,
      attempt: options.attempt,
      candidateHash: options.candidateHash,
      revisionId: options.revisionId,
      hypothesis: options.hypothesis,
      acceptedRemediation: options.acceptedRemediation,
      diffText: options.diffText,
      changedFiles: options.changedFiles,
      recoveryPointHash: options.recoveryPointHash,
      required: options.required,
      triggered: options.triggered,
      t5Selection: options.t5Selection,
      checkHints: options.checkHints,
      inputRefs: options.inputRefs,
      testReceipts: options.testReceipts,
      parentAgentId: `orchestrator-${lease.runId}`,
      gateway: this.options.gateway,
      lease,
      readBroker: this.options.readBroker,
      seal: this.sealSurface(),
      model: this.options.model,
      providerClass: this.options.providerClass,
      reasoning: this.options.reasoning,
      limits: this.options.limits,
      signal: this.options.signal,
    })
    for (const session of result.sessions) {
      this.record(session)
    }
    return result
  }

  /** Run the end-of-run Orchestrator role session. */
  async runOrchestrator(options: {
    incidentId: string
    runId: string
    attempt: number
    stageOutcomes: { detect: string; diagnose: string; repair: string; verify: string }
    runContext: string
    sessionId?: string
  }): Promise<OrchestratorReport | null> {
    const kit = this.kit()
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
      ...(session.runArtifactRef === undefined ? {} : { run_artifact_ref: session.runArtifactRef }),
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
      schema_version: "1.1",
      manifest_id: `capture-manifest:${options.incidentId}:${options.runId}`,
      incident_id: options.incidentId,
      run_id: options.runId,
      attempt: options.attempt,
      mode: options.mode,
      scenario: options.scenario,
      provider_class: this.options.providerClass ?? "real",
      provider: this.options.manifestProvider ?? this.options.model.provider,
      model: this.options.model.id,
      reasoning: this.options.reasoning ?? "high",
      pi_agent_core_version: this.options.piAgentCoreVersion,
      pi_ai_version: this.options.piAiVersion,
      skill_tree_digest: this.options.skillTreeDigest,
      tool_catalog_revision: this.options.toolCatalogVersion,
      prompt_revision: this.options.promptRevision ?? PROMPT_REVISION,
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
      schemaVersion: "1.1",
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
