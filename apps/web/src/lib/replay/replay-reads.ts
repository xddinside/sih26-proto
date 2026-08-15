/**
 * Typed read projections over a verified {@link ReplayStore}, for the pinned
 * Workspace routes `/`, `/incidents/:id`, and `/incidents/:id/artifacts/:hash`
 * from docs/build-handoff.md section 9.
 *
 * The read APIs are the demo-scope incident list, incident detail, and
 * authorized artifact envelope. Reads never mutate the store. The only
 * failures are ids or hashes outside the verified bundle, which return named
 * `MISSING_ARTIFACT` errors. There is deliberately no write, command, or
 * event-stream path here: saved-run controls cannot submit.
 */
import { integrityError } from "@sih/contracts/errors"
import type { IntegrityError } from "@sih/contracts/errors"
import { isHashString } from "@sih/contracts/hashes"
import type { RunRecord } from "@sih/contracts/journal"
import type {
  ArtifactEnvelope,
  ClosureReason,
  IncidentState,
  JournalEvent,
  JournalEventType,
} from "@sih/contracts/types"

import { replayErr, replayOk } from "./replay-result"
import type { ReplayResult } from "./replay-result"
import type { ReplayIncident, ReplayStore } from "./replay-store"

/** One row of the incident list projection. */
export interface IncidentSummary {
  /** Manifest Incident id. */
  incidentId: string
  /** Replayed Incident state, or null before the first transition. */
  state: IncidentState | null
  /** The recorded closure reason when the Incident closed. */
  closureReason: ClosureReason | undefined
  /** Replayed attempts used against the Attempt Limit. */
  attemptsUsed: number
  /** The manifest's expected final journal sequence. */
  finalSequence: number
  /** Number of Incident Runs in the journal. */
  runCount: number
  /** Number of artifacts sealed by this Incident's journal. */
  artifactCount: number
  /** The journal's last event type, or null for an empty journal. */
  latestEventType: JournalEventType | null
}

/** The incident detail projection. */
export interface IncidentDetail {
  /** Manifest Incident id. */
  incidentId: string
  /** Replayed Incident state, or null before the first transition. */
  state: IncidentState | null
  /** The recorded closure reason when the Incident closed. */
  closureReason: ClosureReason | undefined
  /** Replayed attempts used against the Attempt Limit. */
  attemptsUsed: number
  /** The manifest's expected final journal sequence. */
  finalSequence: number
  /** The ordered journal events, sequence 1 through `finalSequence`. */
  events: readonly JournalEvent[]
  /** The replayed Incident Runs with their stage records. */
  runs: readonly RunRecord[]
  /** Every artifact envelope this Incident's journal sealed, in journal order. */
  artifacts: readonly AuthorizedArtifact[]
}

/** An artifact envelope an Incident's journal is authorized to read. */
export interface AuthorizedArtifact {
  /** The envelope content hash, `sha256:` prefixed. */
  contentHash: string
  /** The bundle path, `artifacts/sha256/<sha256-hex>.json`. */
  path: string
  /** The verified envelope, belonging to the requested Incident. */
  envelope: ArtifactEnvelope
}

/** Project one verified Incident into a list row. */
function summaryOf(incident: ReplayIncident): IncidentSummary {
  const lastEvent = incident.events.at(-1)
  return {
    incidentId: incident.incidentId,
    state: incident.journalState.incidentState,
    closureReason: incident.journalState.closureReason,
    attemptsUsed: incident.journalState.attemptsUsed,
    finalSequence: incident.finalSequence,
    runCount: incident.journalState.runs.length,
    artifactCount: incident.artifactHashes.length,
    latestEventType: lastEvent?.type ?? null,
  }
}

/**
 * List every verified Incident in manifest order. The store is already fully
 * verified, so this read cannot fail.
 */
export function listIncidents(store: ReplayStore): readonly IncidentSummary[] {
  return store.incidents.map(summaryOf)
}

/**
 * Read the full detail projection for one verified Incident: its journal
 * events, replayed Runs, and sealed artifact envelopes in journal order.
 * Returns a named `MISSING_ARTIFACT` error for an id outside the bundle.
 */
export function getIncidentDetail(
  store: ReplayStore,
  incidentId: string,
): ReplayResult<IncidentDetail, IntegrityError[]> {
  const incident = store.incidents.find(
    (candidate) => candidate.incidentId === incidentId,
  )
  if (incident === undefined) {
    return replayErr([
      integrityError(
        "MISSING_ARTIFACT",
        `incident ${JSON.stringify(incidentId)} is not part of this saved bundle`,
        incidentId,
      ),
    ])
  }
  const artifacts: AuthorizedArtifact[] = []
  for (const hash of incident.artifactHashes) {
    const artifact = store.artifacts.get(hash)
    if (artifact === undefined) {
      return replayErr([
        integrityError(
          "MISSING_ARTIFACT",
          `artifact ${hash} sealed by the journal is absent from the bundle`,
          hash,
        ),
      ])
    }
    artifacts.push(artifact)
  }
  return replayOk({
    incidentId: incident.incidentId,
    state: incident.journalState.incidentState,
    closureReason: incident.journalState.closureReason,
    attemptsUsed: incident.journalState.attemptsUsed,
    finalSequence: incident.finalSequence,
    events: incident.events,
    runs: incident.journalState.runs,
    artifacts,
  })
}

/**
 * Read the authorized artifact envelope for one Incident.
 *
 * The envelope must be verified, part of the saved bundle, and sealed for the
 * requested Incident. An unknown hash, a malformed hash, and an artifact that
 * belongs to a different Incident all return the same named
 * `MISSING_ARTIFACT` denial; the caller learns nothing about artifacts outside
 * its Incident.
 */
export function getAuthorizedArtifact(
  store: ReplayStore,
  incidentId: string,
  contentHash: string,
): ReplayResult<AuthorizedArtifact, IntegrityError[]> {
  if (!isHashString(contentHash)) {
    return replayErr([
      integrityError(
        "MISSING_ARTIFACT",
        `artifact hash ${JSON.stringify(contentHash)} is not a well-formed sha256 hash`,
        contentHash,
      ),
    ])
  }
  const artifact = store.artifacts.get(contentHash)
  if (artifact === undefined) {
    return replayErr([
      integrityError(
        "MISSING_ARTIFACT",
        `artifact ${contentHash} is not part of this saved bundle`,
        contentHash,
      ),
    ])
  }
  if (artifact.envelope.incident_id !== incidentId) {
    return replayErr([
      integrityError(
        "MISSING_ARTIFACT",
        `artifact ${contentHash} is not part of incident ${JSON.stringify(incidentId)}`,
        contentHash,
        { incident_id: incidentId },
      ),
    ])
  }
  return replayOk(artifact)
}
