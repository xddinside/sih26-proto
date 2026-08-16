import { createFileRoute } from "@tanstack/react-router"

import { IncidentListView } from "../features/incidents/components/incident-list-view"
import { fetchIncidentList } from "../features/incidents/server/replay-server"
import { ErrorState, LoadingState } from "../features/incidents/components/states"

export const Route = createFileRoute("/")({
  loader: () => fetchIncidentList(),
  pendingComponent: () => (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <LoadingState label="Replaying saved bundle — verifying journal and sealed artifacts…" />
    </main>
  ),
  component: IncidentListRoute,
})

function IncidentListRoute() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <ErrorState state={result.state} copy={result.copy} errors={result.errors} />
  }
  return <IncidentListView view={result.view} />
}
