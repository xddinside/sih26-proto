/**
 * Saved-bundle corruption catalog, issue #22.
 *
 * Each case mutates an in-memory copy of a saved bundle and is verified to
 * surface exactly the named integrity error code from the stable vocabulary
 * in `packages/contracts/src/errors.ts` (the same style as the contract
 * fixture mutations in `packages/contracts/test/invalid-cases.ts`).
 *
 * A mutation that rewrites file bytes also rewrites the manifest entries for
 * those bytes, so the only failing check is the one the case names. The
 * pristine captured bundle in `demo/saved-runs/` is never touched: callers
 * pass a copy.
 *
 * This module is shared by `demo/replay/replay-check.ts` (data-level checks
 * over `demo/saved-runs/`) and the end-to-end runner in `apps/web/e2e/`
 * (which serves a corrupted copy to the dev server and asserts the rendered
 * error state).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

import { contentHash, sha256Hex } from "../../packages/contracts/src/hashes.js"
import type { ArtifactEnvelope } from "../../packages/contracts/src/schemas/artifact-envelope.js"
import type { EvidenceSet } from "../../packages/contracts/src/schemas/evidence.js"
import type { JournalEvent } from "../../packages/contracts/src/schemas/journal-event.js"
import type { SavedBundleManifest } from "../../packages/contracts/src/schemas/saved-bundle-manifest.js"

const MANIFEST_PATH = "manifest.json"

export type FileMap = Map<string, string>

/** One named corruption case with the integrity error it must surface. */
export interface CorruptionCase {
  name: string
  expectedCode: string
  /** The mutation is applied to a copy; the caller owns the original. */
  apply: (files: FileMap) => FileMap
}

const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

function manifestOf(files: FileMap): SavedBundleManifest {
  const text = files.get(MANIFEST_PATH)
  if (text === undefined) {
    throw new Error("corruption catalog: missing manifest.json")
  }
  return JSON.parse(text) as SavedBundleManifest
}

/** Rewrite manifest.json to match the current file bytes. */
function reManifest(files: FileMap): FileMap {
  const manifest = manifestOf(files)
  const next = new Map(files)
  next.delete(MANIFEST_PATH)
  const fileEntries: Record<string, { sha256: string; size: number }> = {}
  for (const filePath of [...next.keys()].sort()) {
    const bytes = next.get(filePath) ?? ""
    fileEntries[filePath] = {
      sha256: `sha256:${sha256Hex(bytes)}`,
      size: utf8Size(bytes),
    }
  }
  const rewritten: SavedBundleManifest = { ...manifest, files: fileEntries }
  next.set(MANIFEST_PATH, JSON.stringify(rewritten, null, 2))
  return next
}

function journalEventsOf(files: FileMap, incidentId: string): JournalEvent[] {
  const text = files.get(`incidents/${incidentId}/journal.jsonl`)
  if (text === undefined) {
    throw new Error(`corruption catalog: missing journal for ${incidentId}`)
  }
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as JournalEvent)
}

function writeJournal(files: FileMap, incidentId: string, events: JournalEvent[]): FileMap {
  const next = new Map(files)
  next.set(
    `incidents/${incidentId}/journal.jsonl`,
    events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  )
  return next
}

function rewriteJournal(files: FileMap, incidentId: string, events: JournalEvent[]): FileMap {
  return reManifest(writeJournal(files, incidentId, events))
}

/** Recompute an envelope's content_hash from its payload. */
function rehashEnvelope(envelope: ArtifactEnvelope): ArtifactEnvelope {
  const hash = contentHash(envelope.payload as never)
  if (!hash.ok) {
    throw new Error(`corruption catalog: cannot canonicalize payload: ${hash.error.message}`)
  }
  return { ...envelope, content_hash: hash.value }
}

/**
 * Rewrite one envelope file, keeping the path/hash agreement intact. When
 * `rehash` is set the envelope's content_hash is recomputed and the file is
 * moved to the content-addressed path for the new hash.
 */
function rewriteEnvelope(
  files: FileMap,
  envelopePath: string,
  envelope: ArtifactEnvelope,
  rehash: boolean,
): FileMap {
  const next = new Map(files)
  const updated = rehash ? rehashEnvelope(envelope) : envelope
  const digest = updated.content_hash.slice("sha256:".length)
  const target = `artifacts/sha256/${digest}.json`
  next.delete(envelopePath)
  next.set(target, JSON.stringify(updated))
  return reManifest(next)
}

/** The first artifact envelope file whose schema id matches, if any. */
function firstEnvelopePath(files: FileMap, schemaId: string): string {
  for (const filePath of files.keys()) {
    if (!filePath.startsWith("artifacts/sha256/")) continue
    const envelope = JSON.parse(files.get(filePath) ?? "") as ArtifactEnvelope
    if (envelope.artifact_schema_id === schemaId) {
      return filePath
    }
  }
  throw new Error(`corruption catalog: no artifact of schema ${schemaId}`)
}

const SEQUENCE_GAP_INCIDENT = "inc-demo-payment-1"

/**
 * The six corruption classes from issue #22 plus the stale-schema class from
 * docs/build-handoff.md section 12, each surfacing its exact error code.
 */
export const CORRUPTION_CASES: readonly CorruptionCase[] = [
  {
    name: "corrupt-hash",
    expectedCode: "CHANGED_CONTENT",
    apply: (files) => {
      // Byte corruption without a manifest rewrite: the recorded hash is stale.
      const next = new Map(files)
      const journalPath = `incidents/${SEQUENCE_GAP_INCIDENT}/journal.jsonl`
      const bytes = next.get(journalPath)
      if (bytes === undefined) {
        throw new Error("corruption catalog: missing journal")
      }
      next.set(journalPath, `${bytes}TAMPERED`)
      return next
    },
  },
  {
    name: "missing-sequence",
    expectedCode: "BAD_SEQUENCE",
    apply: (files) => {
      const events = journalEventsOf(files, SEQUENCE_GAP_INCIDENT)
      const withGap = events.filter((event) => event.sequence !== 3)
      return rewriteJournal(files, SEQUENCE_GAP_INCIDENT, withGap)
    },
  },
  {
    name: "unknown-schema",
    expectedCode: "UNKNOWN_SCHEMA",
    apply: (files) => {
      const envelopePath = firstEnvelopePath(files, "incident-brief")
      const envelope = JSON.parse(files.get(envelopePath) ?? "") as ArtifactEnvelope
      return rewriteEnvelope(files, envelopePath, {
        ...envelope,
        artifact_schema_id: "mystery-artifact",
      }, false)
    },
  },
  {
    name: "stale-data",
    expectedCode: "STALE_DATA",
    apply: (files) => {
      const envelopePath = firstEnvelopePath(files, "evidence-set")
      const envelope = JSON.parse(files.get(envelopePath) ?? "") as ArtifactEnvelope
      const payload = envelope.payload as EvidenceSet
      const first = payload.items[0]
      if (first === undefined) {
        throw new Error("corruption catalog: evidence set has no items")
      }
      // Expired at the demo evaluation time (2026-08-16T12:00:00Z).
      const updatedPayload: EvidenceSet = {
        ...payload,
        items: [{ ...first, fresh_until: "2026-08-15T00:00:00Z" }, ...payload.items.slice(1)],
      }
      return rewriteEnvelope(files, envelopePath, { ...envelope, payload: updatedPayload }, true)
    },
  },
  {
    name: "redaction-failure",
    expectedCode: "REDACTION_FAILURE",
    apply: (files) => {
      const envelopePath = firstEnvelopePath(files, "evidence-set")
      const envelope = JSON.parse(files.get(envelopePath) ?? "") as ArtifactEnvelope
      const payload = envelope.payload as EvidenceSet
      const first = payload.items[0]
      if (first === undefined) {
        throw new Error("corruption catalog: evidence set has no items")
      }
      // Declare a masked field whose recorded value is not the literal mask.
      const redaction = first.redaction ?? { profile_id: "demo-profile", masked_fields: [] }
      const updatedItem = { ...first, redaction: { ...redaction, masked_fields: ["/backend"] } }
      const updatedPayload: EvidenceSet = { ...payload, items: [updatedItem, ...payload.items.slice(1)] }
      return rewriteEnvelope(files, envelopePath, { ...envelope, payload: updatedPayload }, true)
    },
  },
  {
    name: "missing-artifact",
    expectedCode: "MISSING_ARTIFACT",
    apply: (files) => {
      const events = journalEventsOf(files, SEQUENCE_GAP_INCIDENT)
      const sealed = events.find((event) => event.type === "artifact_sealed")
      if (sealed?.type !== "artifact_sealed") {
        throw new Error("corruption catalog: no sealed artifact")
      }
      const digest = sealed.artifact_ref.content_hash.slice("sha256:".length)
      const next = new Map(files)
      next.delete(`artifacts/sha256/${digest}.json`)
      return reManifest(next)
    },
  },
  {
    name: "stale-schema",
    expectedCode: "STALE_SCHEMA",
    apply: (files) => {
      const envelopePath = firstEnvelopePath(files, "incident-brief")
      const envelope = JSON.parse(files.get(envelopePath) ?? "") as ArtifactEnvelope
      return rewriteEnvelope(files, envelopePath, { ...envelope, artifact_schema_version: "0.9" }, false)
    },
  },
]

// ---------------------------------------------------------------------------
// Directory helpers for callers that work from disk copies.
// ---------------------------------------------------------------------------

/** Read a saved bundle directory into a path -> UTF-8 text map. */
export function readBundleFromDirectory(dir: string): FileMap {
  const root = dir.endsWith(path.sep) ? dir.slice(0, -1) : dir
  const files = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else {
        files.set(full.slice(root.length + 1), readFileSync(full, "utf8"))
      }
    }
  }
  walk(root)
  return files
}

/** Write an in-memory bundle to a directory, replacing it entirely. */
export function writeBundleToDirectory(dir: string, files: FileMap): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [filePath, bytes] of files) {
    const target = path.join(dir, filePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
}
