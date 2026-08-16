/**
 * Incident detail view: journal-driven shell with saved-truth labels,
 * provenance, receipt-bound numbers, and the fixed stage chips. The rich
 * panel fixtures (Fusion, Verify tables, Watch rows) arrive in a later issue;
 * this shell renders every settled field the saved journal already carries.
 */
import { Link } from "@tanstack/react-router"

import type { ApprovalView, DetailView, GateView, ReceiptView, RunView } from "../lib/projections"
import { formatTimestamp } from "../lib/format"
import { SavedBadge, SeverityPill, StatePill } from "./badge"
import { Citation, CitedValue } from "./citation"
import { SavedControls } from "./controls"
import { ProvenanceStrip } from "./provenance"
import { Section, KeyValue } from "./section"
import { EmptyState } from "./states"

function stageTone(status: string | null): "neutral" | "positive" | "negative" | "warning" {
  if (status === "completed") return "positive"
  if (status === "failed") return "negative"
  if (status === "in-progress") return "warning"
  return "neutral"
}

/** The fixed six-stage chips for one attempt. */
function StageChips({ run }: { run: RunView }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label={`attempt ${run.attempt} stages`}>
      {run.stages.map((stage) => (
        <li key={stage.stage} className="flex items-center gap-1.5">
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
            <Citation source={{ kind: "artifact", ref: stage.artifactContentHash, schemaId: stage.artifactSchemaId ?? "artifact" }} label={`${stage.stage} artifact`} />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** One attempt card: run identity, state, and its stage chips. */
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

/** The eight-check Hypothesis gate table: counts and citations only. */
function HypothesisGate({ gate }: { gate: GateView }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label="Hypothesis gate checks">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <caption className="sr-only">Hypothesis gate checks</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-2 py-2">Check</th>
            <th scope="col" className="px-2 py-2">Result</th>
            <th scope="col" className="px-2 py-2">Counts</th>
            <th scope="col" className="px-2 py-2">Cited items</th>
          </tr>
        </thead>
        <tbody>
          {gate.checks.map((check) => (
            <tr key={check.check} className="border-b border-border/60">
              <td className="px-2 py-2 font-mono text-xs">{check.check}</td>
              <td className="px-2 py-2">{check.result ? <StatePill tone="positive">pass</StatePill> : <StatePill tone="negative">fail</StatePill>}</td>
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
                      <li key={id} className="font-mono text-xs text-muted-foreground">{id}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A Release or Action Gate fact table, or the "not reached" gap. */
function GateSection({ title, gate, notReached }: { title: string; gate: GateView | null; notReached: string | null }) {
  if (gate !== null) {
    return (
      <Section id={title} title={title} description={`verdict ${gate.verdict} · evaluated ${formatTimestamp(gate.evaluatedAt)} · policy ${gate.policyVersion}${gate.tzdbVersion !== null ? ` · tzdb ${gate.tzdbVersion}` : ""}`}>
        <div className="overflow-x-auto" role="region" aria-label={`${title} facts`}>
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-2 py-2">Fact</th>
                <th scope="col" className="px-2 py-2">Result</th>
                <th scope="col" className="px-2 py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {gate.facts.map((fact) => (
                <tr key={fact.fact} className="border-b border-border/60">
                  <td className="px-2 py-2 font-mono text-xs">{fact.fact}</td>
                  <td className="px-2 py-2">{fact.result ? <StatePill tone="positive">pass</StatePill> : <StatePill tone="negative">fail</StatePill>}</td>
                  <td className="px-2 py-2">
                    <ul className="space-y-0.5">
                      {fact.evidence.map((reference) => (
                        <li key={`${reference.kind}-${reference.ref}`} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {reference.kind} {reference.ref}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    )
  }
  return (
    <Section id={title} title={title}>
      <EmptyState
        title="Not reached"
        description={notReached === null ? "no gate record in this saved bundle" : `not reached — run ended ${notReached}`}
      />
    </Section>
  )
}

function ReceiptRow({ receipt }: { receipt: ReceiptView }) {
  return (
    <li className="border-b border-border/60 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{receipt.receiptId}</span>
        <StatePill tone="info">{receipt.kind}</StatePill>
        <Citation source={receipt.source} label="receipt journal" />
        {receipt.stage !== null ? <span className="text-xs text-muted-foreground">stage {receipt.stage}</span> : null}
      </div>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {receipt.fields.map((field) => (
          <div key={field.label} className="flex items-baseline gap-1.5 text-sm">
            <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{field.label}</dt>
            <dd className="min-w-0 break-words font-mono text-xs">{field.text} <Citation source={field.source} label={field.label} /></dd>
          </div>
        ))}
      </dl>
    </li>
  )
}

function ApprovalRow({ approval }: { approval: ApprovalView }) {
  return (
    <li className="border-b border-border/60 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{approval.approvalId}</span>
        <StatePill tone="info">{approval.action}</StatePill>
        <StatePill tone="neutral">class {approval.actionRiskClass}</StatePill>
        <Citation source={approval.source} label="approval journal" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {approval.approverIdentity} via {approval.approvalSystem} · policy {approval.policyVersion} · tzdb {approval.tzdbVersion} · expires {formatTimestamp(approval.expiry)}
      </p>
      {approval.changedSurfaces.length > 0 ? (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          surfaces: {approval.changedSurfaces.join(", ")}
        </p>
      ) : null}
    </li>
  )
}

export function IncidentDetailView({ view }: { view: DetailView }) {
  const latestFailed = view.runs.find((run) => run.failureReason !== null)?.failureReason ?? null
  const controlReasonId = "saved-controls-reason"
  return (
    <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
          <Link to="/" className="hover:underline">Incidents</Link>
          <span aria-hidden="true"> / </span>
          <span className="text-foreground">{view.incidentId}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-xl font-semibold">{view.incidentId}</h1>
          {view.state !== null ? <StatePill tone={view.state === "closed" ? "neutral" : view.state === "resolved" ? "info" : "warning"}>{view.state}</StatePill> : <StatePill>state unrecorded</StatePill>}
          {view.closureReason !== null ? <StatePill tone="neutral">closed: {view.closureReason}</StatePill> : null}
          {view.detectorState !== null ? <StatePill tone={view.detectorState === "resolved" ? "positive" : "warning"}>detector {view.detectorState}</StatePill> : null}
          <SeverityPill severity={view.severity} />
        </div>
        <p className="mt-3">
          <SavedBadge captureTime={view.meta.captureTime} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          replaying journal and sealed artifacts; no live agent, broker, or detector activity
        </p>
      </header>

      <Section id="overview" title="Overview">
        <dl>
          <KeyValue label="Attempts used">
            <CitedValue value={String(view.attemptsUsed)} source={view.attemptsSource} label="attempts used" />
            <span className="ml-2 text-xs text-muted-foreground">attempt limit not recorded in this saved bundle</span>
          </KeyValue>
          <KeyValue label="Final journal sequence">
            <CitedValue value={String(view.finalSequence)} source={view.finalSequenceSource} label="final sequence" />
          </KeyValue>
          <KeyValue label="Scope">
            {view.scope !== null ? `${view.scope.service} · ${view.scope.environment} · tenant ${view.scope.tenantId}` : "scope unrecorded"}
          </KeyValue>
        </dl>
      </Section>

      <Section id="attempts" title="Attempts and stages">
        <ul className="space-y-3">
          {view.runs.map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </ul>
      </Section>

      <Section id="trigger" title="Trigger and intake">
        {view.firstTrigger !== null ? (
          <div className="space-y-2">
            <ProvenanceStrip
              facts={[
                { label: "rule", value: view.firstTrigger.ruleId },
                { label: "rule_version", value: view.firstTrigger.ruleVersion },
                { label: "detector", value: view.firstTrigger.detectorSource },
                { label: "trigger_id", value: view.firstTrigger.triggerId },
              ]}
            />
            <dl>
              <KeyValue label="Signal">
                <CitedValue value={view.firstTrigger.signalName} source={view.firstTrigger.source} label="signal name" />
              </KeyValue>
              <KeyValue label="Recorded value">
                <CitedValue value={view.firstTrigger.signalValue} source={view.firstTrigger.source} label="signal value" />
              </KeyValue>
              <KeyValue label="Threshold">
                <CitedValue value={view.firstTrigger.signalThreshold} source={view.firstTrigger.source} label="signal threshold" />
              </KeyValue>
              <KeyValue label="Received at">{view.firstTrigger.receivedAt}</KeyValue>
            </dl>
            {view.resolvedTrigger !== null ? (
              <p className="text-sm text-muted-foreground">
                resolved trigger {view.resolvedTrigger.receivedAt} · recorded value{" "}
                <CitedValue value={view.resolvedTrigger.signalValue} source={view.resolvedTrigger.source} label="resolved signal value" />
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">no resolved trigger recorded</p>
            )}
          </div>
        ) : (
          <EmptyState title="No trigger recorded" description="this incident's journal has no trigger_received event" />
        )}
      </Section>

      {view.hypothesisGate !== null ? (
        <Section
          id="hypothesis-gate"
          title="Hypothesis gate"
          description={`verdict ${view.hypothesisGate.verdict} · hypothesis ${view.hypothesisGate.hypothesisId ?? "unrecorded"} · evaluated ${formatTimestamp(view.hypothesisGate.evaluatedAt)} · policy ${view.hypothesisGate.policyVersion}`}
        >
          <HypothesisGate gate={view.hypothesisGate} />
        </Section>
      ) : (
        <GateSection title="Hypothesis gate" gate={null} notReached={latestFailed} />
      )}

      <GateSection title="Release gate" gate={view.releaseGate} notReached={latestFailed} />
      <GateSection title="Action gate" gate={view.actionGate} notReached={latestFailed} />

      <Section id="receipts" title="Broker receipts" description="numbers and facts come from receipts, never narrative">
        {view.receipts.length === 0 ? (
          <EmptyState title="No receipts" description="this incident's journal records no broker receipts" />
        ) : (
          <ul>
            {view.receipts.map((receipt) => (
              <ReceiptRow key={receipt.receiptId} receipt={receipt} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="approvals" title="Approvals" description="recorded decisions, read-only for saved runs">
        {view.approvals.length === 0 ? (
          <EmptyState title="No approvals" description="no approval decision recorded in this saved bundle" />
        ) : (
          <ul>
            {view.approvals.map((approval) => (
              <ApprovalRow key={`${approval.approvalId}-${approval.action}`} approval={approval} />
            ))}
          </ul>
        )}
        <div className="mt-3">
          <SavedControls reasonId={controlReasonId} controls={["Approve", "Deny", "Pause", "Cancel"]} />
        </div>
      </Section>

      <Section id="policy" title="Policy decisions" description="recorded policy versions, read-only">
        {view.policyDecisions.length === 0 ? (
          <EmptyState title="No policy decisions" description="no policy_decision recorded in this saved bundle" />
        ) : (
          <ul>
            {view.policyDecisions.map((decision) => (
              <li key={decision.source.ref} className="border-b border-border/60 py-2 text-sm last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatePill tone={decision.decision === "approval-required" ? "warning" : "info"}>{decision.decision}</StatePill>
                  <Citation source={decision.source} label="policy decision" />
                </div>
                <p className="mt-1 text-muted-foreground">
                  tzdb {decision.tzdbVersion} · window {decision.window || "unrecorded"} · evaluated {formatTimestamp(decision.evaluatedAt)}
                </p>
                {decision.reason !== null ? <p className="text-xs text-muted-foreground">reason: {decision.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="artifacts" title="Sealed artifacts" description="every artifact shows its schema, version, and content hash">
        {view.artifacts.length === 0 ? (
          <EmptyState title="No artifacts" description="this incident's journal sealed no artifacts" />
        ) : (
          <ul>
            {view.artifacts.map((artifact) => (
              <li key={artifact.contentHash} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
                <Link
                  to="/incidents/$id/artifacts/$hash"
                  params={{ id: view.incidentId, hash: artifact.contentHash.slice("sha256:".length) }}
                  className="font-mono text-xs hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {artifact.schemaId}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">v{artifact.schemaVersion}</span>
                <Citation source={artifact.source} label="artifact hash" />
                <span className="text-xs text-muted-foreground">sealed {formatTimestamp(artifact.sealedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="audit" title="Audit trail (journal tail)" description="append-only journal tail, ordered by sequence">
        <div className="overflow-x-auto" role="region" aria-label="Journal tail">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-2 py-2">Seq</th>
                <th scope="col" className="px-2 py-2">Event</th>
                <th scope="col" className="px-2 py-2">Actor</th>
                <th scope="col" className="px-2 py-2">Policy</th>
                <th scope="col" className="px-2 py-2">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {view.journalTail.map((event) => (
                <tr key={event.sequence} className="border-b border-border/60">
                  <td className="px-2 py-1.5 font-mono text-xs">{event.sequence}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{event.type}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{event.actorId} ({event.actorKind})</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{event.policyVersion}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{event.recordedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  )
}
