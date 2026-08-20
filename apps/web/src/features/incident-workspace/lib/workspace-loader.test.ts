import { describe, expect, test } from "bun:test"

import { loadWorkspaceStore } from "./workspace-loader"

describe("loadWorkspaceStore cache", () => {
  test("reuses one verified replay store for repeated reads", async () => {
    const [first, concurrent] = await Promise.all([
      loadWorkspaceStore(),
      loadWorkspaceStore(),
    ])
    const repeated = await loadWorkspaceStore()

    expect(first.ok).toBe(true)
    expect(concurrent.ok).toBe(true)
    expect(repeated.ok).toBe(true)
    if (!first.ok || !concurrent.ok || !repeated.ok) return

    expect(concurrent.value).toBe(first.value)
    expect(repeated.value).toBe(first.value)
  })
})
