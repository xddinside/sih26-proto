import { IconChevronRight } from "@tabler/icons-react"

import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { workspaceHref } from "../../lib/workspace-search"
import { incidentShortId } from "./application-header"
import { ReviewBadge } from "./review-primitives"
import { CopyButton } from "./copy-button"

function durationLabel(seconds: number | null) {
  if (seconds === null) return "duration unrecorded"
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function severityLabel(severity: string | null): string {
  if (severity === "critical") return "SEV-1"
  if (severity === "high") return "SEV-2"
  if (severity === "medium") return "SEV-3"
  return severity ?? "severity unrecorded"
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

export function ChangeHeader({ view }: { view: ChangeWorkspaceView }) {
  const change = view.change
  const sourceHost = view.sourceHost
  const status = sourceHost?.state ?? change?.state ?? "Not prepared"
  return (
    <>
      <nav aria-label="Breadcrumb" className="cr-breadcrumb">
        <a href="/">Incidents</a>
        <IconChevronRight aria-hidden="true" />
        <span>{incidentShortId(view.incident.incidentId)}</span>
        <IconChevronRight aria-hidden="true" />
        <strong>Remediation</strong>
        <span className="cr-sr-only">Change Review</span>
      </nav>

      <section className="cr-change-header" aria-label="Change summary header">
        <div>
          <div className="cr-badges">
            <ReviewBadge
              tone={
                status === "Blocked" || status === "open" ? "danger" : "success"
              }
            >
              {status}
            </ReviewBadge>
            <span className="cr-sr-only">
              change {change?.state ?? "Not prepared"}
            </span>
            <ReviewBadge tone="danger">
              {severityLabel(view.incident.severity)}
            </ReviewBadge>
            {sourceHost ? (
              <span className="cr-change-number">
                #{sourceHost.pullRequestNumber}
              </span>
            ) : null}
          </div>
          <h1>
            {sentenceCase(
              change?.citationChange ??
                sourceHost?.title ??
                change?.description ??
                "No remediation recorded for this run"
            )}
          </h1>
          <p>
            {sourceHost
              ? `${sourceHost.repository} · ${sourceHost.branch}`
              : `${view.incident.service ?? "service unrecorded"} · ${view.incident.environment ?? "environment unrecorded"}`}
          </p>
        </div>
        <div className="cr-change-actions">
          {sourceHost ? (
            <CopyButton
              value={sourceHost.pullRequestUrl}
              label="Copy PR link"
            />
          ) : null}
          <a
            className="cr-button cr-button-primary"
            href={workspaceHref(view.incident.incidentId, {
              tab: "summary",
              record: sourceHost ? "source-host" : "remediation",
            })}
          >
            {sourceHost ? "Inspect PR record" : "Inspect remediation"}
          </a>
        </div>
      </section>

      <div className="cr-run-meta" aria-label="Run context">
        <span>
          <strong>{view.incident.environment ?? "unrecorded"}</strong>{" "}
          environment
        </span>
        <span>{view.incident.service ?? "service unrecorded"}</span>
        <span>Attempt {view.run.attempt}</span>
        <span>{durationLabel(view.run.durationSeconds)}</span>
      </div>
    </>
  )
}
