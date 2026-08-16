/**
 * Panel 1 — Header: Incident key, state, severity, scope, detector state,
 * Attempt Limit, attempts used and remaining, the standing Saved Demo Run
 * badge, and the latest run outcome.
 */
import { SavedBadge, SeverityPill, StatePill } from "../../../incidents/components/badge"
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import type { HeaderPanelView } from "../../lib/workspace-projection"

export function HeaderPanel({ header }: { header: HeaderPanelView }) {
  return (
    <Section id="workspace-header" title="Incident">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-xl font-semibold">{header.incidentId}</h1>
        {header.state !== null ? (
          <StatePill tone={header.state === "closed" ? "neutral" : header.state === "resolved" ? "info" : "warning"}>
            {header.state}
          </StatePill>
        ) : (
          <StatePill>state unrecorded</StatePill>
        )}
        {header.closureReason !== null ? <StatePill tone="neutral">closed: {header.closureReason}</StatePill> : null}
        {header.detectorState !== null ? (
          <StatePill tone={header.detectorState === "resolved" ? "positive" : "warning"}>detector {header.detectorState}</StatePill>
        ) : null}
        <SeverityPill severity={header.severity} />
      </div>
      <p className="mt-3">
        <SavedBadge captureTime={header.captureTime} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        replaying journal and sealed artifacts; no live agent, broker, or detector activity
      </p>
      <dl className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 py-1.5 text-sm">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Scope</dt>
          <dd className="min-w-0 break-words">
            {header.scope !== null
              ? `${header.scope.service} · ${header.scope.environment} · tenant ${header.scope.tenantId}`
              : "scope unrecorded"}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 py-1.5 text-sm">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Attempts</dt>
          <dd>
            <CitedValue value={String(header.attemptsUsed)} source={header.attemptsSource} label="attempts used" />
            <span className="ml-2 text-xs text-muted-foreground">
              of {header.attemptLimit} · {header.attemptsRemaining} remaining
            </span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 py-1.5 text-sm">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Final journal sequence</dt>
          <dd>
            <CitedValue value={String(header.finalSequence)} source={header.finalSequenceSource} label="final sequence" />
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-sm">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Latest run</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {header.latestRun === null ? (
              <span className="text-xs text-muted-foreground">no run recorded</span>
            ) : (
              <>
                <StatePill tone={header.latestRun.state === "completed" ? "positive" : header.latestRun.state === "failed" ? "negative" : "neutral"}>
                  {header.latestRun.state}
                </StatePill>
                {header.latestRun.outcome !== null ? <StatePill tone="info">outcome {header.latestRun.outcome}</StatePill> : null}
                {header.latestRun.failureReason !== null ? <StatePill tone="negative">{header.latestRun.failureReason}</StatePill> : null}
                <span className="text-xs text-muted-foreground">attempt {header.latestRun.attempt}</span>
              </>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        <Citation source={{ kind: "replay", ref: "replay" }} label="replayed journal state" /> attempts and state replay from
        the journal aggregate
      </p>
    </Section>
  )
}
