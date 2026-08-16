import { createFileRoute } from "@tanstack/react-router"

import { ArtifactEnvelopeView } from "../features/incidents/components/artifact-envelope-view"
import { ErrorState, LoadingState } from "../features/incidents/components/states"
import { fetchIncidentArtifact } from "../features/incidents/server/replay-server"

export const Route = createFileRoute("/incidents/$id_/artifacts/$hash")({
  loader: ({ params }) =>
    fetchIncidentArtifact({
      data: { incidentId: params.id, contentHash: `sha256:${params.hash}` },
    }),
  pendingComponent: () => (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <LoadingState label="Verifying artifact envelope…" />
    </main>
  ),
  component: ArtifactRoute,
})

function ArtifactRoute() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <ErrorState state={result.state} copy={result.copy} errors={result.errors} />
  }
  return <ArtifactEnvelopeView view={result.view} incidentId={result.view.incidentId} />
}
