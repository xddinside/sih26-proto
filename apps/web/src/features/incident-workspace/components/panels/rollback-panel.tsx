/**
 * Pitch-only panel — Rollback records: the Solution Contract path rendered as
 * fixed documentation. The panel states plainly that neither saved run
 * contains a rollback and that the design in docs/research/release-recovery.md
 * stands unchanged.
 */
import { Section } from "../../../incidents/components/section"
import { StatePill } from "../../../incidents/components/badge"
import { ROLLBACK_PANEL } from "../../constants"

export function RollbackPanel() {
  return (
    <Section
      id="workspace-rollback"
      title="Rollback records — Solution Contract"
      description={ROLLBACK_PANEL.scopeLabel}
    >
      <StatePill tone="warning">proposed product scope</StatePill>
      <p className="mt-2 text-sm leading-relaxed">{ROLLBACK_PANEL.intro}</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        {ROLLBACK_PANEL.sequence.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{ROLLBACK_PANEL.allowListTitle}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {ROLLBACK_PANEL.allowList.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{ROLLBACK_PANEL.honesty}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        this panel documents the contract; it does not claim either saved run executed rollback, and the demo build provides no
        live rollback path.
      </p>
    </Section>
  )
}
