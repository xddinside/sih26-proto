/**
 * opencode-go supplemental model support (issue #32).
 *
 * The pinned pi-ai 0.79.4 catalog is static and predates the opencode-go
 * "muse" family. The gateway resolves models through pi-ai's `getModel`
 * first, then this supplemental catalog so new opencode-go models can run
 * without unpinning pi-ai.
 *
 * The muse endpoint streams chat-completions chunks but never sends a
 * non-empty `finish_reason`, which pi-ai's own openai-completions transport
 * treats as an error. `museStreamingProvider` re-streams that endpoint with
 * the same pi-ai event protocol, but treats end-of-stream as a normal stop
 * and derives `toolUse` from the presence of tool-call blocks.
 */
import OpenAI from "openai"

import {
  calculateCost,
  createAssistantMessageEventStream,
  parseStreamingJson,
} from "@earendil-works/pi-ai"
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai"

import type { GatewayStreamRequest } from "./model-gateway.js"

export interface SupplementalModelEntry {
  id: string
  name: string
  api: "openai-completions"
  provider: "opencode-go"
  baseUrl: string
  reasoning: boolean
  thinkingLevelMap: Record<string, string | null>
  input: string[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
  compat: { maxTokensField: "max_tokens" | "max_completion_tokens" }
}

/** The opencode-go muse models the pinned pi-ai catalog does not carry yet.
 * Catalog defaults (context window, cost) are conservative placeholders;
 * the capture manifest freezes provider/model identity and the resolved
 * metadata, never these local cost guesses. */
export const SUPPLEMENTAL_MODELS: Readonly<Record<string, SupplementalModelEntry>> = {
  "muse-spark-1.2": {
    id: "muse-spark-1.2",
    name: "Muse Spark 1.2",
    api: "openai-completions",
    provider: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", xhigh: "max" },
    input: ["text"],
    cost: { input: 0.05, output: 0.15, cacheRead: 0.0025, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    compat: { maxTokensField: "max_tokens" },
  },
  "muse-spark-1.2-contributor": {
    id: "muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    api: "openai-completions",
    provider: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", xhigh: "max" },
    input: ["text"],
    cost: { input: 0.05, output: 0.15, cacheRead: 0.0025, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    compat: { maxTokensField: "max_tokens" },
  },
}

/** The supplemental entry for a provider/model pair, or undefined. */
export function resolveSupplementalModel(
  provider: string,
  modelId: string,
): SupplementalModelEntry | undefined {
  if (provider !== "opencode-go") {
    return undefined
  }
  return SUPPLEMENTAL_MODELS[modelId]
}

/** True when the resolved model is served by the muse streaming endpoint
 * that never sends a finish_reason. */
export function isMuseStreamingModel(model: Model<Api> | SupplementalModelEntry): boolean {
  return model.provider === "opencode-go" && model.id.startsWith("muse-spark-")
}

interface StreamableMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | Array<Record<string, unknown>> | null
  tool_call_id?: string
  tool_calls?: unknown[]
  reasoning_content?: string
}

/** Convert the pi-ai Context to OpenAI chat-completions messages for a plain
 * (no special-compat) opencode-go model. Mirrors the pinned pi-ai transport
 * for models without provider-specific compat quirks. */
export function toOpenAiMessages(model: SupplementalModelEntry, context: Context): StreamableMessage[] {
  const messages: StreamableMessage[] = []
  if (context.systemPrompt !== undefined && context.systemPrompt.length > 0) {
    messages.push({ role: "system", content: context.systemPrompt })
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      const user = message as UserMessage
      if (typeof user.content === "string") {
        messages.push({ role: "user", content: user.content })
      } else {
        const parts = user.content.map((block) =>
          block.type === "text"
            ? { type: "text", text: block.text }
            : { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.data}` } },
        )
        if (parts.length > 0) {
          messages.push({ role: "user", content: parts })
        }
      }
    } else if (message.role === "assistant") {
      const assistant = message as AssistantMessage
      const textParts = assistant.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .filter((block) => block.text.trim().length > 0)
        .map((block) => block.text)
      const text = textParts.join("")
      const thinking = assistant.content
        .filter((block): block is Extract<typeof block, { type: "thinking" }> => block.type === "thinking")
        .filter((block) => block.thinking.trim().length > 0)
        .map((block) => block.thinking)
        .join("\n")
      const toolCalls = assistant.content
        .filter((block): block is ToolCall => block.type === "toolCall")
        .map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }))
      const out: StreamableMessage = {
        role: "assistant",
        content: text.length > 0 ? text : null,
      }
      if (thinking.length > 0) {
        out.reasoning_content = thinking
      }
      if (toolCalls.length > 0) {
        out.tool_calls = toolCalls
      }
      messages.push(out)
    } else if (message.role === "toolResult") {
      const result = message as ToolResultMessage
      const content = Array.isArray(result.content)
        ? result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n")
        : ""
      messages.push({ role: "tool", tool_call_id: result.toolCallId, content })
    }
  }
  return messages
}

function emptyUsage(model: SupplementalModelEntry): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function usageFromChunk(
  raw: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } },
  model: SupplementalModelEntry,
): AssistantMessage["usage"] {
  const promptTokens = raw.prompt_tokens ?? 0
  const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? 0
  const cacheWrite = raw.prompt_tokens_details?.cache_write_tokens ?? 0
  const input = Math.max(0, promptTokens - cacheRead - cacheWrite)
  const output = raw.completion_tokens ?? 0
  const usage: AssistantMessage["usage"] = {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  calculateCost(model as unknown as Model<Api>, usage)
  return usage
}

interface MuseChunk {
  id?: string
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
  }
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning_content?: string
      reasoning?: string
      reasoning_text?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    } | null
  }>
}

/** Stream one chat-completions turn from the opencode-go endpoint with the
 * pi-ai event protocol, tolerating the missing `finish_reason`. */
export function museStreamingProvider(
  request: GatewayStreamRequest,
  model: SupplementalModelEntry,
  apiKey: string | undefined,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()
  void (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(model),
      stopReason: "stop",
      timestamp: Date.now(),
    }
    try {
      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`)
      }
      const client = new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
      })
      const params: Record<string, unknown> = {
        model: model.id,
        messages: toOpenAiMessages(model, request.context),
        stream: true,
        stream_options: { include_usage: true },
      }
      const tools = request.context.tools
      if (tools !== undefined && tools.length > 0) {
        params.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      }
      if (request.options?.maxTokens !== undefined) {
        params[model.compat.maxTokensField] = request.options.maxTokens
      }

      const openaiStream = (await client.chat.completions.create(params as never)) as unknown as AsyncIterable<MuseChunk>

      stream.push({ type: "start", partial: output })
      let textBlock: Extract<AssistantMessage["content"][number], { type: "text" }> | null = null
      let thinkingBlock: Extract<AssistantMessage["content"][number], { type: "thinking" }> | null = null
      let hasFinishReason = false
      const toolCallBlocksByIndex = new Map<number, ToolCall & { partialArgs?: string; streamIndex?: number }>()
      const blocks = output.content
      const getContentIndex = (block: AssistantMessage["content"][number]): number => blocks.indexOf(block)

      const finishBlock = (block: AssistantMessage["content"][number]): void => {
        const contentIndex = getContentIndex(block)
        if (contentIndex === -1) return
        if (block.type === "text") {
          stream.push({ type: "text_end", contentIndex, content: block.text, partial: output })
        } else if (block.type === "thinking") {
          stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output })
        } else if (block.type === "toolCall") {
          const tool = block as ToolCall & { partialArgs?: string; streamIndex?: number }
          tool.arguments = parseStreamingJson(tool.partialArgs ?? "")
          delete tool.partialArgs
          delete tool.streamIndex
          stream.push({ type: "toolcall_end", contentIndex, toolCall: block as ToolCall, partial: output })
        }
      }

      for await (const chunk of openaiStream) {
        if (!chunk || typeof chunk !== "object") continue
        output.responseId ||= chunk.id
        if (chunk.usage) {
          output.usage = usageFromChunk(chunk.usage, model)
        }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
        if (!choice) continue
        if (choice.finish_reason) {
          output.stopReason = choice.finish_reason === "tool_calls" ? "toolUse" : choice.finish_reason as "stop" | "length" | "toolUse" | "error"
          hasFinishReason = true
        }
        const delta = choice.delta
        if (!delta) continue
        if (delta.content !== null && delta.content !== undefined && delta.content.length > 0) {
          if (!textBlock) {
            textBlock = { type: "text", text: "" }
            blocks.push(textBlock)
            stream.push({ type: "text_start", contentIndex: getContentIndex(textBlock), partial: output })
          }
          textBlock.text += delta.content
          stream.push({ type: "text_delta", contentIndex: getContentIndex(textBlock), delta: delta.content, partial: output })
        }
        const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"] as const
        let reasoningText: string | undefined
        for (const field of reasoningFields) {
          const value = delta[field]
          if (typeof value === "string" && value.length > 0) {
            reasoningText = value
            break
          }
        }
        if (reasoningText !== undefined) {
          if (!thinkingBlock) {
            thinkingBlock = { type: "thinking", thinking: "", thinkingSignature: "reasoning_content" }
            blocks.push(thinkingBlock)
            stream.push({ type: "thinking_start", contentIndex: getContentIndex(thinkingBlock), partial: output })
          }
          thinkingBlock.thinking += reasoningText
          stream.push({ type: "thinking_delta", contentIndex: getContentIndex(thinkingBlock), delta: reasoningText, partial: output })
        }
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined
            let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined
            if (!block && toolCall.id) {
              block = output.content.find(
                (entry): entry is ToolCall & { partialArgs?: string; streamIndex?: number } =>
                  entry.type === "toolCall" && entry.id === toolCall.id,
              )
            }
            if (!block) {
              block = {
                type: "toolCall",
                id: toolCall.id || "",
                name: toolCall.function?.name || "",
                arguments: {},
                partialArgs: "",
                streamIndex,
              }
              if (streamIndex !== undefined) toolCallBlocksByIndex.set(streamIndex, block)
              blocks.push(block)
              stream.push({ type: "toolcall_start", contentIndex: getContentIndex(block), partial: output })
            }
            if (toolCall.id) block.id = toolCall.id
            if (toolCall.function?.name) block.name = toolCall.function.name
            if (toolCall.function?.arguments) {
              const deltaArgs = toolCall.function.arguments
              block.partialArgs = (block.partialArgs ?? "") + deltaArgs
              block.arguments = parseStreamingJson(block.partialArgs)
            }
            stream.push({ type: "toolcall_delta", contentIndex: getContentIndex(block), delta: toolCall.function?.arguments ?? "", partial: output })
          }
        }
      }

      for (const block of [...blocks]) {
        finishBlock(block)
      }

      if (request.options?.signal?.aborted) {
        throw new Error("Request was aborted")
      }
      if (!hasFinishReason) {
        const hasToolCall = output.content.some((block) => block.type === "toolCall")
        output.stopReason = hasToolCall ? "toolUse" : "stop"
      }
      stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output })
      stream.end(output)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const final: AssistantMessage = {
        ...output,
        stopReason: request.options?.signal?.aborted ? "aborted" : "error",
        errorMessage: message,
      }
      stream.push({ type: "error", reason: final.stopReason as "aborted" | "error", error: final })
      stream.end(final)
    }
  })()
  return stream
}
