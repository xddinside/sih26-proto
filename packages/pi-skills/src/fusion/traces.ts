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

/** The snake_case wire shape of a sealed Fusion Run Artifact. */
export interface FusionRunArtifactWire {
  schema_version: "1.0"
  round: number
  revision_id: string
  task: string
  brief?: string
  calls: {
    kind: FusionPipelineCall["kind"]
    role: string
    model: string
    status: FusionPipelineCall["status"]
    system_prompt: string
    input_prompt: string
    output: string | null
    failure_message?: string
    attempts: number
    retry_delays_ms: number[]
    prompt_tokens: number
    completion_tokens: number
    started_at: string
    duration_ms: number
    turns?: number
    tool_calls?: number
  }[]
  status: FusionRunArtifact["status"]
  status_reason?: string
  exclude_from_context: true
  sealed_at: string
  perspectives?: {
    participant_id: string
    perspective: string
    order: number
  }[]
  metrics?: {
    participants: {
      participant_id: string
      status: FusionRunMetrics["participants"][number]["status"]
      turns: number
      tool_calls: number
      duration_ms: number
    }[]
    judge: {
      status: FusionRunMetrics["judge"] extends infer T
        ? T extends { status: infer S }
          ? S
          : never
        : never
      turns: number
      tool_calls: number
      duration_ms: number
    } | null
    synthesizer: {
      status: FusionRunMetrics["synthesizer"] extends infer T
        ? T extends { status: infer S }
          ? S
          : never
        : never
      turns: number
      tool_calls: number
      duration_ms: number
    } | null
    total_wall_clock_ms: number
  }
}

const roleMetricWire = (
  metric: NonNullable<FusionRunMetrics["judge"]>,
): {
  status: FusionRunMetrics["judge"] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never
  turns: number
  tool_calls: number
  duration_ms: number
} => ({
  status: metric.status,
  turns: metric.turns,
  tool_calls: metric.toolCalls,
  duration_ms: metric.durationMs,
})

/** Convert a camelCase `FusionRunArtifact` to its snake_case sealed shape. */
export function fusionRunArtifactWire(
  artifact: FusionRunArtifact
): FusionRunArtifactWire {
  return {
    schema_version: "1.0",
    round: artifact.round,
    revision_id: artifact.revisionId,
    task: artifact.task,
    ...(artifact.brief === undefined ? {} : { brief: artifact.brief }),
    calls: artifact.calls.map((call) => ({
      kind: call.kind,
      role: call.role,
      model: call.model,
      status: call.status,
      system_prompt: call.systemPrompt,
      input_prompt: call.inputPrompt,
      output: call.output,
      ...(call.failureMessage === undefined
        ? {}
        : { failure_message: call.failureMessage }),
      attempts: call.attempts,
      retry_delays_ms: call.retryDelaysMs,
      prompt_tokens: call.promptTokens,
      completion_tokens: call.completionTokens,
      started_at: call.startedAt,
      duration_ms: call.durationMs,
      ...(call.turns === undefined ? {} : { turns: call.turns }),
      ...(call.toolCalls === undefined ? {} : { tool_calls: call.toolCalls }),
    })),
    status: artifact.status,
    ...(artifact.statusReason === undefined
      ? {}
      : { status_reason: artifact.statusReason }),
    exclude_from_context: artifact.excludeFromContext,
    sealed_at: artifact.sealedAt,
    ...(artifact.perspectives === undefined
      ? {}
      : {
          perspectives: artifact.perspectives.map((p) => ({
            participant_id: p.participantId,
            perspective: p.perspective,
            order: p.order,
          })),
        }),
    ...(artifact.metrics === undefined
      ? {}
      : {
          metrics: {
            participants: artifact.metrics.participants.map((p) => ({
              participant_id: p.participantId,
              status: p.status,
              turns: p.turns,
              tool_calls: p.toolCalls,
              duration_ms: p.durationMs,
            })),
            judge:
              artifact.metrics.judge === null
                ? null
                : roleMetricWire(artifact.metrics.judge),
            synthesizer:
              artifact.metrics.synthesizer === null
                ? null
                : roleMetricWire(artifact.metrics.synthesizer),
            total_wall_clock_ms: artifact.metrics.totalWallClockMs,
          },
        }),
  }
}
