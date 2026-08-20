import { IconCheck, IconChevronRight, IconCode } from "@tabler/icons-react"

import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { RecordAnchor, ReviewBadge } from "./review-primitives"

function SummaryRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ChangeSummaryCard({ view }: { view: ChangeWorkspaceView }) {
  const change = view.change
  if (change === null) {
    return (
      <section className="cr-panel">
        <header className="cr-panel-head">
          <h2>Change summary</h2>
        </header>
        <div className="cr-panel-body">
          <p>No Remediation was recorded for this run.</p>
        </div>
      </section>
    )
  }
  const fileSummary =
    view.diff.state === "parsed"
      ? `${view.diff.files.length} ${view.diff.files.length === 1 ? "file" : "files"} · +${view.diff.additions} −${view.diff.deletions}`
      : view.diff.state === "absent"
        ? "no recorded diff"
        : "diff could not be split by file"
  return (
    <section aria-labelledby="cr-summary-title" className="cr-panel">
      <header className="cr-panel-head">
        <h2 id="cr-summary-title">Change summary</h2>
        <ReviewBadge tone={change.state === "Blocked" ? "danger" : "success"}>
          {view.sourceHost?.state ?? change.state}
        </ReviewBadge>
      </header>
      <div className="cr-panel-body">
        <p className="cr-change-copy">
          {change.description ?? "no recorded change description"}
        </p>
        <dl className="cr-definition-list cr-summary-list">
          <SummaryRow label="Accepted Hypothesis">
            {change.hypothesisId ? (
              <RecordAnchor
                incidentId={view.incident.incidentId}
                recordId={`hypothesis:${change.hypothesisId}`}
              >
                {change.hypothesisId}
                {change.citationChange ? ` · ${change.citationChange}` : ""}
                <IconChevronRight aria-hidden="true" />
              </RecordAnchor>
            ) : (
              "none recorded"
            )}
          </SummaryRow>
          <SummaryRow label="Changed files">
            <RecordAnchor
              incidentId={view.incident.incidentId}
              recordId="diff-raw"
              tab="files"
            >
              {fileSummary}
            </RecordAnchor>
          </SummaryRow>
          {change.services.length > 0 || change.environments.length > 0 ? (
            <SummaryRow label="Affected area">
              {[...change.services, ...change.environments].join(" · ")}
            </SummaryRow>
          ) : null}
          <SummaryRow label="Recovery">
            <RecordAnchor
              incidentId={view.incident.incidentId}
              recordId="recovery:point"
            >
              {change.recoveryConsumed
                ? "Rollback remained available through release"
                : "Rollback plan ready"}
              <IconChevronRight aria-hidden="true" />
            </RecordAnchor>
          </SummaryRow>
        </dl>
      </div>
    </section>
  )
}

function ReviewStat({
  value,
  label,
  result = "passed",
}: {
  value: string
  label: string
  result?: "passed" | "failed" | "not-run"
}) {
  return (
    <div className="cr-review-stat">
      <span className={`cr-result-icon ${result}`} aria-hidden="true">
        {result === "passed" ? <IconCheck /> : result === "failed" ? "×" : "−"}
      </span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  )
}

function ReviewStateCard({ view }: { view: ChangeWorkspaceView }) {
  const failed = view.reviewState.failedIds.length > 0
  const testsPassed =
    view.reviewState.testsPassed === view.reviewState.testsTotal
  const gate = view.reviewState.releaseGate
  return (
    <section aria-labelledby="cr-review-title" className="cr-panel">
      <header className="cr-panel-head">
        <h2 id="cr-review-title">Review state</h2>
      </header>
      <div className="cr-review-stats">
        <ReviewStat
          value={
            view.sourceHost?.approvals !== null &&
            view.sourceHost?.approvals !== undefined
              ? `${view.sourceHost.approvals} approved`
              : `${view.reviewState.reviewsPassed}/${view.reviewState.reviewsTotal} approved`
          }
          label={
            failed
              ? `${view.reviewState.failedIds.join(", ")} did not pass`
              : "Correctness and recovery approved"
          }
          result={failed ? "failed" : "passed"}
        />
        <ReviewStat
          value={
            view.sourceHost?.checksPassed !== null &&
            view.sourceHost?.checksPassed !== undefined &&
            view.sourceHost.checksTotal !== null
              ? `${view.sourceHost.checksPassed}/${view.sourceHost.checksTotal} passed`
              : `${view.reviewState.testsPassed}/${view.reviewState.testsTotal} passed`
          }
          label={
            testsPassed
              ? "All required checks complete"
              : "Some recorded checks did not pass"
          }
          result={testsPassed ? "passed" : "failed"}
        />
        <ReviewStat
          value={
            gate ? `Release Gate ${gate.verdict}` : "Release Gate not reached"
          }
          label={
            gate
              ? "Release requirements met"
              : "The run ended before release review"
          }
          result={
            !gate ? "not-run" : gate.verdict === "pass" ? "passed" : "failed"
          }
        />
      </div>
    </section>
  )
}

function FilesPreview({ view }: { view: ChangeWorkspaceView }) {
  return (
    <section
      aria-labelledby="cr-files-title"
      className="cr-panel cr-files-preview"
    >
      <header className="cr-panel-head">
        <h2 id="cr-files-title">Files changed</h2>
        <a
          href={`/incidents/${view.incident.incidentId}?tab=files`}
          className="cr-review-diff"
        >
          Review diff
        </a>
      </header>
      {view.diff.state === "parsed" && view.diff.files.length > 0 ? (
        view.diff.files.map((file) => (
          <RecordAnchor
            key={file.id}
            incidentId={view.incident.incidentId}
            recordId={file.id}
            tab="files"
            className="cr-file-row"
          >
            <IconCode aria-hidden="true" />
            <strong>{file.path ?? "path unrecorded"}</strong>
            <span>
              <b>+{file.additions}</b>
              <i>−{file.deletions}</i>
            </span>
            <IconChevronRight aria-hidden="true" />
          </RecordAnchor>
        ))
      ) : (
        <div className="cr-file-gap">
          <span>{view.diff.note ?? "no diff recorded"}</span>
          {view.diff.rawText ? (
            <RecordAnchor
              incidentId={view.incident.incidentId}
              recordId="diff-raw"
              tab="files"
            >
              Inspect the raw recorded diff
            </RecordAnchor>
          ) : null}
        </div>
      )}
    </section>
  )
}

export function SummaryTab({ view }: { view: ChangeWorkspaceView }) {
  return (
    <section id="cr-panel-summary">
      <div className="cr-summary-grid">
        <ChangeSummaryCard view={view} />
        <ReviewStateCard view={view} />
      </div>
      <FilesPreview view={view} />
    </section>
  )
}
