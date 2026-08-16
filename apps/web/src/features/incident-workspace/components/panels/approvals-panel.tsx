/**
 * Panel 10 — Approvals: one immutable record per decision — action digest,
 * approver identity, approval system, policy and tzdb versions, class,
 * expiry, scope, and one-use consumption. Saved runs render recorded
 * decisions read-only; approve/deny controls are disabled.
 */
import { Citation } from "../../../incidents/components/citation"
import { SavedControls } from "../../../incidents/components/controls"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { formatTimestamp } from "../../../incidents/lib/format"
import type { ApprovalView } from "../../../incidents/lib/projections"
import { FieldRow } from "../workspace-primitives"

function ApprovalRow({ approval }: { approval: ApprovalView }) {
  return (
    <li className="border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{approval.approvalId}</span>
        <StatePill tone="info">{approval.action}</StatePill>
        <StatePill tone="neutral">class {approval.actionRiskClass}</StatePill>
        <Citation source={approval.source} label="approval journal" />
      </div>
      <dl className="mt-2">
        <FieldRow label="Approver">
          {approval.approverIdentity} via {approval.approvalSystem}
        </FieldRow>
        <FieldRow label="Versions">
          <span className="font-mono text-xs">
            policy {approval.policyVersion} · tzdb {approval.tzdbVersion}
          </span>
        </FieldRow>
        <FieldRow label="Expiry">
          {formatTimestamp(approval.expiry)}
          <span className="ml-2 text-xs text-muted-foreground">one-use; consumed once, never replayed</span>
        </FieldRow>
        {approval.target !== null ? (
          <FieldRow label="Scope">
            target {approval.target}
            {approval.changedSurfaces.length > 0 ? (
              <span className="ml-2 font-mono text-xs text-muted-foreground">surfaces {approval.changedSurfaces.join(", ")}</span>
            ) : null}
          </FieldRow>
        ) : null}
      </dl>
    </li>
  )
}

export function ApprovalsPanel({ approvals }: { approvals: ApprovalView[] }) {
  const controlReasonId = "workspace-saved-controls-reason"
  return (
    <Section
      id="workspace-approvals"
      title="Approvals"
      description="recorded decisions replay read-only; live approve and deny controls are Solution Contract only"
    >
      {approvals.length === 0 ? (
        <EmptyState
          title="No approval records"
          description="no approval decision recorded in this saved run — the run ended before any action needed one"
        />
      ) : (
        <ul className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalRow key={`${approval.approvalId}-${approval.action}`} approval={approval} />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <SavedControls reasonId={controlReasonId} controls={["Approve", "Deny"]} />
      </div>
    </Section>
  )
}
