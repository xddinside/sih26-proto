import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { IncidentTrigger } from "@sih/contracts/types"
import type { ControlPlane } from "../src/core/state-machine.js"
import type { LeaseClaims } from "../src/leases/lease-service.js"
import type { DomainError, Result } from "../src/result.js"
import { closeRuntime, newTestRuntime } from "./helpers.js"

const SHA = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`

function trigger(n: number): IncidentTrigger {
  return {
    schema_version: "1.0",
    trigger_id: `orch-trig-${n}`,
    delivery_key: SHA(n + 100),
    incident_key: SHA(n),
    received_at: "2026-08-15T15:35:20Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "demo",
      rule_id: "payment-error-rate",
      rule_version: "git:test",
    },
    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [],
  }
}

function must<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function lease(cp: ControlPlane, incidentId: string, runId: string, stage: LeaseClaims["stage"]) {
  const policy = await cp.getPolicy(incidentId)
  const issued = await cp.leases.issueRunLease({
    incidentId,
    runId,
    attempt: 1,
    stage,
    actorId: `orchestrator-${runId}`,
    actorKind: "orchestrator",
    authorityMode: policy.authorityMode,
    policyVersion: policy.version,
    toolClass: stage,
  })
  return {
    token: issued.token,
    claims: {
      leaseId: issued.leaseId,
      incidentId,
      runId,
      attempt: 1,
      stage,
      actorId: `orchestrator-${runId}`,
      actorKind: "orchestrator" as const,
      toolClass: stage,
    },
  }
}

const budget = {
  model_turns: 20,
  non_terminal_tool_calls: 32,
  session_wall_clock_ms: 720_000,
  run_wall_clock_ms: 7_200_000,
}

describe("Control Plane Orchestrator work admission", () => {
  let runtime: Awaited<ReturnType<typeof newTestRuntime>> | undefined
  let cp: ControlPlane

  beforeAll(async () => {
    runtime = await newTestRuntime("orchestrator-work")
    cp = runtime.cp
  })

  afterAll(async () => {
    if (runtime) await closeRuntime(runtime)
  })

  test("admits only current-stage bounded work and rejects duplicates or oversized budgets", async () => {
    const intake = must(await cp.handleTrigger(trigger(1)))
    const incidentId = intake.incidentId
    const runId = "run-1"
    await cp.startRun(incidentId, runId)
    const current = await lease(cp, incidentId, runId, "detect")

    const inspected = must(await cp.inspectOrchestratorState(incidentId, current.token, current.claims))
    expect(inspected.current_stage).toBe("detect")
    expect(inspected.admitted_artifacts).toEqual([])

    const request = {
      request_id: "request-detect-1",
      work_id: "detect-1",
      stage: "detect" as const,
      attempt: 1,
      depends_on: [],
      budget,
    }
    const admitted = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, request))
    expect(admitted.status).toBe("admitted")

    const duplicate = await cp.requestOrchestratorWork(incidentId, current.token, current.claims, request)
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.code).toBe("DUPLICATE_WORK")

    const staleAttempt = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      ...request,
      request_id: "request-detect-stale",
      work_id: "detect-stale",
      attempt: 2,
    }))
    expect(staleAttempt.status).toBe("rejected")
    if (staleAttempt.status === "rejected") expect(staleAttempt.code).toBe("STALE_ATTEMPT")

    const missingDependency = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      ...request,
      request_id: "request-detect-missing-dependency",
      work_id: "detect-missing-dependency",
      depends_on: ["not-admitted"],
    }))
    expect(missingDependency.status).toBe("rejected")
    if (missingDependency.status === "rejected") expect(missingDependency.code).toBe("PREREQUISITE_MISSING")

    const tooLarge = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      ...request,
      request_id: "request-detect-too-large",
      work_id: "detect-too-large",
      budget: { ...budget, session_wall_clock_ms: 720_001 },
    }))
    expect(tooLarge.status).toBe("rejected")
    if (tooLarge.status === "rejected") expect(tooLarge.code).toBe("BUDGET_EXCEEDED")

    const cumulative = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      ...request,
      request_id: "request-detect-cumulative",
      work_id: "detect-cumulative",
      budget: { ...budget, model_turns: 1 },
    }))
    expect(cumulative.status).toBe("rejected")
    if (cumulative.status === "rejected") expect(cumulative.code).toBe("BUDGET_EXCEEDED")

    const wrongStage = must(await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      ...request,
      request_id: "request-diagnose-with-detect-lease",
      work_id: "diagnose-1",
      stage: "diagnose",
    }))
    expect(wrongStage.status).toBe("rejected")
    if (wrongStage.status === "rejected") expect(wrongStage.code).toBe("WRONG_STAGE")
  })

  test("does not admit a later stage until its artifact-backed prerequisite is complete", async () => {
    const intake = must(await cp.handleTrigger(trigger(2)))
    const incidentId = intake.incidentId
    const runId = "run-1"
    await cp.startRun(incidentId, runId)
    const detect = await lease(cp, incidentId, runId, "detect")
    const detectWork = must(await cp.requestOrchestratorWork(incidentId, detect.token, detect.claims, {
      request_id: "request-detect-completable",
      work_id: "detect-completable",
      stage: "detect",
      attempt: 1,
      depends_on: [],
      budget: { ...budget, model_turns: 1, non_terminal_tool_calls: 1, session_wall_clock_ms: 1 },
    }))
    const before = must(await cp.requestOrchestratorWork(incidentId, detect.token, detect.claims, {
      request_id: "request-diagnose-before-detect",
      work_id: "diagnose-before-detect",
      stage: "diagnose",
      attempt: 1,
      depends_on: [],
      budget,
    }))
    expect(before.status).toBe("rejected")
    if (before.status === "rejected") expect(before.code).toBe("WRONG_STAGE")

    const brief = must(await cp.sealArtifact(incidentId, runId, {
      incidentId,
      runId,
      schemaId: "incident-brief",
      schemaVersion: "1.0",
      payload: {
        schema_version: "1.0",
        incident_id: incidentId,
        run_id: runId,
        attempt: 1,
        severity: "critical",
        scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
        symptom: "payment charges fail",
        initial_evidence_item_ids: [],
        policy_version: (await cp.getPolicy(incidentId)).version,
        sealed_at: "2026-08-15T15:00:00.000Z",
      },
      producer: { skill: "test", skill_version: "1.0" },
    }))
    expect((await cp.submitCommand(incidentId, detect.token, detect.claims, { kind: "enter-stage", stage: "detect" })).ok).toBe(true)
    expect((await cp.submitCommand(incidentId, detect.token, detect.claims, { kind: "stage-status", stage: "detect", to: "in-progress" })).ok).toBe(true)
    expect((await cp.submitCommand(incidentId, detect.token, detect.claims, { kind: "stage-status", stage: "detect", to: "completed", artifact_ref: brief.artifactRef })).ok).toBe(true)
    expect((await cp.completeOrchestratorWork(incidentId, detect.token, detect.claims, detectWork.work_id, [brief.artifactRef])).ok).toBe(true)

    const diagnose = await lease(cp, incidentId, runId, "diagnose")
    const admitted = must(await cp.requestOrchestratorWork(incidentId, diagnose.token, diagnose.claims, {
      request_id: "request-diagnose-after-detect",
      work_id: "diagnose-after-detect",
      stage: "diagnose",
      attempt: 1,
      depends_on: [detectWork.work_id],
      budget: { ...budget, model_turns: 1, non_terminal_tool_calls: 1, session_wall_clock_ms: 1 },
    }))
    expect(admitted.status).toBe("admitted")
    if (admitted.status === "admitted") expect(admitted.admitted_artifacts).toContainEqual(brief.artifactRef)
  })

  test("revocation stops dependent scheduling and invalidates the active lease", async () => {
    const intake = must(await cp.handleTrigger(trigger(3)))
    const incidentId = intake.incidentId
    const runId = "run-1"
    await cp.startRun(incidentId, runId)
    const current = await lease(cp, incidentId, runId, "detect")

    await cp.revokeOrchestratorWork(incidentId, runId)

    const afterRevoke = await cp.requestOrchestratorWork(incidentId, current.token, current.claims, {
      request_id: "request-after-revoke",
      work_id: "detect-after-revoke",
      stage: "detect",
      attempt: 1,
      depends_on: [],
      budget: { ...budget, model_turns: 1, non_terminal_tool_calls: 1, session_wall_clock_ms: 1, run_wall_clock_ms: 1 },
    })
    expect(afterRevoke.ok).toBe(false)
    if (!afterRevoke.ok) expect(afterRevoke.error.code).toBe("REVOKED_LEASE")
  })
})
