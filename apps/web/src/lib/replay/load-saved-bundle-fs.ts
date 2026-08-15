/**
 * Server-only filesystem loader for the static saved bundle.
 *
 * This is the adapter's only module that touches the filesystem; the pure
 * modules must never import it. It reads exactly the settled layout —
 * `manifest.json` and every file the manifest lists — into memory and
 * delegates all verification to `loadReplayStore`. It exists for the server
 * side of later Workspace routes and must never be bundled for the browser.
 */
import { readFile } from "node:fs/promises"

import { parseJsonTextStrict } from "@sih/contracts/canonical"
import { integrityError } from "@sih/contracts/errors"
import type { IntegrityError } from "@sih/contracts/errors"
import { parseSavedBundleManifest } from "@sih/contracts/parse"

import type { ReplayOptions } from "./replay-files"
import { replayErr, replayOk } from "./replay-result"
import type { ReplayResult } from "./replay-result"
import { loadReplayStore } from "./replay-store"
import type { ReplayStore } from "./replay-store"

/** A filesystem failure, distinct from bundle integrity failures. */
export interface FsReadError {
  /** Discriminator for loader failures outside the integrity vocabulary. */
  kind: "filesystem"
  /** The bundle path the loader failed to read. */
  path: string
  /** The underlying error message, prose only. */
  message: string
}

/** Loader failure: an integrity error or a filesystem read failure. */
export type LoaderError = IntegrityError | FsReadError

const MANIFEST_PATH = "manifest.json"

/** Wrap an unknown throw from `readFile` in a named filesystem error. */
function fsError(path: string, error: unknown): FsReadError {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: "filesystem", path, message }
}

/**
 * Load a saved bundle from a directory and verify it, returning the read-only
 * replay store. The directory must contain the settled layout; the loader
 * reads `manifest.json` and every file the manifest lists, never files the
 * manifest does not list. Filesystem failures and integrity failures are
 * returned as values, never thrown.
 *
 * @param rootUrl a directory URL ending in `/` that contains `manifest.json`
 * @param options the explicit freshness evaluation time
 */
export async function loadReplayStoreFromDirectory(
  rootUrl: URL,
  options: ReplayOptions,
): Promise<ReplayResult<ReplayStore, LoaderError[]>> {
  const files = new Map<string, string>()
  let manifestText: string
  try {
    manifestText = await readFile(new URL(MANIFEST_PATH, rootUrl), "utf8")
  } catch (error) {
    return replayErr([fsError(MANIFEST_PATH, error)])
  }
  const manifestJson = parseJsonTextStrict(manifestText)
  if (!manifestJson.ok) {
    return replayErr([
      integrityError(
        "MALFORMED_CONTRACT",
        `manifest.json is not strict JSON: ${manifestJson.error.message}`,
        MANIFEST_PATH,
      ),
    ])
  }
  const manifest = parseSavedBundleManifest(manifestJson.value)
  if (!manifest.ok) {
    return replayErr([manifest.error])
  }
  files.set(MANIFEST_PATH, manifestText)
  for (const path of Object.keys(manifest.value.files)) {
    try {
      const text = await readFile(new URL(path, rootUrl), "utf8")
      files.set(path, text)
    } catch (error) {
      return replayErr([fsError(path, error)])
    }
  }
  const result = loadReplayStore(files, options)
  if (!result.ok) {
    return replayErr(result.error)
  }
  return replayOk(result.value)
}
