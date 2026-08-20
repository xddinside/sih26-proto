import { IconChevronDown } from "@tabler/icons-react"

import { abbreviate } from "../../../incidents/lib/format"
import type { ChangeReviewTab } from "../../lib/workspace-search"
import { workspaceHref } from "../../lib/workspace-search"
import type { IncidentNavigatorRow } from "../../lib/change-workspace-projection"
import { ReviewBadge } from "./review-primitives"
import { DownloadButton } from "./download-button"

export function incidentShortId(incidentId: string): string {
  return abbreviate(incidentId, 12)
}

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
  tab?: ChangeReviewTab
  record?: string
}) {
  return (
    <a
      href={workspaceHref(incidentId, { tab, record })}
      aria-current={current ? "page" : undefined}
      className="cr-incident-option"
    >
      <span className="cr-incident-option-head">
        <strong>{incidentShortId(incidentId)}</strong>
        <ReviewBadge tone={row.state === "closed" ? "success" : "warning"}>
          {row.state ?? "unrecorded"}
        </ReviewBadge>
      </span>
      <span>{row.signalName ?? "signal unrecorded"}</span>
      <small>{row.latestOutcome ?? "outcome unrecorded"}</small>
    </a>
  )
}

export function ApplicationHeader({
  incidentId,
  navigator,
  tab,
  record,
  exportData,
}: {
  incidentId: string
  navigator: IncidentNavigatorRow[]
  captureTime: string
  tab?: ChangeReviewTab
  record?: string
  exportData: unknown
}) {
  const policyActive = record === "policy"
  const auditActive = record === "audit:index" || record?.startsWith("audit:")
  return (
    <header className="cr-app-header">
      <a className="cr-skip-link" href="#workspace-main">
        Skip to incident
      </a>
      <a href="/" className="cr-brand">
        <span className="cr-brand-mark" aria-hidden="true">
          IR
        </span>
        <span>Incident Response</span>
      </a>
      <nav className="cr-primary-nav" aria-label="Primary">
        <a
          href="/"
          aria-current={!policyActive && !auditActive ? "page" : undefined}
        >
          Incidents
        </a>
        <a
          href={workspaceHref(incidentId, { tab, record: "policy" })}
          aria-current={policyActive ? "page" : undefined}
        >
          Policies
        </a>
        <a
          href={workspaceHref(incidentId, { tab, record: "audit:index" })}
          aria-current={auditActive ? "page" : undefined}
        >
          Audit
        </a>
      </nav>
      <div className="cr-header-actions">
        <ReviewBadge tone="info">
          <span className="cr-sr-only">Saved Demo Run. </span>Captured run
        </ReviewBadge>
        <details className="cr-incident-nav">
          <summary aria-label="Browse incidents">
            <span>
              <small>Incident</small>
              <strong>{incidentShortId(incidentId)}</strong>
            </span>
            <IconChevronDown size={15} stroke={1.75} aria-hidden="true" />
          </summary>
          <div className="cr-incident-menu">
            <div className="cr-incident-menu-head">
              <div>
                <p className="cr-eyebrow">Workspace</p>
                <h2>Incidents</h2>
              </div>
              <ReviewBadge>{navigator.length} saved</ReviewBadge>
            </div>
            <div className="cr-incident-options" aria-label="Saved incidents">
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
          </div>
        </details>
        <DownloadButton
          data={exportData}
          fileName={`${incidentId}-change-review.json`}
        />
      </div>
    </header>
  )
}
