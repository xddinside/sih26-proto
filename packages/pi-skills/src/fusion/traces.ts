/**
 * Fusion Run Artifacts, mirroring the live harness's `run-artifacts.ts` and
 * `trace-collector.ts`: participant, Judge, and Synthesizer traces persist
 * for inspection but are excluded from later model context
 * (`excludeFromContext: true`). Only the Synthesized Response is durable
 * stage input. Artifacts persist even for failed and aborted rounds.
 */
import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"

export type FusionCallKind = "brief" | "participant" | "judge" | "synthesizer"

export interface FusionPipelineCall {
  kind: FusionCallKind
  role: string
  model: string
  status: "succeeded" | "failed" | "aborted"
  systemPrompt: string
  inputPrompt: string
  output: string | null
  failureMessage?: string
  attempts: number
  retryDelaysMs: number[]
  promptTokens: number
  completionTokens: number
  startedAt: string
  durationMs: number
  /** Model turns and non-terminal tool calls for a real Pi role session. */
  turns?: number
  toolCalls?: number
}

/** One participant's perspective, in its configured order. */
export interface FusionPerspective {
  participantId: string
  perspective: string
  order: number
}

/** Aggregate session metrics for a real-agent Fusion round. */
export interface FusionRunMetrics {
  participants: {
    participantId: string
    status: "succeeded" | "failed" | "aborted"
    turns: number
    toolCalls: number
    durationMs: number
  }[]
  judge: {
    status: "succeeded" | "failed" | "aborted"
    turns: number
    toolCalls: number
    durationMs: number
  } | null
  synthesizer: {
    status: "succeeded" | "failed" | "aborted"
    turns: number
    toolCalls: number
    durationMs: number
  } | null
  totalWallClockMs: number
}

export interface FusionRunArtifact {
  schema_version: "1.0"
  round: number
  revisionId: HashString
  task: string
  brief?: string
  calls: FusionPipelineCall[]
  status: "succeeded" | "invalid" | "failed" | "aborted"
  statusReason?: string
  /**
   * The live harness stores Fusion Run Artifacts as custom messages with
   * `excludeFromContext: true`. Only the Synthesized Response continues as
   * durable stage input.
   */
  excludeFromContext: true
  sealedAt: string
  /** Participant perspectives in their configured order. */
  perspectives?: FusionPerspective[]
  /** Aggregate session metrics for real-agent rounds. */
  metrics?: FusionRunMetrics
}

export function emptyFusionRunArtifact(
  round: number,
  revisionId: string,
  task: string,
  brief: string | undefined
): FusionRunArtifact {
  return {
    schema_version: "1.0",
    round,
    revisionId: revisionId as HashString,
    task,
    ...(brief === undefined ? {} : { brief }),
    calls: [],
    status: "failed",
    excludeFromContext: true,
    sealedAt: new Date().toISOString(),
  }
}

export async function artifactDigest(
  artifact: FusionRunArtifact
): Promise<HashString> {
  const digest = contentHash(JSON.parse(JSON.stringify(artifact)) as never)
  if (!digest.ok) {
    throw new Error(`fusion artifact digest failed: ${digest.error.message}`)
  }
  return digest.value
}

/**
 * Assemble the context for any later model stage (evidence gathering, Repair,
 * Verify). Participant and Judge traces and Fusion Run Artifacts are never
 * included; only the Synthesized Response enters.
 */
export function buildLaterContext(options: {
  synthesizerOutput: string
  fusionArtifact: FusionRunArtifact
}): string {
  const artifactText = JSON.stringify(options.fusionArtifact)
  if (artifactText.includes(options.synthesizerOutput)) {
    throw new Error("fusion artifact must not embed later context")
  }
  // `excludeFromContext` is a type-level guarantee on FusionRunArtifact: the
  // artifact is always excluded from later model context.
  return options.synthesizerOutput
}

/** True when the given context is free of every excluded trace. The traces
 * are the per-call outputs of participants and the Judge; the Synthesized
 * Response may legitimately echo hypothesis content, but never a raw
 * participant or Judge output. */
export function assertExcludedFromContext(
  context: string,
  artifact: FusionRunArtifact
): boolean {
  const traces = artifact.calls
    .filter((call) => call.kind === "participant" || call.kind === "judge")
    .map((call) => call.output)
    .filter((output): output is string => output !== null)
  return traces.every((trace) => !context.includes(trace))
}
