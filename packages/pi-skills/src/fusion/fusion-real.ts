/**
 * The real-agent Fusion round: two Pi role sessions run in parallel as
 * participants (each with its own perspective), then one Judge session, then
 * one Synthesizer session. Every role ends in one schema-valid typed terminal
 * submission (`submit_hypotheses`, `submit_judgment`, `submit_synthesis`)
 * whose payload is validated against the @sih/contracts registry and sealed
 * through the Control Plane seam the caller supplies. The pipeline calls are
 * recorded in actual order with participants in perspective order; aggregate
 * metrics are recorded; failed and aborted rounds still return a partial
 * artifact.
 */
import type { ModelGateway, LeaseRef, ReadBroker } from "@sih/brokers"
import type {
  FusionJudgeOutput,
  FusionParticipantOutput,
  FusionSynthesizerOutput,
} from "@sih/contracts/types"
import type { ThinkingLevel } from "@earendil-works/pi-ai"

import {
  createJudgePrompt,
  createParticipantPrompt,
  createSynthesizerPrompt,
  JUDGE_SYSTEM_PROMPT,
  PARTICIPANT_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "../prompts.js"
import { PiRoleSession } from "../role/role-session.js"
import type { RoleSessionPhase } from "../role/role-session.js"
import type { RoleLimits } from "../role/limits.js"
import { createReadTool } from "../role/broker-tools.js"
import { createTerminalTool } from "../role/terminal-tools.js"
import type { FusionRunArtifact, FusionRunMetrics } from "./traces.js"
import { artifactDigest, emptyFusionRunArtifact } from "./traces.js"
import type { ParticipantRun, JudgeRun, SynthesizerRun } from "./fusion-runtime.js"

/** The durability seam: seal one role output as an artifact and return its
 * content hash (the submission id). */
export interface FusionSealSurface {
  seal: (input: {
    schemaId: string
    schemaVersion: string
    payload: unknown
    producer?: { skill?: string; skill_version?: string }
  }) => Promise<{ content_hash: string }>
}

export interface RealFusionRoundOptions {
  round: number
  revisionId: string
  task: string
  brief?: string
  /** Participant ids in perspective order. */
  participantIds: string[]
  /** One perspective per participant, aligned by index. */
  participantPerspectives: string[]
  judgeId: string
  synthesizerId: string
  parentAgentId: string
  gateway: ModelGateway
  lease: LeaseRef
  readBroker?: ReadBroker
  candidateHash: string
  seal: FusionSealSurface
  /** The provider/model pair every session in the round uses. */
  model: { provider: string; id: string }
  reasoning?: ThinkingLevel
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
  /** The tools each session may call besides its terminal tool. */
  tools?: readonly string[]
}

export interface FusionRoleSessionRecord {
  role: "participant" | "judge" | "synthesizer"
  agentId: string
  status: "succeeded" | "failed" | "aborted"
  submissionId?: string
  /** The sealed agent-run-artifact hash for this session. */
  runArtifactRef?: string
  modelUseAgentIds: string[]
  turns: number
  toolCalls: number
  durationMs: number
}

export interface RealFusionRoundResult {
  round: number
  valid: boolean
  participantRuns: ParticipantRun[]
  judge?: JudgeRun
  synthesizer?: SynthesizerRun
  artifact: FusionRunArtifact
  artifactDigest: string
  /** Per-role session records, in run order, for the capture manifest. */
  sessions: FusionRoleSessionRecord[]
}

const READ_TOOL = "read_broker_query"

/** The authority set for a role session: the terminal tool that ends the
 * role, the broker read tool, and any other declared tools. Every registered
 * tool must be inside the effective set or the Pi loop never exposes it. */
function authorityTools(
  terminalName: string,
  tools: readonly string[],
): string[] {
  return [terminalName, READ_TOOL, ...tools]
}

/**
 * Run one real Fusion round. Participant sessions run in parallel; Judge and
 * Synthesizer run after them. A round is valid when at least two participants
 * submitted well-formed outputs; a failed participant never aborts a valid
 * round. Judge and Synthesizer failures invalidate or fail the round but the
 * partial artifact still returns.
 */
export async function runRealFusionRound(
  options: RealFusionRoundOptions,
): Promise<RealFusionRoundResult> {
  if (options.participantIds.length < 2) {
    throw new Error("a real Fusion round needs at least two participants")
  }
  if (options.participantPerspectives.length !== options.participantIds.length) {
    throw new Error("participantPerspectives must align with participantIds")
  }
  const startedAt = Date.now()
  const artifact = emptyFusionRunArtifact(
    options.round,
    options.revisionId,
    options.task,
    options.brief,
  )
  artifact.perspectives = options.participantIds.map((participantId, index) => ({
    participantId,
    perspective: options.participantPerspectives[index] ?? "",
    order: index + 1,
  }))

  const participantPrompt = createParticipantPrompt(
    options.task,
    options.brief,
    options.revisionId,
  )
  const calls: FusionRunArtifact["calls"] = []
  const sessions: FusionRoleSessionRecord[] = []

  // Participants run concurrently. Results are collected per index and then
  // recorded in configured perspective order below, never in completion
  // order, so persisted and displayed participant order always follows the
  // configured perspectives.
  const participantResults = await Promise.all(
    options.participantIds.map(async (participantId, index) => {
      const perspective = options.participantPerspectives[index] ?? ""
      const agentId = `${participantId}-${options.round}`
      const call = newCall("participant", participantId, options, participantPrompt)
      const captured = await runRoleSession({
        options,
        agentId,
        roleLabel: "participant",
        systemPrompt: [
          PARTICIPANT_SYSTEM_PROMPT,
          `Your assigned investigation perspective: ${perspective}`,
          "Treat it as a starting lens, not a constraint: you may reject it or propose any Hypothesis the evidence supports.",
        ].join("\n"),
        promptText: participantPrompt,
        terminalName: "submit_hypotheses",
        schemaName: "fusion-participant-output",
        schemaVersion: "1.0",
        call,
        readBroker: options.readBroker,
      })
      let run: ParticipantRun
      if (captured.payload !== null && captured.status === "succeeded") {
        run = {
          participantId,
          model: modelLabel(options),
          wellFormed: true,
          output: captured.payload as FusionParticipantOutput,
        } satisfies ParticipantRun
      } else {
        run = {
          participantId,
          model: modelLabel(options),
          wellFormed: false,
          failure: {
            message: captured.session.status === "succeeded"
              ? "participant output failed the Fusion Participant Output v1 schema check"
              : (captured.session.status === "aborted"
                  ? "participant session aborted"
                  : "participant session failed"),
            attempts: 1,
          },
        } satisfies ParticipantRun
      }
      return { call, session: captured.session, run }
    }),
  )
  const participantRuns = participantResults.map((result) => result.run)
  for (const result of participantResults) {
    sessions.push(result.session)
    calls.push(result.call)
  }
  artifact.calls = [...calls]

  const roundValid = participantRuns.filter((run) => run.wellFormed).length >= 2
  if (!roundValid) {
    const aborted = options.signal?.aborted === true
    artifact.status = aborted ? "aborted" : "invalid"
    artifact.statusReason = aborted
      ? "Fusion round aborted before the Judge; no terminal results"
      : `${participantRuns.filter((run) => run.wellFormed).length} well-formed participant outputs; a round needs at least two`
    artifact.metrics = metricsOf(sessions, startedAt)
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      artifact,
      artifactDigest: await artifactDigest(artifact),
      sessions,
    }
  }

  // Judge after all participants.
  const judgeInputs = participantRuns
    .filter((run) => run.wellFormed)
    .map((run) => ({
      participantId: run.participantId,
      output: JSON.stringify(run.output),
    }))
  const judgeId = `${options.judgeId}-${options.round}`
  const judgeCall = newCall(
    "judge",
    options.judgeId,
    options,
    createJudgePrompt(options.task, options.brief, options.revisionId, judgeInputs),
  )
  const judgeCaptured = await runRoleSession({
    options,
    agentId: judgeId,
    roleLabel: "judge",
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    promptText: judgeCall.inputPrompt,
    terminalName: "submit_judgment",
    schemaName: "fusion-judge-output",
    schemaVersion: "1.0",
    call: judgeCall,
    readBroker: options.readBroker,
  })
  sessions.push(judgeCaptured.session)
  calls.push(judgeCall)
  artifact.calls = [...calls]
  let judge: JudgeRun | undefined
  if (judgeCaptured.payload === null || judgeCaptured.status !== "succeeded") {
    judge = {
      attempt: 1,
      wellFormed: false,
      failure: {
        message: judgeCaptured.session.status === "aborted"
          ? "Judge session aborted"
          : "Judge output malformed after one rerun",
      },
      malformedReruns: 0,
    }
    artifact.status = options.signal?.aborted === true ? "aborted" : "invalid"
    artifact.statusReason =
      options.signal?.aborted === true
        ? "Fusion round aborted during the Judge"
        : "Judge output malformed; the round is invalid"
    artifact.metrics = metricsOf(sessions, startedAt)
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      judge,
      artifact,
      artifactDigest: await artifactDigest(artifact),
      sessions,
    }
  }
  judge = {
    attempt: 1,
    wellFormed: true,
    output: judgeCaptured.payload as FusionJudgeOutput,
    malformedReruns: 0,
  }

  // Synthesizer after the Judge.
  const synthesizerId = `${options.synthesizerId}-${options.round}`
  const synthesizerCall = newCall(
    "synthesizer",
    options.synthesizerId,
    options,
    createSynthesizerPrompt(
      options.task,
      options.brief,
      options.revisionId,
      judgeInputs,
      JSON.stringify(judge.output),
    ),
  )
  const synthesizerCaptured = await runRoleSession({
    options,
    agentId: synthesizerId,
    roleLabel: "synthesizer",
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
    promptText: synthesizerCall.inputPrompt,
    terminalName: "submit_synthesis",
    schemaName: "fusion-synthesizer-output",
    schemaVersion: "1.0",
    call: synthesizerCall,
    readBroker: options.readBroker,
  })
  sessions.push(synthesizerCaptured.session)
  calls.push(synthesizerCall)
  artifact.calls = [...calls]
  let synthesizer: SynthesizerRun | undefined
  if (
    synthesizerCaptured.payload === null ||
    synthesizerCaptured.status !== "succeeded"
  ) {
    synthesizer = {
      attempt: 1,
      wellFormed: false,
      failure: {
        message: synthesizerCaptured.session.status === "aborted"
          ? "Synthesizer session aborted"
          : "Synthesizer output malformed after one rerun",
      },
      malformedReruns: 0,
      exhausted: false,
    }
    artifact.status =
      options.signal?.aborted === true ? "aborted" : "failed"
    artifact.statusReason =
      options.signal?.aborted === true
        ? "Fusion round aborted during the Synthesizer"
        : "Synthesizer output malformed; the round ends needs-human"
    artifact.metrics = metricsOf(sessions, startedAt)
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      judge,
      synthesizer,
      artifact,
      artifactDigest: await artifactDigest(artifact),
      sessions,
    }
  }
  synthesizer = {
    attempt: 1,
    wellFormed: true,
    output: synthesizerCaptured.payload as FusionSynthesizerOutput,
    malformedReruns: 0,
    exhausted: false,
  }

  artifact.status = "succeeded"
  artifact.metrics = metricsOf(sessions, startedAt)
  artifact.sealedAt = new Date().toISOString()

  return {
    round: options.round,
    valid: true,
    participantRuns,
    judge,
    synthesizer,
    artifact,
    artifactDigest: await artifactDigest(artifact),
    sessions,
  }
}

function modelLabel(options: RealFusionRoundOptions): string {
  return `${options.model.provider}/${options.model.id}`
}

function newCall(
  kind: "participant" | "judge" | "synthesizer",
  role: string,
  options: RealFusionRoundOptions,
  inputPrompt: string,
): FusionRunArtifact["calls"][number] {
  return {
    kind,
    role,
    model: modelLabel(options),
    status: "failed",
    systemPrompt: "",
    inputPrompt,
    output: null,
    attempts: 1,
    retryDelaysMs: [],
    promptTokens: 0,
    completionTokens: 0,
    startedAt: new Date().toISOString(),
    durationMs: 0,
  }
}

interface CapturedRoleResult {
  status: "succeeded" | "failed" | "aborted"
  payload: unknown | null
  session: FusionRoleSessionRecord
}

async function runRoleSession(options: {
  options: RealFusionRoundOptions
  agentId: string
  roleLabel: string
  systemPrompt: string
  promptText: string
  terminalName: string
  schemaName: string
  schemaVersion: string
  call: FusionRunArtifact["calls"][number]
  readBroker?: ReadBroker
}): Promise<CapturedRoleResult> {
  const started = Date.now()
  let capturedPayload: unknown = null
  let submissionId: string | undefined
  const terminal = createTerminalTool({
    name: options.terminalName,
    schemaName: options.schemaName,
    schemaVersion: options.schemaVersion,
    submit: async (payload) => {
      capturedPayload = payload
      const sealed = await options.options.seal.seal({
        schemaId: options.schemaName,
        schemaVersion: options.schemaVersion,
        payload,
        producer: { skill: `sih-fusion-${options.roleLabel}`, skill_version: "1.0" },
      })
      submissionId = sealed.content_hash
      return { submissionId: sealed.content_hash }
    },
  })
  const tools = []
  if (options.readBroker !== undefined) {
    tools.push(
      createReadTool({
        broker: options.readBroker,
        lease: options.options.lease,
        candidateHash: options.options.candidateHash,
      }),
    )
  }
  tools.push(terminal.tool)
  const toolNames = authorityTools(
    options.terminalName,
    options.options.tools ?? [],
  )
  const session = new PiRoleSession({
    agentId: options.agentId,
    parentAgentId: options.options.parentAgentId,
    agentRole: options.roleLabel,
    phase: options.roleLabel as RoleSessionPhase,
    systemPrompt: options.systemPrompt,
    model: options.options.model,
    reasoning: options.options.reasoning,
    lease: options.options.lease,
    gateway: options.options.gateway,
    candidateHash: options.options.candidateHash,
    tools,
    terminalTool: terminal,
    authority: {
      roleTools: toolNames,
      stageTools: toolNames,
      policyTools: toolNames,
      leaseTools: toolNames,
    },
    limits: options.options.limits,
    signal: options.options.signal,
  })
  const result = await session.run(options.promptText)
  const status = result.status
  const payload = status === "succeeded" ? capturedPayload : null
  const sealedRun = await options.options.seal.seal({
    schemaId: "agent-run-artifact",
    schemaVersion: "1.0",
    payload: result.artifact,
    producer: { skill: `sih-fusion-${options.roleLabel}`, skill_version: "1.0" },
  })
  options.call.status = status
  options.call.durationMs = Date.now() - started
  options.call.turns = result.turns
  options.call.toolCalls = result.toolCalls
  options.call.systemPrompt = options.systemPrompt
  if (payload !== null) {
    options.call.output = JSON.stringify(payload)
  }
  if (status !== "succeeded") {
    options.call.failureMessage = result.failureReason
  }
  const record: FusionRoleSessionRecord = {
    role: options.roleLabel as FusionRoleSessionRecord["role"],
    agentId: options.agentId,
    status,
    turns: result.turns,
    toolCalls: result.toolCalls,
    durationMs: Date.now() - started,
    modelUseAgentIds: [options.agentId],
    runArtifactRef: sealedRun.content_hash,
  }
  if (submissionId !== undefined) {
    record.submissionId = submissionId
  }
  return { status, payload, session: record }
}

function metricsOf(
  sessions: readonly FusionRoleSessionRecord[],
  startedAt: number,
): FusionRunMetrics {
  const byRole = (role: FusionRoleSessionRecord["role"]) =>
    sessions.filter((session) => session.role === role)
  const take = (
    role: FusionRoleSessionRecord["role"],
  ): FusionRunMetrics["judge"] => {
    const session = byRole(role).at(0)
    if (session === undefined) {
      return null
    }
    return {
      status: session.status,
      turns: session.turns,
      toolCalls: session.toolCalls,
      durationMs: session.durationMs,
    }
  }
  return {
    participants: byRole("participant").map((session) => ({
      participantId: session.agentId,
      status: session.status,
      turns: session.turns,
      toolCalls: session.toolCalls,
      durationMs: session.durationMs,
    })),
    judge: take("judge"),
    synthesizer: take("synthesizer"),
    totalWallClockMs: Date.now() - startedAt,
  }
}