/**
 * Static saved-bundle replay store, from docs/build-handoff.md section 15.2.
 *
 * `loadReplayStore` runs the full integrity verification from
 * `@sih/contracts` over an in-memory bundle — manifest file hashes and UTF-8
 * sizes, journal sequence and transitions, schema name and version, redaction
 * metadata, freshness at the explicit evaluation time, and every journal
 * artifact and receipt reference — then projects the verified data into a
 * typed, read-only store for later Workspace routes.
 *
 * The verifier never repairs data: any integrity failure returns every named
 * error and no store. The adapter exposes no write, command, or mutation
 * path, so saved-run controls cannot submit by construction.
 */
import { integrityError } from "@sih/contracts/errors"
import type { IntegrityError } from "@sih/contracts/errors"
import { reduceJournalEvents } from "@sih/contracts/journal"
import type { JournalState } from "@sih/contracts/journal"
import { verifySavedBundle } from "@sih/contracts/saved-bundle"
import type {
  ArtifactEnvelope,
  JournalEvent,
  SavedBundleManifest,
} from "@sih/contracts/types"

import type { ReplayOptions, SavedFileMap } from "./replay-files"
import { replayErr, replayOk } from "./replay-result"
import type { ReplayResult } from "./replay-result"

const SHA256_PREFIX = "sha256:"

/** One verified Incident projection from the saved bundle. */
export interface ReplayIncident {
  /** Manifest Incident id, for example `inc-demo-payment-1`. */
  incidentId: string
  /** The manifest's expected final journal sequence. */
  finalSequence: number
  /** The ordered journal events, sequence 1 through `finalSequence`. */
  events: readonly JournalEvent[]
  /** The replayed aggregate state: Incident, Runs, and stage records. */
  journalState: JournalState
  /** Content hashes sealed by this Incident's journal, in first-seen order. */
  artifactHashes: readonly string[]
}

/** One content-addressed artifact envelope with its bundle path. */
export interface ReplayArtifact {
  /** The envelope content hash, `sha256:` prefixed. */
  contentHash: string
  /** The bundle path, `artifacts/sha256/<sha256-hex>.json`. */
  path: string
  /** The verified envelope. */
  envelope: ArtifactEnvelope
}

/** A fully verified saved bundle, projected for read-only replay. */
export interface ReplayStore {
  /** The verified manifest. */
  manifest: SavedBundleManifest
  /** Verified Incidents in manifest order. */
  incidents: readonly ReplayIncident[]
  /** Every verified artifact envelope, keyed by content hash. */
  artifacts: ReadonlyMap<string, ReplayArtifact>
}

/** The bundle path for a `sha256:` content hash. */
function artifactPath(contentHash: string): string {
  return `artifacts/sha256/${contentHash.slice(SHA256_PREFIX.length)}.json`
}

/**
 * Load and fully verify a saved bundle, returning the read-only replay store.
 *
 * Every check from `verifySavedBundle` runs first. On failure the returned
 * error array carries every named integrity error; the bundle is never
 * repaired, reordered, or completed. On success the verified manifest,
 * Incidents, and artifact envelopes are projected into the store, and each
 * journal is replayed once more into its aggregate state.
 *
 * @param files the in-memory bundle: POSIX relative path to exact UTF-8 text
 * @param options the explicit freshness evaluation time
 */
export function loadReplayStore(
  files: SavedFileMap,
  options: ReplayOptions,
): ReplayResult<ReplayStore, IntegrityError[]> {
  const verified = verifySavedBundle({ files }, options)
  if (!verified.ok) {
    return replayErr(verified.error)
  }
  const { manifest, incidents, artifacts } = verified.value

  const replayIncidents: ReplayIncident[] = []
  for (const incident of incidents) {
    const reduced = reduceJournalEvents(incident.events)
    if (!reduced.ok) {
      return replayErr([
        integrityError(
          reduced.error.code,
          `verified journal failed replay: ${reduced.error.message}`,
          reduced.error.path,
          reduced.error.details,
        ),
      ])
    }
    const seen = new Set<string>()
    const artifactHashes: string[] = []
    for (const event of incident.events) {
      const hash =
        event.type === "artifact_sealed"
          ? event.artifact_ref.content_hash
          : event.type === "stage_transition" && event.artifact_ref !== undefined
            ? event.artifact_ref.content_hash
            : null
      if (hash !== null && !seen.has(hash)) {
        seen.add(hash)
        artifactHashes.push(hash)
      }
    }
    replayIncidents.push({
      incidentId: incident.incidentId,
      finalSequence: incident.finalSequence,
      events: incident.events,
      journalState: reduced.value,
      artifactHashes,
    })
  }

  const replayArtifacts = new Map<string, ReplayArtifact>()
  for (const [contentHash, envelope] of artifacts) {
    replayArtifacts.set(contentHash, {
      contentHash,
      path: artifactPath(contentHash),
      envelope,
    })
  }

  return replayOk({
    manifest,
    incidents: replayIncidents,
    artifacts: replayArtifacts,
  })
}
