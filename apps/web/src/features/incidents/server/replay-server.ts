/**
 * Read-only server functions for the pinned Workspace routes
 * (`/`, `/incidents/:id`, `/incidents/:id/artifacts/:hash`).
 *
 * These are the demo-scope read APIs from docs/build-handoff.md section 9
 * backed by the static saved bundle. Each returns a plain, JSON-serializable
 * result so the result can cross the server/client boundary. There is
 * deliberately no write, command, or event-stream function here: saved-run
 * controls cannot submit by construction.
 */
import { createServerFn } from "@tanstack/react-start"

import { DEMO_EVALUATION_TIME } from "../constants"
import { loadDemoStore } from "../lib/load-store"
import { artifactView, detailView, listView } from "../lib/projections"
import type { ArtifactView, DetailView, ListView } from "../lib/projections"
import { mapReplayFailures } from "../lib/store-status"
import type { IntegrityState, IntegrityStateCopy, MappedError } from "../lib/store-status"

/** A failed read, carrying the mapped integrity state for rendering. */
export interface ReadFailure {
  ok: false
  state: IntegrityState
  copy: IntegrityStateCopy
  errors: MappedError[]
}

/** A failed read with no view; rendered as the mapped state page. */
function toFailure(errors: readonly { code?: string; kind?: string; message: string; path?: string }[]): ReadFailure {
  const mapped = mapReplayFailures(errors)
  return { ok: false, state: mapped.state, copy: mapped.copy, errors: mapped.errors }
}

export type ListResult = { ok: true; view: ListView } | ReadFailure
export type DetailResult = { ok: true; view: DetailView } | ReadFailure
export type ArtifactResult = { ok: true; view: ArtifactView } | ReadFailure

const incidentIdInput = (input: unknown): { incidentId: string } => {
  if (
    typeof input === "object" &&
    input !== null &&
    "incidentId" in input &&
    typeof input.incidentId === "string"
  ) {
    return { incidentId: input.incidentId }
  }
  return { incidentId: "" }
}

const artifactInput = (input: unknown): { incidentId: string; contentHash: string } => {
  const value = incidentIdInput(input)
  const contentHash =
    typeof input === "object" &&
    input !== null &&
    "contentHash" in input &&
    typeof input.contentHash === "string"
      ? input.contentHash
      : ""
  return { incidentId: value.incidentId, contentHash }
}

/** Read the incident list from the verified saved bundle. */
export const fetchIncidentList = createServerFn({ method: "GET" }).handler(
  async (): Promise<ListResult> => {
    const store = await loadDemoStore()
    if (!store.ok) {
      return toFailure(store.error)
    }
    return { ok: true, view: listView(store.value) }
  },
)

/** Read one incident's journal-driven detail projection. */
export const fetchIncidentDetail = createServerFn({ method: "GET" })
  .validator(incidentIdInput)
  .handler(async ({ data }): Promise<DetailResult> => {
    const store = await loadDemoStore()
    if (!store.ok) {
      return toFailure(store.error)
    }
    const view = detailView(store.value, data.incidentId, DEMO_EVALUATION_TIME)
    if (view === null) {
      return toFailure([
        {
          code: "MISSING_ARTIFACT",
          message: `incident ${JSON.stringify(data.incidentId)} is not part of this saved bundle`,
          path: data.incidentId,
        },
      ])
    }
    return { ok: true, view }
  })

/** Read the authorized, redacted artifact envelope for one incident. */
export const fetchIncidentArtifact = createServerFn({ method: "GET", strict: { output: false } })
  .validator(artifactInput)
  .handler(async ({ data }): Promise<ArtifactResult> => {
    const store = await loadDemoStore()
    if (!store.ok) {
      return toFailure(store.error)
    }
    const view = artifactView(store.value, data.incidentId, data.contentHash)
    if (view === null) {
      return toFailure([
        {
          code: "MISSING_ARTIFACT",
          message: `artifact ${JSON.stringify(data.contentHash)} is not part of incident ${JSON.stringify(data.incidentId)}`,
          path: data.contentHash,
        },
      ])
    }
    return { ok: true, view }
  })
