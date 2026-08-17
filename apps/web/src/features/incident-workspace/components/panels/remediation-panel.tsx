/**
 * Panel 7 — Remediation: Remediation Proposal v1 with the one-line diff,
 * the change-to-Hypothesis citation map, test plan, blast radius, the
 * Recovery Point draft, deterministic action-risk class and disposition, and
 * the PR-shaped record from the source-host adapter receipt.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { FieldRow, MonoCell, TableHead, TableRegion } from "../workspace-primitives"
import type { RemediationPanelView } from "../../lib/workspace-projection"

function dispositionTone(disposition: string): "neutral" | "positive" | "negative" | "warning" | "info" {
  if (disposition === "allowed") return "positive"
  if (disposition === "approval-required") return "warning"
  if (disposition === "prohibited") return "negative"
  return "neutral"
}

export function RemediationPanel({ panel }: { panel: RemediationPanelView | null }) {
  return (
    <Section
      id="workspace-remediation"
      title="Remediation"
      description="Remediation Proposal v1: change description, diff, citation map, test plan, Recovery Point draft, risk class, disposition, gate path, and the PR-shaped record"
    >
      {panel === null ? (
        <EmptyState title="No Remediation" description="this saved run sealed no remediation proposal" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">candidate {panel.candidateHash.slice(0, 16)}…</span>
            <StatePill tone="neutral">class {panel.remediationClass}</StatePill>
            <StatePill tone={panel.actionRiskClass === "safe" ? "positive" : "warning"}>risk {panel.actionRiskClass}</StatePill>
            <StatePill tone={dispositionTone(panel.disposition)}>disposition {panel.disposition}</StatePill>
            <StatePill tone="info">gate path {panel.gatePath}</StatePill>
            <Citation source={panel.source} label="proposal artifact" />
          </div>
          <p className="mt-2 text-sm">{panel.changeDescription}</p>

          {panel.diff !== null ? (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Diff</p>
              <pre className="mt-1 overflow-x-auto border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                <code>{panel.diff.diffText}</code>
              </pre>
              <p className="mt-1 text-xs text-muted-foreground">
                diff hash <span className="break-all font-mono">{panel.diff.diffHash}</span> · base{" "}
                <span className="font-mono">{panel.diff.baseRef.slice(0, 16)}…</span>
              </p>
            </div>
          ) : null}

          <div className="mt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Change-to-Hypothesis citation map</p>
            <TableRegion label="Remediation citation map" minWidth="min-w-[40rem]">
              <TableHead columns={["Change", "Hypothesis", "Cited items"]} />
              <tbody>
                {panel.citationMap.map((citation, index) => (
                  <tr key={index} className="border-b border-border/60">
                    <td className="px-2 py-2">{citation.change}</td>
                    <MonoCell>{citation.hypothesisId}</MonoCell>
                    <MonoCell>{citation.citedItemIds.map((id) => id.slice(0, 14)).join(", ")}</MonoCell>
                  </tr>
                ))}
              </tbody>
            </TableRegion>
          </div>

          <dl className="mt-3">
            <FieldRow label="Test plan">
              <span className="font-mono text-xs">{panel.testPlan.join(", ")}</span>
            </FieldRow>
            <FieldRow label="Changed surfaces">
              <span className="font-mono text-xs">{panel.changedSurfaces.join(", ")}</span>
            </FieldRow>
            <FieldRow label="Blast radius">
              <span className="text-xs">
                services {panel.blastRadius.services.length === 0 ? "none" : panel.blastRadius.services.join(", ")} · environments{" "}
                {panel.blastRadius.environments.length === 0 ? "none" : panel.blastRadius.environments.join(", ")} · cohorts{" "}
                {panel.blastRadius.cohorts.length === 0 ? "none" : panel.blastRadius.cohorts.join(", ")}
              </span>
            </FieldRow>
            <FieldRow label="Recovery Point">
              <span className="font-mono text-xs">{panel.recoveryPointId.slice(0, 16)}…</span>
              <span className="ml-2 text-xs text-muted-foreground">covers {panel.recoveryPointSurfaces.join(", ")}</span>
            </FieldRow>
          </dl>

          {panel.prReceipt !== null ? (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">PR-shaped record (source-host adapter stand-in)</p>
              <div className="mt-1 border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CitedValue value={panel.prReceipt.receiptId} source={panel.prReceipt.source} label="PR receipt" />
                  <StatePill tone="positive">{panel.prReceipt.outcome}</StatePill>
                  {panel.prReceipt.executedAt !== null ? (
                    <span className="text-xs text-muted-foreground">executed {panel.prReceipt.executedAt}</span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{panel.prReceipt.command}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">no PR-shaped record receipt recorded</p>
          )}
        </>
      )}
    </Section>
  )
}
