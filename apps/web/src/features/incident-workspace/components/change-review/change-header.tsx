/**
 * The Change header: breadcrumb, the change state and severity pills, the
 * recorded change description, the source-host record entry point, and the
 * run context strip. All values replay the verified bundle; the source-host
 * row shows exactly what the bundle records (see the Source-host record).
 */
import { SeverityPill, StatePill } from "../../../incidents/components/badge"
import { sourceLabel } from "../../../incidents/lib/format"
import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { ChangeStatePill, RecordAnchor, RunMetaStrip, shortRef } from "./review-primitives"
import { incidentShortId } from "./application-header"

export function ChangeHeader({ view }: { view: ChangeWorkspaceView }) {
  const change = view.change
  const sourceHost = view.records["source-host"]
  const sourceHostStatus = sourceHost.status ?? "Not recorded"
  return (
    <section aria-label="Change summary header">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <a href="/" className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Incidents
        </a>
        <span aria-hidden="true"> / </span>
        <span className="font-mono">{incidentShortId(view.incident.incidentId)}</span>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">Change Review</span>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {change !== null ? <ChangeStatePill state={change.state} /> : <StatePill tone="neutral">change state unrecorded</StatePill>}
        <SeverityPill severity={view.incident.severity} />
        <span className="font-mono text-xs text-muted-foreground" title={change?.candidateHash ?? undefined}>
          candidate {shortRef(change?.candidateHash ?? null)}
        </span>
      </div>

      <h1 className="mt-3 font-heading text-2xl font-semibold leading-snug">
        {change?.description ?? "No Remediation recorded for this run"}
      </h1>

      <p className="mt-2 text-sm text-muted-foreground">
        {change !== null && change.artifactSource !== null ? (
          <>
            recorded diff{" "}
            <span className="font-mono text-[11px]" title={change.artifactSource.ref}>
              {sourceLabel(change.artifactSource)}
            </span>
          </>
        ) : (
          "no recorded diff for this run"
        )}
        {" · "}
        <RecordAnchor incidentId={view.incident.incidentId} recordId="source-host" tab="summary">
          Inspect source-host record
        </RecordAnchor>
        <span className="ml-1 text-xs text-muted-foreground">({sourceHostStatus.toLowerCase()})</span>
      </p>

      <div className="mt-3 border-y border-border py-2">
        <RunMetaStrip run={view.run} incident={{ service: view.incident.service, environment: view.incident.environment }} />
        <p className="mt-1 text-xs text-muted-foreground" title={view.run.bindingReason}>
          run <strong className="font-mono">{view.run.runId}</strong> · {view.run.state}
          {view.run.outcome !== null ? ` · ${view.run.outcome}` : ""}
          {view.run.failureReason !== null ? ` · failed: ${view.run.failureReason}` : ""} · {view.run.bindingReason}
        </p>
      </div>
    </section>
  )
}