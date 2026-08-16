/**
 * Citation binding chip, rendered next to every number or fact that comes from
 * a saved row, receipt, artifact, or the manifest. "Receipts own numbers" is
 * made visible: the value and its saved source sit side by side.
 */
import type { Source } from "../lib/format"
import { sourceLabel, sourceRef } from "../lib/format"

export interface CitationProps {
  source: Source
  /** Optional extra context appended to the accessible label. */
  label?: string
}

/**
 * A small, read-only citation tag. The visible text is the source label; the
 * machine reference is in the title/aria-label so screen readers and the
 * visual layer both carry the binding.
 */
export function Citation({ source, label }: CitationProps) {
  const text = sourceLabel(source)
  const ref = sourceRef(source)
  const describedBy = label === undefined ? text : `${label}: ${text}`
  return (
    <span
      data-slot="citation"
      title={ref}
      aria-label={describedBy}
      className="inline-flex items-center rounded-none border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground whitespace-nowrap"
    >
      {text}
    </span>
  )
}

/** A rendered value bound to its saved source. */
export function CitedValue({
  value,
  source,
  label,
  className,
}: {
  value: string
  source: Source
  label?: string
  className?: string
}) {
  return (
    <span className={className}>
      <span className="font-semibold tabular-nums">{value}</span>{" "}
      <Citation source={source} label={label} />
    </span>
  )
}
