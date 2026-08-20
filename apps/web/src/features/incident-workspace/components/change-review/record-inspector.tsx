/**
 * The Change inspector: one record at a time, selected through the `record`
 * search parameter. Shows the record's kind, status, summary, facts with
 * their citations, related records, the sealed-artifact deep link, and the
 * raw record behind a `<details>` disclosure (no client script).
 */
import { StatePill } from "../../../incidents/components/badge"
import { shortHash } from "../../../incidents/lib/format"
import type { ChangeWorkspaceView, InspectorRecord  } from "../../lib/change-workspace-projection"
import { FactRow, RecordAnchor, RecordReference } from "./review-primitives"

const TONE_PILL: Record<string, "positive" | "negative" | "warning" | "info" | "neutral"> = {
  positive: "positive",
  negative: "negative",
  warning: "warning",
  info: "info",
  neutral: "neutral",
}

/** The sealed artifact deep link for a record, when it has one. */
function ArtifactDeepLink({
  incidentId,
  record,
}: {
  incidentId: string
  record: InspectorRecord
}) {
  if (record.artifactLink === null) {
    return null
  }
  const hex = record.artifactLink.slice("sha256:".length)
  return (
    <a
      href={`/incidents/${incidentId}/artifacts/${hex}`}
      className="inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="font-mono">{shortHash(record.artifactLink)}</span>
      <span className="text-muted-foreground">open sealed artifact</span>
    </a>
  )
}

/** One inspector record. */
export function RecordInspectorPanel({
  view,
  record,
}: {
  view: ChangeWorkspaceView
  record: InspectorRecord
}) {
  return (
    <aside aria-label="Change inspector" className="border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{record.kind}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 break-words font-heading text-base font-semibold">{record.title}</h2>
          {record.status !== null ? (
            <StatePill tone={TONE_PILL[record.statusTone ?? "neutral"]}>{record.status}</StatePill>
          ) : null}
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{record.summary}</p>
        {record.facts.length > 0 ? (
          <dl className="mt-3">
            {record.facts.map((fact) => (
              <FactRow key={fact.label} label={fact.label} value={fact.value} source={fact.source} />
            ))}
          </dl>
        ) : null}
        {record.related.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Related</span>
            {record.related.map((related) => (
              <RecordAnchor key={related.recordId} incidentId={view.incident.incidentId} recordId={related.recordId}>
                {related.label}
              </RecordAnchor>
            ))}
          </p>
        ) : null}
        {record.artifactLink !== null ? (
          <p className="mt-3">
            <ArtifactDeepLink incidentId={view.incident.incidentId} record={record} />
          </p>
        ) : null}
        <RecordReference record={record} />
        {record.raw !== null ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Show raw record
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto border border-border bg-muted/40 p-3 text-[11px] leading-5">
              <code>{JSON.stringify(record.raw, null, 2)}</code>
            </pre>
          </details>
        ) : null}
      </div>
    </aside>
  )
}