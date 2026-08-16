/**
 * Panel 6 — Fusion rounds: every participant's structured output (exactly two
 * in the Demo Profile), the Judge output, the Synthesizer output, and round
 * validity. Participant and Judge traces render only behind the explicit
 * disclosure view labeled "excluded from later model context — inspection
 * only"; only the Synthesized Response is durable stage input.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { formatTimestamp } from "../../../incidents/lib/format"
import { MonoCell, TableHead, TableRegion } from "../workspace-primitives"
import type { FusionPanelView } from "../../lib/workspace-projection"

const EXCLUDED_NOTE =
  "excluded from later model context — inspection only. Participant and Judge traces persist for audit but never become durable stage input; only the Synthesized Response continues."

function JudgeFindingList({ rows }: { rows: { statement: string; hypothesisIds: string[]; citedItemIds: string[] }[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">none recorded</p>
  }
  return (
    <ul className="space-y-0.5">
      {rows.map((row, index) => (
        <li key={index} className="text-sm">
          {row.statement}
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            hypotheses {row.hypothesisIds.length === 0 ? "none" : row.hypothesisIds.join(", ")} · cites{" "}
            {row.citedItemIds.length === 0 ? "none" : row.citedItemIds.map((id) => id.slice(0, 14)).join(", ")}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function FusionPanel({ panel }: { panel: FusionPanelView | null }) {
  return (
    <Section
      id="workspace-fusion"
      title="Fusion rounds"
      description="two independent participants, one Judge that compares without picking a winner, one Synthesizer whose output alone is durable"
    >
      {panel === null ? (
        <EmptyState title="No Fusion records" description="this saved run sealed no fusion participant outputs" />
      ) : (
        <>
          <div className="mb-3">
            <p className="text-sm">
              Round validity:{" "}
              {panel.roundValidity.length === 0
                ? "unrecorded"
                : panel.roundValidity
                    .map((round) => `round ${round.round} valid ${String(round.valid)} (${round.participantIds.length} participants)`)
                    .join(" · ")}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Synthesizer output — durable stage input</p>
            {panel.synthesizer === null ? (
              <p className="mt-1 text-sm text-muted-foreground">no synthesizer output recorded</p>
            ) : (
              <div className="mt-1 border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{panel.synthesizer.synthesizerId}</span>
                  <Citation source={panel.synthesizer.source} label="synthesizer artifact" />
                </div>
                <TableRegion label="Synthesizer ranked hypotheses" minWidth="min-w-[32rem]" summary="ranked Hypotheses from the Synthesized Response">
                  <TableHead columns={["Rank", "Hypothesis", "Status"]} />
                  <tbody>
                    {panel.synthesizer.ranked.map((entry) => (
                      <tr key={entry.rank} className="border-b border-border/60">
                        <MonoCell>{entry.rank}</MonoCell>
                        <MonoCell>{entry.hypothesisId}</MonoCell>
                        <MonoCell>{entry.status}</MonoCell>
                      </tr>
                    ))}
                  </tbody>
                </TableRegion>
                {panel.synthesizer.nextActions.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Next actions</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {panel.synthesizer.nextActions.map((action, index) => (
                        <li key={index} className="text-sm">
                          {action.procedure}
                          <span className="ml-2 text-xs text-muted-foreground">
                            bounds {action.bounds} · permissions {action.permissions.join(", ")} · discriminates{" "}
                            {action.discriminates.join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  revision {panel.synthesizer.fusionMeta.revisionId.slice(0, 16)}… · started{" "}
                  {formatTimestamp(panel.synthesizer.fusionMeta.startedAt)} · completed{" "}
                  {formatTimestamp(panel.synthesizer.fusionMeta.completedAt)}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 border border-dashed border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Participant and Judge traces — disclosure view
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{EXCLUDED_NOTE}</p>

            <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Participants (2 in the Demo Profile)</p>
            <ul className="mt-1 space-y-3">
              {panel.participants.map((participant) => (
                <li key={participant.participantId} className="border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{participant.participantId}</span>
                    <Citation source={participant.source} label="participant artifact" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    hypotheses proposed: {participant.hypothesisIds.join(", ")}
                  </p>
                  {participant.objections.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {participant.objections.map((objection, index) => (
                        <li key={index} className="text-xs">
                          objection{objection.hypothesisId !== null ? ` to ${objection.hypothesisId}` : ""}: {objection.statement}
                          <span className="ml-2 font-mono text-muted-foreground">
                            {objection.citedItemIds.map((id) => id.slice(0, 14)).join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>

            {panel.judge !== null ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Judge output</p>
                  <span className="font-mono text-sm font-semibold">{panel.judge.judgeId}</span>
                  <Citation source={panel.judge.source} label="judge artifact" />
                </div>
                <div className="mt-1 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium">Agreements</p>
                    <JudgeFindingList rows={panel.judge.agreements} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Contradictions</p>
                    <JudgeFindingList rows={panel.judge.contradictions} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Blind spots</p>
                    <JudgeFindingList rows={panel.judge.blindSpots} />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Unique findings</p>
                    <JudgeFindingList rows={panel.judge.uniqueFindings} />
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-xs font-medium">Citation audit</p>
                  <TableRegion label="Judge citation audit" minWidth="min-w-[32rem]">
                    <TableHead columns={["Participant", "Uncited claims", "Invalid citations", "Missing item citations"]} />
                    <tbody>
                      {panel.judge.citationAudit.map((audit) => (
                        <tr key={audit.participantId} className="border-b border-border/60">
                          <MonoCell>{audit.participantId}</MonoCell>
                          <MonoCell>{audit.uncitedClaims}</MonoCell>
                          <MonoCell>{audit.invalidCitations}</MonoCell>
                          <MonoCell>{audit.missingItemCitations}</MonoCell>
                        </tr>
                      ))}
                    </tbody>
                  </TableRegion>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <CitedValue value="Synthesized Response" source={{ kind: "replay", ref: "replay" }} label="durable stage input" />
        is the only durable Diagnose output; the panel renders no other model transcript as evidence.
      </p>
    </Section>
  )
}
