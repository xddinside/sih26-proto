/**
 * Read projection tests for the static saved-bundle replay adapter: incident
 * list, incident detail, and the authorized artifact envelope with its
 * denial cases. Reads run over a store verified from the real contract
 * fixture; no weaker stand-in contract is used.
 */
import { describe, expect, test } from "bun:test"

import type { IntegrityError } from "@sih/contracts/errors"

import { loadFixtureBundle } from "./fixture-bundle"
import type { ReplayResult } from "./replay-result"
import { getAuthorizedArtifact, getIncidentDetail, listIncidents } from "./replay-reads"
import { loadReplayStore } from "./replay-store"
import type { ReplayStore } from "./replay-store"

const EVALUATION_TIME = "2026-08-16T12:00:00Z"

/** Verify the fixture and return the store, or fail the test early. */
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

/** The error codes of a failed read result, or an empty list on success. */
function readErrorCodes(
  result: ReplayResult<unknown, IntegrityError[]>,
): string[] {
  if (result.ok) {
    return []
  }
  return result.error.map((error: IntegrityError) => error.code)
}

describe("saved replay reads", () => {
  test("lists both incidents with their settled states", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const summaries = listIncidents(store)
    expect(summaries).toHaveLength(2)
    if (summaries.length !== 2) {
      return
    }

    const runOne = summaries[0]
    expect(runOne.incidentId).toBe("inc-demo-payment-1")
    expect(runOne.state).toBe("closed")
    expect(runOne.attemptsUsed).toBe(1)
    expect(runOne.finalSequence).toBe(44)
    expect(runOne.runCount).toBe(1)
    expect(runOne.artifactCount).toBe(7)
    expect(runOne.latestEventType).toBe("incident_transition")

    const runTwo = summaries[1]
    expect(runTwo.incidentId).toBe("inc-demo-payment-2")
    expect(runTwo.state).toBe("open")
    expect(runTwo.attemptsUsed).toBe(1)
    expect(runTwo.finalSequence).toBe(25)
    expect(runTwo.runCount).toBe(1)
    expect(runTwo.artifactCount).toBe(5)
    expect(runTwo.latestEventType).toBe("run_transition")
  })

  test("returns full detail for a known incident", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const detail = getIncidentDetail(store, "inc-demo-payment-1")
    expect(detail.ok).toBe(true)
    if (!detail.ok) {
      return
    }
    expect(detail.value.events).toHaveLength(44)
    expect(detail.value.runs).toHaveLength(1)
    if (detail.value.runs.length !== 1) {
      return
    }
    expect(detail.value.runs[0].outcome).toBe("verified-remediation")
    expect(detail.value.artifacts).toHaveLength(7)
    for (const artifact of detail.value.artifacts) {
      expect(artifact.envelope.incident_id).toBe("inc-demo-payment-1")
    }
  })

  test("records the failed run detail for the second incident", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const detail = getIncidentDetail(store, "inc-demo-payment-2")
    expect(detail.ok).toBe(true)
    if (!detail.ok) {
      return
    }
    expect(detail.value.state).toBe("open")
    expect(detail.value.runs).toHaveLength(1)
    if (detail.value.runs.length !== 1) {
      return
    }
    expect(detail.value.runs[0].state).toBe("failed")
    expect(detail.value.runs[0].failureReason).toBe("verification-failed")
  })

  test("denies detail for an unknown incident with MISSING_ARTIFACT", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const detail = getIncidentDetail(store, "inc-does-not-exist")
    expect(detail.ok).toBe(false)
    expect(readErrorCodes(detail)).toContain("MISSING_ARTIFACT")
  })

  test("authorizes an artifact sealed in the incident journal", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const hash = store.incidents.at(0)?.artifactHashes.at(0)
    expect(hash).toBeDefined()
    if (hash === undefined) {
      return
    }
    const artifact = getAuthorizedArtifact(store, "inc-demo-payment-1", hash)
    expect(artifact.ok).toBe(true)
    if (!artifact.ok) {
      return
    }
    expect(artifact.value.contentHash).toBe(hash)
    expect(artifact.value.envelope.incident_id).toBe("inc-demo-payment-1")
    expect(artifact.value.path).toBe(
      `artifacts/sha256/${hash.slice("sha256:".length)}.json`,
    )
  })

  test("denies an artifact that belongs to another incident", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const otherHash = store.incidents.at(1)?.artifactHashes.at(0)
    expect(otherHash).toBeDefined()
    if (otherHash === undefined) {
      return
    }
    const artifact = getAuthorizedArtifact(store, "inc-demo-payment-1", otherHash)
    expect(artifact.ok).toBe(false)
    expect(readErrorCodes(artifact)).toContain("MISSING_ARTIFACT")
  })

  test("denies an unknown artifact hash with MISSING_ARTIFACT", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const unknown = `sha256:${"0".repeat(64)}`
    const artifact = getAuthorizedArtifact(store, "inc-demo-payment-1", unknown)
    expect(artifact.ok).toBe(false)
    expect(readErrorCodes(artifact)).toContain("MISSING_ARTIFACT")
  })

  test("denies a malformed artifact hash with MISSING_ARTIFACT", async () => {
    const store = await verifiedStore()
    if (store === null) {
      return
    }
    const artifact = getAuthorizedArtifact(store, "inc-demo-payment-1", "not-a-hash")
    expect(artifact.ok).toBe(false)
    expect(readErrorCodes(artifact)).toContain("MISSING_ARTIFACT")
  })
})
