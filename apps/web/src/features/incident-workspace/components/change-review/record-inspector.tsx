import { useEffect, useRef } from "react"
import { IconArrowUpRight, IconCode, IconX } from "@tabler/icons-react"

import type { ChangeReviewTab } from "../../lib/workspace-search"
import { workspaceHref } from "../../lib/workspace-search"
import type {
  ChangeWorkspaceView,
  InspectorRecord,
} from "../../lib/change-workspace-projection"
import { RecordAnchor, ReviewBadge } from "./review-primitives"
import { CopyButton } from "./copy-button"

function tone(
  record: InspectorRecord
): "neutral" | "success" | "danger" | "warning" | "info" {
  if (record.statusTone === "positive") return "success"
  if (record.statusTone === "negative") return "danger"
  return record.statusTone ?? "neutral"
}

export function RecordInspectorPanel({
  view,
  record,
  tab,
}: {
  view: ChangeWorkspaceView
  record: InspectorRecord
  tab: ChangeReviewTab
}) {
  return (
    <aside aria-label="Selected record" className="cr-inspector">
      <div className="cr-inspector-content">
        <div className="cr-inspector-record">
          <div className="cr-inspector-heading">
            <div>
              <p className="cr-eyebrow">Selected record</p>
              <h2>{record.title}</h2>
            </div>
            {record.status ? (
              <ReviewBadge tone={tone(record)}>{record.status}</ReviewBadge>
            ) : null}
          </div>
          <p className="cr-inspector-kind">{record.kind}</p>
          <p className="cr-inspector-summary">{record.summary}</p>
          <RecordAnchor
            incidentId={view.incident.incidentId}
            recordId={record.id}
            tab={tab}
            className="cr-button cr-button-ghost cr-inspector-open"
          >
            View details
            <IconArrowUpRight aria-hidden="true" />
          </RecordAnchor>
        </div>
      </div>
    </aside>
  )
}

function navigateToCloseHref(closeHref: string) {
  window.location.assign(closeHref)
}

export function RecordDialog({
  view,
  record,
  tab,
}: {
  view: ChangeWorkspaceView
  record: InspectorRecord
  tab: ChangeReviewTab
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = `record-dialog-title-${record.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const closeHref = workspaceHref(view.incident.incidentId, { tab })
  const usefulReference =
    record.reference !== null && !record.reference.startsWith("sha256:")

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    // The open attribute makes the record available in the server-rendered
    // page. Re-open it with showModal after hydration for native focus trapping.
    dialog.removeAttribute("open")
    dialog.showModal()

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <div
      className="cr-record-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          navigateToCloseHref(closeHref)
        }
      }}
    >
      <dialog
        ref={dialogRef}
        open
        aria-labelledby={titleId}
        className="cr-record-dialog"
        onCancel={(event) => {
          event.preventDefault()
          navigateToCloseHref(closeHref)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            navigateToCloseHref(closeHref)
          }
        }}
      >
        <div className="cr-record-dialog-frame">
          <header className="cr-record-dialog-header">
            <div>
              <p className="cr-eyebrow">{record.kind}</p>
              <h2 id={titleId}>{record.title}</h2>
            </div>
            <a
              href={closeHref}
              className="cr-dialog-close"
              aria-label="Close details"
              onClick={() => dialogRef.current?.close()}
            >
              <IconX aria-hidden="true" />
            </a>
          </header>

          <div className="cr-record-dialog-body">
            <div className="cr-record-dialog-lead">
              {record.status ? (
                <ReviewBadge tone={tone(record)}>{record.status}</ReviewBadge>
              ) : null}
              <p>{record.summary}</p>
            </div>

            {record.facts.length > 0 ? (
              <dl className="cr-definition-list">
                {record.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {fact.value.startsWith("https://") ? (
                        <a href={fact.value} target="_blank" rel="noreferrer">
                          Open pull request
                        </a>
                      ) : (
                        fact.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {record.related.length > 0 ? (
              <div className="cr-related">
                <span>Related</span>
                {record.related.map((related) => (
                  <RecordAnchor
                    key={related.recordId}
                    incidentId={view.incident.incidentId}
                    recordId={related.recordId}
                    tab={tab}
                  >
                    {related.label}
                  </RecordAnchor>
                ))}
              </div>
            ) : null}

            <div className="cr-inspector-actions">
              {usefulReference ? (
                <CopyButton
                  value={record.reference ?? ""}
                  label={
                    record.reference?.startsWith("https://")
                      ? "Copy PR link"
                      : "Copy reference"
                  }
                />
              ) : null}
              {record.raw ? (
                <details>
                  <summary className="cr-button cr-button-ghost">
                    <IconCode aria-hidden="true" />
                    Show raw record
                  </summary>
                  <pre className="cr-detail-code">
                    <code>{JSON.stringify(record.raw, null, 2)}</code>
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  )
}
