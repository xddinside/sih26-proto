/**
 * The Incident Workspace: the canonical panel hierarchy from
 * docs/research/incident-workspace.md, rendered read-only over a verified
 * saved Demo Run. Panels 1–12, the read-only policy panel, the audit tail,
 * and the telemetry deep links replay the saved bundle; the rollback panel
 * and the full R/T catalog panel are static Solution Contract documentation
 * marked proposed product scope.
 */
import type { ReactNode } from "react"

import { StatePill } from "../../incidents/components/badge"
import { Section } from "../../incidents/components/section"
import type { WorkspaceView } from "../lib/workspace-projection"
import { ApprovalsPanel } from "./panels/approvals-panel"
import { AttemptsPanel } from "./panels/attempts-panel"
import { AuditPanel } from "./panels/audit-panel"
import { CatalogPanel } from "./panels/catalog-panel"
import { EvidencePanel } from "./panels/evidence-panel"
import { FusionPanel } from "./panels/fusion-panel"
import { GatesPanel } from "./panels/gates-panel"
import { HeaderPanel } from "./panels/header-panel"
import { HypothesesPanel } from "./panels/hypotheses-panel"
import { IntakePanel } from "./panels/intake-panel"
import { PolicyPanel } from "./panels/policy-panel"
import { RecoveryPanel } from "./panels/recovery-panel"
import { RemediationPanel } from "./panels/remediation-panel"
import { RollbackPanel } from "./panels/rollback-panel"
import { TelemetryPanel } from "./panels/telemetry-panel"
import { VerifyPanel } from "./panels/verify-panel"
import { WatchPanel } from "./panels/watch-panel"

const NAV_ITEMS = [
  ["workspace-header", "Incident"],
  ["workspace-attempts", "Attempts and stages"],
  ["workspace-intake", "Trigger and intake"],
  ["workspace-evidence", "Evidence Set"],
  ["workspace-hypotheses", "Hypotheses and gate"],
  ["workspace-fusion", "Fusion rounds"],
  ["workspace-remediation", "Remediation"],
  ["workspace-verify", "Verify"],
  ["workspace-gates", "Release or Action Gate"],
  ["workspace-approvals", "Approvals"],
  ["workspace-watch", "Watch"],
  ["workspace-recovery", "Recovery Point"],
  ["workspace-rollback", "Rollback (contract)"],
  ["workspace-policy", "Policies and limits"],
  ["workspace-audit", "Audit trail"],
  ["workspace-telemetry", "Telemetry deep links"],
  ["workspace-catalog", "Full R/T catalog (contract)"],
] as const

/** A failed run renders its banner with the recorded failure reason. */
function FailedRunBanner({ view }: { view: WorkspaceView }) {
  const failed = view.detail.runs.find((run) => run.failureReason !== null)
  if (failed === undefined) {
    return null
  }
  return (
    <div
      role="status"
      className="border border-destructive/40 bg-destructive/10 px-4 py-3"
      aria-label={`run ${failed.runId} failed`}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatePill tone="negative">run {failed.runId}</StatePill>
        <span>failed: {failed.failureReason}</span>
        <span className="text-xs text-muted-foreground">
          attempt consumed · {view.header.attemptsRemaining} of {view.header.attemptLimit} attempts remaining · Incident{" "}
          {view.header.state ?? "state unrecorded"}
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        the failed evidence stays visible in the Evidence Set; no Remediation shipped and no gate was reached.
      </p>
    </div>
  )
}

/** Sticky desktop section rail; a picker list under the header at small widths. */
function WorkspaceNav() {
  return (
    <nav aria-label="Workspace sections" className="sticky top-0 z-10 border border-border bg-card/95 px-3 py-2 backdrop-blur">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Sections</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {NAV_ITEMS.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <a href="/" className="hover:underline">
          Incidents
        </a>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">workspace</span>
      </nav>
      <WorkspaceNav />
      {children}
    </main>
  )
}

/**
 * The full workspace for one saved Incident. The parent route supplies the
 * projection through `fetchWorkspaceDetail` (see `route-integration.ts`).
 */
export function IncidentWorkspaceView({ view }: { view: WorkspaceView }) {
  const latestRun = view.detail.runs.at(-1)
  return (
    <WorkspaceShell>
      <HeaderPanel header={view.header} />
      <FailedRunBanner view={view} />
      <AttemptsPanel runs={view.detail.runs} journalTail={view.detail.journalTail} />
      <IntakePanel intake={view.intake} />
      <EvidencePanel evidence={view.evidence} incidentId={view.detail.incidentId} />
      <HypothesesPanel panel={view.hypotheses} />
      <FusionPanel panel={view.fusion} />
      <RemediationPanel panel={view.remediation} />
      <VerifyPanel panel={view.verify} />
      <GatesPanel gates={view.gates} receipts={view.detail.receipts} />
      <ApprovalsPanel approvals={view.approvals} />
      <WatchPanel panel={view.watch} />
      <RecoveryPanel panel={view.recovery} />
      <RollbackPanel />
      <PolicyPanel panel={view.policy} />
      <AuditPanel auditTail={view.auditTail} humanActions={view.humanActions} />
      <TelemetryPanel links={view.telemetry} />
      <CatalogPanel />
      <Section id="workspace-replay-meta" title="Replay provenance">
        <p className="text-sm text-muted-foreground">
          format {view.meta.formatVersion} · captured {view.meta.captureTime} · evaluation time {view.meta.evaluationTime} ·{" "}
          {view.meta.incidentCount} saved Incidents · latest run{" "}
          {latestRun === undefined ? "unrecorded" : `${latestRun.state}${latestRun.outcome !== null ? ` (${latestRun.outcome})` : ""}`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          every panel fact replays a journal sequence, receipt, or sealed artifact; saved-run controls cannot submit, and no
          live agent, broker, or detector ran.
        </p>
      </Section>
    </WorkspaceShell>
  )
}
