/**
 * Lease and permit tests: stale-lease rejection and one-use permit reuse
 * rejection. PostgreSQL-backed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { advanceClock } from "../src/clock.js"
import { LeaseService } from "../src/leases/lease-service.js"
import type { Runtime } from "../src/bootstrap.js"
import { closeRuntime, newTestRuntime, testConfig } from "./helpers.js"

const SHA = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`

describe("Leases and permits", () => {
  let runtime: Runtime

  beforeAll(async () => {
    runtime = await newTestRuntime("leases")
  })
  afterAll(async () => {
    await closeRuntime(runtime)
  })

  test("an expired lease is rejected at the broker", async () => {
    const intake = await runtime.cp.handleTrigger({
      schema_version: "1.0",
      trigger_id: "t",
      delivery_key: SHA(50),
      incident_key: SHA(51),
      received_at: "2026-08-15T15:35:20Z",
      detector: { source: "s", connection_id: "c", rule_id: "r", rule_version: "v" },
      state: "firing",
      severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
      signal_summary: { name: "x", value: 0.9, unit: "1", threshold: 0.2 },
      evidence_refs: [],
    })
    const incidentId = intake.ok ? intake.value.incidentId : "inc-lease"
    await runtime.cp.startRun(incidentId, "run-1")
    const policy = await runtime.cp.getPolicy(incidentId)
    const issued = await runtime.cp.leases.issueRunLease({
      incidentId, runId: "run-1", attempt: 1, stage: "detect",
      actorId: "orch", actorKind: "orchestrator", authorityMode: policy.authorityMode,
      policyVersion: policy.version, toolClass: "detect",
    })
    const claims = {
      leaseId: issued.leaseId, incidentId, runId: "run-1", attempt: 1, stage: "detect",
      actorId: "orch", actorKind: "orchestrator" as const, toolClass: "detect",
    }
    const stillValid = await runtime.cp.leases.verifyRunLease(issued.token, claims, "running")
    expect(stillValid.ok).toBe(true)

    // A second LeaseService with an advanced clock sees the lease as expired.
    const future = new LeaseService(runtime.store, advanceClock(runtime.clock, 3600), testConfig("leases"))
    const expired = await future.verifyRunLease(issued.token, claims, "running")
    expect(expired.ok).toBe(false)
    if (!expired.ok) {
      expect(expired.error.code).toBe("EXPIRED_LEASE")
    }
  })

  test("a revoked lease is rejected", async () => {
    const intake = await runtime.cp.handleTrigger({
      schema_version: "1.0", trigger_id: "t", delivery_key: SHA(52), incident_key: SHA(53),
      received_at: "2026-08-15T15:35:20Z",
      detector: { source: "s", connection_id: "c", rule_id: "r", rule_version: "v" },
      state: "firing", severity: "critical",
      scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
      signal_summary: { name: "x", value: 0.9, unit: "1", threshold: 0.2 }, evidence_refs: [],
    })
    const incidentId = intake.ok ? intake.value.incidentId : "inc-revoke"
    await runtime.cp.startRun(incidentId, "run-1")
    const policy = await runtime.cp.getPolicy(incidentId)
    const issued = await runtime.cp.leases.issueRunLease({
      incidentId, runId: "run-1", attempt: 1, stage: "detect",
      actorId: "orch", actorKind: "orchestrator", authorityMode: policy.authorityMode,
      policyVersion: policy.version, toolClass: "detect",
    })
    const claims = {
      leaseId: issued.leaseId, incidentId, runId: "run-1", attempt: 1, stage: "detect",
      actorId: "orch", actorKind: "orchestrator" as const, toolClass: "detect",
    }
    await runtime.cp.leases.revokeRunLeases(incidentId, "run-1")
    const result = await runtime.cp.leases.verifyRunLease(issued.token, claims, "running")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("REVOKED_LEASE")
    }
  })

  test("a one-use permit cannot be replayed", async () => {
    const issued = await runtime.cp.leases.issuePermit({
      kind: "release", incidentId: "inc-permit", runId: "run-1", attempt: 1,
      candidateHash: SHA(60), target: "payment", actionDigest: SHA(61),
    })
    const expected = { candidateHash: SHA(60), target: "payment", incidentId: "inc-permit" }
    const first = await runtime.cp.leases.consumePermit(issued.permitId, issued.token, expected)
    expect(first.ok).toBe(true)

    const second = await runtime.cp.leases.consumePermit(issued.permitId, issued.token, expected)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe("PERMIT_USED")
    }
  })

  test("a permit bound to the wrong candidate hash is rejected", async () => {
    const issued = await runtime.cp.leases.issuePermit({
      kind: "release", incidentId: "inc-permit2", runId: "run-1", attempt: 1,
      candidateHash: SHA(62), target: "payment", actionDigest: SHA(63),
    })
    const wrong = await runtime.cp.leases.consumePermit(issued.permitId, issued.token, {
      candidateHash: SHA(99), target: "payment", incidentId: "inc-permit2",
    })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) {
      expect(wrong.error.code).toBe("CANDIDATE_MISMATCH")
    }
  })
})
