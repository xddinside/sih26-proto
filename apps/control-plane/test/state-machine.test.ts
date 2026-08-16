/**
 * PostgreSQL-backed state-machine tests: trigger dedup/idempotency,
 * transition legality, journal replay, and the two settled Demo Run terminal
 * paths (Run 1 resolve/close, Run 2 verification-failed with no Release).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { JournalCommand, JournalEvent, IncidentTrigger, RemediationProposal } from "@sih/contracts/types"
import { reduceJournalEvents } from "@sih/contracts/journal"
import type { DomainError, Result } from "../src/result.js"

import type { Runtime } from "../src/bootstrap.js"
import type { ControlPlane } from "../src/core/state-machine.js"
import type { LeaseClaims } from "../src/leases/lease-service.js"
import { closeRuntime, newTestRuntime } from "./helpers.js"

const SHA = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`
const ID = (n: number) => `sha256:${(0xffffffff - n).toString(16).padStart(64, "0")}`

function trigger(n: number, state: "firing" | "resolved" = "firing"): IncidentTrigger {
  return {
    schema_version: "1.0" as const,
    trigger_id: `trig-${n}`,
    delivery_key: ID(n),
    incident_key: SHA(n),
    received_at: "2026-08-15T15:35:20Z",
    detector: {
      source: "prometheus-alertmanager",
      connection_id: "astronomy-shop-local",
      rule_id: "payment-error-rate",
      rule_version: "git:abc123",
    },
    state,
    severity: "critical" as const,
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-15T15:33:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [],
  }
}

async function stageLease(cp: ControlPlane, incidentId: string, runId: string, attempt: number, stage: string): Promise<{ token: string; claims: LeaseClaims }> {
  const policy = await cp.getPolicy(incidentId)
  const issued = await cp.leases.issueRunLease({
    incidentId,
    runId,
    attempt,
    stage,
    actorId: `orch-${runId}`,
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
      attempt,
      stage,
      actorId: `orch-${runId}`,
      actorKind: "orchestrator",
      toolClass: stage,
    },
  }
}

async function drive(cp: ControlPlane, incidentId: string, runId: string, attempt: number, stage: string, to: "in-progress" | "completed", artifactRef?: { schema_id: string; schema_version: string; content_hash: string }): Promise<void> {
  const l = await stageLease(cp, incidentId, runId, attempt, stage)
  const enter = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "enter-stage", stage })
  expect(enter.ok).toBe(true)
  const progress = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "stage-status", stage, to: "in-progress" })
  expect(progress.ok).toBe(true)
  if (to === "completed") {
    const done = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "stage-status", stage, to: "completed", artifact_ref: artifactRef })
    expect(done.ok).toBe(true)
  }
}

async function seal(cp: ControlPlane, incidentId: string, runId: string, schemaId: string, payload: unknown) {
  return cp.sealArtifact(incidentId, runId, { incidentId, runId, schemaId, schemaVersion: "1.0", payload: payload as never, producer: { skill: "test", skill_version: "1.0" } })
}

function must<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const T = "2026-08-15T16:00:00Z"

describe("Control Plane state machine", () => {
  let runtime: Runtime
  let cp: ControlPlane

  beforeAll(async () => {
    runtime = await newTestRuntime("state")
    cp = runtime.cp
  })
  afterAll(async () => {
    await closeRuntime(runtime)
  })

  test("trigger dedup by delivery_key is a no-op", async () => {
    const first = await cp.handleTrigger(trigger(1))
    expect(first.ok).toBe(true)
    expect(must(first).deliveryResult).toBe("incident-created")
    const incidentId = must(first).incidentId
    const eventsBefore = cp.journal.events(incidentId).length

    const second = await cp.handleTrigger(trigger(1))
    expect(second.ok).toBe(true)
    expect(must(second).deliveryResult).toBe("duplicate-noop")
    expect(cp.journal.events(incidentId).length).toBe(eventsBefore)
  })

  test("a firing trigger for an open incident appends evidence, never a second run", async () => {
    const first = await cp.handleTrigger(trigger(2))
    expect(first.ok).toBe(true)
    const incidentId = must(first).incidentId
    const stateBefore = cp.journal.state(incidentId)
    const runCount = stateBefore?.runs.length ?? 0

    // Same incident key, new delivery: appends evidence, no second run.
    const again = await cp.handleTrigger({ ...trigger(2), delivery_key: ID(98) })
    expect(again.ok).toBe(true)
    expect(must(again).deliveryResult).toBe("evidence-appended")
    expect(cp.journal.state(incidentId)?.runs.length).toBe(runCount)
  })

  test("a closed incident cannot start a run (illegal transition)", async () => {
    const first = await cp.handleTrigger(trigger(4))
    expect(first.ok).toBe(true)
    const incidentId = must(first).incidentId
    await cp.humanAction(incidentId, "close")

    const policy = await cp.getPolicy(incidentId)
    const illegal: JournalCommand = {
      type: "run_transition",
      idempotency_key: "illegal-run-create",
      recorded_at: T,
      actor: { id: "cp-1", kind: "control-plane" },
      policy_version: policy.version,
      incident_id: incidentId,
      run_id: "run-x",
      attempt: 1,
      from: null,
      to: "queued",
      expected_run_version: 0,
    }
    const applied = await cp.journal.apply(incidentId, illegal)
    expect(applied.kind).toBe("error")
    if (applied.kind === "error") {
      expect(applied.error.code).toBe("ILLEGAL_TRANSITION")
    }
  })

  test("journal replays to the same state", async () => {
    const first = await cp.handleTrigger(trigger(5))
    expect(first.ok).toBe(true)
    const incidentId = must(first).incidentId
    const runId = "run-1"
    await cp.startRun(incidentId, runId)

    const events = cp.journal.events(incidentId) as JournalEvent[]
    const reduced = reduceJournalEvents(events)
    expect(reduced.ok).toBe(true)
    if (reduced.ok) {
      expect(reduced.value.incidentState).toBe("open")
      expect(reduced.value.runs[0]?.state).toBe("running")
    }
  })

  test("Run 1: verified-remediation resolves and closes", async () => {
    const first = await cp.handleTrigger(trigger(6))
    expect(first.ok).toBe(true)
    const incidentId = must(first).incidentId
    const runId = "run-1"
    const attempt = 1
    await cp.startRun(incidentId, runId)

    // Detect
    const brief = await seal(cp, incidentId, runId, "incident-brief", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      severity: "critical", scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      symptom: "payment charges failing", initial_evidence_item_ids: [], policy_version: "policy-v1", sealed_at: T,
    })
    expect(brief.ok).toBe(true)
    await drive(cp, incidentId, runId, attempt, "detect", "completed", must(brief).artifactRef)

    // Diagnose
    const diagnosis = await seal(cp, incidentId, runId, "diagnosis-report", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      hypotheses: [], contradictions: [], gaps: [], next_actions: [],
      fusion_meta: { participant_ids: ["p1", "p2"], judge_id: "j1", synthesizer_id: "s1", revision_id: SHA(10), rounds: [] },
      sealed_at: T,
    })
    expect(diagnosis.ok).toBe(true)
    await drive(cp, incidentId, runId, attempt, "diagnose", "completed", must(diagnosis).artifactRef)

    // Repair: sealed remediation proposal with candidate hash.
    const candidateHash = SHA(20)
    const proposalPayload: RemediationProposal = {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      candidate_hash: candidateHash, remediation_class: "code", action_risk_class: "safe",
      gate_path: "release", disposition: "allowed", change_description: "restore negation",
      diff: { base_ref: "abc", diff_text: "-if (['visa'].includes)", diff_hash: SHA(21) },
      citations: [], test_plan: [], changed_surfaces: ["src/payment/card.js"],
      recovery_point: { id: "rp-1", changed_surfaces: ["src/payment/card.js"] },
      sealed_at: T,
    }
    const proposal = await seal(cp, incidentId, runId, "remediation-proposal", proposalPayload)
    expect(proposal.ok).toBe(true)
    await drive(cp, incidentId, runId, attempt, "repair", "completed", must(proposal).artifactRef)

    // Verify: deterministic verdict pass.
    const verdict = await cp.requestVerificationVerdict(incidentId, runId, {
      candidateHash,
      attempt,
      remediationClass: "code",
      riskClass: "safe",
      gatePath: "release",
      resolver: {
        remediationClass: "code",
        declaredSurfaces: ["src/payment/card.js"],
        diff: { changed_files: ["src/payment/card.js"], deleted_files: [] },
        actionRiskClass: "safe",
        policyVersion: "v1",
        toolCatalog: {
          version: "1", language: "node", fuzzHarnessAvailable: false, stagingTargetExists: false,
          serviceUserFacing: false, pipelineHasE2E: false, performanceSuiteExists: false,
          performanceSensitivePaths: [], ownershipMap: { "src/payment/card.js": "payment-regression" },
        },
        recoveryPointSurfaces: ["src/payment/card.js"],
        watchPlanExists: false,
      },
      reviews: ["R1", "R2", "R3", "R4", "R8"].map((role) => ({ role, status: "pass", findings: [] })),
      tests: ["T1", "T2", "T3", "T4", "T5", "T7"].map((layer) => ({ layer, outcome: "pass", flaky: false, tool: "node --test", tool_version: "1", receipt_ref: `r-${layer}` })),
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(verdict.ok).toBe(true)
    expect(must(verdict).verdict).toBe("pass")
    await drive(cp, incidentId, runId, attempt, "verify", "completed", must(verdict).artifactRef)

    // Release Gate: pass; permit issued.
    const gate = await cp.requestReleaseGate(incidentId, runId, {
      candidateHash,
      proposal: proposalPayload,
      verificationReport: { candidate_hash: candidateHash, hash_binding: { match: true } },
      riskClass: "safe",
      actionDigest: SHA(30),
      target: "payment",
      attempt,
      artifactMatchesCommit: true,
      pipelineChecksPassed: true,
      targetVersionMatches: true,
      rolloutWatchPlanComplete: true,
      recoveryPointCoverage: { validated: true, changed: ["src/payment/card.js"], covered: ["src/payment/card.js"], uncoveredApproved: false },
      pipelineRulesPassed: true,
    })
    expect(gate.ok).toBe(true)
    expect(must(gate).verdict).toBe("pass")
    expect(must(gate).permit).not.toBeNull()

    // Action Broker executes the permitted swap and records a receipt.
    const receipt = await cp.recordBrokerReceipt(incidentId, runId, "release", {
      kind: "action",
      receipt_id: "rcpt-release-1",
      idempotency_key: "release-action-1",
      lease_id: "lease-1",
      stage: "release",
      candidate_hash: candidateHash,
      action: { adapter: "compose-release", action_class: "submit_typed_action", command: "swap" },
      target: { expected_version: "seed" },
      permit_id: must(gate).permit?.permitId,
      outcome: "ok",
      executed_at: T,
    }, "action-broker")
    expect(receipt.ok).toBe(true)

    const releaseRecord = await seal(cp, incidentId, runId, "release-record", {
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: runId,
      attempt,
      candidate_hash: candidateHash,
      remediation_ref: SHA(21),
      verification_report_ref: SHA(23),
      target: "payment",
      expected_version: "seed",
      authority_mode: "repair",
      policy_version: "policy-v1",
      action_risk_class: "safe",
      approvals: [],
      release_gate_ref: SHA(24),
      recovery_point_id: `rp-${runId}`,
      rollout_plan_ref: SHA(25),
      watch_plan_ref: SHA(26),
      permit_id: null,
      adapter_receipt_ids: [],
      stage_history: [{ stage: "release", status: "completed", at: T }],
      sealed_at: T,
    })
    expect(releaseRecord.ok).toBe(true)
    await drive(cp, incidentId, runId, attempt, "release", "completed", must(releaseRecord).artifactRef)

    // Watch
    const watch = await seal(cp, incidentId, runId, "watch-report", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      rollout_stage: "2", samples: [], stage_outcome: "pass", sealed_at: T,
    })
    expect(watch.ok).toBe(true)
    await drive(cp, incidentId, runId, attempt, "watch", "completed", must(watch).artifactRef)

    // Complete the run.
    const l = await stageLease(cp, incidentId, runId, attempt, "watch")
    const complete = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "complete-run", outcome: "verified-remediation" })
    expect(complete.ok).toBe(true)

    const state = cp.journal.state(incidentId)
    expect(state?.runs[0]?.outcome).toBe("verified-remediation")
    expect(state?.incidentState).toBe("resolved")

    // Confirmation window closes the Incident.
    const closed = await cp.confirmWindow(incidentId)
    expect(closed.ok).toBe(true)
    expect(cp.journal.state(incidentId)?.incidentState).toBe("closed")
  })

  test("Run 2: verification-failed with no Release record", async () => {
    const first = await cp.handleTrigger(trigger(7))
    expect(first.ok).toBe(true)
    const incidentId = must(first).incidentId
    const runId = "run-1"
    const attempt = 1
    await cp.startRun(incidentId, runId)

    const brief = await seal(cp, incidentId, runId, "incident-brief", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      severity: "critical", scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      symptom: "payment charges failing", initial_evidence_item_ids: [], policy_version: "policy-v1", sealed_at: T,
    })
    await drive(cp, incidentId, runId, attempt, "detect", "completed", must(brief).artifactRef)

    const diagnosis = await seal(cp, incidentId, runId, "diagnosis-report", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      hypotheses: [], contradictions: [], gaps: [], next_actions: [],
      fusion_meta: { participant_ids: ["p1", "p2"], judge_id: "j1", synthesizer_id: "s1", revision_id: SHA(11), rounds: [] },
      sealed_at: T,
    })
    await drive(cp, incidentId, runId, attempt, "diagnose", "completed", must(diagnosis).artifactRef)

    const candidateHash = SHA(22)
    const proposal = await seal(cp, incidentId, runId, "remediation-proposal", {
      schema_version: "1.0", incident_id: incidentId, run_id: runId, attempt,
      candidate_hash: candidateHash, remediation_class: "code", action_risk_class: "safe",
      gate_path: "release", disposition: "allowed", change_description: "restore negation",
      diff: { base_ref: "abc", diff_text: "-if (['visa'].includes)", diff_hash: SHA(23) },
      citations: [], test_plan: [], changed_surfaces: ["src/payment/card.js"],
      recovery_point: { id: "rp-1", changed_surfaces: ["src/payment/card.js"] },
      sealed_at: T,
    })
    await drive(cp, incidentId, runId, attempt, "repair", "completed", must(proposal).artifactRef)

    // Verify: R1 records a cited major finding; T5 fails.
    const verdict = await cp.requestVerificationVerdict(incidentId, runId, {
      candidateHash,
      attempt,
      remediationClass: "code",
      riskClass: "safe",
      gatePath: "release",
      resolver: {
        remediationClass: "code",
        declaredSurfaces: ["src/payment/card.js"],
        diff: { changed_files: ["src/payment/card.js"], deleted_files: [] },
        actionRiskClass: "safe",
        policyVersion: "v1",
        toolCatalog: {
          version: "1", language: "node", fuzzHarnessAvailable: false, stagingTargetExists: false,
          serviceUserFacing: false, pipelineHasE2E: false, performanceSuiteExists: false,
          performanceSensitivePaths: [], ownershipMap: { "src/payment/card.js": "payment-regression" },
        },
        recoveryPointSurfaces: ["src/payment/card.js"],
        watchPlanExists: false,
      },
      reviews: [
        { role: "R1", status: "fail", findings: [{ id: "f1", severity: "major", citations: [{ kind: "file-line" }], status: "open", uncited: false }] },
        { role: "R2", status: "pass", findings: [] },
        { role: "R3", status: "pass", findings: [] },
        { role: "R4", status: "pass", findings: [] },
        { role: "R8", status: "pass", findings: [] },
      ],
      tests: [
        { layer: "T1", outcome: "pass", flaky: false, tool: "eslint", tool_version: "1", receipt_ref: "r-T1" },
        { layer: "T2", outcome: "pass", flaky: false, tool: "build", tool_version: "1", receipt_ref: "r-T2" },
        { layer: "T3", outcome: "pass", flaky: false, tool: "node --test", tool_version: "1", receipt_ref: "r-T3" },
        { layer: "T4", outcome: "pass", flaky: false, tool: "contract", tool_version: "1", receipt_ref: "r-T4" },
        { layer: "T5", outcome: "fail", flaky: false, tool: "node --test", tool_version: "1", receipt_ref: "r-T5" },
        { layer: "T7", outcome: "pass", flaky: false, tool: "scan", tool_version: "1", receipt_ref: "r-T7" },
      ],
      guardedApprovalValid: true,
      hypothesisInvalidated: false,
      contradictionUnresolved: false,
    })
    expect(verdict.ok).toBe(true)
    expect(must(verdict).verdict).toBe("fail")

    // Verify stage fails, then the run fails with verification-failed.
    const l = await stageLease(cp, incidentId, runId, attempt, "verify")
    await cp.submitCommand(incidentId, l.token, l.claims, { kind: "enter-stage", stage: "verify" })
    await cp.submitCommand(incidentId, l.token, l.claims, { kind: "stage-status", stage: "verify", to: "in-progress" })
    const verifyFailed = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "stage-status", stage: "verify", to: "failed", artifact_ref: must(verdict).artifactRef })
    expect(verifyFailed.ok).toBe(true)

    const fail = await cp.submitCommand(incidentId, l.token, l.claims, { kind: "fail-run", failure_reason: "verification-failed" })
    expect(fail.ok).toBe(true)

    const state = cp.journal.state(incidentId)
    expect(state?.runs[0]?.state).toBe("failed")
    expect(state?.runs[0]?.failureReason).toBe("verification-failed")
    expect(state?.incidentState).toBe("open")
    expect(state?.attemptsUsed).toBe(1)

    // No Release Gate, no Action Gate, no release record, no Watch report.
    const gates = cp.gateEvaluations(incidentId).map((entry) => entry.gate)
    expect(gates).not.toContain("release")
    expect(gates).not.toContain("action")
    const artifactSchemas = cp.sealedArtifacts(incidentId).map((entry) => entry.artifactRef.schema_id)
    expect(artifactSchemas).not.toContain("release-record")
    expect(artifactSchemas).not.toContain("watch-report")
  })
})
