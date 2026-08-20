/**
 * Model Gateway: routes model calls to the provider and records model use.
 * The gateway holds provider keys; no credential, key, or model budget
 * bypass ever leaves it. The Demo Profile removes token and cost caps, but
 * model-use records still bind the Incident, Run, and agent identities.
 *
 * Two transports share the lease boundary:
 *
 * - `complete` is the legacy deterministic fixture path: one canned or stub
 *   completion, used by offline tests and the existing skill sessions.
 * - `stream` is the Pi role-session transport: it returns a pi-ai
 *   `AssistantMessageEventStream` that the role's Pi Agent loop consumes.
 *   The gateway resolves the provider model, injects the provider key (from
 *   its own environment only), records one sanitized model-use record per
 *   completed turn, and never lets the key or provider authorization header
 *   into a record or error message.
 */
import {
  createAssistantMessageEventStream,
  getModel,
  streamSimple
  
  
  
  
  
  
  
} from "@earendil-works/pi-ai"
import type {Api, AssistantMessage, AssistantMessageEventStream, Context, Model, ThinkingLevel, ToolCall} from "@earendil-works/pi-ai";

import type { ControlPlaneClient, LeaseRef, ModelRequest } from "./types.js"
import { museStreamingProvider, resolveSupplementalModel } from "./opencode-go.js"

export class ModelGatewayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

export interface ModelProvider {
  complete(model: string, prompt: string): Promise<{ text: string; promptTokens: number; completionTokens: number }>
}

/** A deterministic local provider stub for the demo (no real model). */
export const stubProvider: ModelProvider = {
  async complete(model, prompt) {
    return {
      text: `[stub:${model}] echo of ${prompt.length} chars`,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: 8,
    }
  },
}

/** One role-session model call through the Gateway. The request never
 * carries a credential; the Gateway resolves the key itself. */
export interface GatewayStreamRequest {
  parentAgentId: string
  agentId: string
  agentRole?: string
  /** The provider and model slug the session wants, e.g. `opencode-go` /
   * `deepseek-v4-flash`. */
  model: { provider: string; id: string }
  reasoning?: ThinkingLevel
  /** The sanitized LLM context (system prompt, messages, tool schemas). */
  context: Context
  options?: { signal?: AbortSignal; maxTokens?: number }
  idempotencyKey: string
}

/** The streaming seam behind the Gateway. The default provider calls
 * `streamSimple` with the Gateway-resolved key; tests inject deterministic
 * doubles. The resolved model's type is drawn from `streamSimple` itself so
 * the provider stays assignable to the seam without re-declaring the
 * provider-generic model type. */
export type GatewayStreamingProvider = (
  request: GatewayStreamRequest,
  resolved: {
    model: Parameters<typeof streamSimple>[0]
    apiKey: string | undefined
  },
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>

/** The real provider transport. The key arrives only from the Gateway's own
 * environment; a missing key is an explicit error, never a fallback. */
export const piAiStreamingProvider: GatewayStreamingProvider = (
  request: GatewayStreamRequest,
  { model, apiKey }: { model: Parameters<typeof streamSimple>[0]; apiKey: string | undefined },
) => {
  if (!apiKey) {
    throw new ModelGatewayError(
      "MISSING_API_KEY",
      `no provider key available for ${model.provider}`,
    )
  }
  // opencode-go muse models stream through a tolerant transport because their
  // endpoint never sends a finish_reason; the pinned pi-ai transport rejects
  // such streams (issue #32).
  const supplemental = resolveSupplementalModel(request.model.provider, request.model.id)
  if (supplemental !== undefined) {
    return museStreamingProvider(request, supplemental, apiKey)
  }
  return streamSimple(
    model,
    {
      systemPrompt: request.context.systemPrompt,
      messages: request.context.messages,
      tools: request.context.tools,
    },
    {
      apiKey,
      reasoning: request.reasoning,
      signal: request.options?.signal,
      maxTokens: request.options?.maxTokens,
    },
  )
}

/** One scripted assistant turn for the deterministic streaming double. */
export type ScriptedTurn =
  | { kind: "text"; text: string }
  | {
      kind: "tool-call"
      id: string
      name: string
      args: Record<string, unknown>
    }
  | { kind: "error"; message: string; stopReason?: "error" | "aborted" }

export interface ScriptedStreamingOptions {
  /** The turn sequence per session (keyed by the request's agentId). When
   * the script runs out of turns, the last turn repeats so budget limits can
   * be exercised deterministically. */
  turns?: Record<string, readonly ScriptedTurn[]>
  /** Optional dynamic script used by deterministic rehearsals that need to
   * inspect a broker/test-tool result before submitting a typed payload. */
  respond?: (request: GatewayStreamRequest, turnIndex: number) => ScriptedTurn | Promise<ScriptedTurn>
  usage?: { input?: number; output?: number }
  /** When true, an aborted signal turns the next stream call into an
   * aborted final message instead of the scripted turn. */
  honorSignal?: boolean
}

function emptyUsage(input: number, output: number): AssistantMessage["usage"] {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

/** A deterministic, network-free streaming double that drives a real Pi
 * agent loop: one scripted assistant turn per stream call, keyed per
 * session. */
export function scriptedStreamingProvider(
  options: ScriptedStreamingOptions,
): GatewayStreamingProvider {
  const callCounts = new Map<string, number>()
  return async (request, { model }) => {
    if (options.honorSignal === true && request.options?.signal?.aborted === true) {
      return errorStream(model, "session aborted", "aborted")
    }
    return turnStream(await nextTurn(), model, options.usage ?? {})

    async function nextTurn(): Promise<ScriptedTurn> {
      const count = callCounts.get(request.agentId) ?? 0
      callCounts.set(request.agentId, count + 1)
      if (options.respond !== undefined) {
        return options.respond(request, count)
      }
      const script = options.turns?.[request.agentId]
      if (script === undefined || script.length === 0) {
        return { kind: "text", text: "no script for this session" }
      }
      if (count >= script.length) {
        const last = script[script.length - 1]
        return last ?? { kind: "text", text: "empty script" }
      }
      return script[count] ?? { kind: "text", text: "empty script" }
    }
  }
}

function assistantMessageFor(
  turn: ScriptedTurn,
  model: Model<Api>,
  usage: { input?: number; output?: number },
): AssistantMessage {
  const now = Date.now()
  const content: AssistantMessage["content"] =
    turn.kind === "tool-call"
      ? [
          {
            type: "toolCall",
            id: turn.id,
            name: turn.name,
            arguments: turn.args,
          },
        ]
      : turn.kind === "text"
        ? [{ type: "text", text: turn.text }]
        : []
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(usage.input ?? 8, usage.output ?? 8),
    stopReason:
      turn.kind === "tool-call"
        ? "toolUse"
        : turn.kind === "error"
          ? (turn.stopReason ?? "error")
          : "stop",
    ...(turn.kind === "error" ? { errorMessage: turn.message } : {}),
    timestamp: now,
  }
}

function turnStream(
  turn: ScriptedTurn,
  model: Model<Api>,
  usage: { input?: number; output?: number },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()
  const message = assistantMessageFor(turn, model, usage)
  if (turn.kind === "error") {
    stream.push({ type: "error", reason: turn.stopReason ?? "error", error: message })
    stream.end(message)
    return stream
  }
  stream.push({ type: "start", partial: message })
  if (turn.kind === "tool-call") {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: turn.id,
      name: turn.name,
      arguments: turn.args,
    }
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message })
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(turn.args), partial: message })
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message })
    stream.push({ type: "done", reason: "toolUse", message })
  } else {
    stream.push({ type: "text_start", contentIndex: 0, partial: message })
    stream.push({ type: "text_delta", contentIndex: 0, delta: turn.text, partial: message })
    stream.push({ type: "text_end", contentIndex: 0, content: turn.text, partial: message })
    stream.push({ type: "done", reason: "stop", message })
  }
  stream.end(message)
  return stream
}

function errorStream(
  model: Model<Api>,
  message: string,
  stopReason: "error" | "aborted",
): AssistantMessageEventStream {
  return turnStream({ kind: "error", message, stopReason }, model, {})
}

function modelUseRecord(
  request: GatewayStreamRequest,
  message: AssistantMessage,
  startedAt: string,
): Record<string, unknown> {
  return {
    parent_agent_id: request.parentAgentId,
    agent_id: request.agentId,
    agent_role: request.agentRole,
    provider: request.model.provider,
    model: request.model.id,
    reasoning: request.reasoning ?? null,
    finish_status: message.stopReason,
    token_use: {
      prompt_tokens: message.usage?.input ?? 0,
      completion_tokens: message.usage?.output ?? 0,
    },
    tool_calls: message.content
      .filter((block): block is Extract<typeof block, { type: "toolCall" }> => block.type === "toolCall")
      .map((call) => ({ tool: call.name, tool_call_id: call.id })),
    idempotency_key: request.idempotencyKey,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  }
}

export class ModelGateway {
  constructor(
    private readonly cp: ControlPlaneClient,
    private readonly provider: ModelProvider = stubProvider,
    private readonly streaming: GatewayStreamingProvider = piAiStreamingProvider,
    private readonly apiKey: string | undefined = process.env.OPENCODE_API_KEY,
  ) {}

  async complete(lease: LeaseRef, request: ModelRequest): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const verified = await this.cp.verifyLease(lease)
    if (!verified.valid) {
      throw new ModelGatewayError("STALE_LEASE", verified.error ?? "lease verification failed")
    }

    const result = await this.provider.complete(request.model, request.prompt)

    await this.cp.recordModelUse(lease.incidentId, lease.runId, {
      parent_agent_id: request.parentAgentId,
      agent_id: request.agentId,
      agent_role: request.agentRole,
      model: request.model,
      token_use: { prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens },
      tool_calls: [],
      idempotency_key: request.idempotencyKey,
    })

    return result
  }

  /**
   * The Pi role-session transport. Verifies the lease, resolves the provider
   * model, streams one turn through the configured provider, records a
   * sanitized model-use record when the turn settles, and returns the stream
   * to the caller. A stale lease fails closed before any model call. A
   * provider failure is encoded in the returned stream as an error message
   * with a sanitized reason.
   */
  async stream(
    lease: LeaseRef,
    request: GatewayStreamRequest,
  ): Promise<AssistantMessageEventStream> {
    const verified = await this.cp.verifyLease(lease)
    if (!verified.valid) {
      throw new ModelGatewayError("STALE_LEASE", verified.error ?? "lease verification failed")
    }

    const resolved = getModel(
      request.model.provider as never,
      request.model.id as never,
    ) ?? resolveSupplementalModel(request.model.provider, request.model.id)
    if (resolved === undefined) {
      throw new ModelGatewayError(
        "UNKNOWN_MODEL",
        `unknown model ${request.model.provider}/${request.model.id}`,
      )
    }
    const model = resolved as Model<Api>

    const startedAt = new Date().toISOString()
    let source: AssistantMessageEventStream
    try {
      source = await this.streaming(request, {
        model,
        apiKey: this.apiKey,
      })
    } catch (error) {
      throw this.sanitizeError(error, request.model.provider)
    }

    const out = createAssistantMessageEventStream()
    void (async () => {
      let final: AssistantMessage | undefined
      try {
        for await (const event of source) {
          if (event.type === "done") {
            final = event.message
          } else if (event.type === "error") {
            final = event.error
          }
          out.push(event)
        }
      } catch (error) {
        // A source stream that throws still settles as a sanitized error
        // message so the agent loop terminates normally.
        const message = assistantMessageFor(
          {
            kind: "error",
            message: this.sanitizeError(error, request.model.provider).message,
            stopReason: "error",
          },
          model,
          {},
        )
        out.push({ type: "error", reason: "error", error: message })
        out.end(message)
        return
      }
      if (final !== undefined) {
        // Model-use recording is durable audit, not a stream path: a record
        // failure must not kill the role turn.
        await this.cp
          .recordModelUse(lease.incidentId, lease.runId, modelUseRecord(request, final, startedAt))
          .catch(() => ({ recorded: false }))
      }
      out.end(final)
    })()
    return out
  }

  /** Provider errors become sanitized `ModelGatewayError`s; credentials and
   * authorization headers never survive into an error message. */
  private sanitizeError(error: unknown, provider: string): Error {
    const message =
      error instanceof Error ? error.message : String(error)
    const scrubbed = this.scrub(message)
    if (error instanceof ModelGatewayError) {
      return new ModelGatewayError(error.code, scrubbed)
    }
    return new ModelGatewayError("STREAM_FAILED", `${provider}: ${scrubbed}`)
  }

  /** The catalog metadata the provider resolved for a provider/model slug,
   * or null when the pair does not resolve. This is the "resolved provider
   * metadata" the capture manifest freezes; it is sanitized catalog data and
   * never carries credentials or request secrets. */
  resolveModelMetadata(
    provider: string,
    modelId: string,
  ): {
    provider: string
    id: string
    name: string
    base_url: string
    reasoning: boolean
    input: string[]
  } | null {
    const resolved = getModel(provider as never, modelId as never) ?? resolveSupplementalModel(provider, modelId)
    if (resolved === undefined) {
      return null
    }
    return {
      provider: resolved.provider,
      id: resolved.id,
      name: resolved.name,
      base_url: resolved.baseUrl,
      reasoning: resolved.reasoning,
      input: resolved.input,
    }
  }

  private scrub(text: string): string {
    let out = text
    if (this.apiKey !== undefined && this.apiKey.length > 0) {
      out = out.split(this.apiKey).join("[REDACTED]")
    }
    return out
      .replace(/authorization:\s*[^\s,;]+/gi, "authorization: [REDACTED]")
      .replace(/bearer\s+[^\s,;]+/gi, "bearer [REDACTED]")
  }
}
