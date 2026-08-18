/**
 * Model Gateway streaming transport tests: lease verification, model-use
 * recording, unknown-model fail-closed, missing-key failure, and credential
 * hygiene in records. No PostgreSQL, no network.
 */
import { describe, expect, test } from "bun:test"
import { FakeControlPlaneClient } from "../src/cp-client.js"
import {
  ModelGateway,
  ModelGatewayError,
  scriptedStreamingProvider,
} from "../src/model-gateway.js"
import type { GatewayStreamRequest, ScriptedTurn } from "../src/model-gateway.js"
import type { LeaseRef } from "../src/types.js"

const SECRET_KEY = "sk-test-0123456789abcdef"

function lease(stage: LeaseRef["stage"], leaseId = "lease-1"): LeaseRef {
  return {
    leaseId,
    token: "tok",
    incidentId: "inc-1",
    runId: "run-1",
    attempt: 1,
    stage,
    actorId: "orch-1",
    actorKind: "orchestrator",
    toolClass: stage,
  }
}

function request(overrides: Partial<GatewayStreamRequest> = {}): GatewayStreamRequest {
  return {
    parentAgentId: "run-1",
    agentId: "agent-1",
    agentRole: "sih-fusion-participant",
    model: { provider: "opencode-go", id: "deepseek-v4-flash" },
    context: { systemPrompt: "be helpful", messages: [], tools: [] },
    idempotencyKey: "ik-1",
    ...overrides,
  }
}

const textTurn: ScriptedTurn = { kind: "text", text: "hello" }

async function drain(stream: { result: () => Promise<unknown> }) {
  return stream.result()
}

describe("Model Gateway streaming transport", () => {
  test("a stale lease fails closed before any model call", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leaseError = "EXPIRED_LEASE"
    const gateway = new ModelGateway(cp, undefined, scriptedStreamingProvider({ turns: { "agent-1": [textTurn] } }))
    await expect(gateway.stream(lease("diagnose"), request())).rejects.toThrow(ModelGatewayError)
  })

  test("an unknown model is rejected before any call", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(cp, undefined, scriptedStreamingProvider({ turns: { "agent-1": [textTurn] } }))
    await expect(
      gateway.stream(lease("diagnose"), request({ model: { provider: "opencode-go", id: "no-such-model" } })),
    ).rejects.toThrow("unknown model")
  })

  test("a missing provider key is an explicit error, never a silent fallback", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(cp, undefined, () => {
      throw new ModelGatewayError("MISSING_API_KEY", "no provider key available for opencode-go")
    })
    await expect(gateway.stream(lease("diagnose"), request())).rejects.toThrow(ModelGatewayError)
  })

  test("a completed turn yields the assistant message and records sanitized model use", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({ turns: { "agent-1": [textTurn] } }),
      SECRET_KEY,
    )
    const stream = await gateway.stream(lease("diagnose"), request())
    const result = await drain(stream)

    expect(result).toHaveProperty("role", "assistant")
    expect(result).toHaveProperty("stopReason", "stop")

    expect(cp.modelUses).toHaveLength(1)
    const use = cp.modelUses[0]?.use
    expect(use?.agent_id).toBe("agent-1")
    expect(use?.agent_role).toBe("sih-fusion-participant")
    expect(use?.provider).toBe("opencode-go")
    expect(use?.model).toBe("deepseek-v4-flash")
    expect(use?.finish_status).toBe("stop")
    expect(use?.idempotency_key).toBe("ik-1")
    expect(use?.token_use).toMatchObject({
      prompt_tokens: 8,
      completion_tokens: 8,
      total_tokens: 16,
    })
    expect(use?.tool_calls).toEqual([])
  })

  test("tool-call turns record the call ids and names", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: {
          "agent-1": [{ kind: "tool-call", id: "call-1", name: "read_broker_query", args: { query: "q" } }],
        },
      }),
      SECRET_KEY,
    )
    const stream = await gateway.stream(lease("diagnose"), request())
    const result = await drain(stream)

    expect(result).toHaveProperty("stopReason", "toolUse")
    const use = cp.modelUses[0]?.use
    expect(use?.tool_calls).toEqual([{ id: "call-1", name: "read_broker_query" }])
  })

  test("a provider setup failure re-throws a sanitized error", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(cp, undefined, () => {
      throw new Error(`upstream 500 for key ${SECRET_KEY} authorization: Bearer ${SECRET_KEY}`)
    }, SECRET_KEY)
    await expect(gateway.stream(lease("diagnose"), request())).rejects.toThrow(
      "upstream 500 for key [REDACTED] authorization: [REDACTED] [REDACTED]",
    )
  })

  test("a scripted error turn lands as an error message and records the error status", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: { "agent-1": [{ kind: "error", message: "provider blew up", stopReason: "error" }] },
      }),
      SECRET_KEY,
    )
    const stream = await gateway.stream(lease("diagnose"), request())
    const result = await drain(stream)

    expect(result).toHaveProperty("stopReason", "error")
    const use = cp.modelUses[0]?.use
    expect(use?.finish_status).toBe("error")
    expect(JSON.stringify(cp.modelUses)).not.toContain(SECRET_KEY)
  })

  test("aborted streams report the aborted status", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const abort = new AbortController()
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: { "agent-1": [textTurn] },
        honorSignal: true,
      }),
      SECRET_KEY,
    )
    abort.abort()
    const stream = await gateway.stream(
      lease("diagnose"),
      request({ options: { signal: abort.signal } }),
    )
    const result = await drain(stream)

    expect(result).toHaveProperty("stopReason", "aborted")
  })
})
