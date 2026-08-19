/**
 * The Agent Run Artifact builder for one Pi role session (issue #25).
 *
 * The builder turns a session's raw facts — identity, model configuration,
 * settled status, timing, transcript, and terminal submission — into the
 * registered `agent-run-artifact@1.0` wire payload. It is diagnostic only:
 * reasoning blocks are never copied, prompts and outputs are scrubbed of
 * provider keys and authorization headers, tool arguments and results are
 * sanitized and bounded, and the typed terminal result is never duplicated —
 * `submission_ref` links the sealed terminal artifact that stays the sole
 * authority.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type {
  AgentPipelineCall,
  AgentRunArtifactWire,
} from "@sih/contracts/types"

import { redactSecrets } from "./redact.js"

/** The bound length of a sanitized tool argument payload, in characters. */
const MAX_TOOL_ARGS_CHARS = 4_000
/** The bound length of a sanitized tool result, in characters. */
const MAX_TOOL_RESULT_CHARS = 8_000
const TRUNCATION_MARK = "…[truncated]"

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}${TRUNCATION_MARK}`
}

export interface BuildAgentRunArtifactOptions {
  agentId: string
  parentAgentId: string
  /** The journal-safe role label the session ran as. */
  agentRole: string
  /** The capture-vocabulary phase this session belongs to. */
  phase: AgentPipelineCall["phase"]
  providerClass: AgentRunArtifactWire["provider_class"]
  provider: string
  model: string
  /** The provider API name (e.g. `opencode-go`) when reported. */
  providerApi?: string
  reasoning: AgentRunArtifactWire["reasoning"]
  systemPrompt: string
  promptText: string
  status: AgentRunArtifactWire["status"]
  failureReason: string | undefined
  /** The sealed terminal artifact hash, when the role submitted. */
  submissionId: string | null
  startedAtMs: number
  completedAtMs: number
  turnCount: number
  messages: readonly AgentMessage[]
  /** The terminal tool's name; its calls are never duplicated here. */
  terminalToolName: string
  /** Extra secrets the session must scrub from its records. */
  secrets?: readonly string[]
}

/** Build the registered agent-run-artifact payload for one session. */
export function buildAgentRunArtifact(
  options: BuildAgentRunArtifactOptions,
): AgentRunArtifactWire {
  const secrets = options.secrets ?? []
  const sanitize = (text: string) => redactSecrets(text, secrets)
  const toolActivity = collectToolActivity(
    options.messages,
    options.terminalToolName,
    sanitize,
  )
  const tokenUse = aggregateTokenUse(options.messages)
  const durationMs = options.completedAtMs - options.startedAtMs
  const startedAt = new Date(options.startedAtMs).toISOString()
  const completedAt = new Date(options.completedAtMs).toISOString()
  const failureReason = options.status === "succeeded" ? null : (options.failureReason ?? null)
  const call: AgentPipelineCall = {
    call_id: `call:${options.agentId}:0`,
    phase: options.phase,
    role: options.agentRole,
    order: 0,
    model: {
      provider: options.provider,
      id: options.model,
      ...(options.providerApi === undefined ? {} : { api: options.providerApi }),
      reasoning: options.reasoning,
    },
    status: options.status,
    started_at: startedAt,
    completed_at: completedAt,
    system_prompt: sanitize(options.systemPrompt),
    input_prompt: sanitize(options.promptText),
    output: lastAssistantText(options.messages, sanitize),
    submission_ref: options.status === "succeeded" ? options.submissionId : null,
    token_use: tokenUse,
    retry_delay_ms: null,
    rate_limit_delay_ms: null,
    turns: options.turnCount,
    tool_activity: toolActivity,
    failure_reason: failureReason,
  }
  return {
    schema_version: "1.0",
    run_artifact_id: `agent-run:${options.agentId}`,
    agent_id: options.agentId,
    parent_agent_id: options.parentAgentId,
    role: options.agentRole,
    phase: options.phase,
    provider_class: options.providerClass,
    provider: options.provider,
    model: options.model,
    reasoning: options.reasoning,
    status: options.status,
    failure_reason: failureReason,
    calls: [call],
    metrics: {
      duration_ms: durationMs,
      prompt_tokens: tokenUse.prompt_tokens,
      completion_tokens: tokenUse.completion_tokens,
      total_tokens: tokenUse.total_tokens,
      tool_call_count: toolActivity.length,
      retry_delay_ms: 0,
      rate_limit_delay_ms: 0,
    },
    exclude_from_context: true,
    sealed_at: completedAt,
  }
}

/** The sanitized final assistant text, or null when the role never spoke. */
function lastAssistantText(
  messages: readonly AgentMessage[],
  sanitize: (text: string) => string,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") {
      continue
    }
    const text = message.content.find(
      (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
    )
    if (text !== undefined) {
      return sanitize(text.text)
    }
  }
  return null
}

/**
 * The session's non-terminal tool requests in transcript order, with the
 * matching tool results. Thinking blocks never reach this record; the
 * terminal tool's own calls are excluded because the sealed terminal
 * artifact stays the sole authority for the typed result.
 */
function collectToolActivity(
  messages: readonly AgentMessage[],
  terminalToolName: string,
  sanitize: (text: string) => string,
): AgentPipelineCall["tool_activity"] {
  const results = new Map<
    string,
    { text: string; isError: boolean }
  >()
  for (const message of messages) {
    if (message.role !== "toolResult") {
      continue
    }
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
    results.set(message.toolCallId, { text, isError: message.isError })
  }
  const activity: AgentPipelineCall["tool_activity"] = []
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue
      }
      if (block.name === terminalToolName) {
        continue
      }
      const result = results.get(block.id)
      activity.push({
        tool_call_id: block.id,
        tool: block.name,
        args: sanitize(truncate(JSON.stringify(block.arguments), MAX_TOOL_ARGS_CHARS)),
        result:
          result === undefined
            ? null
            : sanitize(truncate(result.text, MAX_TOOL_RESULT_CHARS)),
        is_error: result?.isError ?? false,
      })
    }
  }
  return activity
}

/** The token totals across every assistant turn in the transcript. */
function aggregateTokenUse(
  messages: readonly AgentMessage[],
): AgentPipelineCall["token_use"] {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }
    promptTokens += message.usage.input
    completionTokens += message.usage.output
    totalTokens += message.usage.totalTokens
  }
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  }
}