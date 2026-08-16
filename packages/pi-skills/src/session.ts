/**
 * Skill-bound subagent sessions, mirroring the live Fusion harness's
 * in-process pattern (`runResearchAgent` in `research-fusion.ts` constructs a
 * fresh Agent per role). The Demo Profile reuses that shape; this module is
 * the SIH seam where the extension APIs `before_agent_start` (system-prompt
 * composition) and `pi.setActiveTools` (per-session allow-lists) apply.
 *
 * Every session starts empty: no shared conversation, no inherited history,
 * its own scratch directory, one skill's system prompt, and one tool
 * allow-list. Sessions cannot create nested Workers, cannot see peer outputs,
 * and reach brokers only through the Orchestrator's tool service.
 */
import { randomUUID } from "node:crypto"

import type { ModelGateway, LeaseRef } from "@sih/brokers"

import { applyActiveTools } from "./allow-lists.js"
import type { Skill } from "./skill-catalog.js"

export interface RetrySettings {
  timeoutMs: number
  maxRetries: number
  maxRetryDelayMs: number
}

export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  timeoutMs: 120_000,
  maxRetries: 2,
  maxRetryDelayMs: 5_000,
}

export interface ToolCallRecord {
  tool: string
  tool_call_id: string
}

export interface SessionRunResult {
  agentId: string
  text: string
  toolCalls: ToolCallRecord[]
  attempts: number
  retryDelaysMs: number[]
}

export interface SkillSessionOptions {
  skill: Skill
  allowList: readonly string[]
  /** The Worker's per-session active-tool set; only these may execute. */
  activeTools: ReadonlySet<string>
  stage: LeaseRef["stage"]
  guardrails: readonly string[]
  /** Role system prompt (e.g. a Fusion role prompt), placed with the
   * guardrails before the skill body. */
  extraSystemPrompt?: string
  taskInput: string
  scratchDir: string
  parentAgentId: string
  agentRole: string
  model: string
  gateway: ModelGateway
  lease: LeaseRef
  retry?: Partial<RetrySettings>
  signal?: AbortSignal
}

const WORKER_GUARDRAILS = [
  "You are a specialist subagent inside one disposable Worker for one Incident attempt.",
  "You have no direct production access, no credentials, and no merge or deploy authority; only stage-permitted, receipt-backed broker reads.",
  "Never output secrets. Cite Evidence Set item ids only; you cannot mint items.",
  "You never see peer subagent outputs.",
  "Your output must match your skill's output schema; a malformed output reruns once and then needs a human.",
]

/**
 * The SIH extension seam for system-prompt composition (the live harness's
 * `before_agent_start` hook), in the fixed order from pi-agent-catalog.md:
 * 1. base prompt with built-in tools disabled and only allow-listed tools
 *    described; 2. global Worker guardrails; 3. stage guardrails; 4. the
 *    skill's SKILL.md body; 5. the task and the exact input subset;
 *    6. active tool snippets.
 */
export function composeSystemPrompt(options: {
  skill: Skill
  allowList: readonly string[]
  stage: string
  guardrails: readonly string[]
  extraSystemPrompt?: string
  toolSnippets?: readonly string[]
}): string {
  const toolList = options.allowList.join(", ")
  return [
    "Pi built-in tools are disabled for this session.",
    `Active tools: ${toolList.length === 0 ? "none" : toolList}.`,
    "You may call only your active tools. Requests beyond them are rejected.",
    "",
    ...WORKER_GUARDRAILS,
    ...options.guardrails.map((guardrail) => `Stage rule: ${guardrail}`),
    ...(options.extraSystemPrompt === undefined
      ? []
      : ["", options.extraSystemPrompt]),
    "",
    `# Skill: ${options.skill.contract.name} (stage ${options.stage})`,
    options.skill.skillMd,
    ...(options.toolSnippets === undefined || options.toolSnippets.length === 0
      ? []
      : ["", "## Active tool snippets", ...options.toolSnippets]),
  ].join("\n")
}

/** Strip code fences and leading prose so a JSON object can be parsed. */
export function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g
  let match = fenced.exec(text)
  let candidate: string | null = null
  while (match !== null) {
    const block = match[1].trim()
    if (block.startsWith("{")) {
      candidate = block
      break
    }
    match = fenced.exec(text)
  }
  if (candidate === null) {
    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first === -1 || last === -1 || last <= first) {
      return null
    }
    candidate = text.slice(first, last + 1)
  }
  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return null
  }
}

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new Error("aborted during retry delay"))
      },
      { once: true }
    )
  })

/**
 * A bounded skill session. `run` executes one task through the Model Gateway
 * with provider retry settings (`timeoutMs`, `maxRetries`, `maxRetryDelayMs`)
 * and abort-signal propagation, mirroring the live harness's model-calls.
 */
export class SkillSession {
  readonly agentId: string
  readonly scratchDir: string
  readonly conversation: {
    role: "system" | "user" | "assistant"
    text: string
  }[] = []
  toolCalls: ToolCallRecord[] = []
  private readonly options: SkillSessionOptions
  private readonly retry: RetrySettings
  private aborted = false

  constructor(options: SkillSessionOptions) {
    this.options = options
    this.agentId = `subagent-${options.agentRole}-${randomUUID().slice(0, 12)}`
    this.scratchDir = options.scratchDir
    this.retry = { ...DEFAULT_RETRY_SETTINGS, ...options.retry }
    // Each session starts empty: the fixed system prompt plus the task input
    // is the whole conversation. Peer outputs are never appended.
    this.conversation.push({
      role: "system",
      text: composeSystemPrompt({
        skill: options.skill,
        allowList: options.allowList,
        stage: options.stage,
        guardrails: options.guardrails,
        extraSystemPrompt: options.extraSystemPrompt,
      }),
    })
  }

  /** The allow-list intersection with the Worker's active tools (the
   * `pi.setActiveTools` seam). */
  get activeTools(): ReadonlySet<string> {
    return applyActiveTools(this.options.activeTools, this.options.allowList)
  }

  async run(): Promise<SessionRunResult> {
    this.conversation.push({ role: "user", text: this.options.taskInput })
    const retryDelaysMs: number[] = []
    let attempts = 0
    for (;;) {
      if (this.aborted) {
        throw new Error("session aborted")
      }
      attempts += 1
      try {
        const result = await this.options.gateway.complete(this.options.lease, {
          parentAgentId: this.options.parentAgentId,
          agentId: this.agentId,
          agentRole: this.options.agentRole,
          model: this.options.model,
          prompt: this.promptText(),
          idempotencyKey: `session:${this.agentId}:${attempts}`,
        })
        this.conversation.push({ role: "assistant", text: result.text })
        return {
          agentId: this.agentId,
          text: result.text,
          toolCalls: [...this.toolCalls],
          attempts,
          retryDelaysMs,
        }
      } catch (error) {
        if (
          attempts > this.retry.maxRetries ||
          this.options.signal?.aborted === true
        ) {
          throw error
        }
        const waitMs = Math.min(this.retry.maxRetryDelayMs, 250 * 2 ** attempts)
        retryDelaysMs.push(waitMs)
        await delay(waitMs, this.options.signal)
      }
    }
  }

  abort(): void {
    this.aborted = true
  }

  private promptText(): string {
    return this.conversation
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join("\n\n")
  }
}
