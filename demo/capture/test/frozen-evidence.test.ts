import { describe, expect, test } from "bun:test"

import { loadFrozenEvidenceSet } from "../src/frozen-evidence.js"
import { savedRunsRoot } from "../src/export.js"

describe("frozen rehearsal Evidence Sets", () => {
  test("loads the immutable base revision for both scenarios", async () => {
    const first = await loadFrozenEvidenceSet(1, { root: savedRunsRoot(), evaluationTime: "2026-08-19T00:00:00.000Z" })
    const second = await loadFrozenEvidenceSet(2, { root: savedRunsRoot(), evaluationTime: "2026-08-19T00:00:00.000Z" })

    expect(first.evidenceSet.revision_number).toBe(1)
    expect(second.evidenceSet.revision_number).toBe(1)
    expect(first.evidenceSet.items.length).toBe(8)
    expect(second.evidenceSet.items.length).toBe(8)
    expect(Object.isFrozen(first.evidenceSet)).toBe(true)
    expect(Object.isFrozen(first.evidenceSet.items)).toBe(true)
    expect(Object.isFrozen(first.evidenceSet.items[0])).toBe(true)
    expect(first.sourceArtifactHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("does not silently accept a changed saved bundle", async () => {
    await expect(loadFrozenEvidenceSet(1, { root: "C:/does-not-exist" })).rejects.toThrow()
  })
})
