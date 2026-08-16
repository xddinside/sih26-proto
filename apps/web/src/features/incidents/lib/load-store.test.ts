/**
 * Saved-bundle directory resolution tests. `resolveBundleDir` walks up from
 * the working directory to find `demo/fixtures/contracts/valid`, so the demo
 * works both from the repo root and from `apps/web` (Turbo's package cwd).
 */
import { describe, expect, test } from "bun:test"

import { resolveBundleDir } from "./load-store"

describe("resolveBundleDir", () => {
  test("resolves the fixture bundle from the apps/web working directory", () => {
    const dir = resolveBundleDir("/home/xdd/dev/work/sih26-proto-task-21/apps/web")
    expect(dir).not.toBeNull()
    expect(dir?.href).toContain("/demo/fixtures/contracts/valid/")
  })

  test("resolves the fixture bundle from the repo root", () => {
    const dir = resolveBundleDir("/home/xdd/dev/work/sih26-proto-task-21")
    expect(dir).not.toBeNull()
    expect(dir?.href).toContain("/demo/fixtures/contracts/valid/")
  })

  test("returns null when no manifest is present up the tree", () => {
    expect(resolveBundleDir("/tmp/opencode")).toBeNull()
  })
})
