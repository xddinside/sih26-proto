/**
 * Small read-only table and gap primitives shared by the workspace panels.
 *
 * Wide tables sit inside a labeled horizontal scroll region with a compact
 * summary line, per docs/research/incident-workspace.md "Accessibility and
 * responsive behavior"; result words are always text, never color alone.
 */
import type { ReactNode } from "react"

import { StatePill } from "../../incidents/components/badge"
import type { Source } from "../../incidents/lib/format"
import { sourceLabel, sourceRef } from "../../incidents/lib/format"

/** A labeled horizontal scroll region wrapping a wide panel table. */
export function TableRegion({
  label,
  summary,
  minWidth,
  children,
}: {
  label: string
  summary?: string
  minWidth?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-x-clip">
      {summary !== undefined ? <p className="mb-2 text-xs text-muted-foreground">{summary}</p> : null}
      <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className={`w-full border-collapse text-sm ${minWidth ?? "min-w-[44rem]"}`}>{children}</table>
      </div>
    </div>
  )
}

/** A table head row with the workspace's settled label style. */
export function TableHead({ columns }: { columns: readonly string[] }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
        {columns.map((column) => (
          <th key={column} scope="col" className="px-2 py-2 font-medium">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )
}

/** A muted cell body. */
export function Cell({ children }: { children: ReactNode }) {
  return <td className="px-2 py-2 align-top">{children}</td>
}

/** A muted monospace cell body. */
export function MonoCell({ children }: { children: ReactNode }) {
  return <td className="px-2 py-2 align-top font-mono text-xs">{children}</td>
}

/** A pass/fail/outcome pill for a gate, sample, or test row. */
export function OutcomePill({ outcome }: { outcome: string }) {
  const tone =
    outcome === "pass" || outcome === "ok" || outcome === "success"
      ? "positive"
      : outcome === "fail" || outcome === "failed" || outcome === "failure"
        ? "negative"
        : outcome === "needs-human"
          ? "warning"
          : "neutral"
  return <StatePill tone={tone}>{outcome}</StatePill>
}

/** A cited artifact hash rendered as a short link to the artifact viewer. */
export function ArtifactRef({
  contentHash,
  schemaId,
  incidentId,
  source,
  label,
}: {
  contentHash: string
  schemaId: string | null
  incidentId: string
  source: Source
  label?: string
}) {
  const hex = contentHash.slice("sha256:".length)
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <a
        href={`/incidents/${incidentId}/artifacts/${hex}`}
        className="font-mono text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {schemaId ?? "artifact"}
      </a>
      <span className="font-mono text-[11px] text-muted-foreground" title={contentHash}>
        {sourceRef(source)}
      </span>
      {label !== undefined ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <span className="sr-only">{sourceLabel(source)}</span>
    </span>
  )
}

/** A masked field mark with its redaction profile id. */
export function RedactionMark({ profileId }: { profileId: string }) {
  return (
    <span className="font-mono text-[11px] text-muted-foreground" title="masked in the saved snapshot">
      mask {profileId}
    </span>
  )
}

/** A labeled gap: stale, expired, or missing data is never hidden. */
export function GapNote({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>
}

/** A field label/value row inside panels, compact. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border/60 py-1.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
