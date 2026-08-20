/**
 * Read-only server functions for the Incident Workspace panels.
 *
 * These are the workspace feature's read endpoints over the richer saved-run
 * bundle in `demo/fixtures/runs/`, backed by the same replay verification as
 * the #21 read APIs. Each returns a plain, JSON-serializable result. There is
 * deliberately no write, command, or event-stream function here: saved-run
 * controls cannot submit by construction.
 */
import { createServerFn } from "@tanstack/react-start"

import { DEMO_EVALUATION_TIME } from "../../incidents/constants"
import { mapReplayFailures } from "../../incidents/lib/store-status"
import type {
  IntegrityState,
  IntegrityStateCopy,
  MappedError,
} from "../../incidents/lib/store-status"
import { loadWorkspaceStore } from "../lib/workspace-loader"
import { changeWorkspaceView } from "../lib/change-workspace-projection"
import type { ChangeWorkspaceView } from "../lib/change-workspace-projection"
import { workspaceView } from "../lib/workspace-projection"
import type { WorkspaceView } from "../lib/workspace-projection"

/** A failed read, carrying the mapped integrity state for rendering. */
export interface WorkspaceReadFailure {
  ok: false
  state: IntegrityState
  copy: IntegrityStateCopy
  errors: MappedError[]
}

export type WorkspaceDetailResult =
  | { ok: true; view: WorkspaceView; changeView: ChangeWorkspaceView | null }
  | WorkspaceReadFailure

const workspaceDetailCache = new Map<string, Promise<WorkspaceDetailResult>>()

function toFailure(
  errors: readonly {
    code?: string
    kind?: string
    message: string
    path?: string
  }[]
): WorkspaceReadFailure {
  const mapped = mapReplayFailures(errors)
  return {
    ok: false,
    state: mapped.state,
    copy: mapped.copy,
    errors: mapped.errors,
  }
}

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

/**
 * Read the full workspace projection for one saved Incident: every panel
 * 1–12 plus the read-only policy, audit tail, and telemetry deep links.
 */
async function projectWorkspaceDetail(
  incidentId: string
): Promise<WorkspaceDetailResult> {
  const cached = workspaceDetailCache.get(incidentId)
  if (cached !== undefined) {
    return cached
  }

  const result = (async (): Promise<WorkspaceDetailResult> => {
    const store = await loadWorkspaceStore()
    if (!store.ok) {
      return toFailure(store.error)
    }
    const view = workspaceView(store.value, incidentId, DEMO_EVALUATION_TIME)
    if (view === null) {
      return toFailure([
        {
          code: "MISSING_ARTIFACT",
          message: `incident ${JSON.stringify(incidentId)} is not part of this saved-run bundle`,
          path: incidentId,
        },
      ])
    }
    const changeView = changeWorkspaceView(
      store.value,
      incidentId,
      DEMO_EVALUATION_TIME
    )
    return { ok: true, view, changeView }
  })()

  workspaceDetailCache.set(incidentId, result)
  const resolved = await result
  if (!resolved.ok && workspaceDetailCache.get(incidentId) === result) {
    workspaceDetailCache.delete(incidentId)
  }
  return resolved
}

export const fetchWorkspaceDetail = createServerFn({ method: "GET" })
  .validator(incidentIdInput)
  .handler(({ data }): Promise<WorkspaceDetailResult> =>
    projectWorkspaceDetail(data.incidentId)
  )
