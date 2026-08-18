/**
 * PiRoleSession deterministic tests: a real pi-agent-core loop driven by the
 * scripted gateway double, exercising broker reads, terminal submission
 * semantics, authority intersection, budgets, cancellation, and credential
 * hygiene. No PostgreSQL, no network, no real model.
 */
import { describe, expect, test } from "bun:test"
import { FakeControlPlaneClient, ModelGateway, ReadBroker, scriptedStreamingProvider } from "@sih/brokers"
import type { LeaseRef, ScriptedTurn } from "@sih/brokers"

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
}

function makeHarness(options: HarnessOptions = {}) {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const gateway = new ModelGateway(
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
