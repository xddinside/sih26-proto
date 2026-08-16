/**
 * Projection tests for the saved-truth views: the list, detail, and artifact
 * projections over the real byte-accurate contract fixture. Every asserted
 * number is checked against a saved row or receipt, never invented.
 */
import { describe, expect, test } from "bun:test"

import { loadFixtureBundle } from "../../../lib/replay/fixture-bundle"
import { loadReplayStore } from "../../../lib/replay/replay-store"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import { artifactView, detailView, listView } from "./projections"

const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function verifiedStore(): Promise<ReplayStore | null> {
  const result = loadReplayStore(await loadFixtureBundle(), {
    evaluationTime: EVALUATION_TIME,
  })
  if (!result.ok) {
    expect(result.error).toEqual([])
    return null
  }
  return result.value
}

describe("incident list view", () => {
  test("projects both saved incidents with their settled states", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const view = listView(store)
    expect(view.incidents).toHaveLength(2)

    const runOne = view.incidents.at(0)
    expect(runOne?.incidentId).toBe("inc-demo-payment-1")
    expect(runOne?.state).toBe("closed")
    expect(runOne?.closureReason).toBe("symptom-cleared")
    expect(runOne?.detectorState).toBe("resolved")
    expect(runOne?.severity).toBe("critical")
    expect(runOne?.serviceName).toBe("payment")
    expect(runOne?.attemptsUsed).toBe(1)
    expect(runOne?.finalSequence).toBe(44)
    expect(runOne?.latestRun?.state).toBe("completed")
    expect(runOne?.latestRun?.outcome).toBe("verified-remediation")

    const runTwo = view.incidents.at(1)
    expect(runTwo?.incidentId).toBe("inc-demo-payment-2")
    expect(runTwo?.state).toBe("open")
    expect(runTwo?.detectorState).toBe("firing")
    expect(runTwo?.attemptsUsed).toBe(1)
    expect(runTwo?.finalSequence).toBe(25)
    expect(runTwo?.latestRun?.state).toBe("failed")
    expect(runTwo?.latestRun?.failureReason).toBe("verification-failed")
  })

  test("binds first trigger and last activity to journal sequences", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const runOne = listView(store).incidents.at(0)
    expect(runOne?.firstTriggerSource).toEqual({ kind: "journal", ref: "1" })
    expect(runOne?.lastActivitySource).toEqual({ kind: "journal", ref: "44" })
  })
})

describe("incident detail view", () => {
  test("projects run one's full journal: gates, receipts, approvals", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const view = detailView(store, "inc-demo-payment-1", EVALUATION_TIME)
    expect(view).not.toBeNull()
    if (view === null) return

    expect(view.firstTrigger?.ruleId).toBe("payment-error-rate")
    expect(view.firstTrigger?.signalValue).toBe("0.92")
    expect(view.firstTrigger?.signalThreshold).toBe("0.2")
    expect(view.resolvedTrigger?.signalValue).toBe("0.02")

    expect(view.runs).toHaveLength(1)
    const run = view.runs.at(0)
    expect(run?.outcome).toBe("verified-remediation")
    const releaseStage = run?.stages.find((stage) => stage.stage === "release")
    expect(releaseStage?.status).toBe("completed")

    expect(view.hypothesisGate?.verdict).toBe("pass")
    expect(view.hypothesisGate?.checks).toHaveLength(8)
    expect(view.releaseGate?.verdict).toBe("pass")
    expect(view.releaseGate?.facts).toHaveLength(8)
    expect(view.actionGate).toBeNull()

    expect(view.receipts.map((receipt) => receipt.receiptId)).toContain("receipt-t3")
    expect(view.receipts.map((receipt) => receipt.receiptId)).toContain("receipt-ci")
    expect(view.approvals).toHaveLength(2)
    expect(view.policyDecisions).toHaveLength(1)
    expect(view.artifacts).toHaveLength(7)
  })

  test("projects run two's failed-verification detail with no release gate", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const view = detailView(store, "inc-demo-payment-2", EVALUATION_TIME)
    expect(view).not.toBeNull()
    if (view === null) return

    expect(view.state).toBe("open")
    expect(view.runs).toHaveLength(1)
    expect(view.runs.at(0)?.state).toBe("failed")
    expect(view.runs.at(0)?.failureReason).toBe("verification-failed")

    const verifyStage = view.runs.at(0)?.stages.find((stage) => stage.stage === "verify")
    expect(verifyStage?.status).toBe("failed")

    expect(view.releaseGate).toBeNull()
    expect(view.actionGate).toBeNull()
    expect(view.receipts.map((receipt) => receipt.receiptId)).toContain("receipt-t5")
    expect(view.approvals).toHaveLength(0)
  })

  test("binds test receipt numbers to the receipt id", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const view = detailView(store, "inc-demo-payment-2", EVALUATION_TIME)
    if (view === null) return
    const t5 = view.receipts.find((receipt) => receipt.receiptId === "receipt-t5")
    expect(t5).toBeDefined()
    const failRun = t5?.fields.find((field) => field.label === "run fail")
    expect(failRun?.text).toContain("Luhn-failing Visa is rejected")
    expect(failRun?.source).toEqual({ kind: "receipt", ref: "receipt-t5" })
  })

  test("returns null for an unknown incident", async () => {
    const store = await verifiedStore()
    if (store === null) return
    expect(detailView(store, "inc-does-not-exist", EVALUATION_TIME)).toBeNull()
  })
})

describe("artifact view", () => {
  test("authorizes a sealed verification report envelope", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const hash = "sha256:d5f10a44e81936cba4c13aeab767a3721e1e68f8c566620c0b0b34cb109d7798"
    const view = artifactView(store, "inc-demo-payment-1", hash)
    expect(view).not.toBeNull()
    if (view === null) return
    expect(view.schemaId).toBe("verification-report")
    expect(view.schemaVersion).toBe("1.0")
    expect(view.contentHash).toBe(hash)
    expect(view.producer.skill).toBe("sih-orchestrator")
    expect(view.payload).toBeDefined()
  })

  test("denies an artifact belonging to another incident", async () => {
    const store = await verifiedStore()
    if (store === null) return
    const hash = "sha256:d5f10a44e81936cba4c13aeab767a3721e1e68f8c566620c0b0b34cb109d7798"
    expect(artifactView(store, "inc-demo-payment-2", hash)).toBeNull()
  })
})
