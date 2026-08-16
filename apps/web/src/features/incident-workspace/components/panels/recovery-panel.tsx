/**
 * Panel 12 — Recovery Point: the recorded fields (prior image digest,
 * service.version, environment and flag files, service definition, exact
 * restore command with preconditions and timeout, retention window), the R8
 * validation findings, and the T12 restore-drill receipts. It names every
 * changed surface; Run 2 shows the draft never consumed.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { FieldRow } from "../workspace-primitives"
import type { RecoveryPanelView } from "../../lib/workspace-projection"

export function RecoveryPanel({ panel }: { panel: RecoveryPanelView | null }) {
  return (
    <Section
      id="workspace-recovery"
      title="Recovery Point"
      description="recorded before the first mutation; names every changed surface, the exact restore command with preconditions and timeout, and the T12 drill receipts"
    >
      {panel === null ? (
        <EmptyState title="No Recovery Point" description="this saved run recorded no remediation with a Recovery Point" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{panel.recoveryPointId.slice(0, 16)}…</span>
            <StatePill tone={panel.consumed ? "info" : "neutral"}>{panel.consumed ? "consumed" : "draft — never consumed"}</StatePill>
          </div>
          <dl className="mt-2">
            <FieldRow label="Changed surfaces">
              <span className="font-mono text-xs">{panel.changedSurfaces.join(", ")}</span>
            </FieldRow>
            {panel.drillReceipts.map((receipt) => (
              <FieldRow key={receipt.receiptId} label={`Restore drill ${receipt.receiptId}`}>
                <CitedValue value={receipt.outcome} source={receipt.source} label="drill outcome" />
                <span className="ml-2 font-mono text-xs">{receipt.command}</span>
                {receipt.executedAt !== null ? (
                  <span className="ml-2 text-xs text-muted-foreground">executed {receipt.executedAt}</span>
                ) : null}
              </FieldRow>
            ))}
          </dl>
          {panel.r8Findings.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">R8 Recovery Point review findings</p>
              <ul className="mt-1 space-y-1">
                {panel.r8Findings.map((finding) => (
                  <li key={finding.id} className="text-sm">
                    <StatePill tone="info">{finding.severity}</StatePill>
                    <span className="ml-2">{finding.claim}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {finding.citations.map((citation) => `${citation.kind} ${citation.ref?.slice(0, 14) ?? ""}`).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">{panel.note}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Citation source={{ kind: "replay", ref: "replay" }} label="replay note" /> the Recovery Point is a recorded plan, not a
            promise of perfect reversal; unreversed external effects stay human-handled.
          </p>
        </>
      )}
    </Section>
  )
}
