/**
 * The SIH Fusion runtime for Diagnose rounds, adapted from the live harness's
 * `research-fusion.ts` (inspected read-only).
 *
 * Kept from the live harness: parallel independent participants with the same
 * Shared Starting Context; Judge after all participants; Synthesizer after
 * the Judge; per-call retry, timeout, and abort; inspectable Fusion Run
 * Artifacts excluded from later model context.
 *
 * SIH deltas: participant outputs are machine-checked against the
 * `fusion-participant-output` schema; a round is valid when at least two
 * participants return well-formed outputs (one failed participant with two
 * valid outputs does not abort — the live harness aborts on any rejected
 * participant); no open web (docs proxy supplies context only); the Judge
 * emits a citation audit and never picks a winner; the Synthesizer output is
 * the only durable stage input.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ModelGateway, LeaseRef } from "@sih/brokers"
import { validate } from "@sih/contracts/parse"
import type {
  FusionJudgeOutput,
  FusionParticipantOutput,
  FusionSynthesizerOutput,
} from "@sih/contracts/types"

import { loadSkill } from "../skill-catalog.js"
import {
  SkillSession,
  extractJson,
  DEFAULT_RETRY_SETTINGS,
} from "../session.js"
import type { RetrySettings } from "../session.js"
import {
  createJudgePrompt,
  createParticipantPrompt,
  createSynthesizerPrompt,
  JUDGE_SYSTEM_PROMPT,
  PARTICIPANT_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
} from "../prompts.js"
import { diagnoseReadOnlyTools } from "../allow-lists.js"
import type { FusionPipelineCall, FusionRunArtifact } from "./traces.js"
import { artifactDigest, emptyFusionRunArtifact } from "./traces.js"

export interface FusionRoleConfig {
  participantIds: string[]
  participantModels: string[]
  judgeId: string
  judgeModel: string
  synthesizerId: string
  synthesizerModel: string
}

export interface FusionRoundOptions {
  round: number
  revisionId: string
  task: string
  brief?: string
  config: FusionRoleConfig
  skillsRoot: string
  scratchRoot: string
  parentAgentId: string
  gateway: ModelGateway
  lease: LeaseRef
  activeTools: ReadonlySet<string>
  retry?: Partial<RetrySettings>
  signal?: AbortSignal
  /**
   * The Demo Profile runs exactly two participants. The Solution Contract
   * keeps the participant count a policy choice (>= 2).
   */
  demoProfile?: boolean
}

export interface ParticipantRun {
  participantId: string
  model: string
  wellFormed: boolean
  output?: FusionParticipantOutput
  failure?: { message: string; attempts: number }
}

export interface JudgeRun {
  attempt: number
  wellFormed: boolean
  output?: FusionJudgeOutput
  failure?: { message: string }
  malformedReruns: number
}

export interface SynthesizerRun {
  attempt: number
  wellFormed: boolean
  output?: FusionSynthesizerOutput
  failure?: { message: string }
  malformedReruns: number
  /** Second malformed output: the round ends needs-human. */
  exhausted: boolean
}

export interface FusionRoundResult {
  round: number
  valid: boolean
  participantRuns: ParticipantRun[]
  judge?: JudgeRun
  synthesizer?: SynthesizerRun
  artifact: FusionRunArtifact
  artifactDigest: string
}

export class FusionRoundError extends Error {
  constructor(
    public readonly kind: "invalid-round" | "needs-human" | "aborted",
    message: string,
    public readonly artifact: FusionRunArtifact
  ) {
    super(message)
  }
}

/** A round is valid when at least two participants return well-formed
 * structured outputs. Failed participants are recorded and never abort. */
export function isRoundValid(
  participantRuns: readonly ParticipantRun[]
): boolean {
  return participantRuns.filter((run) => run.wellFormed).length >= 2
}

export const DIAGNOSE_GUARDRAILS = [
  "Diagnose stage: read-only investigation; no writes, no shell, no open web.",
  "The docs proxy supplies context only, never evidence.",
  "Cite Evidence Set item ids from the pinned revision only.",
] as const

function parseParticipantOutput(text: string): FusionParticipantOutput | null {
  const json = extractJson(text)
  if (json === null) {
    return null
  }
  const parsed: unknown = JSON.parse(json)
  const result = validate("fusion-participant-output", "1.0", parsed)
  return result.ok ? (result.value as FusionParticipantOutput) : null
}

function parseJudgeOutput(text: string): FusionJudgeOutput | null {
  const json = extractJson(text)
  if (json === null) {
    return null
  }
  const result = validate(
    "fusion-judge-output",
    "1.0",
    JSON.parse(json) as unknown
  )
  return result.ok ? (result.value as FusionJudgeOutput) : null
}

function parseSynthesizerOutput(text: string): FusionSynthesizerOutput | null {
  const json = extractJson(text)
  if (json === null) {
    return null
  }
  const result = validate(
    "fusion-synthesizer-output",
    "1.0",
    JSON.parse(json) as unknown
  )
  return result.ok ? (result.value as FusionSynthesizerOutput) : null
}

async function runSkillCall(options: {
  skillName: string
  role: string
  model: string
  systemPrompt: string
  taskInput: string
  skillsRoot: string
  scratchRoot: string
  parentAgentId: string
  gateway: ModelGateway
  lease: LeaseRef
  activeTools: ReadonlySet<string>
  retry: RetrySettings
  signal?: AbortSignal
}): Promise<{ text: string; attempts: number; retryDelaysMs: number[] }> {
  const skill = await loadSkill(
    join(options.skillsRoot, "core", options.skillName)
  )
  const session = new SkillSession({
    skill,
    allowList: diagnoseReadOnlyTools(),
    activeTools: options.activeTools,
    stage: "diagnose",
    guardrails: DIAGNOSE_GUARDRAILS,
    extraSystemPrompt: options.systemPrompt,
    taskInput: options.taskInput,
    scratchDir: join(
      options.scratchRoot,
      `${options.skillName}-${options.role}-${Math.random().toString(36).slice(2, 10)}`
    ),
    parentAgentId: options.parentAgentId,
    agentRole: options.role,
    model: options.model,
    gateway: options.gateway,
    lease: options.lease,
    retry: options.retry,
    signal: options.signal,
  })
  const result = await session.run()
  return {
    text: result.text,
    attempts: result.attempts,
    retryDelaysMs: result.retryDelaysMs,
  }
}

/**
 * Run one Fusion Diagnosis round: participants in parallel, then the Judge,
 * then the Synthesizer. Participant outputs validate against their schema;
 * a round with fewer than two well-formed outputs is invalid and reruns.
 */
export async function runFusionRound(
  options: FusionRoundOptions
): Promise<FusionRoundResult> {
  if (options.config.participantIds.length < 2) {
    throw new FusionRoundError(
      "invalid-round",
      "a Fusion round needs at least two participants",
      emptyFusionRunArtifact(
        options.round,
        options.revisionId,
        options.task,
        options.brief
      )
    )
  }
  if (
    options.demoProfile === true &&
    options.config.participantIds.length !== 2
  ) {
    throw new FusionRoundError(
      "invalid-round",
      "the Demo Profile runs exactly two Fusion participants",
      emptyFusionRunArtifact(
        options.round,
        options.revisionId,
        options.task,
        options.brief
      )
    )
  }

  const retry = { ...DEFAULT_RETRY_SETTINGS, ...options.retry }
  const artifact = emptyFusionRunArtifact(
    options.round,
    options.revisionId,
    options.task,
    options.brief
  )
  const calls: FusionPipelineCall[] = []
  const recordCall = (
    call: Omit<FusionPipelineCall, "durationMs" | "status"> & {
      startedAt: string
      durationMs?: number
      status?: FusionPipelineCall["status"]
    }
  ): FusionPipelineCall => {
    const entry = {
      ...call,
      status: call.status ?? "succeeded",
      durationMs: call.durationMs ?? 0,
    }
    calls.push(entry)
    return entry
  }

  const participantPrompt = createParticipantPrompt(
    options.task,
    options.brief,
    options.revisionId
  )

  const settled = await Promise.allSettled(
    options.config.participantIds.map(async (participantId, index) => {
      const model = options.config.participantModels.at(index)
      if (model === undefined) {
        throw new Error(`missing model for participant ${participantId}`)
      }
      const startedAt = Date.now()
      const call = recordCall({
        kind: "participant",
        role: participantId,
        model,
        systemPrompt: PARTICIPANT_SYSTEM_PROMPT,
        inputPrompt: participantPrompt,
        output: null,
        attempts: 0,
        retryDelaysMs: [],
        promptTokens: 0,
        completionTokens: 0,
        startedAt: new Date().toISOString(),
      })
      try {
        const result = await runSkillCall({
          skillName: "sih-fusion-participant",
          role: "participant",
          model,
          systemPrompt: PARTICIPANT_SYSTEM_PROMPT,
          taskInput: participantPrompt,
          skillsRoot: options.skillsRoot,
          scratchRoot: options.scratchRoot,
          parentAgentId: options.parentAgentId,
          gateway: options.gateway,
          lease: options.lease,
          activeTools: options.activeTools,
          retry,
          signal: options.signal,
        })
        call.output = result.text
        call.attempts = result.attempts
        call.retryDelaysMs = result.retryDelaysMs
        call.durationMs = Date.now() - startedAt
        const output = parseParticipantOutput(result.text)
        if (output === null) {
          call.status = "failed"
          call.failureMessage =
            "participant output failed the Fusion Participant Output v1 schema check"
          return {
            participantId,
            model,
            wellFormed: false,
            failure: {
              message: call.failureMessage,
              attempts: result.attempts,
            },
          } satisfies ParticipantRun
        }
        return {
          participantId,
          model,
          wellFormed: true,
          output,
        } satisfies ParticipantRun
      } catch (error) {
        call.status = "failed"
        call.failureMessage =
          error instanceof Error ? error.message : String(error)
        call.durationMs = Date.now() - startedAt
        return {
          participantId,
          model,
          wellFormed: false,
          failure: { message: call.failureMessage, attempts: 0 },
        } satisfies ParticipantRun
      }
    })
  )

  const participantRuns = settled.map((result) => {
    if (result.status === "fulfilled") {
      return result.value
    }
    return {
      participantId: "unknown",
      model: "unknown",
      wellFormed: false,
      failure: { message: "participant call rejected", attempts: 0 },
    } satisfies ParticipantRun
  })
  artifact.calls = [...calls]

  const roundValid = isRoundValid(participantRuns)
  if (!roundValid) {
    artifact.status = "invalid"
    artifact.statusReason = `${participantRuns.filter((run) => run.wellFormed).length} well-formed participant outputs; a round needs at least two`
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      artifact,
      artifactDigest: await artifactDigest(artifact),
    }
  }

  // Judge after all participants. Input: participant outputs only, never
  // tool traces. Malformed output reruns once; a second failure invalidates
  // the round.
  const judgeInputs = participantRuns
    .filter((run) => run.wellFormed)
    .map((run) => ({
      participantId: run.participantId,
      output: JSON.stringify(run.output),
    }))
  const judgePrompt = createJudgePrompt(
    options.task,
    options.brief,
    options.revisionId,
    judgeInputs
  )
  const judgeRun = await runJudgeOrSynthesizer({
    kind: "judge",
    skillName: "sih-fusion-judge",
    role: "judge",
    model: options.config.judgeModel,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    prompt: judgePrompt,
    parse: parseJudgeOutput,
    options,
    retry,
    record: (call) => calls.push(call),
  })
  artifact.calls = [...calls]
  if (!judgeRun.wellFormed) {
    artifact.status = "invalid"
    artifact.statusReason =
      "Judge output malformed after one rerun; the round is invalid"
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      judge: judgeRun,
      artifact,
      artifactDigest: await artifactDigest(artifact),
    }
  }

  const synthesizerPrompt = createSynthesizerPrompt(
    options.task,
    options.brief,
    options.revisionId,
    judgeInputs,
    JSON.stringify(judgeRun.output)
  )
  const synthesizerRun = await runJudgeOrSynthesizer({
    kind: "synthesizer",
    skillName: "sih-fusion-synthesizer",
    role: "synthesizer",
    model: options.config.synthesizerModel,
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
    prompt: synthesizerPrompt,
    parse: parseSynthesizerOutput,
    options,
    retry,
    record: (call) => calls.push(call),
  })
  artifact.calls = [...calls]

  if (!synthesizerRun.wellFormed) {
    artifact.status = "failed"
    artifact.statusReason =
      "Synthesizer output malformed after one rerun; the round ends needs-human"
    artifact.sealedAt = new Date().toISOString()
    return {
      round: options.round,
      valid: false,
      participantRuns,
      judge: judgeRun,
      synthesizer: synthesizerRun,
      artifact,
      artifactDigest: await artifactDigest(artifact),
    }
  }

  artifact.status = "succeeded"
  artifact.sealedAt = new Date().toISOString()

  // The Fusion Run Artifact persists for inspection (Worker scratch here;
  // the journal records its hash) and stays out of later model context.
  await mkdir(join(options.scratchRoot, "fusion"), { recursive: true })
  await writeFile(
    join(options.scratchRoot, "fusion", `round-${options.round}.json`),
    JSON.stringify(artifact, null, 2)
  )

  return {
    round: options.round,
    valid: true,
    participantRuns,
    judge: judgeRun,
    synthesizer: synthesizerRun,
    artifact,
    artifactDigest: await artifactDigest(artifact),
  }
}

async function runJudgeOrSynthesizer<T>(options: {
  kind: "judge" | "synthesizer"
  skillName: string
  role: string
  model: string
  systemPrompt: string
  prompt: string
  parse: (text: string) => T | null
  options: FusionRoundOptions
  retry: RetrySettings
  record: (call: FusionPipelineCall) => void
}): Promise<{
  attempt: number
  wellFormed: boolean
  output?: T
  failure?: { message: string }
  malformedReruns: number
  exhausted: boolean
}> {
  const { options: roundOptions } = options
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now()
    const call: FusionPipelineCall = {
      kind: options.kind,
      role: options.role,
      model: options.model,
      status: "succeeded",
      systemPrompt: options.systemPrompt,
      inputPrompt: options.prompt,
      output: null,
      attempts: 0,
      retryDelaysMs: [],
      promptTokens: 0,
      completionTokens: 0,
      startedAt: new Date().toISOString(),
      durationMs: 0,
    }
    try {
      const result = await runSkillCall({
        skillName: options.skillName,
        role: options.role,
        model: options.model,
        systemPrompt: options.systemPrompt,
        taskInput: options.prompt,
        skillsRoot: roundOptions.skillsRoot,
        scratchRoot: roundOptions.scratchRoot,
        parentAgentId: roundOptions.parentAgentId,
        gateway: roundOptions.gateway,
        lease: roundOptions.lease,
        activeTools: roundOptions.activeTools,
        retry: options.retry,
        signal: roundOptions.signal,
      })
      call.output = result.text
      call.attempts = result.attempts
      call.retryDelaysMs = result.retryDelaysMs
      call.durationMs = Date.now() - startedAt
      const parsed = options.parse(result.text)
      if (parsed !== null) {
        options.record(call)
        return {
          attempt,
          wellFormed: true,
          output: parsed,
          malformedReruns: attempt - 1,
          exhausted: false,
        }
      }
      call.status = "failed"
      call.failureMessage = `${options.kind} output failed its schema check`
      options.record(call)
    } catch (error) {
      call.status = "failed"
      call.failureMessage =
        error instanceof Error ? error.message : String(error)
      call.durationMs = Date.now() - startedAt
      options.record(call)
    }
  }
  return {
    attempt: 2,
    wellFormed: false,
    failure: { message: `${options.kind} output malformed after one rerun` },
    malformedReruns: 1,
    exhausted: true,
  }
}
