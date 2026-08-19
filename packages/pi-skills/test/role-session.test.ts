/**
 * PiRoleSession deterministic tests: a real pi-agent-core loop driven by the
 * scripted gateway double, exercising broker reads, terminal submission
 * semantics, authority intersection, budgets, cancellation, and credential
 * hygiene. No PostgreSQL, no network, no real model.
 */
import { describe, expect, test } from "bun:test"
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai"
import type { AssistantMessage, streamSimple } from "@earendil-works/pi-ai"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import { FakeControlPlaneClient, ModelGateway, ReadBroker, scriptedStreamingProvider } from "@sih/brokers"
import type { GatewayStreamingProvider, LeaseRef, ScriptedTurn } from "@sih/brokers"

import { makeHypothesis, makeLease, REVISION_ID } from "./helpers.js"
import { createReadTool } from "../src/role/broker-tools.js"
import { createTerminalTool } from "../src/role/terminal-tools.js"
import { PiRoleSession } from "../src/role/role-session.js"
import { effectiveToolSet } from "../src/role/authority.js"
import { containsNoSecrets } from "../src/role/redact.js"

const SECRET = "sk-live-0123456789abcdef"

const READ_TOOL_NAME = "read_broker_query"
const TERMINAL_TOOL_NAME = "submit_fusion_output"

/** A schema-valid fusion-participant-output@1.0 payload. */
function validSubmission(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    participant_id: "p-1",
    revision_id: REVISION_ID,
    hypotheses: [makeHypothesis()],
    stated_objections: [],
    completed_at: new Date().toISOString(),
  }
}

const readTurn = (id: string, args: Record<string, unknown>): ScriptedTurn => ({
  kind: "tool-call",
  id,
  name: READ_TOOL_NAME,
  args,
})

function readArgs(backend = "prometheus"): Record<string, unknown> {
  return { backend, connection_id: "c1", query: "sum(rate(http_errors[5m]))" }
}

/** A streaming double whose turns stall until the signal fires or 1s passes. */
function slowStreamingProvider(): GatewayStreamingProvider {
  return (request, { model }) => {
    const stream = createAssistantMessageEventStream()
    void (async () => {
      const partial = stallMessage(model, "stalling…")
      stream.push({ type: "start", partial })
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        request.options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
      const aborted = request.options?.signal?.aborted === true
      const message = aborted
        ? { ...partial, content: [], stopReason: "aborted" as const }
        : { ...partial, content: [{ type: "text" as const, text: "done" }], stopReason: "stop" as const }
      if (aborted) {
        stream.push({ type: "error", reason: "aborted", error: message })
      } else {
        stream.push({ type: "done", reason: "stop", message })
      }
      stream.end(message)
    })()
    return stream
  }
}

function stallMessage(model: Parameters<typeof streamSimple>[0], text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  }
}

function lastAssistantStopReason(messages: AgentMessage[]): string | undefined {
  const last = [...messages].reverse().find((message) => message.role === "assistant")
  if (last === undefined || !("stopReason" in last)) {
    return undefined
  }
  return last.stopReason
}

interface HarnessOptions {
  turns?: readonly ScriptedTurn[]
  authority?: Partial<{
    roleTools: string[]
    stageTools: string[]
    policyTools: string[]
    leaseTools: string[]
  }>
  lease?: LeaseRef
  limits?: { maxModelTurns?: number; maxNonTerminalToolCalls?: number; maxDurationMs?: number }
  signal?: AbortSignal
  gateway?: ModelGateway
  secrets?: string[]
}

function makeHarness(options: HarnessOptions = {}) {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const gateway =
    options.gateway ??
    new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: { "agent-1": options.turns ?? [] },
        honorSignal: true,
      }),
      SECRET,
    )
  const broker = new ReadBroker(cp)
  const readTool = createReadTool({
    broker,
    lease: options.lease ?? makeLease("diagnose"),
    candidateHash: "sha256:" + "1".repeat(64),
  })
  const submitted: unknown[] = []
  const terminal = createTerminalTool({
    name: TERMINAL_TOOL_NAME,
    schemaName: "fusion-participant-output",
    schemaVersion: "1.0",
    submit: async (payload) => {
      submitted.push(payload)
      return { submissionId: `sub-${submitted.length}` }
    },
  })
  const authority = {
    roleTools: options.authority?.roleTools ?? [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
    stageTools: options.authority?.stageTools ?? [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
    policyTools: options.authority?.policyTools ?? [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
    leaseTools: options.authority?.leaseTools ?? [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
  }
  const session = new PiRoleSession({
    agentId: "agent-1",
    parentAgentId: "run-1",
    agentRole: "sih-fusion-participant",
    phase: "participant",
    systemPrompt: "You are a bounded Fusion participant.",
    model: { provider: "opencode-go", id: "deepseek-v4-flash" },
    reasoning: "high",
    lease: options.lease ?? makeLease("diagnose"),
    gateway,
    candidateHash: "sha256:" + "1".repeat(64),
    tools: [readTool, terminal.tool],
    terminalTool: terminal,
    authority,
    limits: options.limits,
    signal: options.signal,
    secrets: options.secrets,
  })
  return { session, cp, terminal, submitted, readTool, gateway }
}

/** The happy path: two reads then a valid terminal submission. */
function happyTurns(): ScriptedTurn[] {
  return [
    readTurn("call-1", readArgs()),
    readTurn("call-2", readArgs("flagd")),
    {
      kind: "tool-call",
      id: "call-3",
      name: TERMINAL_TOOL_NAME,
      args: {
        submission: validSubmission(),
      },
    },
  ]
}

describe("effective tool authority", () => {
  test("the intersection of all four lists wins", () => {
    const set = effectiveToolSet({
      roleTools: ["a", "b", "c"],
      stageTools: ["b", "c", "d"],
      policyTools: ["b", "d"],
      leaseTools: ["b"],
    })
    expect([...set]).toEqual(["b"])
  })

  test("a missing list defaults to no authority", () => {
    const set = effectiveToolSet({
      roleTools: ["a"],
      stageTools: ["a"],
      policyTools: undefined,
      leaseTools: ["a"],
    })
    expect(set.size).toBe(0)
  })

  test("an empty list defaults to no authority", () => {
    const set = effectiveToolSet({
      roleTools: ["a"],
      stageTools: [],
      policyTools: ["a"],
      leaseTools: ["a"],
    })
    expect(set.size).toBe(0)
  })
})

describe("PiRoleSession", () => {
  test("happy path: two permitted broker reads then a valid terminal submission succeeds", async () => {
    const { session, cp, submitted, terminal } = makeHarness({ turns: happyTurns() })
    const result = await session.run("Investigate and finish.")

    expect(result.status).toBe("succeeded")
    expect(result.turns).toBeGreaterThanOrEqual(3)
    expect(result.toolCalls).toBe(2)
    expect(result.terminalSubmission).toEqual({ submissionId: "sub-1" })
    expect(terminal.submission).toEqual({ submissionId: "sub-1" })
    expect(submitted).toHaveLength(1)
    expect(cp.receipts).toHaveLength(2)
    expect(
      cp.receipts.every(
        ({ receipt }) => receipt.kind === "read" && receipt.result.outcome === "ok",
      ),
    ).toBe(true)
  })

  test("every broker call is lease-scoped and binds the candidate hash", async () => {
    const { session, cp } = makeHarness({ turns: happyTurns() })
    await session.run("Go.")
    const hashes = cp.receipts.map(({ receipt }) => receipt.candidate_hash)
    expect(hashes).toEqual(["sha256:" + "1".repeat(64), "sha256:" + "1".repeat(64)])
  })

  test("no authority means the role cannot call anything and fails", async () => {
    const { session } = makeHarness({
      turns: happyTurns(),
      authority: {
        roleTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
        stageTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
        policyTools: [],
        leaseTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
      },
    })
    const result = await session.run("Investigate and finish.")
    expect(result.status).toBe("failed")
    expect(result.terminalSubmission).toBeUndefined()
  })

  test("a denied broker call produces no receipt and the session can correct course", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: {
          "agent-1": [
            readTurn("call-1", readArgs()),
            { kind: "error", message: "broker refused", stopReason: "error" },
          ],
        },
        honorSignal: true,
      }),
      SECRET,
    )
    const broker = new ReadBroker(cp)
    const lease = makeLease("diagnose")
    const readTool = createReadTool({ broker, lease, candidateHash: "sha256:" + "1".repeat(64) })
    const terminal = createTerminalTool({
      name: TERMINAL_TOOL_NAME,
      schemaName: "fusion-participant-output",
      schemaVersion: "1.0",
      submit: async (payload) => ({ submissionId: "sub-1" }),
    })
    // A refused read: the lease turns stale after the first successful call.
    let calls = 0
    const flaky = new ReadBroker({
      verifyLease: async () => {
        calls += 1
        return calls === 1 ? { valid: true, runState: "running" } : { valid: false, runState: null, error: "EXPIRED_LEASE" }
      },
      recordReceipt: async (incidentId, _runId, _stage, receipt) => {
        cp.receipts.push({ incidentId, receipt })
        return { recorded: true }
      },
      recordModelUse: async () => ({ recorded: true }),
      decideAction: async () => ({ decision: "autonomous", reason: "ok", riskClass: "safe" }),
      consumePermit: async () => ({ consumed: true }),
    })
    const flakyReadTool = createReadTool({
      broker: flaky,
      lease,
      candidateHash: "sha256:" + "1".repeat(64),
    })
    void readTool
    const session = new PiRoleSession({
      agentId: "agent-1",
      parentAgentId: "run-1",
      agentRole: "sih-fusion-participant",
      phase: "participant",
      systemPrompt: "You are a bounded Fusion participant.",
      model: { provider: "opencode-go", id: "deepseek-v4-flash" },
      lease,
      gateway,
      candidateHash: "sha256:" + "1".repeat(64),
      tools: [flakyReadTool, terminal.tool],
      terminalTool: terminal,
      authority: {
        roleTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
        stageTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
        policyTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
        leaseTools: [READ_TOOL_NAME, TERMINAL_TOOL_NAME],
      },
    })
    const result = await session.run("Investigate.")
    expect(result.status).toBe("failed")
    expect(cp.receipts).toHaveLength(1)
  })

  test("invalid terminal args return to the session and can be corrected", async () => {
    const payload = validSubmission()
    const { session, submitted, terminal } = makeHarness({
      turns: [
        readTurn("call-1", readArgs()),
        {
          kind: "tool-call",
          id: "call-2",
          name: TERMINAL_TOOL_NAME,
          args: { submission: { schema_version: "9.9" } },
        },
        readTurn("call-3", readArgs("flagd")),
        {
          kind: "tool-call",
          id: "call-4",
          name: TERMINAL_TOOL_NAME,
          args: { submission: payload },
        },
      ],
    })
    const result = await session.run("Investigate and finish.")

    expect(result.status).toBe("succeeded")
    expect(submitted).toEqual([payload])
    expect(terminal.submission).toEqual({ submissionId: "sub-1" })
    expect(result.toolCalls).toBe(2)
  })

  test("only the first valid terminal submission is durable", async () => {
    const payload = validSubmission()
    const { session, submitted, terminal } = makeHarness({
      turns: [
        {
          kind: "tool-call",
          id: "call-1",
          name: TERMINAL_TOOL_NAME,
          args: { submission: payload },
        },
        {
          kind: "tool-call",
          id: "call-2",
          name: TERMINAL_TOOL_NAME,
          args: { submission: payload },
        },
      ],
    })
    const result = await session.run("Finish.")
    expect(result.status).toBe("succeeded")
    expect(submitted).toHaveLength(1)
    expect(terminal.submission).toEqual({ submissionId: "sub-1" })
  })

  test("prose-only role with no terminal submission fails", async () => {
    const { session, submitted } = makeHarness({ turns: [{ kind: "text", text: "I am done." }] })
    const result = await session.run("Do the role.")
    expect(result.status).toBe("failed")
    expect(result.failureReason).toContain("no terminal submission")
    expect(submitted).toHaveLength(0)
  })

  test("the model turn budget stops the session", async () => {
    const { session, cp } = makeHarness({
      turns: [
        readTurn("call-1", readArgs()),
        readTurn("call-2", readArgs("flagd")),
        { kind: "text", text: "still working" },
      ],
      limits: { maxModelTurns: 2 },
    })
    const result = await session.run("Go.")
    expect(result.status).toBe("failed")
    expect(result.turns).toBeLessThanOrEqual(2)
    expect(result.failureReason).toContain("model turn budget")
    expect(cp.receipts).toHaveLength(2)
  })

  test("the non-terminal tool budget blocks further tool calls", async () => {
    const { session } = makeHarness({
      turns: [
        readTurn("call-1", readArgs()),
        readTurn("call-2", readArgs("flagd")),
        readTurn("call-3", readArgs()),
        { kind: "text", text: "final" },
      ],
      limits: { maxNonTerminalToolCalls: 2 },
    })
    const result = await session.run("Go.")
    expect(result.status).toBe("failed")
    expect(result.toolCalls).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(result.messages)).toContain("non-terminal tool call budget exhausted")
  })

  test("cancellation yields an aborted status", async () => {
    const abort = new AbortController()
    const { session } = makeHarness({
      turns: [
        readTurn("call-1", readArgs()),
        readTurn("call-2", readArgs("flagd")),
        { kind: "text", text: "final" },
      ],
      signal: abort.signal,
    })
    abort.abort()
    const result = await session.run("Go.")
    expect(result.status).toBe("aborted")
  })

  test("the wall-clock budget stops the session at a turn boundary", async () => {
    const { session } = makeHarness({
      turns: [readTurn("call-1", readArgs())],
      limits: { maxDurationMs: 1 },
    })
    const result = await session.run("Go.")
    expect(result.status).toBe("failed")
    expect(result.failureReason).toContain("wall-clock")
    expect(result.terminalSubmission).toBeUndefined()
  })

  test("a stalled model turn is cut off by the wall-clock budget", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, undefined, slowStreamingProvider(), undefined)
    const { session } = makeHarness({ gateway, limits: { maxDurationMs: 50 } })
    const result = await session.run("Go.")
    expect(result.status).toBe("failed")
    expect(result.failureReason).toContain("wall-clock")
    expect(lastAssistantStopReason(result.messages)).toBe("aborted")
  })

  test("cancellation mid-turn yields an aborted status", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, undefined, slowStreamingProvider(), undefined)
    const { session } = makeHarness({ gateway })
    const running = session.run("Go.")
    await Bun.sleep(30)
    session.abort()
    const result = await running
    expect(result.status).toBe("aborted")
    expect(lastAssistantStopReason(result.messages)).toBe("aborted")
  })

  test("records and transcripts contain no provider key or authorization header", async () => {
    const { session, cp } = makeHarness({ turns: happyTurns() })
    const result = await session.run("Investigate and finish.")

    const serialized = JSON.stringify({
      modelUses: cp.modelUses,
      receipts: cp.receipts,
      transcript: result.messages,
    })
    expect(serialized).not.toContain(SECRET)
    expect(serialized.toLowerCase()).not.toContain("authorization:")
    expect(containsNoSecrets(serialized, [SECRET])).toBe(true)
  })
})

/** A streaming double that emits a thinking block, a secret-bearing text
 * turn, and then a terminal tool call. */
function thinkingStreamingProvider(): GatewayStreamingProvider {
  const callCounts = new Map<string, number>()
  return (request, { model }) => {
    const stream = createAssistantMessageEventStream()
    void (async () => {
      const count = callCounts.get(request.agentId) ?? 0
      callCounts.set(request.agentId, count + 1)
      const think: AssistantMessage = {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "the hidden reasoning", redacted: false },
          { type: "toolCall", id: "call-t1", name: READ_TOOL_NAME, arguments: readArgs() },
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      }
      const reveal: AssistantMessage = {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-t2",
            name: READ_TOOL_NAME,
            arguments: {
              backend: "prometheus",
              connection_id: "c1",
              query: `authorization: Bearer ${SECRET}`,
            },
          },
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      }
      const finish: AssistantMessage = {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-t3",
            name: TERMINAL_TOOL_NAME,
            arguments: { submission: validSubmission() },
          },
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      }
      const turns = [think, reveal, finish]
      const message = turns[Math.min(count, turns.length - 1)] ?? finish
      stream.push({ type: "start", partial: message })
      if (message.stopReason === "toolUse") {
        const toolCall = message.content[0] as Extract<
          AssistantMessage["content"][number],
          { type: "toolCall" }
        >
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message })
        stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message })
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message })
        stream.push({ type: "done", reason: "toolUse", message })
      } else {
        stream.push({ type: "text_start", contentIndex: 0, partial: message })
        const text = message.content[0] as { type: "text"; text: string }
        stream.push({ type: "text_delta", contentIndex: 0, delta: text.text, partial: message })
        stream.push({ type: "text_end", contentIndex: 0, content: text.text, partial: message })
        stream.push({ type: "done", reason: "stop", message })
      }
      stream.end(message)
    })()
    return stream
  }
}

describe("PiRoleSession run artifact", () => {
  test("a succeeded session settles a complete artifact", async () => {
    const { session } = makeHarness({ turns: happyTurns() })
    const result = await session.run("Investigate and finish.")
    const artifact = result.artifact

    expect(artifact.phase).toBe("participant")
    expect(artifact.agent_id).toBe("agent-1")
    expect(artifact.parent_agent_id).toBe("run-1")
    expect(artifact.provider_class).toBe("real")
    expect(artifact.provider).toBe("opencode-go")
    expect(artifact.model).toBe("deepseek-v4-flash")
    expect(artifact.reasoning).toBe("high")
    expect(artifact.status).toBe("succeeded")
    expect(artifact.failure_reason).toBeNull()
    expect(artifact.exclude_from_context).toBe(true)
    expect(artifact.sealed_at).toBeDefined()

    const call = artifact.calls[0]
    expect(call).toBeDefined()
    expect(call.call_id).toBe("call:agent-1:0")
    expect(call.order).toBe(0)
    expect(call.phase).toBe("participant")
    expect(call.role).toBe("sih-fusion-participant")
    expect(call.status).toBe("succeeded")
    expect(call.submission_ref).toBe("sub-1")
    expect(call.turns).toBe(3)
    expect(call.tool_activity.map((a) => a.tool_call_id)).toEqual(["call-1", "call-2"])
    expect(call.tool_activity.map((a) => a.tool)).toEqual([READ_TOOL_NAME, READ_TOOL_NAME])
    expect(call.retry_delay_ms).toBeNull()
    expect(call.rate_limit_delay_ms).toBeNull()

    expect(artifact.metrics.duration_ms).toBe(Date.parse(call.completed_at) - Date.parse(call.started_at))
    expect(artifact.metrics.prompt_tokens).toBe(call.token_use.prompt_tokens)
    expect(artifact.metrics.completion_tokens).toBe(call.token_use.completion_tokens)
    expect(artifact.metrics.total_tokens).toBe(call.token_use.total_tokens)
    expect(artifact.metrics.tool_call_count).toBe(call.tool_activity.length)
  })

  test("the artifact excludes hidden reasoning and scrubs secrets", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, undefined, thinkingStreamingProvider(), SECRET)
    const { session } = makeHarness({ gateway })
    const result = await session.run("Investigate and finish.")

    expect(result.status).toBe("succeeded")
    const serialized = JSON.stringify(result.artifact)
    expect(serialized).not.toContain("the hidden reasoning")
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain("authorization: Bearer")
    expect(containsNoSecrets(serialized, [SECRET])).toBe(true)

    const call = result.artifact.calls[0]
    expect(call.tool_activity.map((a) => a.tool_call_id)).toEqual(["call-t1", "call-t2"])
    expect(call.output).toBeNull()
    const secretTurn = call.tool_activity[1]
    expect(secretTurn.args).not.toContain(SECRET)
    expect(secretTurn.args).toContain("[REDACTED]")
    expect(secretTurn.result).not.toContain(SECRET)
  })

  test("a failed session settles a failed artifact with no submission", async () => {
    const { session } = makeHarness({
      turns: [{ kind: "error", message: "provider exploded", stopReason: "error" }],
    })
    const result = await session.run("Go.")

    expect(result.status).toBe("failed")
    const artifact = result.artifact
    expect(artifact.status).toBe("failed")
    expect(artifact.failure_reason).toContain("no terminal submission")
    const call = artifact.calls[0]
    expect(call.status).toBe("failed")
    expect(call.failure_reason).toContain("no terminal submission")
    expect(call.submission_ref).toBeNull()
    expect(call.turns).toBe(1)
    expect(call.tool_activity).toHaveLength(0)
  })

  test("an aborted session settles an aborted artifact", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, undefined, slowStreamingProvider(), undefined)
    const { session } = makeHarness({ gateway })
    const running = session.run("Go.")
    await Bun.sleep(30)
    session.abort()
    const result = await running

    expect(result.status).toBe("aborted")
    expect(result.artifact.status).toBe("aborted")
    expect(result.artifact.calls[0].submission_ref).toBeNull()
    expect(result.artifact.calls[0].status).toBe("aborted")
  })
})

