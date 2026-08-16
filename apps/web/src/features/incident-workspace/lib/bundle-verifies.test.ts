/**
 * Replay-adapter verification test for the richer saved-run bundle in
 * `demo/fixtures/runs/`. The bundle must verify end to end through the same
 * `loadReplayStoreFromDirectory` the workspace server functions use: manifest
 * file hashes and sizes, journal sequence and transitions, schema name and
 * version, redaction metadata, freshness, and every artifact and receipt
 * reference.
 */
import { describe, expect, test } from "bun:test"

import { loadReplayStoreFromDirectory } from "../../../lib/replay/load-saved-bundle-fs"

const RUNS_URL = new URL("../../../../../../demo/fixtures/runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

describe("demo/fixtures/runs saved-run bundle", () => {
  test("verifies end to end with the settled outcomes", async () => {
    const result = await loadReplayStoreFromDirectory(RUNS_URL, { evaluationTime: EVALUATION_TIME })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const store = result.value
    expect(store.manifest.incident_ids).toEqual([
      { incident_id: "inc-demo-payment-1", final_sequence: 91 },
      { incident_id: "inc-demo-payment-2", final_sequence: 66 },
    ])

    const runOne = store.incidents.find((incident) => incident.incidentId === "inc-demo-payment-1")
    const runTwo = store.incidents.find((incident) => incident.incidentId === "inc-demo-payment-2")
    expect(runOne?.journalState.incidentState).toBe("closed")
    expect(runOne?.journalState.closureReason).toBe("symptom-cleared")
    expect(runOne?.journalState.runs[0]?.outcome).toBe("verified-remediation")
    expect(runTwo?.journalState.incidentState).toBe("open")
    expect(runTwo?.journalState.runs[0]?.failureReason).toBe("verification-failed")

    // Run 2 has no Release record and no production Watch Report.
    const runTwoSchemas = runTwo?.artifactHashes.map((hash) => store.artifacts.get(hash)?.envelope.artifact_schema_id)
    expect(runTwoSchemas).not.toContain("rollout-watch-plan")
    expect(runTwoSchemas).not.toContain("watch-report")
  })
})
