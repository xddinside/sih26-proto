/**
 * Pure read projections from the verified {@link ReplayStore} into the
 * plain, JSON-serializable view models the route components render.
 *
 * Every number or fact in a view carries a {@link Source} citation binding so
 * the UI can render "receipts own numbers" visibly (docs/research/
 * incident-workspace.md). These functions never mutate the store and never
 * fabricate data: a field absent from the journal stays null and the UI marks
 * the gap rather than inventing a value.
 */
import type { RunRecord } from "@sih/contracts/journal"
import { STAGE_ORDER } from "@sih/contracts/transitions"
import type { StageName } from "@sih/contracts/transitions"
import type {
  ArtifactEnvelope,
  IncidentTrigger,
  JournalEvent,
} from "@sih/contracts/types"

import { getAuthorizedArtifact, getIncidentDetail, listIncidents } from "../../../lib/replay/replay-reads"
import type { AuthorizedArtifact, IncidentDetail } from "../../../lib/replay/replay-reads"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import type { Source } from "./format"
import { formatRatio } from "./format"

/** Presentation meta for the standing saved-run banner. */
export interface PresentationMeta {
  formatVersion: string
  captureTime: string
  evaluationTime: string
  incidentCount: number
}

const REPLAY_SOURCE: Source = { kind: "replay", ref: "replay" }
const MANIFEST_SOURCE: Source = { kind: "manifest", ref: "manifest" }

function journalSource(sequence: number): Source {
  return { kind: "journal", ref: String(sequence) }
}

function receiptSource(receiptId: string): Source {
  return { kind: "receipt", ref: receiptId }
}

function artifactSource(envelope: ArtifactEnvelope): Source {
  return {
    kind: "artifact",
    ref: envelope.content_hash,
    schemaId: envelope.artifact_schema_id,
  }
}

function metaOf(store: ReplayStore): PresentationMeta {
  return {
    formatVersion: store.manifest.format_version,
    captureTime: store.manifest.capture_time,
    evaluationTime: "",
    incidentCount: store.incidents.length,
  }
}

/** One incident list row, every field bound to a saved source. */
export interface IncidentListRow {
  incidentId: string
  state: string | null
  closureReason: string | null
  detectorState: string | null
  severity: string | null
  serviceName: string | null
  environmentName: string | null
  ruleId: string | null
  ruleVersion: string | null
  firstTriggerAt: string | null
  firstTriggerSource: Source | null
  lastActivityAt: string | null
  lastActivitySource: Source | null
  attemptsUsed: number
  attemptsSource: Source
  finalSequence: number
  finalSequenceSource: Source
  runCount: number
  artifactCount: number
  latestRun: {
    attempt: number
    state: string
    outcome: string | null
    failureReason: string | null
  } | null
  latestRunSource: Source | null
}

/** The incident list view. */
export interface ListView {
  meta: PresentationMeta
  incidents: IncidentListRow[]
}

function firstTrigger(events: readonly JournalEvent[]): {
  trigger: IncidentTrigger
  sequence: number
} | null {
  for (const event of events) {
    if (event.type === "trigger_received") {
      return { trigger: event.trigger, sequence: event.sequence }
    }
  }
  return null
}

/** The detector state recorded by the last trigger event, or null. */
function lastDetectorState(events: readonly JournalEvent[]): string | null {
  let state: string | null = null
  for (const event of events) {
    if (event.type === "trigger_received") {
      state = event.trigger.state
    }
  }
  return state
}

/** The last non-creating run transition, or null when the run never progressed. */
function latestRunTransition(events: readonly JournalEvent[]): Extract<JournalEvent, { type: "run_transition" }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type === "run_transition" && event.from !== null) {
      return event
    }
  }
  return null
}

/** Derive a list row from an Incident's ordered events and replayed state. */
function rowOf(
  incidentId: string,
  events: readonly JournalEvent[],
  state: string | null,
  closureReason: string | undefined,
  attemptsUsed: number,
  finalSequence: number,
  runCount: number,
  artifactCount: number,
): IncidentListRow {
  const trigger = firstTrigger(events)
  const last = events.at(-1)
  const latestRunTransitionEvent = latestRunTransition(events)

  return {
    incidentId,
    state,
    closureReason: closureReason ?? null,
    detectorState: lastDetectorState(events),
    severity: trigger?.trigger.severity ?? null,
    serviceName: trigger?.trigger.scope.service_name ?? null,
    environmentName: trigger?.trigger.scope.deployment_environment_name ?? null,
    ruleId: trigger?.trigger.detector.rule_id ?? null,
    ruleVersion: trigger?.trigger.detector.rule_version ?? null,
    firstTriggerAt: trigger?.trigger.received_at ?? null,
    firstTriggerSource: trigger === null ? null : journalSource(trigger.sequence),
    lastActivityAt: last?.recorded_at ?? null,
    lastActivitySource: last === undefined ? null : journalSource(last.sequence),
    attemptsUsed,
    attemptsSource: REPLAY_SOURCE,
    finalSequence,
    finalSequenceSource: MANIFEST_SOURCE,
    runCount,
    artifactCount,
    latestRun:
      latestRunTransitionEvent === null
        ? null
        : {
            attempt: latestRunTransitionEvent.attempt,
            state: latestRunTransitionEvent.to,
            outcome: latestRunTransitionEvent.outcome ?? null,
            failureReason: latestRunTransitionEvent.failure_reason ?? null,
          },
    latestRunSource:
      latestRunTransitionEvent === null ? null : journalSource(latestRunTransitionEvent.sequence),
  }
}

/** Project the incident list view from a verified store. */
export function listView(store: ReplayStore): ListView {
  const meta = metaOf(store)
  const summaries = listIncidents(store)
  const incidents = store.incidents.map((incident, index) => {
    const summary = summaries[index]
    return rowOf(
      incident.incidentId,
      incident.events,
      summary.state,
      summary.closureReason,
      summary.attemptsUsed,
      incident.finalSequence,
      summary.runCount,
      summary.artifactCount,
    )
  })
  return { meta, incidents }
}

/** One stage chip for an attempt, with its journal citation. */
export interface StageView {
  stage: StageName
  status: string | null
  reason: string | null
  candidateHash: string | null
  artifactSchemaId: string | null
  artifactContentHash: string | null
  source: Source | null
}

/** One Incident Run attempt with its fixed-order stage chips. */
export interface RunView {
  runId: string
  attempt: number
  state: string
  outcome: string | null
  failureReason: string | null
  restartCount: number
  stages: StageView[]
}

/** A hypothesis-gate check row: counts and citations only, never prose. */
export interface GateCheckView {
  check: string
  result: boolean
  counts: { key: string; value: number }[]
  citedItemIds: string[]
  reason: string | null
}

/** A release/action gate fact row. */
export interface GateFactView {
  fact: string
  result: boolean
  evidence: { kind: string; ref: string }[]
}

/** One gate evaluation with its journal citation. */
export interface GateView {
  gate: string
  verdict: string
  evaluatedAt: string
  policyVersion: string
  tzdbVersion: string | null
  hypothesisId: string | null
  candidateHash: string | null
  checks: GateCheckView[]
  facts: GateFactView[]
  source: Source
}

/** One broker receipt with its receipt-id and journal citation. */
export interface ReceiptView {
  receiptId: string
  kind: string
  stage: string | null
  source: Source
  fields: { label: string; text: string; source: Source }[]
}

/** One recorded approval decision. */
export interface ApprovalView {
  approvalId: string
  action: string
  approverIdentity: string
  approvalSystem: string
  policyVersion: string
  tzdbVersion: string
  actionRiskClass: string
  expiry: string
  target: string | null
  changedSurfaces: string[]
  source: Source
}

/** One policy decision record. */
export interface PolicyDecisionView {
  decision: string
  tzdbVersion: string
  window: string
  evaluatedAt: string
  reason: string | null
  source: Source
}

/** One journal tail event. */
export interface JournalTailView {
  sequence: number
  type: string
  recordedAt: string
  actorId: string
  actorKind: string
  policyVersion: string
}

/** One sealed artifact link. */
export interface ArtifactLinkView {
  contentHash: string
  schemaId: string
  schemaVersion: string
  sealedAt: string
  producerSkill: string | null
  producerSkillVersion: string | null
  source: Source
}

/** The incident detail view. */
export interface DetailView {
  meta: PresentationMeta
  incidentId: string
  state: string | null
  closureReason: string | null
  detectorState: string | null
  severity: string | null
  scope: { tenantId: string; environment: string; service: string } | null
  attemptsUsed: number
  attemptsSource: Source
  finalSequence: number
  finalSequenceSource: Source
  firstTrigger: {
    triggerId: string
    deliveryKey: string
    incidentKey: string
    receivedAt: string
    ruleId: string
    ruleVersion: string
    detectorSource: string
    state: string
    signalName: string
    signalValue: string
    signalThreshold: string
    source: Source
  } | null
  resolvedTrigger: {
    receivedAt: string
    signalValue: string
    source: Source
  } | null
  runs: RunView[]
  hypothesisGate: GateView | null
  releaseGate: GateView | null
  actionGate: GateView | null
  receipts: ReceiptView[]
  approvals: ApprovalView[]
  policyDecisions: PolicyDecisionView[]
  journalTail: JournalTailView[]
  artifacts: ArtifactLinkView[]
}

function stageRecordOf(
  run: RunRecord,
  stage: StageName,
): NonNullable<RunRecord["stageRecords"]>[number] | undefined {
  for (let i = run.stageRecords.length - 1; i >= 0; i -= 1) {
    const record = run.stageRecords[i]
    if (record.stage === stage) {
      return record
    }
  }
  return undefined
}

function runViewOf(detail: IncidentDetail, run: RunRecord): RunView {
  const stages = STAGE_ORDER.map((stage) => {
    const record = stageRecordOf(run, stage)
    let source: Source | null = null
    for (let i = detail.events.length - 1; i >= 0; i -= 1) {
      const event = detail.events[i]
      if (
        event.type === "stage_transition" &&
        event.run_id === run.runId &&
        event.attempt === run.attempt &&
        event.stage === stage
      ) {
        source = journalSource(event.sequence)
        break
      }
    }
    return {
      stage,
      status: record?.to ?? null,
      reason: record?.reason ?? null,
      candidateHash: record?.candidateHash ?? null,
      artifactSchemaId: record?.artifactRef?.schema_id ?? null,
      artifactContentHash: record?.artifactRef?.content_hash ?? null,
      source,
    }
  })
  return {
    runId: run.runId,
    attempt: run.attempt,
    state: run.state,
    outcome: run.outcome ?? null,
    failureReason: run.failureReason ?? null,
    restartCount: run.restartCount,
    stages,
  }
}

function gateViewOf(event: Extract<JournalEvent, { type: "gate_evaluated" }>): GateView {
  const evaluation = event.evaluation
  const base: GateView = {
    gate: evaluation.gate,
    verdict: evaluation.verdict,
    evaluatedAt: evaluation.evaluated_at,
    policyVersion: evaluation.policy_version,
    tzdbVersion: null,
    hypothesisId: null,
    candidateHash: null,
    checks: [],
    facts: [],
    source: journalSource(event.sequence),
  }

  if (evaluation.gate === "hypothesis") {
    base.hypothesisId = evaluation.hypothesis_id
    base.checks = evaluation.checks.map((check) => ({
      check: check.check,
      result: check.result,
      counts: Object.entries(check.counts ?? {}).map(([key, value]) => ({ key, value })),
      citedItemIds: check.cited_item_ids ?? [],
      reason: check.reason ?? null,
    }))
    return base
  }

  base.candidateHash = evaluation.candidate_hash
  base.tzdbVersion = evaluation.tzdb_version
  base.facts = evaluation.facts.map((fact) => ({
    fact: fact.fact,
    result: fact.result,
    evidence: fact.evidence_refs.map((reference) => ({ kind: reference.kind, ref: reference.ref })),
  }))
  return base
}

function receiptsOf(detail: IncidentDetail): ReceiptView[] {
  const views: ReceiptView[] = []
  for (const event of detail.events) {
    if (event.type !== "broker_receipt_recorded") {
      continue
    }
    const receipt = event.receipt
    const source = receiptSource(receipt.receipt_id)
    const journal = journalSource(event.sequence)
    const fields: ReceiptView["fields"] = []
    if (receipt.kind === "test") {
      fields.push({ label: "layer", text: receipt.layer, source })
      fields.push({ label: "tool", text: `${receipt.tool} ${receipt.tool_version}`, source })
      fields.push({ label: "target", text: receipt.target, source })
      for (const run of receipt.runs) {
        fields.push({
          label: `run ${run.result}`,
          text: run.detail ?? run.at,
          source,
        })
      }
      fields.push({ label: "outcome", text: receipt.outcome, source })
      fields.push({
        label: "candidate hash",
        text: receipt.candidate_hash,
        source: artifactSourceForHash(receipt.candidate_hash),
      })
    } else if (receipt.kind === "ci") {
      fields.push({ label: "pipeline", text: receipt.pipeline, source })
      fields.push({ label: "status", text: receipt.status, source })
      for (const step of receipt.steps) {
        fields.push({ label: `step ${step.name}`, text: step.status, source })
      }
      if (receipt.artifact_digest !== undefined) {
        fields.push({
          label: "artifact digest",
          text: receipt.artifact_digest,
          source: artifactSourceForHash(receipt.artifact_digest),
        })
      }
    } else if (receipt.kind === "read") {
      fields.push({ label: "backend", text: receipt.request.backend, source })
      fields.push({ label: "query", text: receipt.request.query, source })
      fields.push({ label: "outcome", text: receipt.result.outcome, source })
      if (receipt.result.row_count !== undefined) {
        fields.push({
          label: "row count",
          text: String(receipt.result.row_count),
          source,
        })
      }
    } else {
      fields.push({ label: "action", text: receipt.action.command, source })
      fields.push({ label: "outcome", text: receipt.outcome, source })
    }
    views.push({
      receiptId: receipt.receipt_id,
      kind: receipt.kind,
      stage: receipt.stage,
      source: journal,
      fields,
    })
  }
  return views
}

function artifactSourceForHash(contentHash: string): Source {
  return { kind: "artifact", ref: contentHash }
}

function approvalsOf(detail: IncidentDetail): ApprovalView[] {
  const views: ApprovalView[] = []
  for (const event of detail.events) {
    if (event.type !== "approval_recorded") {
      continue
    }
    const approval = event.approval
    views.push({
      approvalId: approval.approval_id,
      action: approval.action,
      approverIdentity: approval.approver_identity,
      approvalSystem: approval.approval_system,
      policyVersion: approval.policy_version,
      tzdbVersion: approval.tzdb_version,
      actionRiskClass: approval.action_risk_class,
      expiry: approval.expiry,
      target: approval.scope?.target ?? null,
      changedSurfaces: approval.scope?.changed_surfaces ?? [],
      source: journalSource(event.sequence),
    })
  }
  return views
}

function policyDecisionsOf(detail: IncidentDetail): PolicyDecisionView[] {
  const views: PolicyDecisionView[] = []
  for (const event of detail.events) {
    if (event.type !== "policy_decision") {
      continue
    }
    const window = event.window
    const windows = (window?.windows ?? [])
      .map(
        (entry) =>
          `${entry.start_weekday} ${entry.start_time}–${entry.end_weekday} ${entry.end_time}`,
      )
      .join(", ")
    views.push({
      decision: event.decision,
      tzdbVersion: event.tzdb_version,
      window: window === undefined ? "" : `${window.iana_zone} ${windows}`,
      evaluatedAt: event.evaluated_at,
      reason: event.reason ?? null,
      source: journalSource(event.sequence),
    })
  }
  return views
}

function journalTailOf(detail: IncidentDetail, count: number): JournalTailView[] {
  return detail.events.slice(-count).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    recordedAt: event.recorded_at,
    actorId: event.actor.id,
    actorKind: event.actor.kind,
    policyVersion: event.policy_version,
  }))
}

function artifactsOf(detail: IncidentDetail): ArtifactLinkView[] {
  return detail.artifacts.map((artifact) => ({
    contentHash: artifact.contentHash,
    schemaId: artifact.envelope.artifact_schema_id,
    schemaVersion: artifact.envelope.artifact_schema_version,
    sealedAt: artifact.envelope.sealed_at,
    producerSkill: artifact.envelope.producer.skill ?? null,
    producerSkillVersion: artifact.envelope.producer.skill_version ?? null,
    source: artifactSource(artifact.envelope),
  }))
}

function gateOf(detail: IncidentDetail, gate: "hypothesis" | "release" | "action"): GateView | null {
  for (let i = detail.events.length - 1; i >= 0; i -= 1) {
    const event = detail.events[i]
    if (event.type === "gate_evaluated" && event.gate === gate) {
      return gateViewOf(event)
    }
  }
  return null
}

/** Project the incident detail view from a verified store. */
export function detailView(
  store: ReplayStore,
  incidentId: string,
  evaluationTime: string,
): DetailView | null {
  const result = getIncidentDetail(store, incidentId)
  if (!result.ok) {
    return null
  }
  const detail = result.value
  const meta = metaOf(store)
  meta.evaluationTime = evaluationTime

  const trigger = firstTrigger(detail.events)
  let resolved: Extract<JournalEvent, { type: "trigger_received" }> | undefined
  for (const event of detail.events) {
    if (event.type === "trigger_received" && event.trigger.state === "resolved") {
      resolved = event
    }
  }

  const firstTriggerView =
    trigger === null
      ? null
      : {
          triggerId: trigger.trigger.trigger_id,
          deliveryKey: trigger.trigger.delivery_key,
          incidentKey: trigger.trigger.incident_key,
          receivedAt: trigger.trigger.received_at,
          ruleId: trigger.trigger.detector.rule_id,
          ruleVersion: trigger.trigger.detector.rule_version,
          detectorSource: trigger.trigger.detector.source,
          state: trigger.trigger.state,
          signalName: trigger.trigger.signal_summary.name,
          signalValue: formatRatio(trigger.trigger.signal_summary.value, trigger.trigger.signal_summary.unit),
          signalThreshold: formatRatio(trigger.trigger.signal_summary.threshold, trigger.trigger.signal_summary.unit),
          source: journalSource(trigger.sequence),
        }

  const resolvedTriggerView =
    resolved === undefined
      ? null
      : {
          receivedAt: resolved.trigger.received_at,
          signalValue: formatRatio(resolved.trigger.signal_summary.value, resolved.trigger.signal_summary.unit),
          source: journalSource(resolved.sequence),
        }

  return {
    meta,
    incidentId: detail.incidentId,
    state: detail.state,
    closureReason: detail.closureReason ?? null,
    detectorState: lastDetectorState(detail.events),
    severity: trigger?.trigger.severity ?? null,
    scope:
      trigger === null
        ? null
        : {
            tenantId: trigger.trigger.scope.tenant_id,
            environment: trigger.trigger.scope.deployment_environment_name,
            service: trigger.trigger.scope.service_name,
          },
    attemptsUsed: detail.attemptsUsed,
    attemptsSource: REPLAY_SOURCE,
    finalSequence: detail.finalSequence,
    finalSequenceSource: MANIFEST_SOURCE,
    firstTrigger: firstTriggerView,
    resolvedTrigger: resolvedTriggerView,
    runs: detail.runs.map((run) => runViewOf(detail, run)),
    hypothesisGate: gateOf(detail, "hypothesis"),
    releaseGate: gateOf(detail, "release"),
    actionGate: gateOf(detail, "action"),
    receipts: receiptsOf(detail),
    approvals: approvalsOf(detail),
    policyDecisions: policyDecisionsOf(detail),
    journalTail: journalTailOf(detail, 12),
    artifacts: artifactsOf(detail),
  }
}

/** One artifact envelope rendered for the authorized viewer. */
export interface ArtifactView {
  incidentId: string
  contentHash: string
  path: string
  schemaId: string
  schemaVersion: string
  sealedAt: string
  runId: string | null
  producer: {
    skill: string | null
    skillVersion: string | null
    tool: string | null
    toolVersion: string | null
    toolCatalogVersion: string | null
    resolverVersion: string | null
  }
  redaction: { profileId: string; maskedFields: string[] } | null
  provenance: string[]
  payload: unknown
}

/** Project the authorized artifact envelope for the artifact viewer. */
export function artifactView(
  store: ReplayStore,
  incidentId: string,
  contentHash: string,
): ArtifactView | null {
  const result = getAuthorizedArtifact(store, incidentId, contentHash)
  if (!result.ok) {
    return null
  }
  const artifact: AuthorizedArtifact = result.value
  const envelope = artifact.envelope
  return {
    incidentId,
    contentHash: envelope.content_hash,
    path: artifact.path,
    schemaId: envelope.artifact_schema_id,
    schemaVersion: envelope.artifact_schema_version,
    sealedAt: envelope.sealed_at,
    runId: envelope.run_id ?? null,
    producer: {
      skill: envelope.producer.skill ?? null,
      skillVersion: envelope.producer.skill_version ?? null,
      tool: envelope.producer.tool ?? null,
      toolVersion: envelope.producer.tool_version ?? null,
      toolCatalogVersion: envelope.producer.tool_catalog_version ?? null,
      resolverVersion: envelope.producer.resolver_version ?? null,
    },
    redaction:
      envelope.redaction === undefined
        ? null
        : {
            profileId: envelope.redaction.profile_id,
            maskedFields: envelope.redaction.masked_fields,
          },
    provenance: envelope.provenance ?? [],
    payload: envelope.payload,
  }
}
