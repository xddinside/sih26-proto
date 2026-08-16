/**
 * Saved-bundle directory resolution tests. `resolveBundleDir` walks up from
 * the working directory and prefers `demo/saved-runs` (the captured export),
 * falling back to `demo/fixtures/runs` and then `demo/fixtures/contracts/valid`.
 * These tests build a temporary tree so they do not depend on any worktree.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, test } from "bun:test"

import { resolveBundleDir } from "./load-store"

const root = mkdtempSync(path.join(tmpdir(), "sih-loader-"))

function touchBundle(relative: string) {
  const dir = path.join(root, relative)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "manifest.json"), "{}")
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("resolveBundleDir", () => {
  test("prefers demo/saved-runs when it exists", () => {
    touchBundle("demo/saved-runs")
    touchBundle("demo/fixtures/runs")
    const dir = resolveBundleDir(path.join(root, "apps/web"))
    expect(dir).not.toBeNull()
    expect(dir?.href).toContain("/demo/saved-runs/")
  })

  test("falls back to demo/fixtures/runs when no saved-runs manifest exists", () => {
    rmSync(path.join(root, "demo", "saved-runs"), { recursive: true, force: true })
    const dir = resolveBundleDir(path.join(root, "apps/web"))
    expect(dir).not.toBeNull()
    expect(dir?.href).toContain("/demo/fixtures/runs/")
  })

  test("falls back to demo/fixtures/contracts/valid", () => {
    rmSync(path.join(root, "demo", "fixtures", "runs"), { recursive: true, force: true })
    touchBundle("demo/fixtures/contracts/valid")
    const dir = resolveBundleDir(root)
    expect(dir).not.toBeNull()
    expect(dir?.href).toContain("/demo/fixtures/contracts/valid/")
  })

  test("returns null when no manifest is present up the tree", () => {
    expect(resolveBundleDir("/tmp/opencode")).toBeNull()
  })
})
