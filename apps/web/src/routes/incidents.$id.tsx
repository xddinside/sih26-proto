import { createFileRoute } from "@tanstack/react-router"

import {
  ErrorState,
  LoadingState,
} from "../features/incidents/components/states"
import {
  ChangeReviewGap,
  ChangeReviewView,
} from "../features/incident-workspace/components/change-review/change-review-view"
import { FastWorkspaceNavigation } from "../features/incident-workspace/components/change-review/fast-workspace-navigation"
import { IncidentWorkspaceView } from "../features/incident-workspace/components/incident-workspace-view"
import { parseWorkspaceSearch } from "../features/incident-workspace/lib/workspace-search"
import { fetchWorkspaceDetail } from "../features/incident-workspace/server/workspace-server"

export const Route = createFileRoute("/incidents/$id")({
  validateSearch: parseWorkspaceSearch,
  // `tab` and `record` only select already-projected client data. The cache
  // key is the Incident path, and its immutable replay stays fresh forever.
  loaderDeps: () => ({}),
  loader: ({ params }) =>
    fetchWorkspaceDetail({ data: { incidentId: params.id } }),
  staleTime: Infinity,
  preloadStaleTime: Infinity,
  gcTime: Infinity,
  pendingComponent: () => (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <LoadingState label="Replaying journal entries and sealing artifacts…" />
    </main>
  ),
  component: IncidentDetailRoute,
})

function IncidentDetailRoute() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  if (!result.ok) {
    return (
      <ErrorState
        state={result.state}
        copy={result.copy}
        errors={result.errors}
      />
    )
  }
  const view = search.view ?? "review"
  const tab = search.tab ?? "summary"
  const record = search.record ?? ""
  if (view === "full") {
    return (
      <>
        <FastWorkspaceNavigation />
        <IncidentWorkspaceView view={result.view} />
      </>
    )
  }
  if (result.changeView === null) {
    return (
      <ChangeReviewGap
        incidentId={result.view.detail.incidentId}
        reason="The saved bundle could not bind this Incident to a run."
      />
    )
  }
  return (
    <>
      <FastWorkspaceNavigation />
      <ChangeReviewView view={result.changeView} tab={tab} record={record} />
    </>
  )
}
