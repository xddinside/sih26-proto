/**
 * Panel 5 — Hypotheses and the eight-check gate: ranked Hypotheses with
 * status chips, causal graphs with cited item edges, the gate table with
 * counts and cited item ids only, alternatives with the item that eliminated
 * each, and the root-cause rule.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { HYPOTHESIS_CHECK_LABELS } from "../../constants"
import type { Source } from "../../../incidents/lib/format"
import { formatTimestamp } from "../../../incidents/lib/format"
import { OutcomePill, TableHead, TableRegion } from "../workspace-primitives"
import type { GateView } from "../../../incidents/lib/projections"
import type { HypothesisPanelView, HypothesisView } from "../../lib/workspace-projection"

function hypothesisTone(status: string): "neutral" | "positive" | "negative" | "warning" | "info" {
  if (status === "accepted" || status === "confirmed") return "positive"
  if (status === "rejected") return "negative"
  if (status === "superseded") return "warning"
  if (status === "testing") return "info"
  return "neutral"
}

function shortItem(id: string): string {
  return id.slice(0, 14)
}

function HypothesisCard({ hypothesis, hypothesisSource }: { hypothesis: HypothesisView; hypothesisSource: Source }) {
  return (
    <li className="border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{hypothesis.id}</span>
        <StatePill tone={hypothesisTone(hypothesis.status)}>{hypothesis.status}</StatePill>
        <Citation source={hypothesisSource} label={`${hypothesis.id} hypothesis`} />
      </div>
      <dl className="mt-2 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Trigger</dt>
          <dd className="min-w-0 break-words">{hypothesis.causalTrigger}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Defect</dt>
          <dd className="min-w-0 break-words font-mono text-xs">{hypothesis.defect}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Failure</dt>
          <dd className="min-w-0 break-words">{hypothesis.failure}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Causal edges</p>
        <ul className="mt-1 space-y-0.5">
          {hypothesis.propagation.map((edge, index) => (
            <li key={index} className="text-sm">
              <span className="font-mono text-xs">{edge.from}</span>
              <span aria-hidden="true"> → </span>
              <span className="font-mono text-xs">{edge.to}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                cites {edge.citedItemIds.length === 0 ? "nothing (uncited edge)" : edge.citedItemIds.map(shortItem).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Evidence</p>
        <p className="mt-0.5 text-xs">
          <span className="text-muted-foreground">supporting</span>{" "}
          <span className="font-mono">{hypothesis.supporting.length === 0 ? "none" : hypothesis.supporting.map(shortItem).join(", ")}</span>
        </p>
        <p className="mt-0.5 text-xs">
          <span className="text-muted-foreground">opposing (eliminating items)</span>{" "}
          <span className="font-mono">{hypothesis.opposing.length === 0 ? "none" : hypothesis.opposing.map(shortItem).join(", ")}</span>
        </p>
      </div>
      {hypothesis.predictedObservations.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pre-registered predictions</p>
          <ul className="mt-0.5 space-y-0.5">
            {hypothesis.predictedObservations.map((observation) => (
              <li key={observation.id} className="text-xs">
                <span className="font-mono">{observation.id}</span> — {observation.statement}
                <span className="ml-2 text-muted-foreground">registered {observation.registeredAt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hypothesis.proposedTests.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Proposed discriminating tests</p>
          <ul className="mt-0.5 space-y-0.5">
            {hypothesis.proposedTests.map((test) => (
              <li key={test.id} className="text-xs">
                <span className="font-mono">{test.id}</span> — {test.procedure}
                <span className="ml-2 text-muted-foreground">
                  bounds {test.bounds} · permissions {test.permissions.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}

function HypothesisGateTable({ gate }: { gate: GateView }) {
  return (
    <TableRegion
      label="Hypothesis gate checks"
      minWidth="min-w-[42rem]"
      summary={`verdict ${gate.verdict} · hypothesis ${gate.hypothesisId ?? "unrecorded"} · evaluated ${formatTimestamp(gate.evaluatedAt)} · policy ${gate.policyVersion}`}
    >
      <TableHead columns={["Check", "Result", "Counts", "Cited items"]} />
      <tbody>
        {gate.checks.map((check) => (
          <tr key={check.check} className="border-b border-border/60">
            <td className="px-2 py-2">
              <span className="font-mono text-xs">{check.check}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">{HYPOTHESIS_CHECK_LABELS[check.check] ?? ""}</p>
            </td>
            <td className="px-2 py-2">
              <OutcomePill outcome={check.result ? "pass" : "fail"} />
            </td>
            <td className="px-2 py-2">
              {check.counts.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <ul className="space-y-0.5">
                  {check.counts.map((count) => (
                    <li key={count.key} className="flex items-center gap-1.5">
                      <CitedValue value={String(count.value)} source={{ kind: "journal", ref: String(gate.source.ref) }} label={count.key} />
                      <span className="font-mono text-xs text-muted-foreground">{count.key}</span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
            <td className="px-2 py-2">
              {check.citedItemIds.length === 0 ? (
                <span className="text-muted-foreground">none</span>
              ) : (
                <ul className="space-y-0.5">
                  {check.citedItemIds.map((id) => (
                    <li key={id} className="font-mono text-xs text-muted-foreground">{shortItem(id)}…</li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableRegion>
  )
}

export function HypothesesPanel({ panel }: { panel: HypothesisPanelView }) {
  const diagnosisSource: Source = { kind: "artifact", ref: "diagnosis-report", schemaId: "diagnosis-report" }
  return (
    <Section
      id="workspace-hypotheses"
      title="Hypotheses and the eight-check gate"
      description="ranked Hypotheses with cited causal edges; the gate table carries counts, booleans, and cited item ids only — no prose is evidence"
    >
      {panel.hypotheses.length === 0 ? (
        <EmptyState title="No Hypotheses" description="this saved run sealed no diagnosis report" />
      ) : (
        <ul className="space-y-3">
          {panel.hypotheses.map((hypothesis) => (
            <HypothesisCard key={hypothesis.id} hypothesis={hypothesis} hypothesisSource={diagnosisSource} />
          ))}
        </ul>
      )}
      {panel.gate !== null ? (
        <div className="mt-4">
          <HypothesisGateTable gate={panel.gate} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">no hypothesis gate evaluation recorded</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        root-cause rule: prediction and experiment support a Hypothesis; only Remediation plus Watch confirm it. An accepted
        Hypothesis is still a Hypothesis.
      </p>
    </Section>
  )
}
