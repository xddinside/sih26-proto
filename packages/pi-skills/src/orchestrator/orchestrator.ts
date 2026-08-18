/**
 * The Pi Orchestrator extension from docs/research/pi-agent-catalog.md and
 * docs/research/orchestrator-stages.md. Loaded once at Worker start; drives
 * Detect -> Diagnose -> Repair -> Verify -> Release -> Watch through the
 * Control Plane stage contract. The Orchestrator proposes everything and
 * decides nothing that policy owns: the Control Plane remains the single
 * durable state writer and owns stage transitions, applicability, the
 * Hypothesis gate, both execution gates, leases, permits, budgets, and
 * policy.
 *
 * `spawn_subagent` is SIH extension work, not a Pi built-in: Pi's SDK
 * documents "build custom tools that spawn sub-agents" as the supported
 * pattern. Each subagent is a fresh skill-bound session inside this Worker.
 *
 * Forbidden decisions enforced here: the Orchestrator never reviews, judges,
 * or synthesizes; never picks a fusion winner; never computes a verdict or a
 * risk class (it transcribes deterministic Control Plane results); never
 * merges, deploys, or executes production actions; and never holds
 * credentials.
 */
import type { LeaseRef, ModelGateway, ReadBroker } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import type {
  EvidenceItem,
  Hypothesis,
  ReviewReport,
  TestReport,
} from "@sih/contracts/types"

import { resolveAllowList } from "../allow-lists.js"
import { assembleVerdictInput, consolidateReviews } from "../consolidation.js"
import type { Contradiction } from "../consolidation.js"
import { runFusionRound } from "../fusion/fusion-runtime.js"
import type { FusionRoundResult } from "../fusion/fusion-runtime.js"
import type { RealFusionRoundOptions } from "../fusion/fusion-real.js"
import { buildLaterContext } from "../fusion/traces.js"
import type { FusionRunArtifact } from "../fusion/traces.js"
import {
  computeCandidateHash,
  validateImplementerDiff,
} from "../repair/implementer.js"
import type { RemediationDisposition } from "../repair/planner.js"
import { SkillSession } from "../session.js"
import type { Skill } from "../skill-catalog.js"
import type { WorkerRuntime } from "../worker/bootstrap.js"

// ---------------------------------------------------------------------------
// Structural Control Plane input shapes. The Control Plane owns these; the
// Worker only assembles them. Kept local so the runtime package depends on
// contracts and brokers only.

export interface HypothesisGateInput {
  hypothesis: Hypothesis
  items: readonly EvidenceItem[]
  criticalItemIds: readonly string[]
  explainedAwayItemIds: readonly string[]
  observedScope: {
    tenant_id: string
    deployment_environment_name: string
    service_name: string
  }
  materialAlternatives: readonly {
    hypothesis_id: string
    eliminated_by_item_ids: string[]
    failed_prediction_of_h: boolean
    rejected: boolean
  }[]
  testRuns: readonly {
    prediction_id: string
    registered_at: string
    started_at: string
    receipt_ref: string
    outcome: "ok" | "failed" | "error"
    prediction_matched: boolean
  }[]
  counterfactualItemIds: readonly string[]
  freshnessWindow: { starts_at: string; ends_at: string | null }
  expectedDeploymentVersion: string | null
  coverage: ReadonlyMap<
    string,
    {
      backend_healthy: boolean
      scope_covered: boolean
      window_covered: boolean
    }
  >
  evaluationTime: string
  needsHumanReason: string | null
}

export interface ApplicabilityInput {
  remediationClass: string
  declaredSurfaces: string[]
  diff: { changed_files: string[]; deleted_files: string[] }
  actionRiskClass: "safe" | "guarded" | "barred"
  policyVersion: string
  toolCatalog: {
    version: string
    language: string
    fuzzHarnessAvailable: boolean
    stagingTargetExists: boolean
    serviceUserFacing: boolean
    pipelineHasE2E: boolean
    performanceSuiteExists: boolean
    performanceSensitivePaths: string[]
    ownershipMap: Record<string, string>
  }
  recoveryPointSurfaces: string[]
  watchPlanExists: boolean
}

export interface ApplicabilityResult {
  required: string[]
  conditional: string[]
  triggered: Record<string, string>
  not_applicable: string[]
  check_reasons: Record<string, string>
  resolver_version: string
  t5_selection: string | null
  needs_human: boolean
  needs_human_reason: string | null
}

export interface GateEvaluationResponse {
  verdict: string
  evaluation?: unknown
  permit?: { permitId: string; token: string } | null
  reason?: string
  artifact_ref?: {
    schema_id: string
    schema_version: string
    content_hash: string
  }
}

export interface VerificationInput {
  candidateHash: string
  attempt: number
  remediationClass: string
  riskClass: "safe" | "guarded" | "barred"
  gatePath: "release" | "action"
  resolver: ApplicabilityInput
  reviews: {
    role: string
    status: "pass" | "fail"
    findings: {
      severity: "blocker" | "major" | "minor" | "info"
      citations: unknown[]
      status: "open" | "retracted" | "fixed-in-revision"
      uncited: boolean
      id: string
    }[]
  }[]
  tests: {
    layer: string
    outcome: "pass" | "fail" | "flaky-pass" | "error" | "not-run"
    flaky: boolean
    tool: string
    tool_version: string
    receipt_ref: string
  }[]
  guardedApprovalValid: boolean
  hypothesisInvalidated: boolean
  contradictionUnresolved: boolean
}

/**
 * The Control Plane proposal surface the Orchestrator calls. Durable writes
 * exist only here; a model cannot seal, transition, or gate-evaluate by any
 * other path.
 */
export interface ControlPlaneProposals {
  sealArtifact: (input: {
    schemaId: string
    schemaVersion: string
    payload: unknown
    producer?: {
      skill?: string
      skill_version?: string
      tool?: string
      tool_version?: string
      tool_catalog_version?: string
    }
  }) => Promise<{
    artifact_ref: {
      schema_id: string
      schema_version: string
      content_hash: string
    }
  }>
  stageCommand: (command: {
    kind: "enter-stage" | "stage-status" | "skip-stage"
    stage: string
    to?: "in-progress" | "completed" | "failed"
    artifact_ref?: {
      schema_id: string
      schema_version: string
      content_hash: string
    }
    reason?: string
    candidate_hash?: string
  }) => Promise<void>
  completeRun: (
    outcome:
      "verified-remediation" | "symptom-cleared" | "diagnosis-only" | "handoff"
  ) => Promise<void>
  failRun: (failureReason: string) => Promise<void>
  requestHypothesisGate: (
    input: HypothesisGateInput
  ) => Promise<{ verdict: string; evaluation: unknown }>
  resolveApplicability: (
    input: ApplicabilityInput
  ) => Promise<ApplicabilityResult>
  requestVerificationVerdict: (
    input: VerificationInput
  ) => Promise<{
    verdict: string
    reason: string
    artifact_ref: {
      schema_id: string
      schema_version: string
      content_hash: string
    }
  }>
  requestReleaseGate: (
    input: Record<string, unknown>
  ) => Promise<GateEvaluationResponse>
  requestActionGate: (
    input: Record<string, unknown>
  ) => Promise<GateEvaluationResponse>
  policyDecision: (
    action: {
      adapter: string
      action_class: string
      command: string
      category: string
      target: string
    },
    stage: string
  ) => Promise<{ decision: string; reason: string; riskClass: string }>
}

export interface OrchestratorOptions {
  runtime: WorkerRuntime
  proposals: ControlPlaneProposals
  gateway: ModelGateway
  /** The stage-scoped lease the Worker currently holds. */
  lease: LeaseRef & { token: string }
  evidence: EvidenceBundle
  readBroker?: ReadBroker
  modelForRole?: (role: string) => string
  signal?: AbortSignal
}

export interface EvidenceBundle {
  revisionId: string
  items: readonly EvidenceItem[]
  criticalItemIds: readonly string[]
  observedScope: {
    tenant_id: string
    deployment_environment_name: string
    service_name: string
  }
  freshnessWindow: { starts_at: string; ends_at: string | null }
  expectedDeploymentVersion: string | null
  coverage: ReadonlyMap<
    string,
    {
      backend_healthy: boolean
      scope_covered: boolean
      window_covered: boolean
    }
  >
  materialAlternatives: readonly {
    hypothesis_id: string
    eliminated_by_item_ids: string[]
    failed_prediction_of_h: boolean
    rejected: boolean
  }[]
  testRuns: readonly {
    prediction_id: string
    registered_at: string
    started_at: string
    receipt_ref: string
    outcome: "ok" | "failed" | "error"
    prediction_matched: boolean
  }[]
  counterfactualItemIds: readonly string[]
}

export interface SubagentRunRecord {
  parentAgentId: string
  agentId: string
  skill: string
  role: string
  model: string
  stage: string
}

export interface StageOutcome {
  stage: string
  ok: boolean
  detail: string
}

export class OrchestratorError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

const STAGE_GUARDRAILS: Readonly<Record<string, readonly string[]>> = {
  detect: ["Detect stage: Read Broker reads only; no writes, no subagents."],
  diagnose: [
    "Diagnose stage: read-only investigation; no writes, no shell, no open web.",
    "The docs proxy supplies context only, never evidence.",
  ],
  repair: [
    "Repair stage: you work in your own scratch or copy-on-write worktree.",
    "No merge, no deploy, no production action.",
  ],
  verify: [
    "Verify stage: you are a reviewer or test subagent; you cannot edit code or plans.",
    "Peer reports are withheld from you; cite receipts and file lines only.",
  ],
  release: [
    "Release stage: the Orchestrator submits; the gates and brokers execute.",
  ],
  watch: [
    "Watch stage: frozen-plan comparison happens in code; you never change a limit.",
  ],
}

const DISPOSITION_BY_MODE: Readonly<Record<string, RemediationDisposition>> = {
  observe: "observe-only",
  prepare: "allowed",
  repair: "allowed",
  emergency: "observe-only",
}

/** The Remediation disposition is a Control Plane emission; the Worker only
 * records the deterministic mapping from the Authority Mode in force. */
export function dispositionFromAuthorityMode(
  authorityMode: string
): RemediationDisposition {
  return DISPOSITION_BY_MODE[authorityMode] ?? "observe-only"
}

/** The fixed no-candidate hash used for stage reads that precede any
 * candidate (Detect, Diagnose). */
export const NO_CANDIDATE_HASH = `sha256:${"0".repeat(64)}`

export class PiOrchestratorExtension {
  readonly records: SubagentRunRecord[] = []
  readonly fusionRounds: FusionRoundResult[] = []
  private readonly options: OrchestratorOptions
  private readonly skills: Map<string, Skill>
  private currentStage: string

  constructor(
    options: OrchestratorOptions,
    skills: Map<string, Skill>,
    currentStage: string
  ) {
    this.options = options
    this.skills = skills
    this.currentStage = currentStage
  }

  get stage(): string {
    return this.currentStage
  }

  /** `spawn_subagent`: a fresh skill-bound session with one allow-list, one
   * scratch directory, and one output schema. SIH extension work, not a Pi
   * built-in. */
  spawnSubagent(options: {
    skillName: string
    role: string
    taskInput: string
    stage: LeaseRef["stage"]
    scratchDir: string
    guardrails?: readonly string[]
    extraSystemPrompt?: string
  }): SkillSession {
    if (options.skillName === "sih-orchestrator") {
      throw new OrchestratorError(
        "NO_NESTED_ORCHESTRATOR",
        "subagents cannot create nested Workers or Orchestrators"
      )
    }
    const skill = this.skills.get(options.skillName)
    if (skill === undefined) {
      throw new OrchestratorError(
        "UNKNOWN_SKILL",
        `skill ${options.skillName} is not in the pinned skills tree`
      )
    }
    const allowList = resolveAllowList(skill.contract.tool_group)
    const model = this.modelForRole(options.role)
    const session = new SkillSession({
      skill,
      allowList,
      activeTools: new Set(allowList),
      stage: options.stage,
      guardrails: options.guardrails ?? STAGE_GUARDRAILS[options.stage],
      extraSystemPrompt: options.extraSystemPrompt,
      taskInput: options.taskInput,
      scratchDir: options.scratchDir,
      parentAgentId: `orchestrator-${this.options.runtime.checkpoint.runId}`,
      agentRole: options.role,
      model,
      gateway: this.options.gateway,
      lease: this.options.lease,
      signal: this.options.signal,
    })
    this.records.push({
      parentAgentId: `orchestrator-${this.options.runtime.checkpoint.runId}`,
      agentId: session.agentId,
      skill: skill.contract.name,
      role: options.role,
      model,
      stage: options.stage,
    })
    return session
  }

  private modelForRole(role: string): string {
    if (this.options.modelForRole !== undefined) {
      const model = this.options.modelForRole(role)
      if (model.length > 0) {
        return model
      }
    }
    const allowed = this.options.runtime.allowedModels[role]
    if (allowed.length === 0) {
      throw new OrchestratorError(
        "NO_MODEL",
        `no allowed model for role ${role} in the Model Gateway configuration`
      )
    }
    return allowed[0] ?? ""
  }

  /** Each stage enters then moves to in-progress before it completes: the
   * Control Plane rejects `entered -> completed` and a status with no prior
   * `entered` record. */
  private async enterStage(stage: string): Promise<void> {
    await this.options.proposals.stageCommand({ kind: "enter-stage", stage })
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage,
      to: "in-progress",
    })
  }

  /** Detect: bounded Read Broker verification queries in parallel (never
   * subagents), then the Incident Brief v1 proposal. One full re-verification
   * on a stale symptom; then `failed: undiagnosable`. */
  async driveDetect(options: {
    symptom: string
    severity: "info" | "warning" | "critical"
    scope: {
      tenant_id: string
      deployment_environment_name: string
      service_name: string
    }
    serviceTopology?: string
    knownLimits?: string
    policyVersion: string
    verificationQueries?: readonly {
      backend: string
      connection_id: string
      query: string
      resource_type?: string
    }[]
  }): Promise<StageOutcome> {
    await this.enterStage("detect")
    if (
      options.verificationQueries !== undefined &&
      this.options.readBroker !== undefined
    ) {
      const results = await Promise.all(
        options.verificationQueries.map((query) =>
          this.options.readBroker?.read(
            this.options.lease,
            {
              backend: query.backend,
              connection_id: query.connection_id,
              query: query.query,
              ...(query.resource_type === undefined
                ? {}
                : { resource_type: query.resource_type }),
            },
            NO_CANDIDATE_HASH
          )
        )
      )
      if (
        results.some(
          (result) => result === undefined || result.result.outcome !== "ok"
        )
      ) {
        throw new OrchestratorError(
          "UNDIAGNOSABLE",
          "symptom verification reads failed; one full re-verification, then failed: undiagnosable"
        )
      }
    }
    const payload = {
      schema_version: "1.0",
      incident_id: this.options.runtime.checkpoint.incidentId,
      run_id: this.options.runtime.checkpoint.runId,
      attempt: this.options.runtime.checkpoint.attempt,
      severity: options.severity,
      scope: options.scope,
      symptom: options.symptom,
      initial_evidence_item_ids: this.options.evidence.criticalItemIds,
      ...(options.serviceTopology === undefined
        ? {}
        : { service_topology: options.serviceTopology }),
      ...(options.knownLimits === undefined
        ? {}
        : { known_limits: options.knownLimits }),
      policy_version: options.policyVersion,
      sealed_at: new Date().toISOString(),
    }
    const sealed = await this.options.proposals.sealArtifact({
      schemaId: "incident-brief",
      schemaVersion: "1.0",
      payload,
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage: "detect",
      to: "completed",
      artifact_ref: sealed.artifact_ref,
    })
    this.currentStage = "diagnose"
    return {
      stage: "detect",
      ok: true,
      detail: sealed.artifact_ref.content_hash,
    }
  }

  /** Diagnose: Fusion rounds until the deterministic Hypothesis gate accepts
   * one Hypothesis, then the Diagnosis Report v1. Only the Synthesized
   * Response continues; participant and Judge traces persist excluded. */
  async driveDiagnose(options: {
    task: string
    brief?: string
    roundCap: number | null
    demoProfile: boolean
    fusionConfig: {
      participantIds: string[]
      participantModels: string[]
      judgeId: string
      judgeModel: string
      synthesizerId: string
      synthesizerModel: string
    }
    remediationDisposition: RemediationDisposition
    /** The Orchestrator picks bounded actions from the Synthesizer's
     * next_actions and runs them through the brokers; the returned receipts
     * pin revision R_{n+1}. Absent, a `continue` verdict fails the stage. */
    gatherEvidence?: (
      actions: readonly {
        procedure: string
        bounds: string
        permissions: string[]
        discriminates: string[]
      }[]
    ) => Promise<{ newRevisionId: string; newItems: readonly EvidenceItem[] }>
    onRound?: (round: FusionRoundResult) => void
    /** Real-agent mode: replaces the deterministic skill session with a
     * real Pi role session runner. Receives everything the round needs. */
    runFusionRound?: (options: {
      round: number
      revisionId: string
      task: string
      brief?: string
      participantIds: string[]
      /** Perspectives per participant; the runner may supply its own. */
      participantPerspectives?: string[]
      judgeId: string
      synthesizerId: string
      parentAgentId: string
    }) => Promise<FusionRoundResult>
  }): Promise<StageOutcome> {
    await this.enterStage("diagnose")
    const { runtime } = this.options
    const activeTools = new Set([
      "read",
      "grep",
      "find",
      "ls",
      "docs_proxy",
      "evidence_note",
    ])
    let round = 0
    let revisionId = this.options.evidence.revisionId
    let items = this.options.evidence.items
    for (;;) {
      round += 1
      if (options.roundCap !== null && round > options.roundCap) {
        throw new OrchestratorError("ROUND_CAP", "fusion round cap exhausted")
      }
      const budget = runtime.budgets.consume("fusion-round")
      if (!budget.allowed) {
        throw new OrchestratorError("ROUND_CAP", "fusion round cap exhausted")
      }
      const result =
        options.runFusionRound === undefined
          ? await runFusionRound({
              round,
              revisionId,
              task: options.task,
              brief: options.brief,
              config: options.fusionConfig,
              skillsRoot: runtime.skillsRoot,
              scratchRoot: this.scratchRoot(),
              parentAgentId: `orchestrator-${runtime.checkpoint.runId}`,
              gateway: this.options.gateway,
              lease: this.options.lease,
              activeTools,
              demoProfile: options.demoProfile,
              signal: this.options.signal,
            })
          : await options.runFusionRound({
              round,
              revisionId,
              task: options.task,
              brief: options.brief,
              participantIds: options.fusionConfig.participantIds,
              judgeId: options.fusionConfig.judgeId,
              synthesizerId: options.fusionConfig.synthesizerId,
              parentAgentId: `orchestrator-${runtime.checkpoint.runId}`,
            })
      this.fusionRounds.push(result)
      options.onRound?.(result)
      if (!result.valid) {
        // Invalid round: rerun, counting against the round cap where one is
        // configured. A failed participant does not abort a valid round.
        continue
      }
      const synthesizer = result.synthesizer?.output
      if (synthesizer === undefined) {
        continue
      }
      const top = synthesizer.ranked_hypotheses.at(0)?.hypothesis
      if (top === undefined) {
        continue
      }
      const gate = await this.options.proposals.requestHypothesisGate({
        hypothesis: top,
        items,
        criticalItemIds: this.options.evidence.criticalItemIds,
        explainedAwayItemIds: [],
        observedScope: this.options.evidence.observedScope,
        materialAlternatives: this.options.evidence.materialAlternatives,
        testRuns: this.options.evidence.testRuns,
        counterfactualItemIds: this.options.evidence.counterfactualItemIds,
        freshnessWindow: this.options.evidence.freshnessWindow,
        expectedDeploymentVersion:
          this.options.evidence.expectedDeploymentVersion,
        coverage: this.options.evidence.coverage,
        evaluationTime: new Date().toISOString(),
        needsHumanReason: null,
      })
      if (gate.verdict === "pass") {
        return this.sealDiagnosisReport(
          synthesizer,
          options.remediationDisposition
        )
      }
      if (gate.verdict === "reject") {
        // The gate rejected the top Hypothesis; resurfacing it needs new
        // evidence that contradicts the rejection reason.
        continue
      }
      if (gate.verdict === "needs-human") {
        throw new OrchestratorError(
          "NEEDS_HUMAN",
          "the Hypothesis gate returned needs-human; the Run parks"
        )
      }
      // continue: gather the named evidence through the brokers, pin
      // revision R_{n+1}, and start the next round. Looping on the same
      // input is not allowed.
      if (options.gatherEvidence === undefined) {
        throw new OrchestratorError(
          "GATE_CONTINUE",
          "gate returned continue; evidence gathering drives the next round"
        )
      }
      const gathered = await options.gatherEvidence(synthesizer.next_actions)
      revisionId = gathered.newRevisionId
      items = gathered.newItems
    }
  }

  private async sealDiagnosisReport(
    synthesizer: NonNullable<FusionRoundResult["synthesizer"]>["output"] & {
      ranked_hypotheses: { hypothesis: Hypothesis }[]
      contradictions: { hypothesis_ids: string[]; cited_item_ids: string[] }[]
      gaps: { missing_evidence_kind: string }[]
      next_actions: {
        procedure: string
        bounds: string
        permissions: string[]
        discriminates: string[]
      }[]
      fusion_meta: {
        participant_ids: string[]
        judge_id: string
        synthesizer_id: string
        revision_id: string
      }
    },
    disposition: RemediationDisposition
  ): Promise<StageOutcome> {
    const payload = {
      schema_version: "1.0",
      incident_id: this.options.runtime.checkpoint.incidentId,
      run_id: this.options.runtime.checkpoint.runId,
      attempt: this.options.runtime.checkpoint.attempt,
      hypotheses: synthesizer.ranked_hypotheses.map(
        (entry) => entry.hypothesis
      ),
      contradictions: synthesizer.contradictions.map((entry) => ({
        hypothesis_ids: entry.hypothesis_ids,
        item_ids: entry.cited_item_ids,
      })),
      gaps: synthesizer.gaps.map((gap) => gap.missing_evidence_kind),
      next_actions: synthesizer.next_actions.map((action) => ({
        procedure: action.procedure,
        bounds: action.bounds,
        permissions: action.permissions,
        discriminates: action.discriminates,
      })),
      fusion_meta: {
        participant_ids: synthesizer.fusion_meta.participant_ids,
        judge_id: synthesizer.fusion_meta.judge_id,
        synthesizer_id: synthesizer.fusion_meta.synthesizer_id,
        revision_id: synthesizer.fusion_meta.revision_id,
        rounds: this.fusionRounds.map((round) => ({
          round: round.round,
          valid: round.valid,
          participant_ids: round.participantRuns.map(
            (run) => run.participantId
          ),
        })),
      },
      remediation_disposition: disposition,
      sealed_at: new Date().toISOString(),
    }
    const sealed = await this.options.proposals.sealArtifact({
      schemaId: "diagnosis-report",
      schemaVersion: "1.0",
      payload,
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage: "diagnose",
      to: "completed",
      artifact_ref: sealed.artifact_ref,
    })
    this.currentStage = "repair"
    return {
      stage: "diagnose",
      ok: true,
      detail: sealed.artifact_ref.content_hash,
    }
  }

  /** The durable context for any later stage: only the Synthesized Response;
   * Fusion Run Artifacts stay excluded. */
  laterContext(round: FusionRoundResult): string {
    if (round.synthesizer?.output === undefined) {
      throw new OrchestratorError(
        "NO_SYNTHESIS",
        "round carries no Synthesizer output"
      )
    }
    return buildLaterContext({
      synthesizerOutput: JSON.stringify(round.synthesizer.output),
      fusionArtifact: round.artifact,
    })
  }

  /** Repair: one planner subagent, then one implementer subagent in its own
   * copy-on-write worktree; the Orchestrator integrates the candidate into
   * the sole integration worktree. The Control Plane computes the
   * deterministic action-risk class; the candidate hash comes from the
   * shared contract helper, never from the model. */
  async driveRepair(options: {
    acceptedHypothesis: Hypothesis
    disposition: RemediationDisposition
    plannerTask: string
    implementerTask: string
    baseRef: string
    adapterDeclarations: {
      adapter: string
      action_class: string
      command: string
      category: string
      target: string
    }
    target: {
      tenant_id: string
      deployment_environment_name: string
      service_name: string
      expected_version?: string
    }
    policyVersion: string
    recoveryPoint: { id: string; changed_surfaces: string[] }
    changedFiles: readonly string[]
    changedSurfaces: readonly string[]
    runPlanner?: (session: SkillSession) => Promise<string>
    runImplementer?: (session: SkillSession) => Promise<string>
  }): Promise<StageOutcome> {
    void options.policyVersion
    await this.enterStage("repair")
    const planner = this.spawnSubagent({
      skillName: "sih-repair-planner",
      role: "repair-planner",
      taskInput: options.plannerTask,
      stage: "repair",
      scratchDir: `${this.scratchRoot()}/repair-planner`,
    })
    const plannerText =
      options.runPlanner !== undefined ? await options.runPlanner(planner) : ""
    const draft = parsePlannerDraft(plannerText)
    const implementer = this.spawnSubagent({
      skillName: "sih-repair-implementer",
      role: "repair-implementer",
      taskInput: options.implementerTask,
      stage: "repair",
      scratchDir: `${this.scratchRoot()}/repair-implementer`,
    })
    const diffText =
      options.runImplementer !== undefined
        ? await options.runImplementer(implementer)
        : ""

    const { diffHash } = validateImplementerDiff({
      diffText,
      baseRef: options.baseRef,
      allowedPaths: options.changedFiles,
    })

    // The deterministic action-risk class comes from the Control Plane policy
    // decision; the Orchestrator never computes it.
    const decision = await this.options.proposals.policyDecision(
      options.adapterDeclarations,
      "repair"
    )
    if (decision.riskClass === "barred") {
      throw new OrchestratorError(
        "BARRED_ACTION",
        "barred class records a human handoff; no execution"
      )
    }
    const riskClass = decision.riskClass as "safe" | "guarded" | "barred"
    const descriptionHash = hashOf(draft.changeDescription)
    const recoveryPointHash = hashOf(options.recoveryPoint)
    const candidateHash = computeCandidateHash({
      baseRef: options.baseRef,
      diffText: diffText,
      remediationClass: "code",
      disposition: options.disposition,
      descriptionHash,
      changedSurfaces: options.changedSurfaces as string[],
      actionRiskClass: riskClass,
      gatePath: "release",
      target: options.target,
      recoveryPointHash,
    })

    const payload = {
      schema_version: "1.0",
      incident_id: this.options.runtime.checkpoint.incidentId,
      run_id: this.options.runtime.checkpoint.runId,
      attempt: this.options.runtime.checkpoint.attempt,
      candidate_hash: candidateHash,
      remediation_class: "code",
      action_risk_class: riskClass,
      gate_path: "release",
      disposition: options.disposition,
      change_description: draft.changeDescription,
      diff: {
        base_ref: options.baseRef,
        diff_text: diffText,
        diff_hash: diffHash,
      },
      citations: draft.citations.map((citation) => ({
        change: citation.change,
        hypothesis_id: options.acceptedHypothesis.id,
        cited_item_ids: citation.cited_item_ids,
      })),
      test_plan: draft.testPlan,
      changed_surfaces: options.changedSurfaces,
      ...(draft.blastRadius === undefined
        ? {}
        : { blast_radius: draft.blastRadius }),
      recovery_point: options.recoveryPoint,
      sealed_at: new Date().toISOString(),
    }
    const sealed = await this.options.proposals.sealArtifact({
      schemaId: "remediation-proposal",
      schemaVersion: "1.0",
      payload,
      producer: { skill: "sih-repair-planner", skill_version: "1.0" },
    })
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage: "repair",
      to: "completed",
      artifact_ref: sealed.artifact_ref,
      candidate_hash: candidateHash,
    })
    this.currentStage = "verify"
    return { stage: "repair", ok: true, detail: candidateHash }
  }

  /** Verify: the Orchestrator requests the deterministic applicability
   * resolution, runs one skilled subagent per applicable role and layer
   * (spawning is graph work; here it consumes the check set and reports),
   * consolidates, and hands the verdict to the Control Plane. */
  async driveVerify(options: {
    candidateHash: string
    applicability: ApplicabilityResult
    applicabilityInput: ApplicabilityInput
    remediationClass: string
    gatePath: "release" | "action"
    riskClass: "safe" | "guarded" | "barred"
    reviewReports: readonly ReviewReport[]
    testReports: readonly TestReport[]
    contradictions: readonly Contradiction[]
    hypothesisInvalidated: boolean
    guardedApprovalValid: boolean
  }): Promise<StageOutcome> {
    await this.enterStage("verify")
    const { runtime } = this.options
    const required = options.applicability.required
    const consolidated = consolidateReviews(options.reviewReports, required, {
      adjudicated: [],
    })
    // Coverage is checked, not consensus: a missing report is a gap.
    if (consolidated.missingRoles.length > 0) {
      throw new OrchestratorError(
        "MISSING_REPORTS",
        `missing required review reports: ${consolidated.missingRoles.join(", ")}`
      )
    }
    const verdictInput = assembleVerdictInput({
      candidateHash: options.candidateHash,
      reports: options.reviewReports,
      testReports: options.testReports,
      contradictions: options.contradictions,
      hypothesisInvalidated: options.hypothesisInvalidated,
      guardedApprovalValid: options.guardedApprovalValid,
    })
    const verdict = await this.options.proposals.requestVerificationVerdict({
      candidateHash: options.candidateHash,
      attempt: runtime.checkpoint.attempt,
      remediationClass: options.remediationClass,
      riskClass: options.riskClass,
      gatePath: options.gatePath,
      resolver: options.applicabilityInput,
      reviews: verdictInput.input.reviews,
      tests: verdictInput.input.tests,
      guardedApprovalValid: verdictInput.input.guardedApprovalValid,
      hypothesisInvalidated: verdictInput.input.hypothesisInvalidated,
      contradictionUnresolved: verdictInput.input.contradictionUnresolved,
    })
    if (verdict.verdict === "pass") {
      await this.options.proposals.stageCommand({
        kind: "stage-status",
        stage: "verify",
        to: "completed",
        artifact_ref: verdict.artifact_ref,
        candidate_hash: options.candidateHash,
      })
      this.currentStage = "release"
      return { stage: "verify", ok: true, detail: verdict.verdict }
    }
    if (verdict.verdict === "fail") {
      throw new OrchestratorError(
        "VERIFICATION_FAILED",
        `verification failed: ${verdict.reason}`
      )
    }
    throw new OrchestratorError(
      "NEEDS_HUMAN",
      `verification needs a human: ${verdict.reason}`
    )
  }

  /** Release: the Orchestrator submits the release request; the Release Gate
   * and the Action Broker execute. The Orchestrator never executes and never
   * receives a credential. */
  async driveRelease(options: {
    candidateHash: string
    gateInput: Record<string, unknown>
    executePermittedAction?: (permit: {
      permitId: string
      token: string
    }) => Promise<{ receiptId: string }>
  }): Promise<StageOutcome> {
    await this.enterStage("release")
    const gate = await this.options.proposals.requestReleaseGate(
      options.gateInput
    )
    if (gate.verdict === "fail") {
      throw new OrchestratorError(
        "GATE_FAILED",
        "the Release Gate returned fail"
      )
    }
    if (
      gate.verdict !== "pass" ||
      gate.permit === null ||
      gate.permit === undefined
    ) {
      throw new OrchestratorError(
        "NEEDS_HUMAN",
        "the Release Gate returned needs-human; resume continues from the gate, never around it"
      )
    }
    const execution =
      options.executePermittedAction === undefined
        ? { receiptId: "permit-issued" }
        : await options.executePermittedAction(gate.permit)
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage: "release",
      to: "completed",
      candidate_hash: options.candidateHash,
      reason: execution.receiptId,
    })
    this.currentStage = "watch"
    return { stage: "release", ok: true, detail: execution.receiptId }
  }

  /** Watch: the frozen plan's queries run through the Read Broker and the
   * comparison happens in code; a model subagent may only assemble the Watch
   * Report. Limits never change and time alone never promotes. */
  async driveWatch(options: {
    rolloutStage: "1" | "2" | "confirmation"
    planRef: string
    samples: readonly WatchSample[]
  }): Promise<StageOutcome> {
    await this.enterStage("watch")
    const comparison = compareWatchSamples(options.samples)
    if (!comparison.passed) {
      throw new OrchestratorError(
        "WATCH_FAILED",
        `watch gates failed: ${comparison.failedGates.join(", ")}`
      )
    }
    const payload = {
      schema_version: "1.0",
      incident_id: this.options.runtime.checkpoint.incidentId,
      run_id: this.options.runtime.checkpoint.runId,
      attempt: this.options.runtime.checkpoint.attempt,
      rollout_stage: options.rolloutStage,
      plan_ref: options.planRef,
      samples: options.samples.map((sample) => ({
        gate: sample.gate,
        query: sample.query,
        time_range: sample.timeRange,
        sample_count: sample.sampleCount,
        value: sample.value,
        limit: sample.limit,
        outcome: sample.outcome,
      })),
      stage_outcome: "pass",
      sealed_at: new Date().toISOString(),
    }
    const sealed = await this.options.proposals.sealArtifact({
      schemaId: "watch-report",
      schemaVersion: "1.0",
      payload,
      producer: { skill: "sih-orchestrator", skill_version: "1.0" },
    })
    await this.options.proposals.stageCommand({
      kind: "stage-status",
      stage: "watch",
      to: "completed",
      artifact_ref: sealed.artifact_ref,
    })
    await this.options.proposals.completeRun("verified-remediation")
    return {
      stage: "watch",
      ok: true,
      detail: sealed.artifact_ref.content_hash,
    }
  }

  /** The Fusion Run Artifacts persist for the Incident Workspace and never
   * re-enter model context. */
  fusionArtifacts(): FusionRunArtifact[] {
    return this.fusionRounds.map((round) => round.artifact)
  }

  private scratchRoot(): string {
    // The disposable writable area: a temp directory per Worker, never the
    // skills tree or the repo.
    return `${process.env.TMPDIR ?? "/tmp"}/sih-worker-scratch/${this.options.runtime.checkpoint.runId}`
  }
}

export interface WatchSample {
  gate: "G1" | "G2" | "G3" | "G4" | "G5" | "G6"
  query: string
  timeRange: { starts_at: string; ends_at: string }
  sampleCount: number
  value: number
  limit: number
  outcome: "pass" | "fail"
}

/** The deterministic frozen-plan comparison: samples against limits, with
 * the sample floor and the missing-data rule. Never a model judgment. */
export function compareWatchSamples(samples: readonly WatchSample[]): {
  passed: boolean
  failedGates: string[]
} {
  const failedGates: string[] = []
  for (const sample of samples) {
    if (sample.sampleCount < 1) {
      // No data is never a pass.
      failedGates.push(`${sample.gate}:no-data`)
      continue
    }
    if (sample.outcome !== "pass") {
      failedGates.push(sample.gate)
      continue
    }
    const withinLimit =
      sample.gate === "G2" || sample.gate === "G5" || sample.gate === "G3"
        ? sample.value < sample.limit
        : true
    if (!withinLimit) {
      failedGates.push(`${sample.gate}:limit`)
    }
  }
  return { passed: failedGates.length === 0, failedGates }
}

function hashOf(payload: unknown): HashString {
  const digest = contentHash(JSON.parse(JSON.stringify(payload)) as never)
  if (!digest.ok) {
    throw new OrchestratorError("HASH_FAILED", digest.error.message)
  }
  return digest.value
}

function parsePlannerDraft(text: string): {
  changeDescription: string
  citations: { change: string; cited_item_ids: string[] }[]
  testPlan: string[]
  changedSurfaces: string[]
  blastRadius?: {
    services?: string[]
    environments?: string[]
    cohorts?: string[]
  }
  recoveryPointDraft: { id: string; changed_surfaces: string[] }
} {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new OrchestratorError(
      "MALFORMED_PLAN",
      "planner output carries no JSON object"
    )
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1))
  if (typeof parsed !== "object" || parsed === null) {
    throw new OrchestratorError(
      "MALFORMED_PLAN",
      "planner output is not an object"
    )
  }
  const draft = parsed as Partial<ReturnType<typeof parsePlannerDraft>>
  if (
    draft.changeDescription === undefined ||
    draft.citations === undefined ||
    draft.testPlan === undefined ||
    draft.changedSurfaces === undefined ||
    draft.recoveryPointDraft === undefined
  ) {
    throw new OrchestratorError(
      "MALFORMED_PLAN",
      "planner draft missing changeDescription, citations, testPlan, changedSurfaces, or recoveryPointDraft"
    )
  }
  return draft as ReturnType<typeof parsePlannerDraft>
}
