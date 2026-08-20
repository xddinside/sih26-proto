/**
 * Small read-only primitives for the Change Review surface.
 *
 * Every interactive element is a plain anchor built by `workspaceHref`, so
 * the whole surface renders with `renderToStaticMarkup` in tests and works
 * with browser back/forward without any client script. State, verdicts, and
 * gaps are conveyed by text plus shape, never by color alone.
 */
import type { ReactNode } from "react"

import { StatePill } from "../../../incidents/components/badge"
import type { Source } from "../../../incidents/lib/format"
import { formatTimestamp, sourceLabel } from "../../../incidents/lib/format"
import type { ChangeReviewTab } from "../../lib/workspace-search"
import { workspaceHref } from "../../lib/workspace-search"
import type {
  ChangeState,
  ChangeRunView,
  InspectorRecord,
} from "../../lib/change-workspace-projection"

export function ReviewBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "neutral" | "success" | "danger" | "warning" | "info"
}) {
  return (
    <span className={`cr-badge cr-badge-${tone}`}>
      {tone !== "neutral" ? <span aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** Tone of a Change state, mirrored from the prototype's settled mapping. */
export function changeStateTone(
  state: ChangeState
): "positive" | "negative" | "warning" | "info" | "neutral" {
  switch (state) {
    case "Resolved":
    case "Verified":
      return "positive"
    case "Blocked":
      return "negative"
    case "Released":
    case "Approved for Release":
      return "info"
    case "Prepared":
    case "Not prepared":
      return "neutral"
  }
}

/** The Change state as a pill, always with the word "Change" so it reads alone. */
export function ChangeStatePill({ state }: { state: ChangeState }) {
  return <StatePill tone={changeStateTone(state)}>change {state}</StatePill>
}

/** A cited source chip, matching `Citation` but without the imported coupling. */
export function SourceChip({
  source,
  label,
}: {
  source: Source
  label?: string
}) {
  return (
    <span
      title={source.ref}
      aria-label={
        label === undefined
          ? sourceLabel(source)
          : `${label}: ${sourceLabel(source)}`
      }
      className="inline-flex items-center rounded-none border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap text-muted-foreground"
    >
      {sourceLabel(source)}
    </span>
  )
}

/** An anchor that opens one record in the details dialog. */
export function RecordAnchor({
  incidentId,
  recordId,
  tab,
  children,
  className,
}: {
  incidentId: string
  recordId: string
  tab?: ChangeReviewTab
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={workspaceHref(incidentId, { tab, record: recordId })}
      data-record-anchor={recordId}
      className={`inline-flex items-center gap-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className ?? ""}`}
    >
      {children}
    </a>
  )
}

/** The run context strip under the change header. */
export function RunMetaStrip({
  run,
  incident,
}: {
  run: ChangeRunView
  incident: { service: string | null; environment: string | null }
}) {
  const duration =
    run.durationSeconds === null
      ? "duration unrecorded"
      : `${run.durationSeconds}s`
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>
        <strong className="text-foreground">
          {incident.environment ?? "environment unrecorded"}
        </strong>{" "}
        environment
      </span>
      <span>{incident.service ?? "service unrecorded"}</span>
      <span>
        attempt {run.attempt} of {run.attemptLimit}
      </span>
      <span>{duration}</span>
      {run.startedAt !== null ? (
        <span title="run-scoped journal window">
          {formatTimestamp(run.startedAt)}
          {run.endedAt !== null ? ` – ${formatTimestamp(run.endedAt)}` : ""}
        </span>
      ) : null}
    </p>
  )
}

/** A fact row inside a record: label, value, and its citation when saved. */
export function FactRow({
  label,
  value,
  source,
}: {
  label: string
  value: string
  source: Source | null
}) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 border-b border-border/60 py-2 text-sm last:border-b-0 max-sm:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">
        <span className="break-all">{value}</span>
        {source !== null ? (
          <span className="ml-1.5">
            <SourceChip source={source} label={label} />
          </span>
        ) : null}
      </dd>
    </div>
  )
}

/** The reference of a record, rendered as copyable text (no clipboard JS). */
export function RecordReference({ record }: { record: InspectorRecord }) {
  if (record.reference === null) {
    return null
  }
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      reference{" "}
      <code className="rounded-none border border-border bg-muted/60 px-1 py-0.5 font-mono text-[11px] break-all">
        {record.reference}
      </code>
    </p>
  )
}
