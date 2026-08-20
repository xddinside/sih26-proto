import { IconCheck, IconChevronRight } from "@tabler/icons-react"
import { useState } from "react"

import type {
  CheckView,
  ChangeWorkspaceView,
} from "../../lib/change-workspace-projection"
import { RecordAnchor, ReviewBadge } from "./review-primitives"

type CheckFilter = "all" | CheckView["kind"] | "failed"

function ResultIcon({ result }: { result: CheckView["result"] }) {
  return (
    <span className={`cr-result-icon ${result}`} aria-hidden="true">
      {result === "passed" ? <IconCheck /> : result === "failed" ? "×" : "−"}
    </span>
  )
}

export function ChecksTab({ view }: { view: ChangeWorkspaceView }) {
  const [filter, setFilter] = useState<CheckFilter>("all")
  const failed = view.checks.filter((check) => check.result === "failed").length
  const reviews = view.checks.filter((check) => check.kind === "Review").length
  const tests = view.checks.filter((check) => check.kind === "Test").length
  const shown = view.checks.filter(
    (check) =>
      filter === "all" ||
      (filter === "failed" ? check.result === "failed" : check.kind === filter)
  )
  const reportedTotal = view.sourceHost?.checksTotal ?? view.checks.length
  const reportedPassed =
    view.sourceHost?.checksPassed ??
    view.checks.filter((check) => check.result === "passed").length

  return (
    <section id="cr-panel-checks" className="cr-panel">
      <header className="cr-panel-head">
        <h2>{failed > 0 ? "Merge blocked" : "All required checks passed"}</h2>
        <ReviewBadge tone={failed > 0 ? "danger" : "success"}>
          {failed > 0
            ? `${failed} failed`
            : `${reportedPassed}/${reportedTotal} passed`}
        </ReviewBadge>
      </header>
      <div className="cr-check-toolbar">
        <div
          className="cr-segmented"
          role="radiogroup"
          aria-label="Filter checks"
        >
          {(
            [
              ["all", `All ${view.checks.length}`],
              ["Review", `Reviews ${reviews}`],
              ["Test", `Tests ${tests}`],
              ["failed", `Failed ${failed}`],
            ] as [CheckFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              className={filter === value ? "active" : undefined}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="cr-check-list">
        {shown.map((check) => (
          <RecordAnchor
            key={check.recordId}
            incidentId={view.incident.incidentId}
            recordId={check.recordId}
            tab="checks"
            className="cr-check-row"
          >
            <ResultIcon result={check.result} />
            <span>
              <strong>
                {check.id} · {check.name}
              </strong>
              <small>
                {check.actor} · {check.tool}
              </small>
            </span>
            <IconChevronRight aria-hidden="true" />
          </RecordAnchor>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="cr-check-empty" role="status">
          No checks match this filter.
        </div>
      ) : null}
    </section>
  )
}
