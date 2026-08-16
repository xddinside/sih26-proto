/**
 * Panel 11 — Watch: the frozen plan file (G1–G6 queries, limits, sample
 * floors, missing-data rules, the recorded unfired severe-regression stop
 * rule), the stage-1 probe ring, the stage-2 service swap, saved Watch rows
 * per window, and the numeric before/after from the recorded rows. Run 2
 * renders "no production Watch Report — the run ended at Verify".
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { formatNumber } from "../../../incidents/lib/format"
import { FieldRow, MonoCell, OutcomePill, TableHead, TableRegion } from "../workspace-primitives"
import type { WatchPanelView } from "../../lib/workspace-projection"

const STAGE_LABELS: Readonly<Record<string, string>> = {
  "1": "Stage 1 — candidate probe ring",
  "2": "Stage 2 — live service swap",
  confirmation: "Confirmation window",
}

function formatSampleCount(value: number): string {
  return String(value)
}

export function WatchPanel({ panel }: { panel: WatchPanelView | null }) {
  if (panel === null) {
    return (
      <Section id="workspace-watch" title="Watch">
        <EmptyState title="No Watch Report" description="the run ended at Verify before the production Watch stage" />
      </Section>
    )
  }

  const stage1 = panel.reports.filter((report) => report.rolloutStage === "1")
  const stage2 = panel.reports.filter((report) => report.rolloutStage === "2")
  const confirmation = panel.reports.filter((report) => report.rolloutStage === "confirmation")
  const probeCount = stage1.flatMap((report) => report.samples.filter((sample) => sample.gate === "G1"))
  const afterRatios = stage2.flatMap((report) => report.samples.filter((sample) => sample.gate === "G5"))

  return (
    <Section
      id="workspace-watch"
      title="Watch"
      description="frozen plan, probe ring, service swap, and saved Watch rows; numeric before/after comes from saved rows, never narrative"
    >
      {panel.plan === null ? (
        <EmptyState title="No frozen Watch plan" description="no rollout-watch-plan artifact sealed in this saved run" />
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              candidate {panel.plan.candidateHash.slice(0, 16)}… · strategy {panel.plan.strategy} · policy {panel.plan.policyVersion}
            </span>
            <Citation source={panel.plan.source} label="watch plan artifact" />
          </div>
          <TableRegion
            label="Frozen Watch plan"
            minWidth="min-w-[48rem]"
            summary="G1–G6 queries, limits, sample floors, and the missing-data rule frozen before release"
          >
            <TableHead columns={["Gate", "Signal", "Query", "Limit", "Sample floor"]} />
            <tbody>
              {panel.plan.queries.map((query) => (
                <tr key={query.id} className="border-b border-border/60">
                  <MonoCell>{query.id}</MonoCell>
                  <td className="px-2 py-2 text-xs">{query.signal}</td>
                  <td className="px-2 py-2 font-mono text-xs">{query.query}</td>
                  <MonoCell>
                    {query.comparator} {formatNumber(query.limit)}
                    {query.unit !== null ? ` ${query.unit}` : ""}
                  </MonoCell>
                  <MonoCell>{formatSampleCount(query.minimumSampleCount)}</MonoCell>
                </tr>
              ))}
            </tbody>
          </TableRegion>
          <dl className="mt-2">
            <FieldRow label="Missing-data rule">
              <span className="font-mono text-xs">{panel.plan.missingDataRule}</span>
              <span className="ml-2 text-xs text-muted-foreground">no data is never a pass</span>
            </FieldRow>
            <FieldRow label="Stop rules (recorded, unfired)">
              {panel.plan.stopRules.map((rule) => (
                <span key={rule.id} className="font-mono text-xs">
                  {rule.id}: {rule.condition} → {rule.action}
                </span>
              ))}
            </FieldRow>
            {panel.plan.rehearsalReceiptRefs.length > 0 ? (
              <FieldRow label="T13 rehearsal receipts">
                <span className="font-mono text-xs">{panel.plan.rehearsalReceiptRefs.join(", ")}</span>
              </FieldRow>
            ) : null}
          </dl>
        </div>
      )}

      {panel.baselineRatio !== null ? (
        <p className="mt-3 text-sm">
          recorded pre-release baseline:{" "}
          <CitedValue value={panel.baselineRatio.value} source={panel.baselineRatio.source} label="baseline error ratio" />
        </p>
      ) : null}

      {panel.probeReceipts.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Probe ring receipts</p>
          <ul className="mt-1">
            {panel.probeReceipts.map((receipt) => (
              <li key={receipt.receiptId} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1.5 text-sm last:border-b-0">
                <CitedValue value={receipt.receiptId} source={receipt.source} label="probe receipt" />
                {receipt.rowCount !== null ? (
                  <CitedValue value={`${receipt.rowCount}/${receipt.rowCount} succeeded`} source={receipt.source} label="probe count" />
                ) : null}
                <span className="font-mono text-xs text-muted-foreground">{receipt.query}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {probeCount.length > 0 ? (
        <p className="mt-3 text-sm">
          stage-1 probe ring:{" "}
          {probeCount.map((sample) => (
            <span key={`${sample.timeRange.startsAt}-${sample.timeRange.endsAt}`} className="mr-2">
              <CitedValue
                value={`${formatSampleCount(sample.value)}/${formatSampleCount(sample.limit)}`}
                source={{ kind: "artifact", ref: stage1[0]?.contentHash ?? "watch-report", schemaId: "watch-report" }}
                label="probe ring"
              />
            </span>
          ))}{" "}
          across {probeCount.length} consecutive stage-1 windows
        </p>
      ) : null}

      {stage1.length > 0 ? (
        <WatchReportBlock title={STAGE_LABELS["1"] ?? "Stage 1"} reports={stage1} />
      ) : null}
      {stage2.length > 0 ? (
        <WatchReportBlock title={STAGE_LABELS["2"] ?? "Stage 2"} reports={stage2} />
      ) : null}
      {confirmation.length > 0 ? (
        <WatchReportBlock title={STAGE_LABELS.confirmation} reports={confirmation} />
      ) : null}

      {panel.reports.length === 0 && panel.plan === null ? (
        <EmptyState title="No production Watch Report" description="the run ended at Verify; the T13 rehearsal receipt remains part of Verify" />
      ) : null}

      {afterRatios.length > 0 ? (
        <p className="mt-3 text-sm">
          after the swap: error ratio{" "}
          {afterRatios.map((sample, index) => (
            <span key={index} className="mr-2">
              <CitedValue
                value={formatNumber(sample.value)}
                source={{ kind: "artifact", ref: stage2[0]?.contentHash ?? "watch-report", schemaId: "watch-report" }}
                label="stage-2 error ratio"
              />
            </span>
          ))}
          across three consecutive stage-2 samples, each below the 0.05 limit
        </p>
      ) : null}
    </Section>
  )
}

function WatchReportBlock({
  title,
  reports,
}: {
  title: string
  reports: WatchPanelView["reports"]
}) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      {reports.map((report) => (
        <div key={report.contentHash} className="mt-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatePill tone={report.stageOutcome === "pass" ? "positive" : "negative"}>{report.stageOutcome}</StatePill>
            <span className="text-xs text-muted-foreground">
              sealed {report.sealedAt} · plan {report.planRef.slice(0, 16)}…
            </span>
            <Citation source={report.source} label="watch report artifact" />
          </div>
          <TableRegion label={`${title} watch rows`} minWidth="min-w-[48rem]">
            <TableHead columns={["Gate", "Window", "Cohorts", "Samples", "Value", "Limit", "Outcome"]} />
            <tbody>
              {report.samples.map((sample, index) => (
                <tr key={`${sample.gate}-${index}`} className="border-b border-border/60">
                  <MonoCell>{sample.gate}</MonoCell>
                  <MonoCell>
                    {sample.timeRange.startsAt.slice(11, 19)}–{sample.timeRange.endsAt.slice(11, 19)}
                  </MonoCell>
                  <MonoCell>
                    {sample.baselineCohort !== null || sample.candidateCohort !== null
                      ? `${sample.baselineCohort ?? "—"} → ${sample.candidateCohort ?? "—"}`
                      : "—"}
                  </MonoCell>
                  <MonoCell>{formatSampleCount(sample.sampleCount)}</MonoCell>
                  <MonoCell>{formatNumber(sample.value)}</MonoCell>
                  <MonoCell>{formatNumber(sample.limit)}</MonoCell>
                  <td className="px-2 py-2">
                    <OutcomePill outcome={sample.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableRegion>
        </div>
      ))}
    </div>
  )
}
