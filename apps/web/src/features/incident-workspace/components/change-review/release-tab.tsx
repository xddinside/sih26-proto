import { IconChevronRight } from "@tabler/icons-react"

import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"
import { RecordAnchor, ReviewBadge } from "./review-primitives"

function GateRows({ view }: { view: ChangeWorkspaceView }) {
  const gate = view.reviewState.releaseGate
  if (gate === null)
    return (
      <p className="cr-release-gap">The run ended before the Release Gate.</p>
    )
  const passed = gate.facts.filter((fact) => fact.result).length
  return (
    <div className="cr-panel-body cr-release-watch">
      <strong>
        {passed}/{gate.facts.length} release requirements passed
      </strong>
      <p>The change met the recorded safety and verification requirements.</p>
      <RecordAnchor
        incidentId={view.incident.incidentId}
        recordId="gate-release"
        tab="release"
      >
        Inspect release decision <IconChevronRight aria-hidden="true" />
      </RecordAnchor>
    </div>
  )
}

export function ReleaseTab({ view }: { view: ChangeWorkspaceView }) {
  const gate = view.reviewState.releaseGate
  const recovery = view.change
  const released =
    view.change?.state === "Released" || view.change?.state === "Resolved"
  return (
    <section id="cr-panel-release" className="cr-release-grid">
      <article className="cr-panel">
        <header className="cr-panel-head">
          <h2>Release Gate</h2>
          <ReviewBadge tone={gate?.verdict === "pass" ? "success" : "neutral"}>
            {gate?.verdict ?? "Not reached"}
          </ReviewBadge>
        </header>
        <GateRows view={view} />
      </article>
      <article className="cr-panel">
        <header className="cr-panel-head">
          <h2>Release and Watch</h2>
          <ReviewBadge tone={released ? "success" : "neutral"}>
            {released ? "Verified" : "Not reached"}
          </ReviewBadge>
        </header>
        <div className="cr-panel-body cr-release-watch">
          <strong>
            {released ? "Release completed" : "No production Watch"}
          </strong>
          <p>
            {released
              ? "Release completed and the confirmation watch passed."
              : "The saved run did not reach a verified production Watch."}
          </p>
          <RecordAnchor
            incidentId={view.incident.incidentId}
            recordId="verification"
            tab="release"
          >
            Inspect verification record <IconChevronRight aria-hidden="true" />
          </RecordAnchor>
        </div>
      </article>
      <article className="cr-panel cr-recovery">
        <header className="cr-panel-head">
          <h2>Recovery Point</h2>
          <ReviewBadge
            tone={recovery?.recoveryConsumed ? "success" : "neutral"}
          >
            {recovery?.recoveryConsumed ? "Ready" : "Drafted"}
          </ReviewBadge>
        </header>
        <div className="cr-panel-body cr-recovery-body">
          <dl className="cr-definition-list">
            <div>
              <dt>Coverage</dt>
              <dd>{recovery?.changedSurfaces.join(", ") || "not recorded"}</dd>
            </div>
            <div>
              <dt>Rollback</dt>
              <dd>
                {recovery?.recoveryConsumed
                  ? "validated and consumed"
                  : "recorded, not consumed"}
              </dd>
            </div>
          </dl>
          <RecordAnchor
            incidentId={view.incident.incidentId}
            recordId="recovery:point"
            tab="release"
            className="cr-button"
          >
            Review rollback record
          </RecordAnchor>
        </div>
      </article>
    </section>
  )
}
