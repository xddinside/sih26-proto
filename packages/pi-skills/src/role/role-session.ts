/**
 * PiRoleSession: one bounded Pi agent role, driven through the Model Gateway
 * transport and the Read Broker, ending in one schema-valid typed terminal
 * submission.
 *
 * The session runs the pi-agent-core agent loop with a gateway-backed stream
 * function, so all model inference flows through the Model Gateway. The
 * session never sees `OPENCODE_API_KEY`; the Gateway alone resolves it. The
 * effective callable-tool set is the intersection of role, stage, policy,
 * and lease authority, defaulting to no authority. Finite defaults bound the
 * session: 20 model turns, 32 non-terminal tool calls, 12 minutes, plus
 * cancellation with an explicit failed/aborted status.
 */
import { runAgentLoop } from "@earendil-works/pi-agent-core"
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core"
import { getModel } from "@earendil-works/pi-ai"
import type {
  AssistantMessageEventStream,
  Model,
  ThinkingLevel,
  streamSimple,
} from "@earendil-works/pi-ai"
import type { ModelGateway, GatewayStreamRequest, LeaseRef  } from "@sih/brokers"

import { DEFAULT_ROLE_LIMITS  } from "./limits.js"
import type {RoleLimits} from "./limits.js";
import { effectiveToolSet  } from "./authority.js"
import type {ToolAuthority} from "./authority.js";
import type { TerminalTool } from "./terminal-tools.js"

export class RoleSessionError extends Error {}

export interface RoleSessionOptions {
  agentId: string
  parentAgentId: string
  agentRole: string
  systemPrompt: string
  /** The provider and model slug, e.g. `opencode-go` / `deepseek-v4-flash`. */
  model: { provider: string; id: string }
  reasoning?: ThinkingLevel
  lease: LeaseRef
  /** The only inference path; the session never holds a provider key. */
  gateway: ModelGateway
  /** The candidate hash every broker call binds to. */
  candidateHash: string
  /** The tools the session may register: broker reads and the terminal. */
  tools: readonly AgentTool<any>[]
  /** The one terminal tool the role ends with. */
  terminalTool: TerminalTool
  authority: ToolAuthority
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
}

export type RoleSessionStatus = "succeeded" | "failed" | "aborted"

export interface RoleSessionResult {
  status: RoleSessionStatus
  turns: number
  toolCalls: number
  terminalSubmission?: { submissionId: string }
  failureReason?: string
  /** The final transcript: assistant turns and tool results. */
  messages: AgentMessage[]
}

export class PiRoleSession {
  private readonly limits: RoleLimits
  private readonly effective: ReadonlySet<string>
  private readonly registered: AgentTool<any>[]
  private readonly abortController = new AbortController()
  private turnCount = 0
  private nonTerminalCalls = 0
  private lastAssistant: { stopReason?: string; errorMessage?: string } | undefined
  private startedAt = Date.now()
  private loopError: Error | undefined

  constructor(private readonly options: RoleSessionOptions) {
    this.limits = { ...DEFAULT_ROLE_LIMITS, ...options.limits }
    this.effective = effectiveToolSet(options.authority)
    this.registered = options.tools.filter((tool) => this.effective.has(tool.name))
    options.signal?.addEventListener("abort", () => this.abort(), { once: true })
  }

  /** Abort the running session. */
  abort(): void {
    this.abortController.abort()
  }

  /** Run the role from a prompt to a terminal submission, a budget limit,
   * or an abort. */
  async run(promptText: string): Promise<RoleSessionResult> {
    this.startedAt = Date.now()
    const prompt: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: promptText }],
      timestamp: Date.now(),
    }
    const context = {
      systemPrompt: this.options.systemPrompt,
      messages: [] as AgentMessage[],
      tools: this.registered,
    }
    let transcript: AgentMessage[] = []

    try {
      transcript = await runAgentLoop(
        [prompt],
        context,
        {
          model: this.resolveModel(),
          reasoning: this.options.reasoning,
          convertToLlm: (messages) =>
            messages.filter(
              (message) =>
                message.role === "user" ||
                message.role === "assistant" ||
                message.role === "toolResult",
            ),
          beforeToolCall: (hookContext) => this.beforeToolCall(hookContext),
          shouldStopAfterTurn: (hookContext) => this.shouldStopAfterTurn(hookContext),
          // The worker never holds a provider key; the Gateway alone does.
          getApiKey: () => undefined,
        },
        (event) => this.onEvent(event),
        this.abortController.signal,
        (
          model: Parameters<typeof streamSimple>[0],
          llmContext: Parameters<typeof streamSimple>[1],
          options?: Parameters<typeof streamSimple>[2],
        ) => this.streamFn(model, llmContext, options),
      )
    } catch (error) {
      this.loopError = error instanceof Error ? error : new Error(String(error))
    }

    return {
      status: this.classifyStatus(),
      turns: this.turnCount,
      toolCalls: this.nonTerminalCalls,
      terminalSubmission: this.options.terminalTool.submission,
      failureReason: this.loopError?.message ?? this.budgetReason(),
      messages: transcript,
    }
  }

  private resolveModel(): Model<any> {
    const lookup = getModel as (provider: string, id: string) => Model<any> | undefined
    const model = lookup(this.options.model.provider, this.options.model.id)
    if (model === undefined) {
      throw new RoleSessionError(
        `unknown model ${this.options.model.provider}/${this.options.model.id}`,
      )
    }
    return model
  }

  private classifyStatus(): RoleSessionStatus {
    if (this.options.terminalTool.submission !== undefined) {
      return "succeeded"
    }
    if (this.options.signal?.aborted || this.abortController.signal.aborted) {
      return "aborted"
    }
    if (this.lastAssistant?.stopReason === "aborted") {
      return "aborted"
    }
    return "failed"
  }

  private budgetReason(): string | undefined {
    if (this.loopError !== undefined) {
      return `role session error: ${this.loopError.message}`
    }
    if (this.turnCount >= this.limits.maxModelTurns) {
      return `model turn budget exhausted (${this.limits.maxModelTurns})`
    }
    if (this.nonTerminalCalls >= this.limits.maxNonTerminalToolCalls) {
      return `non-terminal tool call budget exhausted (${this.limits.maxNonTerminalToolCalls})`
    }
    if (Date.now() - this.startedAt >= this.limits.maxDurationMs) {
      return `wall-clock budget exhausted (${this.limits.maxDurationMs}ms)`
    }
    return "no terminal submission made"
  }

  private onEvent(event: AgentEvent): Promise<void> | void {
    if (event.type === "turn_end") {
      this.turnCount += 1
      if (event.message.role === "assistant") {
        this.lastAssistant = event.message
      }
    }
  }

  private beforeToolCall(
    hookContext: BeforeToolCallContext,
  ): Promise<{ block: true; reason: string } | undefined> {
    const name = hookContext.toolCall.name
    if (name === this.options.terminalTool.tool.name) {
      if (this.options.terminalTool.submission !== undefined) {
        return Promise.resolve({
          block: true,
          reason: `${name} already completed; only the first valid terminal submission is durable`,
        })
      }
      return Promise.resolve(undefined)
    }
    this.nonTerminalCalls += 1
    if (this.nonTerminalCalls > this.limits.maxNonTerminalToolCalls) {
      return Promise.resolve({
        block: true,
        reason: `non-terminal tool call budget exhausted (${this.limits.maxNonTerminalToolCalls})`,
      })
    }
    if (!this.effective.has(name)) {
      return Promise.resolve({
        block: true,
        reason: `${name} is not in the effective tool set for this role`,
      })
    }
    return Promise.resolve(undefined)
  }

  private shouldStopAfterTurn(hookContext: ShouldStopAfterTurnContext): boolean {
    if (this.options.terminalTool.submission !== undefined) {
      return true
    }
    if (this.turnCount >= this.limits.maxModelTurns) {
      return true
    }
    return Date.now() - this.startedAt >= this.limits.maxDurationMs
  }

  private async streamFn(
    model: Parameters<typeof streamSimple>[0],
    llmContext: Parameters<typeof streamSimple>[1],
    options?: Parameters<typeof streamSimple>[2],
  ): Promise<AssistantMessageEventStream> {
    const request: GatewayStreamRequest = {
      parentAgentId: this.options.parentAgentId,
      agentId: this.options.agentId,
      agentRole: this.options.agentRole,
      model: { provider: model.provider, id: model.id },
      reasoning: options?.reasoning,
      context: {
        systemPrompt: llmContext.systemPrompt,
        messages: llmContext.messages,
        tools: llmContext.tools,
      },
      options: { signal: options?.signal, maxTokens: options?.maxTokens },
      idempotencyKey: `${this.options.lease.runId}-${this.options.agentId}-turn-${this.turnCount}`,
    }
    return this.options.gateway.stream(this.options.lease, request)
  }
}
