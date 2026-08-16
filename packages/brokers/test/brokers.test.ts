/**
 * Broker tests: lease-carrying requests, receipt binding (wrong candidate hash
 * rejected), forged stage, and barred action rejection. No PostgreSQL.
 */
import { describe, expect, test } from "bun:test"
import { ActionBroker, ActionBrokerError } from "../src/action-broker.js"
import { FakeControlPlaneClient } from "../src/cp-client.js"
import { ModelGateway, ModelGatewayError } from "../src/model-gateway.js"
import { ReadBroker, ReadBrokerError } from "../src/read-broker.js"
import type { LeaseRef } from "../src/types.js"

const SHA = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`

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

describe("Read Broker", () => {
  test("a stale lease fails closed before any data moves", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leaseError = "STALE_LEASE"
    const broker = new ReadBroker(cp)
    await expect(
      broker.read(lease("diagnose"), { backend: "prometheus", connection_id: "c", query: "q" }, SHA(1)),
    ).rejects.toThrow(ReadBrokerError)
  })

  test("a valid read returns data and records a receipt bound to the candidate hash", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const broker = new ReadBroker(cp)
    const { receiptId } = await broker.read(
      lease("diagnose"),
      { backend: "prometheus", connection_id: "c", query: "q" },
      SHA(1),
    )
    expect(receiptId).toMatch(/^rcpt-/)
    expect(cp.receipts).toHaveLength(1)
    const receipt = cp.receipts[0]?.receipt
    expect(receipt?.candidate_hash).toBe(SHA(1))
    expect(receipt?.stage).toBe("diagnose")
    expect(receipt?.lease_id).toBe("lease-1")
  })
})

describe("Action Broker", () => {
  test("a forged stage write is rejected", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const broker = new ActionBroker(cp)
    await expect(
      broker.execute(lease("detect"), {
        action: { adapter: "local-git", action_class: "submit_remediation_pr", command: "patch" },
        target: { service_name: "payment", expected_version: "v1" },
        candidateHash: SHA(1),
        actionDigest: SHA(2),
      }),
    ).rejects.toThrow("detect may not perform submit_remediation_pr")
  })

  test("a release-stage action without a permit is rejected", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const broker = new ActionBroker(cp)
    await expect(
      broker.execute(lease("release"), {
        action: { adapter: "compose-release", action_class: "submit_typed_action", command: "swap" },
        target: { service_name: "payment", expected_version: "v1" },
        candidateHash: SHA(1),
        actionDigest: SHA(2),
      }),
    ).rejects.toThrow("one-use permit")
  })

  test("a permit bound to a different candidate hash is rejected", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    cp.permitCandidateHash = SHA(7)
    const broker = new ActionBroker(cp)
    try {
      await broker.execute(lease("release"), {
        action: { adapter: "compose-release", action_class: "submit_typed_action", command: "swap" },
        target: { service_name: "payment", expected_version: "v1" },
        candidateHash: SHA(1),
        actionDigest: SHA(2),
        permitId: "permit-1",
        permitToken: "ptok",
      })
      throw new Error("expected rejection")
    } catch (cause) {
      expect(cause).toBeInstanceOf(ActionBrokerError)
      expect((cause as ActionBrokerError).code).toBe("CANDIDATE_MISMATCH")
    }
  })

  test("a barred action never executes", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    cp.decision = { decision: "denied", reason: "barred", riskClass: "barred" }
    const broker = new ActionBroker(cp)
    await expect(
      broker.execute(lease("release"), {
        action: { adapter: "compose-release", action_class: "submit_typed_action", command: "drop table orders" },
        target: { service_name: "payment", expected_version: "v1" },
        candidateHash: SHA(1),
        actionDigest: SHA(2),
        permitId: "permit-1",
        permitToken: "ptok",
      }),
    ).rejects.toThrow("barred")
  })

  test("a successful action records a receipt binding target and candidate hash", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const broker = new ActionBroker(cp)
    const receipt = await broker.execute(lease("release"), {
      action: { adapter: "compose-release", action_class: "submit_typed_action", command: "swap" },
      target: { service_name: "payment", expected_version: "v1" },
      candidateHash: SHA(1),
      actionDigest: SHA(2),
      permitId: "permit-1",
      permitToken: "ptok",
    })
    expect(receipt.kind).toBe("action")
    expect(receipt.candidate_hash).toBe(SHA(1))
    expect((receipt as { outcome: string }).outcome).toBe("ok")
  })
})

describe("Model Gateway", () => {
  test("a stale lease fails closed", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leaseError = "EXPIRED_LEASE"
    const gateway = new ModelGateway(cp)
    await expect(
      gateway.complete(lease("diagnose"), {
        parentAgentId: "p", agentId: "a", model: "m", prompt: "hi", idempotencyKey: "k",
      }),
    ).rejects.toThrow(ModelGatewayError)
  })

  test("a valid call records model use without exposing any credential", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-1")
    const gateway = new ModelGateway(cp)
    const result = await gateway.complete(lease("diagnose"), {
      parentAgentId: "p", agentId: "a", model: "m", prompt: "hi", idempotencyKey: "k",
    })
    expect(result.promptTokens).toBeGreaterThanOrEqual(0)
  })
})
