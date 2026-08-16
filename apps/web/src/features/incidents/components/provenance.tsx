/**
 * Provenance strip: the pinned versions and identities bound to a saved
 * artifact, rendered as a compact, wrap-friendly line. "Provenance on every
 * artifact" (docs/research/incident-workspace.md).
 */

function Fact({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === "") {
    return null
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="uppercase tracking-wide">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  )
}

/** A horizontal, wrapping strip of provenance facts. */
export function ProvenanceStrip({
  facts,
  className,
}: {
  facts: { label: string; value: string | null }[]
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className ?? ""}`}>
      {facts.map((fact) => (
        <Fact key={fact.label} label={fact.label} value={fact.value} />
      ))}
    </div>
  )
}
