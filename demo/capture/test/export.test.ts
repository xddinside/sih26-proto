/**
 * Export verification tests for the two saved Demo Runs in `demo/saved-runs/`.
 * These run the same `verifySavedBundle` the Incident Workspace replay
 * adapter uses, then assert the two settled terminal outcomes from
 * docs/research/demo-runs.md.
 *
 * Run with `bun test` from demo/capture (see README.md).
 */
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { verifySavedBundle } from "@sih/contracts/saved-bundle"

import { savedRunsRoot } from "../src/export.js"

async function loadBundle(): Promise<ReturnType<typeof verifySavedBundle>> {
  const root = savedRunsRoot()
  const files = new Map<string, string>()
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relative)
      } else {
        files.set(relative, await readFile(join(dir, entry.name), "utf8"))
      }
    }
  }
  await walk(root, "")
  return verifySavedBundle({ files }, { evaluationTime: new Date().toISOString() })
}

describe("demo/saved-runs export", () => {
  test("passes every integrity check (manifest, sequence, schema, redaction, staleness, hash, missing-artifact)", async () => {
    const result = await loadBundle()
    if (!result.ok) {
      // Surface every error so a failing bundle is diagnosable at a glance.
      const summary = result.error.map((error) => `${error.code}: ${error.message}`).join("\n")
      throw new Error(`bundle failed verification (${result.error.length} errors):\n${summary}`)
    }
    expect(result.value.manifest.format_version).toBe("1.0")
    expect(result.value.incidents).toHaveLength(2)
    expect(result.value.incidents.map((incident) => incident.incidentId)).toEqual([
      "inc-demo-payment-1",
      "inc-demo-payment-2",
    ])
  })

  test("Run 1 ends closed: verified-remediation with a Release record and Watch reports", async () => {
    const result = await loadBundle()
    if (!result.ok) throw new Error("bundle failed verification")
    const runOne = result.value.incidents.find((incident) => incident.incidentId === "inc-demo-payment-1")
    expect(runOne).toBeDefined()

    const state = (runOne as NonNullable<typeof runOne>).events.reduce(
      (aggregate, event) => {
        if (event.type === "run_transition" && event.to === "completed") {
          aggregate.outcome = event.outcome
        }
        if (event.type === "incident_transition") {
          aggregate.incidentState = event.to
          aggregate.closureReason = event.closure_reason
        }
        if (event.type === "artifact_sealed") {
          aggregate.schemas.add(event.artifact_ref.schema_id)
        }
        if (event.type === "gate_evaluated") {
          aggregate.gates.push(`${event.gate}:${event.evaluation.verdict}`)
        }
        return aggregate
      },
      { outcome: null, incidentState: null, closureReason: null, schemas: new Set<string>(), gates: [] as string[] },
    )

    expect(state.outcome).toBe("verified-remediation")
    expect(state.incidentState).toBe("closed")
    expect(state.closureReason).toBe("symptom-cleared")
    expect(state.schemas.has("release-record")).toBe(true)
    expect(state.schemas.has("rollout-watch-plan")).toBe(true)
    expect(state.schemas.has("watch-report")).toBe(true)
    expect(state.schemas.has("recovery-point")).toBe(true)
    expect(state.gates).toContain("release:pass")
  })

  test("Run 2 ends open: verification-failed with no Release record and no production Watch Report", async () => {
    const result = await loadBundle()
    if (!result.ok) throw new Error("bundle failed verification")
    const runTwo = result.value.incidents.find((incident) => incident.incidentId === "inc-demo-payment-2")
    expect(runTwo).toBeDefined()

    const state = (runTwo as NonNullable<typeof runTwo>).events.reduce(
      (aggregate, event) => {
        if (event.type === "run_transition" && event.to === "failed") {
          aggregate.failureReason = event.failure_reason
        }
        if (event.type === "incident_transition") {
          aggregate.incidentState = event.to
        }
        if (event.type === "artifact_sealed") {
          aggregate.schemas.add(event.artifact_ref.schema_id)
        }
        if (event.type === "gate_evaluated") {
          aggregate.gates.push(event.gate)
        }
        return aggregate
      },
      { failureReason: null, incidentState: null, schemas: new Set<string>(), gates: [] as string[] },
    )

    expect(state.failureReason).toBe("verification-failed")
    expect(state.incidentState).toBe("open")
    expect(state.schemas.has("release-record")).toBe(false)
    expect(state.schemas.has("rollout-watch-plan")).toBe(false)
    expect(state.schemas.has("watch-report")).toBe(false)
    expect(state.gates).not.toContain("release")
    expect(state.gates).not.toContain("action")
  })

  test("Run 2's T5 failure is recorded and bound to the candidate hash", async () => {
    const result = await loadBundle()
    if (!result.ok) throw new Error("bundle failed verification")
    const runTwo = result.value.incidents.find((incident) => incident.incidentId === "inc-demo-payment-2")
    const receipts = (runTwo as NonNullable<typeof runTwo>).events.filter(
      (event) => event.type === "broker_receipt_recorded" && event.receipt.receipt_id === "receipt-t5",
    )
    expect(receipts).toHaveLength(1)
    const receipt = (receipts[0] as Extract<(typeof receipts)[number], { type: "broker_receipt_recorded" }>).receipt
    expect(receipt.outcome).toBe("fail")
    expect(receipt.runs[0]?.detail).toBe("Luhn-failing Visa is rejected")
    expect(receipt.candidate_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
