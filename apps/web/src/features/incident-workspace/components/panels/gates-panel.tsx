/**
 * Panel 9 — Release or Action Gate: the eight Release Gate facts (or the six
 * Action Gate facts) with evidence refs and results, the release record
 * receipts, the release lease, and permit consumption. A run that never
 * reached a gate renders "not reached — run ended verification-failed",
 * never an empty gate.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { ACTION_GATE_FACT_LABELS, RELEASE_GATE_FACT_LABELS } from "../../constants"
import type { GateView, ReceiptView } from "../../../incidents/lib/projections"
import { formatTimestamp } from "../../../incidents/lib/format"
import { MonoCell, OutcomePill, TableHead, TableRegion } from "../workspace-primitives"
import type { GatePanelView } from "../../lib/workspace-projection"

function GateFactsTable({ gate }: { gate: GateView }) {
  const labels = gate.gate === "release" ? RELEASE_GATE_FACT_LABELS : ACTION_GATE_FACT_LABELS
  return (
    <TableRegion
      label={`${gate.gate} gate facts`}
      minWidth="min-w-[40rem]"
      summary={`verdict ${gate.verdict} · evaluated ${formatTimestamp(gate.evaluatedAt)} · policy ${gate.policyVersion}${
        gate.tzdbVersion !== null ? ` · tzdb ${gate.tzdbVersion}` : ""
      }`}
    >
      <TableHead columns={["Fact", "Meaning", "Result", "Evidence refs"]} />
      <tbody>
        {gate.facts.map((fact) => (
          <tr key={fact.fact} className="border-b border-border/60">
            <MonoCell>{fact.fact}</MonoCell>
            <td className="px-2 py-2 text-xs">{labels[fact.fact] ?? ""}</td>
            <td className="px-2 py-2">
              <OutcomePill outcome={fact.result ? "pass" : "fail"} />
            </td>
            <MonoCell>{fact.evidence.map((reference) => `${reference.kind} ${reference.ref.slice(0, 18)}`).join(", ")}</MonoCell>
          </tr>
        ))}
      </tbody>
    </TableRegion>
  )
}

function ReleaseRecordReceipts({ receipts }: { receipts: ReceiptView[] }) {
  const releaseReceipts = receipts.filter(
    (receipt) =>
      receipt.receiptId === "receipt-candidate-deploy" ||
      receipt.receiptId === "receipt-swap" ||
      receipt.receiptId === "receipt-ci" ||
      receipt.receiptId === "receipt-metric",
  )
  if (releaseReceipts.length === 0) {
    return null
  }
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Release record receipts</p>
      <ul className="mt-1">
        {releaseReceipts.map((receipt) => (
          <li key={receipt.receiptId} className="border-b border-border/60 py-2 text-sm last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <CitedValue value={receipt.receiptId} source={receipt.source} label="release receipt" />
              <StatePill tone="info">{receipt.kind}</StatePill>
            </div>
            <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {receipt.fields.map((field) => (
                <div key={field.label} className="flex items-baseline gap-1.5 text-xs">
                  <dt className="shrink-0 uppercase tracking-wide text-muted-foreground">{field.label}</dt>
                  <dd className="min-w-0 break-words font-mono">{field.text} <Citation source={field.source} label={field.label} /></dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GatesPanel({ gates, receipts }: { gates: GatePanelView; receipts: ReceiptView[] }) {
  const release = gates.release
  const action = gates.action
  return (
    <Section
      id="workspace-gates"
      title="Release or Action Gate"
      description="the execution gates run outside the Orchestrator; a run that never reached a gate renders the recorded gap"
    >
      {release !== null ? (
        <GateFactsTable gate={release} />
      ) : (
        <EmptyState
          title="Release Gate not reached"
          description={gates.notReachedReason === null ? "no release gate record in this saved bundle" : `not reached — run ended ${gates.notReachedReason}`}
        />
      )}
      {action !== null ? (
        <div className="mt-3">
          <GateFactsTable gate={action} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Action Gate: {gates.notReachedReason === null ? "no record in this saved bundle" : `not reached — run ended ${gates.notReachedReason}`};
          a direct operational Remediation, not this code candidate, would take that path.
        </p>
      )}
      <ReleaseRecordReceipts receipts={receipts} />
      {release !== null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          gate evaluation is a saved journal record; the permit is consumed once by the broker and cannot be replayed.
        </p>
      ) : null}
    </Section>
  )
}
