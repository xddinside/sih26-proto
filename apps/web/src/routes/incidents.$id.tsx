import { createFileRoute } from "@tanstack/react-router"

import { ErrorState, LoadingState } from "../features/incidents/components/states"
import { IncidentWorkspaceView } from "../features/incident-workspace/components/incident-workspace-view"
import { fetchWorkspaceDetail } from "../features/incident-workspace/server/workspace-server"

export const Route = createFileRoute("/incidents/$id")({
  loader: ({ params }) => fetchWorkspaceDetail({ data: { incidentId: params.id } }),
  pendingComponent: () => (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <LoadingState label="Replaying journal entries and sealing artifacts…" />
    </main>
  ),
  component: IncidentDetailRoute,
})

function IncidentDetailRoute() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <ErrorState state={result.state} copy={result.copy} errors={result.errors} />
  }
  return <IncidentWorkspaceView view={result.view} />
}
