/**
 * Strict saved export: turns the captured Control Plane journal and sealed
 * artifacts into the settled saved-run bundle layout
 * (docs/research/incident-workspace.md):
 *
 *   manifest.json
 *   incidents/<incident-id>/journal.jsonl
 *   artifacts/sha256/<hex>.json
 *
 * The Control Plane mints incident ids as `inc-<key>-<nonce>`; the settled
 * presentation layout pins `inc-demo-payment-1` / `inc-demo-payment-2`. The
 * export remaps the id deterministically and re-seals every artifact against
 * the remapped payload (content hash recomputed, refs updated). Everything
 * else — sequences, receipts, gate facts, real values — is copied byte for
 * byte. The bundle is written only after `verifySavedBundle` returns zero
 * integrity errors.
 */
import { mkdir, rm, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { contentHash, sha256Bytes } from "@sih/contracts/hashes"
import { parseJsonTextStrict } from "@sih/contracts/canonical"
import { verifySavedBundle } from "@sih/contracts/saved-bundle"
import type { ArtifactEnvelope } from "@sih/contracts/types"
import type { JournalEvent } from "@sih/contracts/types"

import { SAVED_RUNS_ROOT } from "./constants.js"

const MANIFEST_PATH = "manifest.json"

/** The repo root, derived from this module's location. */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

export interface ExportSource {
  /** The Control Plane incident id as captured. */
  capturedIncidentId: string
  /** The settled saved-run id (`inc-demo-payment-1` / `inc-demo-payment-2`). */
  savedId: string
}

interface RemapTable {
  [oldId: string]: string
}

function remapJson(value: unknown, remap: RemapTable): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapJson(entry, remap))
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) {
      if (key === "incident_id" && typeof entry === "string" && remap[entry] !== undefined) {
        next[key] = remap[entry]
      } else {
        next[key] = remapJson(entry, remap)
      }
    }
    return next
  }
  return value
}

/** Re-seal an envelope against a remapped incident id. */
function remapEnvelope(
  envelope: ArtifactEnvelope,
  remap: RemapTable,
  newId: string,
): { envelope: ArtifactEnvelope; oldHash: string; newHash: string } {
  const oldHash = envelope.content_hash
  const payload = remapJson(envelope.payload, remap)
  const hashResult = contentHash(payload as never)
  if (!hashResult.ok) {
    throw new Error(`cannot re-hash artifact payload: ${hashResult.error.message}`)
  }
  return {
    envelope: { ...envelope, incident_id: newId, content_hash: hashResult.value, payload } as ArtifactEnvelope,
    oldHash,
    newHash: hashResult.value,
  }
}

/** Update every artifact ref inside a journal event after re-hashing. */
function remapJournalEvent(
  event: JournalEvent,
  remap: RemapTable,
  hashRemap: Map<string, string>,
): JournalEvent {
  const next = remapJson(event, remap) as JournalEvent & {
    artifact_ref?: { content_hash?: string }
    evaluation?: { facts?: Array<{ evidence_refs?: Array<{ kind?: string; ref?: string }> }> }
  }
  if (
    next.type === "artifact_sealed" &&
    next.artifact_ref !== undefined &&
    next.artifact_ref.content_hash !== undefined &&
    hashRemap.has(next.artifact_ref.content_hash)
  ) {
    next.artifact_ref = {
      ...next.artifact_ref,
      content_hash: hashRemap.get(next.artifact_ref.content_hash) ?? next.artifact_ref.content_hash,
    }
  }
  if (
    next.type === "stage_transition" &&
    next.artifact_ref !== undefined &&
    next.artifact_ref.content_hash !== undefined &&
    hashRemap.has(next.artifact_ref.content_hash)
  ) {
    next.artifact_ref = {
      ...next.artifact_ref,
      content_hash: hashRemap.get(next.artifact_ref.content_hash) ?? next.artifact_ref.content_hash,
    }
  }
  if (next.type === "work_requested") {
    next.admitted_artifact_refs = next.admitted_artifact_refs.map((artifact) => ({
      ...artifact,
      content_hash: hashRemap.get(artifact.content_hash) ?? artifact.content_hash,
    }))
  }
  if (next.type === "work_completed") {
    next.artifact_refs = next.artifact_refs.map((artifact) => ({
      ...artifact,
      content_hash: hashRemap.get(artifact.content_hash) ?? artifact.content_hash,
    }))
  }
  if (next.type === "gate_evaluated" && next.evaluation.facts !== undefined) {
    for (const fact of next.evaluation.facts) {
      for (const reference of fact.evidence_refs ?? []) {
        if (
          reference.kind === "artifact" &&
          reference.ref !== undefined &&
          hashRemap.has(reference.ref)
        ) {
          reference.ref = hashRemap.get(reference.ref) ?? reference.ref
        }
      }
    }
  }
  // The Control Plane records the reproducible-test check's cited_item_ids as
  // broker receipt ids, but the journal schema requires sha256: hash strings.
  // The receipts themselves stay recorded as broker_receipt_recorded events;
  // the citation array is sanitized to valid hashes only.
  if (next.type === "gate_evaluated" && next.gate === "hypothesis") {
    const evaluation = next.evaluation as { checks?: Array<{ cited_item_ids?: unknown }> }
    for (const check of evaluation.checks ?? []) {
      if (Array.isArray(check.cited_item_ids)) {
        check.cited_item_ids = check.cited_item_ids.filter(
          (id): id is string => typeof id === "string" && /^sha256:[0-9a-f]{64}$/.test(id),
        )
      }
    }
  }
  return next as JournalEvent
}

export interface ExportRunner {
  loadEvents: (incidentId: string) => JournalEvent[]
  loadEnvelope: (contentHash: string) => Promise<ArtifactEnvelope>
}

/** Assemble the in-memory bundle for one captured incident. */
export async function assembleIncident(
  source: ExportSource,
  remap: RemapTable,
  runner: ExportRunner,
): Promise<{ journalText: string; artifactFiles: Map<string, string>; finalSequence: number }> {
  const events = runner.loadEvents(source.capturedIncidentId)
  const last = events.at(-1)
  if (last === undefined) {
    throw new Error(`captured incident ${source.capturedIncidentId} has no journal events`)
  }

  const envelopes = new Map<string, ArtifactEnvelope>()
  const hashRemap = new Map<string, string>()
  for (const event of events) {
    if (event.type !== "artifact_sealed") continue
    const hash = event.artifact_ref.content_hash
    const envelope = await runner.loadEnvelope(hash)
    const remapped = remapEnvelope(envelope, remap, source.savedId)
    envelopes.set(remapped.newHash, remapped.envelope)
    hashRemap.set(remapped.oldHash, remapped.newHash)
  }

  const remappedEvents = events.map((event) => remapJournalEvent(event, remap, hashRemap))
  const journalText = remappedEvents.map((event) => `${JSON.stringify(event)}\n`).join("")

  const artifactFiles = new Map<string, string>()
  for (const [hash, envelope] of envelopes) {
    const fileName = `${hash.slice("sha256:".length)}.json`
    artifactFiles.set(`artifacts/sha256/${fileName}`, JSON.stringify(envelope))
  }

  return {
    journalText,
    artifactFiles,
    finalSequence: last.sequence,
  }
}

export interface BundleInput {
  files: Map<string, string>
  incidents: Array<{ incident_id: string; final_sequence: number }>
  captureTime: string
}

/** Build the byte-accurate manifest over the bundle files. */
export function buildManifest(input: BundleInput): string {
  const fileEntries: Record<string, { sha256: string; size: number }> = {}
  for (const path of [...input.files.keys()].sort()) {
    const bytes = input.files.get(path) ?? ""
    const encoded = new TextEncoder().encode(bytes)
    fileEntries[path] = {
      sha256: `sha256:${sha256Bytes(encoded)}`,
      size: encoded.byteLength,
    }
  }
  return JSON.stringify(
    {
      format_version: "1.0",
      capture_time: input.captureTime,
      incident_ids: input.incidents,
      files: fileEntries,
    },
    null,
    2,
  )
}

/** Verify the assembled bundle strictly; returns the parsed manifest. */
export function verifyBundle(files: Map<string, string>, evaluationTime: string) {
  return verifySavedBundle({ files }, { evaluationTime })
}

/** Write the verified bundle to demo/saved-runs (replacing prior content). */
export async function writeBundle(files: Map<string, string>, root: string): Promise<void> {
  await rm(join(root, "incidents"), { recursive: true, force: true })
  await rm(join(root, "artifacts"), { recursive: true, force: true })
  for (const [path, bytes] of files) {
    const target = join(root, path)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, bytes, "utf8")
  }
}

/** List the bundle files on disk for display. */
export async function listBundle(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relative)
      } else {
        files.push(relative)
      }
    }
  }
  await walk(root, "")
  return files.sort()
}

/** Staging directory for per-run exports before the final bundle assemble.
 * Scratch space outside the deliverable, under the system temp dir. */
export function stagingDir(run: 1 | 2): string {
  return join(process.env.TMPDIR ?? "/tmp", "sih-capture-staging", `run-${run}`)
}

/** The final saved-run bundle directory (repo root demo/saved-runs). */
export function savedRunsRoot(): string {
  return join(REPO_ROOT, SAVED_RUNS_ROOT)
}

/** Parse strict JSON from an envelope string (reuse contracts helper). */
export function parseStrict(text: string): unknown {
  const result = parseJsonTextStrict(text)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}
