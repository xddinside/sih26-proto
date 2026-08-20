/**
 * Dev-store selection tests for real-agent captures (issue #23/#31). Each
 * scenario tracks its own consecutive streak of eligible full-capture real
 * runs under one unchanged frozen-config digest; a scenario becomes
 * selectable only after three consecutive eligible runs, and presentation
 * needs both scenarios. Fixture runs, rehearsal runs, deterministic
 * development fixtures, and runs with an unexpected outcome never qualify.
 */
import { describe, expect, test } from "bun:test"

import type { StoredCaptureRecord } from "../src/dev-store.js"
import {
  configDigestOf,
  manifestConfigDigestOf,
  runReachedTerminalState,
  scenarioStreak,
  selectPresentationStreak,
} from "../src/dev-store.js"
import type { CaptureManifest } from "@sih/contracts/types"

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
    manifestDigest: `sha256:${String(partial.run).repeat(64)}`,
    agentRunArtifacts: 24,
    configDigest: `config-digest-${partial.run}`,
    runPath: "runs/run",
    failureReason: partial.run === 2 ? "verification-failed" : null,
  }
  return { ...base, ...partial }
}

function manifest(): CaptureManifest {
  return {
    schema_version: "1.2",
    manifest_id: "capture-manifest:inc-1:run-1",
    incident_id: "inc-1",
    run_id: "run-1",
    attempt: 1,
    mode: "full-capture",
    scenario: "S1",
    provider_class: "real",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "medium",
    pi_agent_core_version: "0.79.4",
    pi_ai_version: "0.79.4",
    skill_tree_digest: `sha256:${"2".repeat(64)}`,
    tool_catalog_revision: "tool-catalog@1.0",
    prompt_revision: "prompts@1.0",
    policy_revision: "policy-v1",
    perspectives: [
      { participant_id: "p-1", perspective: "code-level", order: 1 },
      { participant_id: "p-2", perspective: "system-level", order: 2 },
    ],
    seeds: [{ id: "S1", digest: `sha256:${"3".repeat(64)}` }],
    budgets: {
      model_turns: 20,
      non_terminal_tool_calls: 32,
      session_wall_clock_ms: 720_000,
      run_wall_clock_ms: 7_200_000,
      attempt_limit: 3,
    },
    schema_versions: { "remediation-draft": "1.0" },
    role_records: [{ role: "planner", agent_id: "agent-planner", status: "succeeded", model_use_agent_ids: [] }],
    manifest_digest: `sha256:${"f".repeat(64)}`,
    sealed_at: "2026-08-18T00:02:00Z",
  }
}

describe("runReachedTerminalState", () => {
  test("run 1 qualifies when completed with verified-remediation and a sealed manifest", () => {
    expect(runReachedTerminalState(record({ run: 1 }))).toBe(true)
  })

  test("run 2 qualifies only for verification-failed with a sealed manifest", () => {
    expect(runReachedTerminalState(record({ run: 2 }))).toBe(true)
    expect(runReachedTerminalState(record({ run: 2, failureReason: "wall-clock budget exhausted" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 2, failureReason: null }))).toBe(false)
  })

  test("rejects fixture, rehearsal, deterministic, incomplete, and unsealed runs", () => {
    expect(runReachedTerminalState(record({ run: 1, agents: "fixture" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, mode: "rehearsal" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, provider: "deterministic" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 2, provider: "deterministic" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, finalRunState: "running" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, outcome: null }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, manifestSealed: false }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 2, finalRunState: "completed" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 1, status: "partial" }))).toBe(false)
    expect(runReachedTerminalState(record({ run: 2, status: "failed" }))).toBe(false)
  })
})

describe("scenarioStreak", () => {
  test("counts consecutive eligible runs at the tail under one digest", () => {
    const a = record({ run: 1, capturedAt: "2026-08-18T00:00:00.000Z" })
    const b = record({ run: 1, capturedAt: "2026-08-18T00:05:00.000Z" })
    const c = record({ run: 1, capturedAt: "2026-08-18T00:10:00.000Z" })
    const streak = scenarioStreak([a, b, c], 1)
    expect(streak.selectable).toBe(true)
    expect(streak.records).toHaveLength(3)
    expect(streak.digest).toBe("config-digest-1")
  })

  test("a failed run at the tail breaks the streak", () => {
    const good = record({ run: 1, capturedAt: "2026-08-18T00:00:00.000Z" })
    const bad = record({ run: 1, capturedAt: "2026-08-18T00:05:00.000Z", status: "partial", finalRunState: "failed", outcome: null, manifestSealed: false })
    const streak = scenarioStreak([good, good, good, bad], 1)
    expect(streak.selectable).toBe(false)
    expect(streak.records).toHaveLength(0)
  })

  test("a changed digest breaks the streak and only the tail counts", () => {
    const oldA = record({ run: 2, capturedAt: "2026-08-18T00:00:00.000Z" })
    const oldB = record({ run: 2, capturedAt: "2026-08-18T00:05:00.000Z" })
    const oldC = record({ run: 2, capturedAt: "2026-08-18T00:10:00.000Z" })
    const newA = record({ run: 2, capturedAt: "2026-08-18T01:00:00.000Z", configDigest: "config-digest-2-new" })
    const newB = record({ run: 2, capturedAt: "2026-08-18T01:05:00.000Z", configDigest: "config-digest-2-new" })
    const streak = scenarioStreak([oldA, oldB, oldC, newA, newB], 2)
    expect(streak.selectable).toBe(false)
    expect(streak.records.map((run) => run.capturedAt)).toEqual(["2026-08-18T01:00:00.000Z", "2026-08-18T01:05:00.000Z"])
  })

  test("deterministic fixtures never form a streak even with valid outcomes", () => {
    const a = record({ run: 1, provider: "deterministic", capturedAt: "2026-08-18T00:00:00.000Z" })
    const b = record({ run: 1, provider: "deterministic", capturedAt: "2026-08-18T00:05:00.000Z" })
    const c = record({ run: 1, provider: "deterministic", capturedAt: "2026-08-18T00:10:00.000Z" })
    const streak = scenarioStreak([a, b, c], 1)
    expect(streak.selectable).toBe(false)
    expect(streak.records).toHaveLength(0)
  })
})

describe("selectPresentationStreak", () => {
  test("selects the latest eligible run of each scenario's three-run streak", () => {
    const run1 = [0, 1, 2].map((offset) => record({ run: 1, capturedAt: `2026-08-18T00:0${offset}:00.000Z` }))
    const run2 = [3, 4, 5].map((offset) => record({ run: 2, capturedAt: `2026-08-18T00:0${offset}:00.000Z` }))
    const selection = selectPresentationStreak([...run1, ...run2])
    expect(selection).not.toBeNull()
    // The bundle carries the latest eligible run of each scenario.
    expect(selection?.records.map((record) => record.run)).toEqual([1, 2])
    expect(selection?.records[0]?.capturedAt).toBe("2026-08-18T00:02:00.000Z")
    expect(selection?.records[1]?.capturedAt).toBe("2026-08-18T00:05:00.000Z")
    expect(selection?.streaks).toHaveLength(2)
    expect(selection?.streaks[0]?.run).toBe(1)
    expect(selection?.streaks[1]?.run).toBe(2)
  })

  test("returns null when only one scenario has a streak", () => {
    const run1 = [0, 1, 2].map((offset) => record({ run: 1, capturedAt: `2026-08-18T00:0${offset}:00.000Z` }))
    const run2 = [record({ run: 2 })]
    expect(selectPresentationStreak([...run1, ...run2])).toBeNull()
  })

  test("returns null when a scenario streak is broken by an omitted or failed run", () => {
    const run1 = [0, 1, 2].map((offset) => record({ run: 1, capturedAt: `2026-08-18T00:0${offset}:00.000Z` }))
    const run2 = [0, 1, 2].map((offset) => record({ run: 2, capturedAt: `2026-08-18T00:1${offset}:00.000Z` }))
    const failed = record({ run: 2, capturedAt: "2026-08-18T00:20:00.000Z", status: "partial", finalRunState: "failed", outcome: null, manifestSealed: false })
    expect(selectPresentationStreak([...run1, ...run2, failed])).toBeNull()
  })

  test("rejects a streak split by a changed config digest", () => {
    const run1 = [0, 1, 2].map((offset) => record({ run: 1, capturedAt: `2026-08-18T00:0${offset}:00.000Z` }))
    const run2 = [0, 1].map((offset) => record({ run: 2, capturedAt: `2026-08-18T00:1${offset}:00.000Z`, configDigest: "config-digest-2-old" }))
    const run2new = record({ run: 2, capturedAt: "2026-08-18T01:00:00.000Z", configDigest: "config-digest-2-new" })
    expect(selectPresentationStreak([...run1, ...run2, run2new])).toBeNull()
  })

  test("ignores non-qualifying records before the streak", () => {
    const old = record({ run: 2, agents: "fixture", capturedAt: "2026-08-18T00:00:00.000Z" })
    const run1 = [0, 1, 2].map((offset) => record({ run: 1, capturedAt: `2026-08-18T00:0${offset + 1}:00.000Z` }))
    const run2 = [3, 4, 5].map((offset) => record({ run: 2, capturedAt: `2026-08-18T00:1${offset}:00.000Z` }))
    const selection = selectPresentationStreak([old, ...run1, ...run2])
    expect(selection).not.toBeNull()
    expect(selection?.records.map((record) => record.run)).toEqual([1, 2])
  })

  test("returns null for fewer than three runs per scenario", () => {
    expect(selectPresentationStreak([record({ run: 1 }), record({ run: 1 }), record({ run: 1 }), record({ run: 2 }), record({ run: 2 })])).toBeNull()
    expect(selectPresentationStreak([])).toBeNull()
  })
})

describe("manifestConfigDigestOf", () => {
  test("distinguishes every frozen input while ignoring run identity", () => {
    const base = manifest()
    const digest = manifestConfigDigestOf(base)
    const variants: Array<[string, (m: CaptureManifest) => CaptureManifest]> = [
      ["model", (m) => ({ ...m, model: "other-model" })],
      ["reasoning", (m) => ({ ...m, reasoning: "high" })],
      ["pi version", (m) => ({ ...m, pi_ai_version: "0.79.5" })],
      ["skill digest", (m) => ({ ...m, skill_tree_digest: `sha256:${"a".repeat(64)}` })],
      ["tool catalog", (m) => ({ ...m, tool_catalog_revision: "tool-catalog@2.0" })],
      ["prompt revision", (m) => ({ ...m, prompt_revision: "prompts@2.0" })],
      ["policy revision", (m) => ({ ...m, policy_revision: "policy-v2" })],
      ["perspectives", (m) => ({ ...m, perspectives: [{ participant_id: "p-1", perspective: "different", order: 1 }] })],
      ["seeds", (m) => ({ ...m, seeds: [{ id: "S1", digest: `sha256:${"b".repeat(64)}` }] })],
      ["budgets", (m) => ({ ...m, budgets: { ...m.budgets, attempt_limit: 5 } })],
      ["schema versions", (m) => ({ ...m, schema_versions: { "remediation-draft": "2.0" } })],
    ]
    for (const [label, mutate] of variants) {
      expect(manifestConfigDigestOf(mutate(base))).not.toBe(digest)
    }
    // Run identity never changes the frozen digest.
    const sameConfig = {
      ...base,
      manifest_id: "capture-manifest:other:run-2",
      incident_id: "other",
      run_id: "run-2",
      sealed_at: "2026-08-19T00:00:00Z",
      manifest_digest: `sha256:${"e".repeat(64)}`,
      role_records: [{ role: "judge", agent_id: "agent-judge", status: "succeeded", model_use_agent_ids: [] }],
    } as CaptureManifest
    expect(manifestConfigDigestOf(sameConfig)).toBe(digest)
  })

  test("differs between scenarios via the seed", () => {
    const s1 = manifest()
    const s2 = {
      ...manifest(),
      scenario: "S2",
      seeds: [{ id: "S2", digest: `sha256:${"c".repeat(64)}` }],
    } as CaptureManifest
    expect(manifestConfigDigestOf(s1)).not.toBe(manifestConfigDigestOf(s2))
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