/**
 * Panel 14 — Policies and limits (read-only): the two recorded dials
 * (Authority Mode, Automation Policy) from the pinned policy version, the
 * recorded execution-time policy decisions with their windows and tzdb
 * versions, the Attempt Limit, and the fixed action-risk table. Saved runs
 * render recorded versions read-only; dial edits are operator-only and
 * live-only.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { SavedControls } from "../../../incidents/components/controls"
import { Section } from "../../../incidents/components/section"
import { StatePill } from "../../../incidents/components/badge"
import { formatTimestamp } from "../../../incidents/lib/format"
import { AUTHORITY_MODES, AUTOMATION_POLICIES, DEMO_CAPS_KEPT, DEMO_CAPS_REMOVED, RISK_TABLE } from "../../constants"
import { TableHead, TableRegion } from "../workspace-primitives"
import type { PolicyPanelView } from "../../lib/workspace-projection"

/** A read-only dial rendered as a horizontal segmented row with one recorded position. */
function RecordedDial({ label, options, recorded }: { label: string; options: readonly string[]; recorded: string | null }) {
  return (
    <div role="group" aria-label={`${label} dial (read-only)`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {options.map((option) => {
          const active = option === recorded
          return (
            <span
              key={option}
              aria-current={active ? "true" : undefined}
              className={
                active
                  ? "inline-flex items-center border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium"
                  : "inline-flex items-center border border-border px-2.5 py-1 text-xs text-muted-foreground"
              }
            >
              {option}
              {active ? <span className="ml-1.5 text-[10px] uppercase tracking-wide">recorded</span> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function PolicyPanel({ panel }: { panel: PolicyPanelView }) {
  const controlReasonId = "workspace-policy-controls-reason"
  return (
    <Section
      id="workspace-policy"
      title="Policies and limits"
      description="recorded dial values replay read-only; the risk table and Demo Profile caps are fixed Solution Contract content"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm font-semibold">policy {panel.policyVersion}</span>
        <Citation source={{ kind: "replay", ref: "replay" }} label="recorded policy version" />
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <RecordedDial
          label="Authority Mode dial"
          options={AUTHORITY_MODES}
          recorded={panel.recorded?.authorityMode ?? null}
        />
        <RecordedDial
          label="Automation Policy dial"
          options={AUTOMATION_POLICIES}
          recorded={panel.recorded?.automationPolicy ?? null}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        the dial positions are pinned by the recorded policy version; dial edits are operator-only and exist only for live
        Incidents.
      </p>

      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Recorded execution-time policy decisions</p>
        {panel.decisions.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            no execution-time decision recorded — the run ended at Verify before any action decision (moot)
          </p>
        ) : (
          <ul className="mt-1">
            {panel.decisions.map((decision) => (
              <li key={decision.source.ref} className="border-b border-border/60 py-2 text-sm last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatePill tone={decision.decision === "approval-required" ? "warning" : "info"}>{decision.decision}</StatePill>
                  <Citation source={decision.source} label="policy decision" />
                </div>
                <p className="mt-1 text-muted-foreground">
                  tzdb {decision.tzdbVersion} · window {decision.window || "unrecorded"} · evaluated{" "}
                  {formatTimestamp(decision.evaluatedAt)}
                </p>
                {decision.reason !== null ? <p className="text-xs text-muted-foreground">reason: {decision.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Attempt Limit</p>
        <p className="mt-1 text-sm">
          <CitedValue value={String(panel.attemptLimit)} source={{ kind: "replay", ref: "replay" }} label="Attempt Limit" />
          <span className="ml-2 text-xs text-muted-foreground">
            Demo Profile default; reaching it writes the Incident Report and closes the Incident attempt-limit
          </span>
        </p>
      </div>

      <div className="mt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Demo Profile cap defaults</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          <div className="border border-border px-3 py-2">
            <p className="text-xs font-medium">Removed for the demo</p>
            <ul className="mt-1 space-y-0.5">
              {DEMO_CAPS_REMOVED.map((cap) => (
                <li key={cap.field} className="text-xs">
                  <span className="font-mono text-muted-foreground">{cap.field}</span> — {cap.setting}
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-border px-3 py-2">
            <p className="text-xs font-medium">Stays in force</p>
            <ul className="mt-1 space-y-0.5">
              {DEMO_CAPS_KEPT.map((cap) => (
                <li key={cap.field} className="text-xs">
                  <span className="font-mono text-muted-foreground">{cap.field}</span> — {cap.setting}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Action-risk table (fixed)</p>
        <TableRegion
          label="Action-risk table"
          minWidth="min-w-[48rem]"
          summary="the deterministic taxonomy; a company may tighten a class, never loosen it"
        >
          <TableHead columns={["Category", "Typical actions", "Default class", "Rollback honesty"]} />
          <tbody>
            {RISK_TABLE.map((row) => (
              <tr key={row.category} className="border-b border-border/60">
                <td className="px-2 py-2 font-mono text-xs">{row.category}</td>
                <td className="px-2 py-2 text-xs">{row.actions}</td>
                <td className="px-2 py-2 text-xs">{row.defaultClass}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{row.rollbackHonesty}</td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </div>

      <div className="mt-3">
        <SavedControls reasonId={controlReasonId} controls={["Dial edits", "Budget edits", "Pause", "Cancel"]} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <Citation source={{ kind: "replay", ref: "replay" }} label="policy note" /> safety rules beat user dials: the barred
        list, both gates, and broker checks always win; a policy change revokes outstanding approvals.
      </p>
    </Section>
  )
}
