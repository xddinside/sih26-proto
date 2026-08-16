/**
 * Panel 3 — Trigger and intake: the IncidentTrigger v1 fields, the intake
 * snapshot links, delivery history with dedup no-ops, and the demo HMAC note.
 */
import { Citation, CitedValue } from "../../../incidents/components/citation"
import { Section } from "../../../incidents/components/section"
import { EmptyState } from "../../../incidents/components/states"
import { StatePill } from "../../../incidents/components/badge"
import { BACKEND_LABELS } from "../../constants"
import { FieldRow, MonoCell, TableHead, TableRegion } from "../workspace-primitives"
import type { IntakePanelView, IntakeTriggerView } from "../../lib/workspace-projection"

function TriggerRow({ trigger }: { trigger: IntakeTriggerView }) {
  return (
    <li className="border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{trigger.triggerId}</span>
        <StatePill tone={trigger.state === "resolved" ? "positive" : "warning"}>{trigger.state}</StatePill>
        <StatePill tone="neutral">delivery {trigger.deliveryResult}</StatePill>
        <Citation source={{ kind: "journal", ref: String(trigger.sequence) }} label="trigger journal" />
      </div>
      <dl className="mt-2">
        <FieldRow label="Rule">
          <span className="font-mono text-xs">{trigger.ruleId}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">version {trigger.ruleVersion}</span>
        </FieldRow>
        <FieldRow label="Detector">
          <span className="font-mono text-xs">{trigger.detectorSource}</span>
          <span className="ml-2 text-xs text-muted-foreground">connection astronomy-shop-local</span>
        </FieldRow>
        <FieldRow label="Signal">
          <CitedValue value={trigger.signalName} source={{ kind: "journal", ref: String(trigger.sequence) }} label="signal name" />
          <span className="ml-2">recorded value </span>
          <CitedValue value={trigger.signalValue} source={{ kind: "journal", ref: String(trigger.sequence) }} label="signal value" />
          <span className="ml-2">threshold </span>
          <CitedValue value={trigger.signalThreshold} source={{ kind: "journal", ref: String(trigger.sequence) }} label="signal threshold" />
        </FieldRow>
        <FieldRow label="Window">
          <span className="font-mono text-xs">
            {trigger.window.startsAt} → {trigger.window.endsAt ?? "open"}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">lookback {trigger.window.lookbackSeconds}s · received {trigger.receivedAt}</span>
        </FieldRow>
        <FieldRow label="Keys">
          <span className="font-mono text-[11px] text-muted-foreground">delivery {trigger.deliveryKey}</span>
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">incident {trigger.incidentKey}</span>
        </FieldRow>
      </dl>
      {trigger.evidenceRefs.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Intake snapshot links</p>
          <ul className="mt-1">
            {trigger.evidenceRefs.map((reference, index) => (
              <li key={`${reference.kind}-${index}`} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1 text-sm last:border-b-0">
                <a href={reference.uri} className="text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {BACKEND_LABELS[reference.backend] ?? reference.backend}
                </a>
                <span className="font-mono text-xs text-muted-foreground">{reference.kind}</span>
                {reference.traceId !== null ? <span className="font-mono text-xs text-muted-foreground">{reference.traceId}</span> : null}
                {reference.observedAt !== null ? <span className="text-xs text-muted-foreground">observed {reference.observedAt}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        links are navigation aids; the saved snapshot is the durable copy.
      </p>
    </li>
  )
}

export function IntakePanel({ intake }: { intake: IntakePanelView }) {
  return (
    <Section
      id="workspace-intake"
      title="Trigger and intake"
      description="IncidentTrigger v1 fields, intake snapshot links, and the delivery history with dedup no-ops"
    >
      {intake.triggers.length === 0 ? (
        <EmptyState title="No trigger recorded" description="this incident's journal has no trigger_received event" />
      ) : (
        <ul className="space-y-3">
          {intake.triggers.map((trigger) => (
            <TriggerRow key={`${trigger.triggerId}-${trigger.sequence}`} trigger={trigger} />
          ))}
        </ul>
      )}
      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Delivery history</p>
        <TableRegion label="Trigger delivery history" minWidth="min-w-[36rem]" summary="dedup by delivery_key; a replayed webhook records a duplicate-noop, never a second Incident">
          <TableHead columns={["Sequence", "Trigger", "State", "Delivery result"]} />
          <tbody>
            {intake.triggers.map((trigger) => (
              <tr key={trigger.sequence} className="border-b border-border/60">
                <MonoCell>{trigger.sequence}</MonoCell>
                <MonoCell>{trigger.triggerId}</MonoCell>
                <MonoCell>{trigger.state}</MonoCell>
                <MonoCell>{trigger.deliveryResult}</MonoCell>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{intake.hmacNote}</p>
    </Section>
  )
}
