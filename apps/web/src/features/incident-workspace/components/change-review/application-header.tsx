/**
 * The application header for the Change Review: brand, primary nav, the
 * saved-run badge, and the saved Incident selector. Every navigation target
 * is a plain anchor; the selector is a `<details>` menu with one anchor per
 * saved Incident from the verified bundle.
 */
import { SavedBadge, StatePill } from "../../../incidents/components/badge"
import { abbreviate } from "../../../incidents/lib/format"
import { workspaceHref } from "../../lib/workspace-search"
import type { IncidentNavigatorRow } from "../../lib/change-workspace-projection"

function incidentStateTone(state: string | null) {
  switch (state) {
    case "closed":
      return "positive" as const
    case "open":
      return "warning" as const
    default:
      return "neutral" as const
  }
}

/** The current Incident's label for the selector summary. */
export function incidentShortId(incidentId: string): string {
  return abbreviate(incidentId, 12)
}

/** One saved Incident row in the selector menu. */
function IncidentOption({
  incidentId,
  current,
  row,
  tab,
  record,
}: {
  incidentId: string
  current: boolean
  row: IncidentNavigatorRow
  tab?: "summary" | "files"
  record?: string
}) {
  return (
    <a
      href={workspaceHref(incidentId, { tab, record })}
      aria-current={current ? "page" : undefined}
      className="block border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex items-center justify-between gap-2">
        <strong className="font-mono text-xs">{incidentShortId(incidentId)}</strong>
        <StatePill tone={incidentStateTone(row.state)}>{row.state ?? "state unrecorded"}</StatePill>
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {row.signalName ?? "signal unrecorded"}
        {row.latestOutcome !== null ? ` · ${row.latestOutcome}` : ""}
      </span>
    </a>
  )
}

export function ApplicationHeader({
  incidentId,
  navigator,
  captureTime,
  tab,
  record,
}: {
  incidentId: string
  navigator: IncidentNavigatorRow[]
  captureTime: string
  tab?: "summary" | "files"
  record?: string
}) {
  const current = navigator.find((row) => row.incidentId === incidentId)
  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-wide hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="flex h-7 w-7 items-center justify-center border border-primary/40 bg-primary/5 text-xs font-bold text-primary" aria-hidden="true">
            IR
          </span>
          Incident Response
        </a>
        <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
          <a href="/" aria-current="page" className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Incidents
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SavedBadge captureTime={captureTime} />
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-none border border-border px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
              <span className="flex flex-col leading-tight">
                <small className="text-[10px] uppercase tracking-wide text-muted-foreground">Incident</small>
                <strong className="font-mono text-xs">{incidentShortId(incidentId)}</strong>
              </span>
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-72 border border-border bg-card shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saved Incidents</p>
                <p className="text-xs text-muted-foreground">{navigator.length} in this bundle</p>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {navigator.map((row) => (
                  <IncidentOption
                    key={row.incidentId}
                    incidentId={row.incidentId}
                    current={row.incidentId === incidentId}
                    row={row}
                    tab={tab}
                    record={record}
                  />
                ))}
              </div>
              {current === undefined ? (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  {incidentId} is not part of this saved bundle.
                </p>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}