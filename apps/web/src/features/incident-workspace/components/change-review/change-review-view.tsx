import type { ChangeReviewTab } from "../../lib/workspace-search"
import { resolveRecordId, workspaceHref } from "../../lib/workspace-search"
import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { ApplicationHeader } from "./application-header"
import { ChangeHeader } from "./change-header"
import { ChecksTab } from "./checks-tab"
import { FilesTab } from "./files-tab"
import { RecordDialog, RecordInspectorPanel } from "./record-inspector"
import { ReleaseTab } from "./release-tab"
import { SummaryTab } from "./summary-tab"
import "./change-review.css"

function TabBar({
  view,
  activeTab,
  record,
}: {
  view: ChangeWorkspaceView
  activeTab: ChangeReviewTab
  record: string
}) {
  const tabs: { id: ChangeReviewTab; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" },
    {
      id: "files",
      label: "Files changed",
      count: view.diff.state === "parsed" ? view.diff.files.length : 0,
    },
    {
      id: "checks",
      label: "Checks",
      count: view.sourceHost?.checksTotal ?? view.checks.length,
    },
    { id: "release", label: "Release" },
  ]
  return (
    <div role="tablist" aria-label="Change records" className="cr-tabs">
      {tabs.map((item) => (
        <a
          key={item.id}
          role="tab"
          href={workspaceHref(view.incident.incidentId, {
            tab: item.id,
            record,
          })}
          aria-selected={item.id === activeTab}
          className={item.id === activeTab ? "active" : undefined}
        >
          {item.label}
          {item.count !== undefined ? <span>{item.count}</span> : null}
        </a>
      ))}
    </div>
  )
}

function ActiveTab({
  view,
  tab,
  selectedFileId,
}: {
  view: ChangeWorkspaceView
  tab: ChangeReviewTab
  selectedFileId: string | null
}) {
  if (tab === "summary") return <SummaryTab view={view} />
  if (tab === "files")
    return <FilesTab view={view} selectedFileId={selectedFileId} />
  if (tab === "checks") return <ChecksTab view={view} />
  return <ReleaseTab view={view} />
}

export function ChangeReviewView({
  view,
  tab,
  record,
}: {
  view: ChangeWorkspaceView
  tab: ChangeReviewTab
  record: string
}) {
  const activeRecord = record !== "" && record in view.records ? record : ""
  const selectedRecord = resolveRecordId(
    new Set(Object.keys(view.records)),
    activeRecord,
    view.defaultRecordId
  )
  const selectedFileId =
    tab === "files" && activeRecord.startsWith("file:") ? activeRecord : null
  const dialogRecord = activeRecord === "" ? null : view.records[activeRecord]
  return (
    <div className="change-review-shell">
      <ApplicationHeader
        incidentId={view.incident.incidentId}
        navigator={view.navigator}
        captureTime={view.meta.captureTime}
        tab={tab}
        record={activeRecord}
        exportData={view}
      />
      <main id="workspace-main" className="cr-page">
        <ChangeHeader view={view} />
        <div className="cr-main-grid">
          <div className="cr-records">
            <TabBar view={view} activeTab={tab} record={activeRecord} />
            <div className="cr-pane">
              <ActiveTab
                view={view}
                tab={tab}
                selectedFileId={selectedFileId}
              />
            </div>
          </div>
          <RecordInspectorPanel
            view={view}
            record={view.records[selectedRecord]}
            tab={tab}
          />
        </div>
      </main>
      {dialogRecord !== null ? (
        <RecordDialog view={view} record={dialogRecord} tab={tab} />
      ) : null}
    </div>
  )
}

export function ChangeReviewGap({
  incidentId,
  reason,
}: {
  incidentId: string
  reason: string
}) {
  return (
    <main className="cr-gap">
      <a href="/">Incidents</a> / <span>{incidentId}</span>
      <section role="status">
        <strong>No run to review.</strong> {reason} The long-form workspace
        stays available at{" "}
        <a href={workspaceHref(incidentId, { view: "full" })}>view=full</a>.
      </section>
    </main>
  )
}
