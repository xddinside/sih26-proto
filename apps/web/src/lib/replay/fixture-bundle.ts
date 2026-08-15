/**
 * Test-only helper that loads the byte-accurate contract fixture bundle from
 * `demo/fixtures/contracts/valid/` into memory. The replay adapter itself is
 * pure; tests exercise it through this single filesystem seam and never touch
 * the disk anywhere else.
 */
import { readFile } from "node:fs/promises"

import { parseJsonTextStrict } from "@sih/contracts/canonical"
import { parseSavedBundleManifest } from "@sih/contracts/parse"

import type { SavedFileMap } from "./replay-files"

const VALID_BUNDLE_URL = new URL(
  "../../../../../demo/fixtures/contracts/valid/",
  import.meta.url,
)

/**
 * Load the real contract fixture bundle into an in-memory file map. Throws
 * only when the fixture itself is unreadable or invalid, which is a broken
 * test, not a replay failure.
 */
export async function loadFixtureBundle(): Promise<SavedFileMap> {
  const files = new Map<string, string>()
  const manifestText = await readFile(
    new URL("manifest.json", VALID_BUNDLE_URL),
    "utf8",
  )
  const manifestJson = parseJsonTextStrict(manifestText)
  if (!manifestJson.ok) {
    throw new Error(`fixture manifest is not strict JSON: ${manifestJson.error.message}`)
  }
  const manifest = parseSavedBundleManifest(manifestJson.value)
  if (!manifest.ok) {
    throw new Error(`fixture manifest failed validation: ${manifest.error.message}`)
  }
  files.set("manifest.json", manifestText)
  for (const path of Object.keys(manifest.value.files)) {
    const text = await readFile(new URL(path, VALID_BUNDLE_URL), "utf8")
    files.set(path, text)
  }
  return files
}
