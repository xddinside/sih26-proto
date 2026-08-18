/**
 * Dev-store selection tests for real-agent captures (issue #23). The
 * presentation streak is the latest three consecutive full-capture real
 * runs under one unchanged config digest covering both scenarios; fixture
 * runs, rehearsal runs, and incomplete runs never qualify.
 */
import { describe, expect, test } from "bun:test"

import type { StoredCaptureRecord } from "../src/dev-store.js"
import {
  configDigestOf,
  runReachedTerminalState,
  selectPresentationStreak,
} from "../src/dev-store.js"

function record(partial: Partial<StoredCaptureRecord> & Pick<StoredCaptureRecord, "run">): StoredCaptureRecord {
  const base: StoredCaptureRecord = {
    version: 1,
    scenario: partial.run === 1 ? "S1" : "S2",
    agents: "real",
    mode: "full-capture",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "medium",
    capturedAt: "2026-08-18T00:00:00.000Z",
    savedId: partial.run === 1 ? "inc-demo-payment-1" : "inc-demo-payment-2",
    incidentId: `inc-${partial.run}`,
    finalSequence: 21,
    finalRunState: partial.run === 1 ? "completed" : "failed",
    outcome: partial.run === 1 ? "verified-remediation" : null,
    candidateHash: null,
    manifestSealed: true,
    configDigest: "config-digest-a",
    runPath: "runs/run",
  }
  return { ...base, ...partial }
}

describe("runReachedTerminalState", () => {
  test("run 1 qualifies when completed with verified-remediation and a sealed manifest", () => {
    expect(runReachedTerminalState(record({ run: 1 }))).toBe(true)
  })

  test("run 2 qualifies when failed with a sealed manifest", () => {
    expect(runReachedTerminalState(record({ run: 2 }))).toBe(true)
  })

  test("rejects fixture, rehearsal, incomplete, and unsealed runs", () => {
    expect(runReachedTerminalState(record({ run: 1, agents: "fixture" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, mode: "rehearsal" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, finalRunState: "running" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, outcome: null }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, manifestSealed: false }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 2, finalRunState: "completed" }))).toBe(false)
  })
})

describe("selectPresentationStreak", () => {
  test("picks the latest three consecutive runs on one unchanged config digest", () => {
    const a = record({ run: 1, capturedAt: "2026-08-18T00:00:00.000Z", savedId: "inc-demo-payment-1" })
    const b = record({ run: 2, capturedAt: "2026-08-18T00:05:00.000Z", savedId: "inc-demo-payment-2" })
    const c = record({ run: 1, capturedAt: "2026-08-18T00:10:00.000Z", savedId: "inc-demo-payment-1" })
    const selection = selectPresentationStreak([a, b, c])
    expect(selection).not.toBeNull()
    expect(selection?.records.map((record) => record.savedId)).toEqual([
      "inc-demo-payment-1",
      "inc-demo-payment-2",
      "inc-demo-payment-1",
    ])
    expect(selection?.startedAt).toBe("2026-08-18T00:00:00.000Z")
  })

  test("requires both scenarios within the streak", () => {
    const runs = [record({ run: 1 }), record({ run: 1 }), record({ run: 1 })]
    expect(selectPresentationStreak(runs)).toBeNull()
  })

  test("rejects a streak split by a changed config digest", () => {
    const a = record({ run: 1, configDigest: "config-digest-a" })
    const b = record({ run: 2, configDigest: "config-digest-a" })
    const c = record({ run: 1, configDigest: "config-digest-b" })
    expect(selectPresentationStreak([a, b, c])).toBeNull()
    expect(selectPresentationStreak([b, c, a])).toBeNull()
  })

  test("ignores non-qualifying records before the streak", () => {
    const fixture = record({ run: 2, agents: "fixture" })
    const b = record({ run: 2, capturedAt: "2026-08-18T00:10:00.000Z" })
    const c = record({ run: 1, capturedAt: "2026-08-18T00:15:00.000Z" })
    const d = record({ run: 2, capturedAt: "2026-08-18T00:20:00.000Z" })
    const selection = selectPresentationStreak([fixture, b, c, d])
    expect(selection?.records.map((record) => record.savedId)).toEqual([
      "inc-demo-payment-2",
      "inc-demo-payment-1",
      "inc-demo-payment-2",
    ])
  })

  test("returns null for fewer than three runs", () => {
    expect(selectPresentationStreak([record({ run: 1 }), record({ run: 2 })])).toBeNull()
    expect(selectPresentationStreak([])).toBeNull()
  })
})

describe("configDigestOf", () => {
  test("distinguishes configuration values that must be frozen", () => {
    const base = { run: 1 as const, scenario: "S1", agents: "real" as const, mode: "full-capture" as const, provider: "opencode", model: "deepseek-v4-flash", reasoning: "medium" }
    expect(configDigestOf(base)).not.toBe(configDigestOf({ ...base, mode: "rehearsal" as const }))
    expect(configDigestOf(base)).not.toBe(configDigestOf({ ...base, model: "other" }))
    expect(configDigestOf(base)).not.toBe(configDigestOf({ ...base, reasoning: "high" }))
    expect(configDigestOf(base)).toBe(configDigestOf({ ...base }))
  })
})