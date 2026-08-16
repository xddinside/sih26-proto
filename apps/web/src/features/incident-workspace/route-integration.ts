/**
 * Route integration surface for the Incident Workspace panels.
 *
 * This module is the single import point a route needs to mount the
 * workspace: the server read function, its result type, and the view
 * component. The parent route wiring is a two-line change in
 * `apps/web/src/routes/incidents.$id.tsx` (see docs/research/
 * incident-workspace.md for the canonical section order this view renders).
 */
export { fetchWorkspaceDetail } from "./server/workspace-server"
export type { WorkspaceDetailResult } from "./server/workspace-server"
export { IncidentWorkspaceView } from "./components/incident-workspace-view"
export { workspaceView } from "./lib/workspace-projection"
export type { WorkspaceView } from "./lib/workspace-projection"
export { loadWorkspaceStore, resolveWorkspaceBundleDir } from "./lib/workspace-loader"
