/**
 * Panel projection tests for the Incident Workspace, following the #21
 * projection-test style: load the richer saved-run bundle through the replay
 * adapter and assert each panel's view model against the settled run
 * outcomes from docs/research/demo-runs.md. Every asserted number is checked
 * against a saved row, receipt, or sealed artifact.
 */
import { describe, expect, test } from "bun:test"

import { loadReplayStoreFromDirectory } from "../../../lib/replay/load-saved-bundle-fs"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import { workspaceView } from "./workspace-projection"
import type { WorkspaceView } from "./workspace-projection"

const RUNS_URL = new URL("../../../../../../demo/fixtures/runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function verifiedStore(): Promise<ReplayStore> {
  const result = await loadReplayStoreFromDirectory(RUNS_URL, { evaluationTime: EVALUATION_TIME })
  if (!result.ok) {
    expect(result.error).toEqual([])
    throw new Error(`bundle failed verification: ${result.error.map((e) => e.message).join("; ")}`)
  }
  return result.value
}

function viewOf(store: ReplayStore, incidentId: string): WorkspaceView {
  const view = workspaceView(store, incidentId, EVALUATION_TIME)
  expect(view).not.toBeNull()
  if (view === null) {
    throw new Error("workspace projection returned null")
  }
  return view
}

describe("Run 1 — verified code Remediation", () => {
  test("header replays closed, symptom-cleared, verified-remediation", async () => {
    const store = await verifiedStore()
    const header = viewOf(store, "inc-demo-payment-1").header
    expect(header.state).toBe("closed")
    expect(header.closureReason).toBe("symptom-cleared")
    expect(header.detectorState).toBe("resolved")
    expect(header.severity).toBe("critical")
    expect(header.attemptsUsed).toBe(1)
    expect(header.attemptLimit).toBe(3)
    expect(header.attemptsRemaining).toBe(2)
    expect(header.latestRun?.state).toBe("completed")
    expect(header.latestRun?.outcome).toBe("verified-remediation")
    expect(header.finalSequence).toBe(91)
  })

  test("intake replays firing, dedup no-op, and resolved delivery history", async () => {
    const store = await verifiedStore()
    const intake = viewOf(store, "inc-demo-payment-1").intake
    expect(intake.triggers.map((t) => t.deliveryResult)).toEqual([
      "incident-created",
      "duplicate-noop",
      "evidence-appended",
    ])
    expect(intake.triggers[0]?.signalValue).toBe("0.92")
    expect(intake.triggers[0]?.ruleId).toBe("payment-error-rate")
    expect(intake.triggers[0]?.ruleVersion).toBe("git:abc123")
    expect(intake.triggers.at(-1)?.signalValue).toBe("0.01")
  })

  test("evidence set revision 1 carries the trace-log join, flagd, and S1 receipts", async () => {
    const store = await verifiedStore()
    const evidence = viewOf(store, "inc-demo-payment-1").evidence
    expect(evidence?.revision?.revisionNumber).toBe(1)
    expect(evidence?.items).toHaveLength(8)
    const kinds = evidence?.items.map((item) => item.kind)
    expect(kinds).toContain("trace")
    expect(kinds).toContain("log")
    expect(kinds).toContain("deployment-event")
    expect(kinds).toContain("code-location")
    const flag = evidence?.items.find((item) => item.backend === "flagd" && JSON.stringify(item.snapshot).includes("paymentFailure"))
    expect(flag?.outcome).toBe("ok")
  })

  test("hypotheses rank H1 accepted and eliminate H2/H3/H4", async () => {
    const store = await verifiedStore()
    const panel = viewOf(store, "inc-demo-payment-1").hypotheses
    expect(panel.hypotheses.map((h) => h.id)).toEqual(["H1", "H2", "H3", "H4"])
    expect(panel.hypotheses[0]?.status).toBe("accepted")
    expect(panel.hypotheses.slice(1).every((h) => h.status === "rejected")).toBe(true)
    expect(panel.hypotheses[1]?.opposing.length).toBeGreaterThan(0)
    expect(panel.gate?.verdict).toBe("pass")
    expect(panel.gate?.checks).toHaveLength(8)
  })

  test("fusion round has two participants, a judge, and a synthesizer", async () => {
    const store = await verifiedStore()
    const fusion = viewOf(store, "inc-demo-payment-1").fusion
    expect(fusion?.participants).toHaveLength(2)
    expect(fusion?.judge).not.toBeNull()
    expect(fusion?.synthesizer?.ranked.map((entry) => entry.hypothesisId)).toEqual(["H1", "H2", "H3", "H4"])
    expect(fusion?.roundValidity[0]?.valid).toBe(true)
  })

  test("remediation is the one-line diff with a citation map and PR record", async () => {
    const store = await verifiedStore()
    const remediation = viewOf(store, "inc-demo-payment-1").remediation
    expect(remediation?.disposition).toBe("allowed")
    expect(remediation?.actionRiskClass).toBe("safe")
    expect(remediation?.remediationClass).toBe("code")
    expect(remediation?.diff?.diffText).toContain("!['visa', 'mastercard']")
    expect(remediation?.citationMap[0]?.hypothesisId).toBe("H1")
    expect(remediation?.prReceipt?.command).toContain("remediate/incident-inc-demo-payment-1")
  })

  test("verify: R1-R4/R8 pass, ten tests pass, verdict pass with hash binding", async () => {
    const store = await verifiedStore()
    const verify = viewOf(store, "inc-demo-payment-1").verify
    expect(verify?.applicability.required).toEqual(["R1", "R2", "R3", "R4", "R8", "T1", "T2", "T3", "T4", "T5", "T7"])
    expect(verify?.applicability.notApplicable).toEqual(["R5", "R6", "R7", "R9", "T6", "T8", "T11"])
    expect(verify?.reviews.map((review) => review.role)).toEqual(["R1", "R2", "R3", "R4", "R8"])
    expect(verify?.reviews.every((review) => review.status === "pass")).toBe(true)
    expect(verify?.tests.map((t) => t.layer)).toEqual(["T1", "T2", "T3", "T4", "T5", "T7", "T9", "T10", "T12", "T13"])
    expect(verify?.tests.every((t) => t.outcome === "pass")).toBe(true)
    expect(verify?.verification?.verdict).toBe("pass")
    expect(verify?.verification?.hashBinding.match).toBe(true)
  })

  test("release gate facts pass with the scheduled-hybrid approval", async () => {
    const store = await verifiedStore()
    const view = viewOf(store, "inc-demo-payment-1")
    expect(view.gates.release?.verdict).toBe("pass")
    expect(view.gates.release?.facts).toHaveLength(8)
    expect(view.gates.action).toBeNull()
    expect(view.approvals).toHaveLength(2)
    expect(view.approvals.map((approval) => approval.action)).toEqual(["granted", "consumed"])
  })

  test("watch: probe ring 20/20 across three windows and error ratio below 0.05", async () => {
    const store = await verifiedStore()
    const watch = viewOf(store, "inc-demo-payment-1").watch
    expect(watch?.plan?.queries.map((q) => q.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"])
    expect(watch?.probeReceipts).toHaveLength(3)
    expect(watch?.probeReceipts.every((receipt) => receipt.rowCount === 20)).toBe(true)
    expect(watch?.reports.map((report) => report.rolloutStage)).toEqual(["1", "2", "confirmation"])
    const stage1G1 = watch?.reports
      .filter((report) => report.rolloutStage === "1")
      .flatMap((report) => report.samples)
      .filter((sample) => sample.gate === "G1")
    expect(stage1G1).toHaveLength(3)
    expect(stage1G1?.every((sample) => sample.value === 20 && sample.limit === 20 && sample.outcome === "pass")).toBe(true)
    const stage2G5 = watch?.reports
      .filter((report) => report.rolloutStage === "2")
      .flatMap((report) => report.samples)
      .filter((sample) => sample.gate === "G5")
    expect(stage2G5).toHaveLength(3)
    expect(stage2G5?.every((sample) => sample.value < 0.05 && sample.outcome === "pass")).toBe(true)
    expect(watch?.baselineRatio?.value).toBe("0.92")
  })

  test("recovery point is validated and consumed by the service swap", async () => {
    const store = await verifiedStore()
    const recovery = viewOf(store, "inc-demo-payment-1").recovery
    expect(recovery?.consumed).toBe(true)
    expect(recovery?.drillReceipts).toHaveLength(1)
    expect(recovery?.r8Findings.length).toBeGreaterThan(0)
    expect(recovery?.changedSurfaces).toContain("src/payment/card.js")
  })

  test("policy is scheduled hybrid with one execution-time decision", async () => {
    const store = await verifiedStore()
    const policy = viewOf(store, "inc-demo-payment-1").policy
    expect(policy.policyVersion).toBe("policy-hybrid-v1")
    expect(policy.recorded?.automationPolicy).toBe("scheduled hybrid")
    expect(policy.recorded?.authorityMode).toBe("Repair")
    expect(policy.decisions).toHaveLength(1)
    expect(policy.decisions[0]?.decision).toBe("approval-required")
  })
})

describe("Run 2 — deterministic failed verification", () => {
  test("header replays open with verification-failed and 2 attempts remaining", async () => {
    const store = await verifiedStore()
    const header = viewOf(store, "inc-demo-payment-2").header
    expect(header.state).toBe("open")
    expect(header.attemptsUsed).toBe(1)
    expect(header.attemptsRemaining).toBe(2)
    expect(header.latestRun?.state).toBe("failed")
    expect(header.latestRun?.failureReason).toBe("verification-failed")
  })

  test("the same four Hypotheses and the same eight-check gate table", async () => {
    const store = await verifiedStore()
    const panel = viewOf(store, "inc-demo-payment-2").hypotheses
    expect(panel.hypotheses.map((h) => h.id)).toEqual(["H1", "H2", "H3", "H4"])
    expect(panel.hypotheses[0]?.status).toBe("accepted")
    expect(panel.gate?.verdict).toBe("pass")
    expect(panel.gate?.checks).toHaveLength(8)
  })

  test("R1 cites the major reachability finding; T5 fails the Luhn case", async () => {
    const store = await verifiedStore()
    const verify = viewOf(store, "inc-demo-payment-2").verify
    const r1 = verify?.reviews.find((review) => review.role === "R1")
    expect(r1?.status).toBe("fail")
    const major = r1?.findings.find((finding) => finding.severity === "major")
    expect(major?.claim).toContain("Luhn guard")
    expect(major?.citations.some((citation) => citation.kind === "file-line")).toBe(true)
    const t5 = verify?.tests.find((t) => t.layer === "T5")
    expect(t5?.outcome).toBe("fail")
    expect(t5?.runs[0]?.detail).toBe("Luhn-failing Visa is rejected")
    expect(verify?.verification?.verdict).toBe("fail")
    expect(verify?.verification?.hashBinding.match).toBe(true)
  })

  test("no Release or Action Gate ran, nothing shipped", async () => {
    const store = await verifiedStore()
    const view = viewOf(store, "inc-demo-payment-2")
    expect(view.gates.release).toBeNull()
    expect(view.gates.action).toBeNull()
    expect(view.gates.notReachedReason).toBe("verification-failed")
    expect(view.approvals).toHaveLength(0)
    expect(view.watch).toBeNull()
    expect(view.recovery?.consumed).toBe(false)
  })

  test("the failed evidence joins the Evidence Set as revision 2", async () => {
    const store = await verifiedStore()
    const evidence = viewOf(store, "inc-demo-payment-2").evidence
    expect(evidence?.revisions).toHaveLength(2)
    expect(evidence?.revision?.revisionNumber).toBe(2)
    expect(evidence?.items).toHaveLength(9)
    const failed = evidence?.items.find((item) => item.kind === "test-result")
    expect(JSON.stringify(failed?.snapshot)).toContain("Luhn-failing Visa is rejected")
  })

  test("policy is autonomous at all times with no execution-time decision", async () => {
    const store = await verifiedStore()
    const policy = viewOf(store, "inc-demo-payment-2").policy
    expect(policy.policyVersion).toBe("policy-autonomous-v1")
    expect(policy.recorded?.automationPolicy).toBe("autonomous at all times")
    expect(policy.decisions).toHaveLength(0)
  })

  test("returns null for an unknown incident", async () => {
    const store = await verifiedStore()
    expect(workspaceView(store, "inc-does-not-exist", EVALUATION_TIME)).toBeNull()
  })
})
