/**
 * The Change Review workspace surface: application header, change header,
 * the Summary / Files changed tabs, the record inspector, and the replay
 * provenance footer. One `ChangeWorkspaceView` projection drives everything;
 * the tabs and the inspector selection are plain search parameters.
 */
import type { ChangeReviewTab } from "../../lib/workspace-search"
import { resolveRecordId, workspaceHref } from "../../lib/workspace-search"
import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { ApplicationHeader } from "./application-header"
import { ChangeHeader } from "./change-header"
import { FilesTab } from "./files-tab"
import { RecordInspectorPanel } from "./record-inspector"
import { SummaryTab } from "./summary-tab"

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
    { id: "files", label: "Files changed", count: view.diff.state === "parsed" ? view.diff.files.length : 0 },
  ]
  return (
    <div role="group" aria-label="Change records" className="flex border-b border-border">
      {tabs.map((tab) => {
        const active = tab.id === activeTab
        return (
          <a
            key={tab.id}
            href={workspaceHref(view.incident.incidentId, { tab: tab.id, record })}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 px-4 py-2 text-sm font-medium underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 ? (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{tab.count}</span>
            ) : null}
          </a>
        )
      })}
    </div>
  )
}

/** The replay provenance footer, mirroring the legacy workspace's section. */
export function ChangeReviewProvenance({ view }: { view: ChangeWorkspaceView }) {
  return (
    <section aria-labelledby="cr-replay-meta-title" className="border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 id="cr-replay-meta-title" className="font-heading text-sm font-semibold tracking-wide uppercase">
          Replay provenance
        </h2>
      </header>
      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground">
          format {view.meta.formatVersion} · captured {view.meta.captureTime} · evaluation time {view.meta.evaluationTime} ·{" "}
          {view.meta.incidentCount} saved Incidents · run {view.run.runId} bound by {view.run.bindingReason}
          {view.meta.manifestId !== null ? ` · capture manifest ${view.meta.manifestId}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {view.meta.providerClass !== null
            ? `provider ${view.meta.providerClass} · model ${view.meta.model ?? "unrecorded"} · reasoning ${view.meta.reasoning ?? "unrecorded"} · `
            : ""}
          every record fact replays a journal sequence, receipt, or sealed artifact; saved-run controls cannot submit, and
          no live agent, broker, or detector ran.
        </p>
      </div>
    </section>
  )
}

/** The Change Review for one Incident and its search state. */
export function ChangeReviewView({
  view,
  tab,
  record,
}: {
  view: ChangeWorkspaceView
  tab: ChangeReviewTab
  record: string
}) {
  const selectedRecord = resolveRecordId(new Set(Object.keys(view.records)), record, view.defaultRecordId)
  const selectedFileId =
    tab === "files" && record !== "" && record.startsWith("file:") && record in view.records ? record : null
  return (
    <div className="min-h-screen bg-background">
      <ApplicationHeader
        incidentId={view.incident.incidentId}
        navigator={view.navigator}
        captureTime={view.meta.captureTime}
        tab={tab}
        record={selectedRecord}
      />
      <main id="workspace-main" className="container mx-auto max-w-6xl px-4 py-6">
        <ChangeHeader view={view} />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0">
            <TabBar view={view} activeTab={tab} record={selectedRecord} />
            <div className="mt-4">
              {tab === "summary" ? <SummaryTab view={view} /> : <FilesTab view={view} selectedFileId={selectedFileId} />}
            </div>
          </div>
          <RecordInspectorPanel view={view} record={view.records[selectedRecord]} />
        </div>
        <div className="mt-6">
          <ChangeReviewProvenance view={view} />
        </div>
      </main>
    </div>
  )
}

/** The named-gap state when no run can be bound to the Incident. */
export function ChangeReviewGap({
  incidentId,
  reason,
}: {
  incidentId: string
  reason: string
}) {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <a href="/" className="hover:underline">
          Incidents
        </a>
        <span aria-hidden="true"> / </span>
        <span className="font-mono">{incidentId}</span>
      </nav>
      <section className="mt-6 border border-border bg-card px-4 py-3" role="status">
        <p className="text-sm">
          <strong>No run to review.</strong> {reason} The long-form workspace stays available at{" "}
          <a href={workspaceHref(incidentId, { view: "full" })} className="underline-offset-2 hover:underline">
            view=full
          </a>
          .
        </p>
      </section>
    </main>
  )
}