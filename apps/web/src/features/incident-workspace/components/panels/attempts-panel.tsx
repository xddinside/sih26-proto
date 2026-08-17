/**
 * Panel 2 — Attempts and stages: serial attempts with the fixed stage chips
 * Detect → Diagnose → Repair → Verify → Release → Watch, run state, outcome,
 * restart count, and lease events.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import type { RunView, JournalTailView  } from "../../../incidents/lib/projections"

function stageTone(status: string | null): "neutral" | "positive" | "negative" | "warning" {
  if (status === "completed") return "positive"
  if (status === "failed") return "negative"
  if (status === "in-progress") return "warning"
  return "neutral"
}

function StageChips({ run }: { run: RunView }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label={`attempt ${run.attempt} stages`}>
      {run.stages.map((stage) => (
        <li key={stage.stage} className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <StatePill tone={stageTone(stage.status)}>
            {stage.stage}
            {stage.status !== null ? ` · ${stage.status}` : " · not-reached"}
          </StatePill>
          {stage.source !== null ? <Citation source={stage.source} label={`${stage.stage} stage`} /> : null}
          {stage.reason !== null ? (
            <span className="text-xs text-muted-foreground" title="skipped reason">
              {stage.reason}
            </span>
          ) : null}
          {stage.artifactContentHash !== null ? (
            <Citation
              source={{ kind: "artifact", ref: stage.artifactContentHash, schemaId: stage.artifactSchemaId ?? "artifact" }}
              label={`${stage.stage} artifact`}
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function RunCard({ run }: { run: RunView }) {
  const tone = run.state === "failed" ? "negative" : run.state === "completed" ? "positive" : "neutral"
  return (
    <li className="border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{run.runId}</span>
        <StatePill tone={tone}>{run.state}</StatePill>
        {run.outcome !== null ? <StatePill tone={tone}>outcome {run.outcome}</StatePill> : null}
        {run.failureReason !== null ? <StatePill tone="negative">{run.failureReason}</StatePill> : null}
        <span className="text-xs text-muted-foreground">attempt {run.attempt} · restart count {run.restartCount}</span>
      </div>
      <div className="mt-3">
        <StageChips run={run} />
      </div>
    </li>
  )
}

export function AttemptsPanel({
  runs,
  journalTail,
}: {
  runs: RunView[]
  journalTail: JournalTailView[]
}) {
  const leaseEvents = journalTail.filter((event) => event.type === "lease_event")
  return (
    <Section
      id="workspace-attempts"
      title="Attempts and stages"
      description="one serial attempt per saved run; stage chips replay the fixed stage order with their recorded statuses"
    >
      {runs.length === 0 ? (
        <EmptyState title="No runs" description="this incident's journal records no Incident Runs" />
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </ul>
      )}
      {leaseEvents.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Lease events</p>
          <ul className="mt-1">
            {leaseEvents.map((event) => (
              <li key={event.sequence} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1.5 text-sm last:border-b-0">
                <CitedValue value={event.type} source={{ kind: "journal", ref: String(event.sequence) }} label="lease event" />
                <span className="font-mono text-xs text-muted-foreground">
                  actor {event.actorId} ({event.actorKind}) · policy {event.policyVersion}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}
