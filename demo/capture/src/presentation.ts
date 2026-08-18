/**
 * Presentation-bundle assembly for real-agent captures (issue #23). The
 * selected streak's runs are assembled into demo/saved-runs and strictly
 * verified; fixture runs, rehearsal runs, incomplete runs, and tampered
 * bundles are rejected.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { buildManifest, savedRunsRoot, verifyBundle, writeBundle } from "./export.js"
import { SAVED_INCIDENT_1, SAVED_INCIDENT_2 } from "./constants.js"
import type { StoredCaptureRecord } from "./dev-store.js"
import { DEV_STORE_ROOT, selectPresentationStreak } from "./dev-store.js"

export interface PresentationResult {
  incidentIds: string[]
  artifacts: number
  streakStartedAt: string
}

/** Assemble and verify the presentation bundle from the selected streak's
 * stored run directories. Throws with a clear reason when a record is not
 * presentation-acceptable. */
export async function assemblePresentation(
  records: readonly StoredCaptureRecord[],
  outRoot: string = savedRunsRoot(),
): Promise<PresentationResult> {
  const files = new Map<string, string>()
  const incidents: Array<{ incident_id: string; final_sequence: number }> = []
  const captureTime = new Date().toISOString()

  for (const record of records) {
    if (record.agents !== "real") {
      throw new Error(`presentation rejects fixture record ${record.savedId} (${record.capturedAt})`)
    }
    if (record.mode !== "full-capture") {
      throw new Error(`presentation rejects rehearsal record ${record.savedId} (${record.capturedAt})`)
    }
    if (!record.manifestSealed) {
      throw new Error(`presentation rejects run without a capture manifest: ${record.savedId} (${record.capturedAt})`)
    }
    const savedId = record.run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
    const runDir = join(DEV_STORE_ROOT, record.runPath)
    const walk = async (current: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(join(current, entry.name), relative)
        } else {
          files.set(relative, await readFile(join(current, entry.name), "utf8"))
        }
      }
    }
    await walk(runDir, "")
    incidents.push({ incident_id: savedId, final_sequence: record.finalSequence })
  }

  const manifest = buildManifest({ files, incidents, captureTime })
  files.set("manifest.json", manifest)

  const verified = verifyBundle(files, captureTime)
  if (!verified.ok) {
    throw new Error(
      `presentation bundle failed verification: ${verified.error
        .map((error) => `${error.code}: ${error.message}`)
        .join("; ")}`,
    )
  }
  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })
  await writeBundle(files, outRoot)
  return {
    incidentIds: incidents.map((incident) => incident.incident_id),
    artifacts: verified.value.artifacts.size,
    streakStartedAt: records[0]?.capturedAt ?? "",
  }
}

/** Find the presentation streak and assemble it. */
export async function presentFromStore(): Promise<PresentationResult | null> {
  const records = await listAll()
  const selection = selectPresentationStreak(records)
  if (selection === null) {
    return null
  }
  return assemblePresentation(selection.records)
}

async function listAll(): Promise<StoredCaptureRecord[]> {
  const { listCaptureRecords } = await import("./dev-store.js")
  return listCaptureRecords()
}