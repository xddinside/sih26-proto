/**
 * Panel 15 — Audit trail (tail): the append-only journal tail with actor,
 * service account, policy version, and sequence; human overrides render in a
 * distinct section. Search is pitch-only and not built.
 */
import { CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import type { JournalTailView } from "../../../incidents/lib/projections"
import { MonoCell, TableHead, TableRegion } from "../workspace-primitives"
import type { HumanActionView } from "../../lib/workspace-projection"

export function AuditPanel({
  auditTail,
  humanActions,
}: {
  auditTail: JournalTailView[]
  humanActions: HumanActionView[]
}) {
  return (
    <Section
      id="workspace-audit"
      title="Audit trail (journal tail)"
      description="append-only, ordered by sequence; each row names its actor and the policy version in force"
    >
      {auditTail.length === 0 ? (
        <EmptyState title="Empty journal" description="this incident's journal records no events" />
      ) : (
        <TableRegion label="Journal tail" minWidth="min-w-[36rem]">
          <TableHead columns={["Seq", "Event", "Actor", "Policy", "Recorded"]} />
          <tbody>
            {auditTail.map((event) => (
              <tr key={event.sequence} className="border-b border-border/60">
                <MonoCell>{event.sequence}</MonoCell>
                <MonoCell>{event.type}</MonoCell>
                <MonoCell>
                  {event.actorId} ({event.actorKind})
                </MonoCell>
                <MonoCell>{event.policyVersion}</MonoCell>
                <MonoCell>{event.recordedAt}</MonoCell>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      )}

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Human overrides</p>
        {humanActions.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">no human override recorded in this saved run</p>
        ) : (
          <ul className="mt-1">
            {humanActions.map((action) => (
              <li key={action.sequence} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
                <CitedValue value={action.action} source={action.source} label="human action" />
                <StatePill tone="warning">human</StatePill>
                <span className="font-mono text-xs text-muted-foreground">actor {action.actorId}</span>
                {action.approvalRef !== null ? (
                  <span className="font-mono text-xs text-muted-foreground">approval {action.approvalRef}</span>
                ) : null}
                {action.reason !== null ? <span className="text-xs text-muted-foreground">reason: {action.reason}</span> : null}
                <span className="text-xs text-muted-foreground">{action.recordedAt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        audit search is Solution Contract scope and not built; the tail replays every recorded event with its actor and policy
        version. Secrets never enter the journal; redacted payloads carry references and hashes.
      </p>
    </Section>
  )
}
