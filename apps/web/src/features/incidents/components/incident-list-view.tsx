/**
 * Incident list view: renders the two saved Demo Runs from the verified store,
 * each row bound to its saved sources and marked as a Saved Demo Run.
 */
import { Link } from "@tanstack/react-router"

import type { ListView } from "../lib/projections"
import { Citation, CitedValue } from "./citation"
import { SavedBadge, SeverityPill, StatePill } from "./badge"

function attemptLabel(used: number): string {
  return used === 1 ? "1 attempt used" : `${used} attempts used`
}

/** One incident row, rendered as a linked, keyboard-focusable card. */
function IncidentRow({ row }: { row: ListView["incidents"][number] }) {
  const outcomeTone =
    row.latestRun?.state === "failed" ? "negative" : row.latestRun?.state === "completed" ? "positive" : "neutral"
  return (
    <li>
      <Link
        to="/incidents/$id"
        params={{ id: row.incidentId }}
        className="block border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{row.incidentId}</span>
          {row.state !== null ? <StatePill tone={row.state === "closed" ? "neutral" : row.state === "resolved" ? "info" : "warning"}>{row.state}</StatePill> : <StatePill>state unrecorded</StatePill>}
          <SeverityPill severity={row.severity} />
        </div>

        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Scope</dt>
            <dd className="min-w-0 break-words">
              {row.serviceName !== null && row.environmentName !== null
                ? `${row.serviceName} · ${row.environmentName}`
                : "scope unrecorded"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Detector</dt>
            <dd className="min-w-0 break-words">
              {row.ruleId !== null ? (
                <>
                  {row.ruleId} <Citation source={{ kind: "journal", ref: "1" }} />
                </>
              ) : (
                "detector unrecorded"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Attempts</dt>
            <dd>
              <CitedValue value={attemptLabel(row.attemptsUsed)} source={row.attemptsSource} label="attempts used" />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Latest run</dt>
            <dd>
              {row.latestRun !== null ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <StatePill tone={outcomeTone}>
                    {row.latestRun.state}
                    {row.latestRun.outcome !== null ? ` · ${row.latestRun.outcome}` : ""}
                    {row.latestRun.failureReason !== null ? ` · ${row.latestRun.failureReason}` : ""}
                  </StatePill>
                  {row.latestRunSource !== null ? <Citation source={row.latestRunSource} /> : null}
                </span>
              ) : (
                "no run recorded"
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {row.firstTriggerAt !== null && row.firstTriggerSource !== null ? (
            <span>
              first trigger {row.firstTriggerAt} <Citation source={row.firstTriggerSource} />
            </span>
          ) : null}
          {row.lastActivityAt !== null && row.lastActivitySource !== null ? (
            <span>
              last activity {row.lastActivityAt} <Citation source={row.lastActivitySource} />
            </span>
          ) : null}
          <span>
            final journal sequence <Citation source={row.finalSequenceSource} />
          </span>
        </div>
      </Link>
    </li>
  )
}

export function IncidentListView({ view }: { view: ListView }) {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="font-heading text-xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evidence-led incident response with deterministic gates; everything shown is saved
          evidence, nothing runs live.
        </p>
        <p className="mt-3">
          <SavedBadge captureTime={view.meta.captureTime} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          bundle format {view.meta.formatVersion} · {view.incidents.length}{" "}
          {view.incidents.length === 1 ? "incident" : "incidents"} · evaluation time is the bundle
          capture time, never the live clock
        </p>
      </header>

      {view.incidents.length === 0 ? (
        <p className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground" role="status">
          No Incidents in this saved bundle.
        </p>
      ) : (
        <ul className="space-y-4" aria-label="Saved incidents">
          {view.incidents.map((row) => (
            <IncidentRow key={row.incidentId} row={row} />
          ))}
        </ul>
      )}
    </main>
  )
}
