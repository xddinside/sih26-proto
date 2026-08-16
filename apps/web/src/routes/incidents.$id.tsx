import { createFileRoute } from "@tanstack/react-router"

import { IncidentDetailView } from "../features/incidents/components/incident-detail-view"
import { ErrorState, LoadingState } from "../features/incidents/components/states"
import { fetchIncidentDetail } from "../features/incidents/server/replay-server"

export const Route = createFileRoute("/incidents/$id")({
  loader: ({ params }) => fetchIncidentDetail({ data: { incidentId: params.id } }),
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
  return <IncidentDetailView view={result.view} />
}
