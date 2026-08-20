/**
 * Presentation-bundle assembly for real-agent captures (issue #23/#31). The
 * selected streaks' runs are assembled into demo/saved-runs and strictly
 * verified; fixture runs, rehearsal runs, incomplete runs, runs missing a
 * required role, and tampered bundles are rejected. Selection provenance is
 * recorded back into the append-only dev store.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { parseJsonTextStrict } from "@sih/contracts/canonical"

import { buildManifest, savedRunsRoot, verifyBundle, writeBundle } from "./export.js"
import { SAVED_INCIDENT_1, SAVED_INCIDENT_2 } from "./constants.js"
import type { StoredCaptureRecord } from "./dev-store.js"
import { appendSelectionRecord, devStoreRoot, selectPresentationStreak } from "./dev-store.js"

export interface PresentationResult {
  incidentIds: string[]
  artifacts: number
  streakStartedAt: string
}

/** The Demo Profile roles a presentation bundle must contain, and how many
 * times each must appear with a succeeded status (issue #31). The Orchestrator
 * runs twice (scheduler + final report); Fusion runs two private participants;
 * repair runs one planner and one implementer; Verify runs the applicable
 * independent review and Test Agent sessions. */
export const REQUIRED_ROLE_COUNTS: Readonly<Record<string, number>> = {
  orchestrator: 1,
  participant: 2,
  judge: 1,
  synthesizer: 1,
  planner: 1,
  implementer: 1,
  review: 1,
  test: 1,
}

/** Every capture-manifest payload in an in-memory bundle. */
function manifestPayloads(files: Map<string, string>): Array<Record<string, unknown>> {
  const payloads: Array<Record<string, unknown>> = []
  for (const [path, bytes] of files) {
    if (!path.startsWith("artifacts/sha256/")) {
      continue
    }
    const parsed = parseJsonTextStrict(bytes)
    if (!parsed.ok) {
      continue
    }
    const envelope = parsed.value as { artifact_schema_id?: string; payload?: Record<string, unknown> }
    if (envelope.artifact_schema_id === "capture-manifest" && envelope.payload !== undefined) {
      payloads.push(envelope.payload)
    }
  }
  return payloads
}

/** True when every sealed capture manifest in the bundle proves a real,
 * full-capture run: not a deterministic fixture and not a rehearsal. The
 * record's own fields are never trusted here — the sealed manifests are the
 * durable truth (issue #31, fixture misclassification). */
export function manifestIsPresentationEligible(files: Map<string, string>): string | null {
  const payloads = manifestPayloads(files)
  if (payloads.length === 0) {
    return "no sealed capture manifest"
  }
  for (const payload of payloads) {
    if (payload.provider_class !== "real") {
      return `provider_class ${JSON.stringify(payload.provider_class)} is not real`
    }
    if (payload.mode !== "full-capture") {
      return `mode ${JSON.stringify(payload.mode)} is not full-capture`
    }
    if (payload.provider === "deterministic") {
      return "deterministic provider fixture"
    }
  }
  return null
}

/** The roles the bundle's sealed manifests report missing or not succeeded.
 * Every run's capture manifest must satisfy the required-role coverage: the
 * union of missing roles across all manifests is returned. An empty array
 * means every required role is present and succeeded in every run. */
export function missingRequiredRoles(
  files: Map<string, string>,
  required: Readonly<Record<string, number>> = REQUIRED_ROLE_COUNTS,
): string[] {
  const payloads = manifestPayloads(files)
  if (payloads.length === 0) {
    return ["capture-manifest"]
  }
  const missing = new Set<string>()
  for (const payload of payloads) {
    const roleRecords = payload.role_records
    if (!Array.isArray(roleRecords)) {
      missing.add("role_records")
      continue
    }
    const counts = new Map<string, number>()
    for (const record of roleRecords) {
      const entry = record as { role?: unknown; status?: unknown }
      if (entry.status !== "succeeded") {
        continue
      }
      const role = typeof entry.role === "string" ? entry.role : ""
      counts.set(role, (counts.get(role) ?? 0) + 1)
    }
    for (const [role, minimum] of Object.entries(required)) {
      if ((counts.get(role) ?? 0) < minimum) {
        missing.add(`${role}>=${minimum}`)
      }
    }
  }
  return [...missing]
}

/** The expected terminal outcome the record must prove before it can be
 * presented (issue #31): Run 1 its verified Release/Watch success, Run 2 its
 * `verification-failed` / "Blocked safely" outcome with no Release. */
export function recordHasExpectedOutcome(record: StoredCaptureRecord): boolean {
  if (record.run === 1) {
    return record.finalRunState === "completed" && record.outcome === "verified-remediation"
  }
  return record.finalRunState === "failed" && record.failureReason === "verification-failed"
}

/** Assemble and verify the presentation bundle from the selected streaks'
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
    if (record.provider === "deterministic") {
      throw new Error(`presentation rejects deterministic-provider fixture ${record.savedId} (${record.capturedAt})`)
    }
    if (!record.manifestSealed) {
      throw new Error(`presentation rejects run without a capture manifest: ${record.savedId} (${record.capturedAt})`)
    }
    if (!recordHasExpectedOutcome(record)) {
      throw new Error(`presentation rejects run without its expected terminal outcome: ${record.savedId} (${record.capturedAt})`)
    }
    const savedId = record.run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
    const runDir = join(devStoreRoot(), record.runPath)
    const walk = async (current: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
        // Housekeeping files of the retained run (its own bundle manifest or
        // a partial/failure record) never enter the presentation bundle; the
        // outer manifest is rebuilt over the assembled files.
        if (
          relative === "manifest.json" ||
          relative === "capture.json" ||
          relative === "failure.json"
        ) {
          continue
        }
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

  const notReal = manifestIsPresentationEligible(files)
  if (notReal !== null) {
    throw new Error(`presentation bundle is not a real full capture: ${notReal}`)
  }
  const missing = missingRequiredRoles(files)
  if (missing.length > 0) {
    throw new Error(`presentation bundle is missing required succeeded roles: ${missing.join(", ")}`)
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

/** Find the presentation streaks, assemble the bundle, and record the
 * selection provenance back into the append-only dev store. */
export async function presentFromStore(outRoot: string = savedRunsRoot()): Promise<PresentationResult | null> {
  const records = await listAll()
  const selection = selectPresentationStreak(records)
  if (selection === null) {
    return null
  }
  const result = await assemblePresentation(selection.records, outRoot)
  await appendSelectionRecord({
    kind: "selection",
    version: 1,
    selectedAt: new Date().toISOString(),
    configDigests: [...new Set(selection.records.map((record) => record.configDigest))],
    records: selection.records.map((record) => ({
      run: record.run,
      scenario: record.scenario,
      savedId: record.savedId,
      capturedAt: record.capturedAt,
      runPath: record.runPath,
      manifestDigest: record.manifestDigest,
      configDigest: record.configDigest,
    })),
  })
  return result
}

async function listAll(): Promise<StoredCaptureRecord[]> {
  const { listCaptureRecords } = await import("./dev-store.js")
  return listCaptureRecords()
}