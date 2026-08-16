/**
 * Server-only saved-bundle loader for the Incident Workspace panels.
 *
 * This is the workspace feature's own filesystem seam: it resolves the richer
 * saved-run bundle in `demo/fixtures/runs/` and delegates all verification to
 * `loadReplayStoreFromDirectory` in the shared replay adapter. It mirrors the
 * #21 loader's walk-up resolution so it works both from the repo root and
 * from `apps/web` (Turbo's cwd), and it is imported only by server functions,
 * never by the browser bundle.
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { loadReplayStoreFromDirectory } from "../../../lib/replay/load-saved-bundle-fs"
import type { LoaderError } from "../../../lib/replay/load-saved-bundle-fs"
import type { ReplayResult } from "../../../lib/replay/replay-result"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import { DEMO_EVALUATION_TIME } from "../../incidents/constants"

const MANIFEST_NAME = "manifest.json"

/**
 * Resolve the richer saved-run bundle directory for a working directory, or
 * null when no candidate contains a manifest. Walks up from the working
 * directory so it works both from the repo root and from `apps/web`.
 */
export function resolveWorkspaceBundleDir(cwd: string): URL | null {
  let dir = path.resolve(cwd)
  for (let level = 0; level < 6; level += 1) {
    const candidate = path.join(dir, "demo", "fixtures", "runs")
    if (existsSync(path.join(candidate, MANIFEST_NAME))) {
      return pathToFileURL(candidate.endsWith(path.sep) ? candidate : `${candidate}${path.sep}`)
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

/** A filesystem failure for the bundle root itself. */
function bundleMissing(cwd: string): LoaderError {
  return {
    kind: "filesystem",
    path: MANIFEST_NAME,
    message: `saved-run bundle not found relative to ${cwd}`,
  }
}

/**
 * Load and fully verify the richer saved-run bundle into the read-only replay
 * store. Verification runs against the explicit demo evaluation time, never
 * the live clock.
 */
export async function loadWorkspaceStore(
  cwd: string = process.cwd(),
): Promise<ReplayResult<ReplayStore, LoaderError[]>> {
  const dir = resolveWorkspaceBundleDir(cwd)
  if (dir === null) {
    return { ok: false, error: [bundleMissing(cwd)] }
  }
  try {
    await readFile(new URL(MANIFEST_NAME, dir))
  } catch {
    return { ok: false, error: [bundleMissing(cwd)] }
  }
  return loadReplayStoreFromDirectory(dir, { evaluationTime: DEMO_EVALUATION_TIME })
}
