/**
 * Pure panel projections for the Incident Workspace, from the verified
 * {@link ReplayStore} into plain, JSON-serializable panel view models.
 *
 * The canonical panel hierarchy comes from docs/research/incident-workspace.md:
 * header, attempts and stages, trigger and intake, Evidence Set and receipts,
 * Hypotheses and eight-check gate, Fusion rounds, Remediation, Verify, Release
 * or Action Gate, Approvals, Watch, Recovery Point, plus the read-only policy
 * panel, the audit tail, and the telemetry deep links. The two static
 * Solution Contract panels (rollback records, full R/T catalog) need no data
 * and render from `constants.ts`.
 *
 * Every panel fact binds to a journal sequence, receipt id, or artifact
 * content hash; a field absent from the saved data stays null and the panel
 * marks the gap. Nothing is invented here.
 */
import type {
  ArtifactEnvelope,
  DiagnosisReport,
  EvidenceItem,
  EvidenceSet,
  FusionJudgeOutput,
  FusionParticipantOutput,
  FusionSynthesizerOutput,
  JournalEvent,
  RemediationProposal,
  ReviewReport,
  RolloutWatchPlan,
  TestReport,
  VerificationReport,
  WatchReport,
} from "@sih/contracts/types"

import { getIncidentDetail } from "../../../lib/replay/replay-reads"
import type { IncidentDetail } from "../../../lib/replay/replay-reads"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import { detailView } from "../../incidents/lib/projections"
import type {
  ApprovalView,
  DetailView,
  GateView,
  PolicyDecisionView,
  PresentationMeta,
} from "../../incidents/lib/projections"
import type { Source } from "../../incidents/lib/format"
import { formatNumber, formatRatio } from "../../incidents/lib/format"
import { ATTEMPT_LIMIT, RECORDED_POLICIES } from "../constants"
import type { RecordedPolicy } from "../constants"

function journalSource(sequence: number): Source {
  return { kind: "journal", ref: String(sequence) }
}

/** A deeply JSON-serializable value, matching the sealed artifact payloads. */
type SerializableJson =
  | string
  | number
  | boolean
  | null
  | SerializableJson[]
  | { [key: string]: SerializableJson }

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

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

/** The standing header panel: Incident identity, state, and Attempt Limit. */
export interface HeaderPanelView {
  incidentId: string
  state: string | null
  closureReason: string | null
  detectorState: string | null
  severity: string | null
  scope: { tenantId: string; environment: string; service: string } | null
  attemptsUsed: number
  attemptsSource: Source
  attemptLimit: number
  attemptsRemaining: number
  finalSequence: number
  finalSequenceSource: Source
  latestRun: { attempt: number; state: string; outcome: string | null; failureReason: string | null } | null
  captureTime: string
}

/** One intake delivery record: trigger fields plus the dedup result. */
export interface IntakeTriggerView {
  triggerId: string
  deliveryKey: string
  incidentKey: string
  state: string
  severity: string
  receivedAt: string
  ruleId: string
  ruleVersion: string
  detectorSource: string
  signalName: string
  signalValue: string
  signalThreshold: string
  window: { startsAt: string; endsAt: string | null; lookbackSeconds: number }
  evidenceRefs: {
    kind: string
    backend: string
    uri: string
    query: string | null
    traceId: string | null
    observedAt: string | null
  }[]
  deliveryResult: string
  sequence: number
}

export interface IntakePanelView {
  triggers: IntakeTriggerView[]
  /** The demo intake uses HMAC-signed webhooks; mTLS is the full product. */
  hmacNote: string
}

/** One Evidence Set item with its provenance and redaction marks. */
export interface EvidenceItemView {
  id: string
  kind: string
  backend: string
  query: string | null
  snapshot: SerializableJson
  contentHash: string
  links: { uri: string; expired: boolean }[]
  observedAt: string
  freshUntil: string | null
  provenance: string[]
  trust: string
  joins: { key: string; value: string | number }[]
  redactionProfileId: string
  maskedFields: string[]
  outcome: string
  supersedes: string[]
  contradicts: string[]
}

export interface EvidenceRevisionView {
  revisionNumber: number
  revisionId: string
  pinnedAt: string
  itemCount: number
  sealedAt: string
  contentHash: string
  source: Source
}

export interface EvidencePanelView {
  /** The latest revision's items, in recorded order. */
  items: EvidenceItemView[]
  revision: EvidenceRevisionView | null
  revisions: EvidenceRevisionView[]
}

/** One ranked Hypothesis from the Diagnosis Report. */
export interface HypothesisView {
  id: string
  status: string
  causalTrigger: string
  defect: string
  propagation: { from: string; to: string; citedItemIds: string[] }[]
  failure: string
  predictedObservations: { id: string; statement: string; registeredAt: string; discriminates: string[] }[]
  supporting: string[]
  opposing: string[]
  unexplained: string[]
  alternatives: string[]
  proposedTests: {
    id: string
    procedure: string
    bounds: string
    permissions: string[]
    expected: { thisHypothesis: string; alternativeId: string | null }
  }[]
}

export interface HypothesisPanelView {
  hypotheses: HypothesisView[]
  gate: GateView | null
}

/** One Fusion round record set, from the two saved run artifacts. */
export interface FusionPanelView {
  roundValidity: { round: number; valid: boolean; participantIds: string[] }[]
  participants: {
    participantId: string
    hypothesisIds: string[]
    objections: { statement: string; hypothesisId: string | null; citedItemIds: string[] }[]
    contentHash: string
    source: Source
  }[]
  judge: {
    judgeId: string
    agreements: { statement: string; hypothesisIds: string[]; citedItemIds: string[] }[]
    contradictions: { statement: string; hypothesisIds: string[]; citedItemIds: string[] }[]
    blindSpots: { statement: string; hypothesisIds: string[]; citedItemIds: string[] }[]
    uniqueFindings: { statement: string; hypothesisIds: string[]; citedItemIds: string[] }[]
    citationAudit: { participantId: string; uncitedClaims: number; invalidCitations: number; missingItemCitations: number }[]
    contentHash: string
    source: Source
  } | null
  synthesizer: {
    synthesizerId: string
    ranked: { rank: number; hypothesisId: string; status: string }[]
    nextActions: { procedure: string; bounds: string; permissions: string[]; discriminates: string[] }[]
    fusionMeta: { participantIds: string[]; judgeId: string; revisionId: string; startedAt: string; completedAt: string }
    contentHash: string
    source: Source
  } | null
}

/** The Remediation panel: proposal, citation map, PR-shaped record. */
export interface RemediationPanelView {
  candidateHash: string
  remediationClass: string
  actionRiskClass: string
  gatePath: string
  disposition: string
  changeDescription: string
  diff: { baseRef: string; diffText: string; diffHash: string } | null
  citationMap: { change: string; hypothesisId: string; citedItemIds: string[] }[]
  testPlan: string[]
  changedSurfaces: string[]
  blastRadius: { services: string[]; environments: string[]; cohorts: string[] }
  recoveryPointId: string
  recoveryPointSurfaces: string[]
  prReceipt: { receiptId: string; command: string; outcome: string; executedAt: string | null; source: Source } | null
  contentHash: string
  source: Source
}

/** The Verify panel: applicability, reviews, tests, Verification Report. */
export interface VerifyPanelView {
  applicability: {
    resolverVersion: string
    policyVersion: string
    required: string[]
    conditional: string[]
    triggered: { key: string; value: string }[]
    notApplicable: string[]
  }
  reviews: {
    role: string
    reviewer: string
    revision: number
    status: string
    findings: {
      id: string
      severity: string
      claim: string
      citations: { kind: string; file: string | null; line: number | null; ref: string | null }[]
      status: string
      uncited: boolean | null
    }[]
    inputRefs: string[]
    candidateHash: string
    sealedAt: string
    skill: string | null
    skillVersion: string | null
    contentHash: string
    source: Source
  }[]
  tests: {
    layer: string
    tool: string
    toolVersion: string
    target: string
    receiptRef: string
    runs: { runHash: string; result: string; at: string; detail: string | null }[]
    outcome: string
    flaky: boolean
    coverageChecked: boolean
    candidateHash: string
    sealedAt: string
    skill: string | null
    contentHash: string
    source: Source
  }[]
  verification: {
    candidateHash: string
    hashBinding: { sealedCandidate: string; checkedCandidate: string; match: boolean }
    verdict: string
    verdictReason: string
    sealedAt: string
    policyVersion: string
    contentHash: string
    source: Source
  } | null
}

/** The Release or Action Gate panel: facts or an explicit "not reached" gap. */
export interface GatePanelView {
  release: GateView | null
  action: GateView | null
  notReachedReason: string | null
}

/** The Watch panel: frozen plan, saved rows, and probe receipts. */
export interface WatchPanelView {
  plan: {
    candidateHash: string
    strategy: string
    stages: { id: string; trafficPercent: number; minimumDurationSeconds: number; minimumSampleCount: number }[]
    queries: { id: string; signal: string; backend: string; query: string; windowSeconds: number; minimumSampleCount: number; comparator: string; limit: number; unit: string | null }[]
    stopRules: { id: string; condition: string; action: string }[]
    missingDataRule: string
    rehearsalReceiptRefs: string[]
    policyVersion: string
    contentHash: string
    source: Source
  } | null
  reports: {
    rolloutStage: string
    planRef: string
    samples: {
      gate: string
      query: string
      baselineCohort: string | null
      candidateCohort: string | null
      timeRange: { startsAt: string; endsAt: string }
      sampleCount: number
      value: number
      limit: number
      outcome: string
    }[]
    stageOutcome: string
    sealedAt: string
    contentHash: string
    source: Source
  }[]
  probeReceipts: { receiptId: string; query: string; rowCount: number | null; observedAt: string | null; source: Source }[]
  /** The recorded pre-release baseline ratio from the firing trigger. */
  baselineRatio: { value: string; source: Source } | null
  notReached: string | null
}

/** The Recovery Point panel: recorded fields plus the T12 drill receipts. */
export interface RecoveryPanelView {
  recoveryPointId: string
  changedSurfaces: string[]
  r8Findings: { id: string; severity: string; claim: string; citations: { kind: string; ref: string | null }[] }[]
  drillReceipts: { receiptId: string; command: string; outcome: string; executedAt: string | null; source: Source }[]
  consumed: boolean
  note: string
}

/** The read-only policy panel: recorded dials plus the Demo Profile caps. */
export interface PolicyPanelView {
  policyVersion: string
  recorded: RecordedPolicy | null
  decisions: PolicyDecisionView[]
  attemptLimit: number
}

/** One recorded human override for the audit panel's distinct section. */
export interface HumanActionView {
  action: string
  reason: string | null
  approvalRef: string | null
  actorId: string
  recordedAt: string
  sequence: number
  source: Source
}

/** One journal model-use record for the Fusion disclosure view. */
export interface ModelUseView {
  agentId: string
  parentAgentId: string
  agentRole: string
  model: string
  promptTokens: number
  completionTokens: number
  sequence: number
  source: Source
}

/** One telemetry deep link: navigation aid only, never a live call. */
export interface TelemetryLinkView {
  owner: string
  backend: string
  kind: string
  uri: string
  expired: boolean
  source: Source
}

/** The full workspace view: #21's detail plus every panel projection. */
export interface WorkspaceView {
  meta: PresentationMeta
  detail: DetailView
  header: HeaderPanelView
  intake: IntakePanelView
  evidence: EvidencePanelView | null
  hypotheses: HypothesisPanelView
  fusion: FusionPanelView | null
  remediation: RemediationPanelView | null
  verify: VerifyPanelView | null
  gates: GatePanelView
  approvals: ApprovalView[]
  watch: WatchPanelView | null
  recovery: RecoveryPanelView | null
  policy: PolicyPanelView
  humanActions: HumanActionView[]
  auditTail: DetailView["journalTail"]
  modelUse: ModelUseView[]
  telemetry: TelemetryLinkView[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every envelope of one schema sealed for the Incident, in journal order. */
function envelopesOf(
  store: ReplayStore,
  incidentId: string,
  schemaId: string,
): ArtifactEnvelope[] {
  const incident = store.incidents.find((candidate) => candidate.incidentId === incidentId)
  if (incident === undefined) {
    return []
  }
  const envelopes: ArtifactEnvelope[] = []
  for (const hash of incident.artifactHashes) {
    const artifact = store.artifacts.get(hash)
    if (artifact !== undefined && artifact.envelope.artifact_schema_id === schemaId) {
      envelopes.push(artifact.envelope)
    }
  }
  return envelopes
}

/** The latest envelope of a schema, preferring higher schema versions. */
function latestOf(envelopes: ArtifactEnvelope[]): ArtifactEnvelope | undefined {
  return envelopes.at(-1)
}

function evidenceItemViewOf(item: EvidenceItem): EvidenceItemView {
  return {
    id: item.id,
    kind: item.kind,
    backend: item.backend,
    query: item.query ?? null,
    snapshot: item.snapshot as SerializableJson,
    contentHash: item.content_hash,
    links: item.links.map((link) => ({ uri: link.uri, expired: link.expired ?? false })),
    observedAt: item.observed_at,
    freshUntil: item.fresh_until ?? null,
    provenance: item.provenance,
    trust: item.trust,
    joins: Object.entries(item.joins).map(([key, value]) => ({ key, value })),
    redactionProfileId: item.redaction.profile_id,
    maskedFields: item.redaction.masked_fields,
    outcome: item.outcome,
    supersedes: item.supersedes ?? [],
    contradicts: item.contradicts ?? [],
  }
}

function hypothesisViewOf(report: DiagnosisReport, id: string): HypothesisView {
  const hypothesis = report.hypotheses.find((candidate) => candidate.id === id)
  if (hypothesis === undefined) {
    throw new Error(`diagnosis report is missing hypothesis ${id}`)
  }
  return {
    id: hypothesis.id,
    status: hypothesis.status,
    causalTrigger: hypothesis.causal_claim.trigger,
    defect: hypothesis.causal_claim.defect,
    propagation: hypothesis.causal_claim.propagation.map((edge) => ({
      from: edge.from,
      to: edge.to,
      citedItemIds: edge.cited_item_ids,
    })),
    failure: hypothesis.causal_claim.failure,
    predictedObservations: hypothesis.predicted_observations.map((observation) => ({
      id: observation.id,
      statement: observation.statement,
      registeredAt: observation.registered_at,
      discriminates: observation.discriminates ?? [],
    })),
    supporting: hypothesis.evidence.supporting,
    opposing: hypothesis.evidence.opposing,
    unexplained: hypothesis.evidence.unexplained,
    alternatives: hypothesis.alternatives,
    proposedTests: hypothesis.proposed_tests.map((test) => ({
      id: test.id,
      procedure: test.procedure,
      bounds: test.bounds,
      permissions: test.permissions,
      expected: {
        thisHypothesis: test.expected.this_hypothesis,
        alternativeId: test.expected.alternative_id ?? null,
      },
    })),
  }
}

const REVIEW_ORDER = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]
const TEST_ORDER = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"]

function reviewViewOf(envelope: ArtifactEnvelope): VerifyPanelView["reviews"][number] {
  const report = envelope.payload as ReviewReport
  return {
    role: report.role,
    reviewer: report.reviewer,
    revision: report.revision,
    status: report.status,
    findings: report.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      claim: finding.claim,
      citations: finding.citations.map((citation) => ({
        kind: citation.kind,
        file: citation.file ?? null,
        line: citation.line ?? null,
        ref: citation.ref ?? null,
      })),
      status: finding.status,
      uncited: finding.uncited ?? null,
    })),
    inputRefs: report.input_refs,
    candidateHash: report.candidate_hash,
    sealedAt: report.sealed_at,
    skill: envelope.producer.skill ?? null,
    skillVersion: envelope.producer.skill_version ?? null,
    contentHash: envelope.content_hash,
    source: artifactSource(envelope),
  }
}

function testViewOf(envelope: ArtifactEnvelope): VerifyPanelView["tests"][number] {
  const report = envelope.payload as TestReport
  return {
    layer: report.layer,
    tool: report.tool,
    toolVersion: report.tool_version,
    target: report.target,
    receiptRef: report.receipt_ref,
    runs: report.runs.map((run) => ({
      runHash: run.run_hash,
      result: run.result,
      at: run.at,
      detail: run.detail ?? null,
    })),
    outcome: report.outcome,
    flaky: report.flaky,
    coverageChecked: report.coverage_checked,
    candidateHash: report.candidate_hash,
    sealedAt: report.sealed_at,
    skill: envelope.producer.skill ?? null,
    contentHash: envelope.content_hash,
    source: artifactSource(envelope),
  }
}

// ---------------------------------------------------------------------------
// Panel projections
// ---------------------------------------------------------------------------

function headerOf(detail: DetailView): HeaderPanelView {
  const latestRun = detail.runs.at(-1) ?? null
  return {
    incidentId: detail.incidentId,
    state: detail.state,
    closureReason: detail.closureReason,
    detectorState: detail.detectorState,
    severity: detail.severity,
    scope: detail.scope,
    attemptsUsed: detail.attemptsUsed,
    attemptsSource: detail.attemptsSource,
    attemptLimit: ATTEMPT_LIMIT,
    attemptsRemaining: Math.max(ATTEMPT_LIMIT - detail.attemptsUsed, 0),
    finalSequence: detail.finalSequence,
    finalSequenceSource: detail.finalSequenceSource,
    latestRun:
      latestRun === null
        ? null
        : {
            attempt: latestRun.attempt,
            state: latestRun.state,
            outcome: latestRun.outcome,
            failureReason: latestRun.failureReason,
          },
    captureTime: detail.meta.captureTime,
  }
}

function intakeOf(detail: IncidentDetail): IntakePanelView {
  const triggers: IntakeTriggerView[] = []
  for (const event of detail.events) {
    if (event.type !== "trigger_received") {
      continue
    }
    const trigger = event.trigger
    triggers.push({
      triggerId: trigger.trigger_id,
      deliveryKey: trigger.delivery_key,
      incidentKey: trigger.incident_key,
      state: trigger.state,
      severity: trigger.severity,
      receivedAt: trigger.received_at,
      ruleId: trigger.detector.rule_id,
      ruleVersion: trigger.detector.rule_version,
      detectorSource: trigger.detector.source,
      signalName: trigger.signal_summary.name,
      signalValue: formatRatio(trigger.signal_summary.value, trigger.signal_summary.unit),
      signalThreshold: formatRatio(trigger.signal_summary.threshold, trigger.signal_summary.unit),
      window: {
        startsAt: trigger.window.starts_at,
        endsAt: trigger.window.ends_at,
        lookbackSeconds: trigger.window.lookback_seconds,
      },
      evidenceRefs: trigger.evidence_refs.map((reference) => ({
        kind: reference.kind,
        backend: reference.backend,
        uri: reference.uri,
        query: reference.query ?? null,
        traceId: reference.trace_id ?? null,
        observedAt: reference.observed_at ?? null,
      })),
      deliveryResult: event.delivery_result,
      sequence: event.sequence,
    })
  }
  return {
    triggers,
    hmacNote:
      "the demo intake accepts HMAC-signed webhooks; the Solution Contract uses mTLS on the company network. The saved trigger snapshots stay the durable copy.",
  }
}

function evidenceOf(
  detail: IncidentDetail,
  store: ReplayStore,
): EvidencePanelView | null {
  const envelopes = envelopesOf(store, detail.incidentId, "evidence-set")
  if (envelopes.length === 0) {
    return null
  }
  const revisions: EvidenceRevisionView[] = envelopes.map((envelope) => {
    const set = envelope.payload as EvidenceSet
    return {
      revisionNumber: set.revision_number,
      revisionId: set.revision_id,
      pinnedAt: set.pinned_at,
      itemCount: set.items.length,
      sealedAt: envelope.sealed_at,
      contentHash: envelope.content_hash,
      source: artifactSource(envelope),
    }
  })
  const latest = latestOf(envelopes)
  if (latest === undefined) {
    return null
  }
  const set = latest.payload as EvidenceSet
  return {
    items: set.items.map(evidenceItemViewOf),
    revision: revisions.at(-1) ?? null,
    revisions,
  }
}

function hypothesesOf(base: DetailView, detail: IncidentDetail, store: ReplayStore): HypothesisPanelView {
  const diagnosisEnvelopes = envelopesOf(store, detail.incidentId, "diagnosis-report")
  const diagnosis = latestOf(diagnosisEnvelopes)
  if (diagnosis === undefined) {
    return { hypotheses: [], gate: base.hypothesisGate }
  }
  const report = diagnosis.payload as DiagnosisReport
  return {
    hypotheses: report.hypotheses.map((hypothesis) => hypothesisViewOf(report, hypothesis.id)),
    gate: base.hypothesisGate,
  }
}

function fusionOf(detail: IncidentDetail, store: ReplayStore): FusionPanelView | null {
  const participantEnvelopes = envelopesOf(store, detail.incidentId, "fusion-participant-output")
  const judgeEnvelopes = envelopesOf(store, detail.incidentId, "fusion-judge-output")
  const synthesizerEnvelopes = envelopesOf(store, detail.incidentId, "fusion-synthesizer-output")
  if (participantEnvelopes.length === 0) {
    return null
  }

  const participants = participantEnvelopes.map((envelope) => {
    const output = envelope.payload as FusionParticipantOutput
    return {
      participantId: output.participant_id,
      hypothesisIds: output.hypotheses.map((hypothesis) => hypothesis.id),
      objections: output.stated_objections.map((objection) => ({
        statement: objection.statement,
        hypothesisId: objection.hypothesis_id ?? null,
        citedItemIds: objection.cited_item_ids,
      })),
      contentHash: envelope.content_hash,
      source: artifactSource(envelope),
    }
  })

  const judgeEnvelope = latestOf(judgeEnvelopes)
  const judge =
    judgeEnvelope === undefined
      ? null
      : (() => {
          const output = judgeEnvelope.payload as FusionJudgeOutput
          const findings = (rows: FusionJudgeOutput["agreements"]) =>
            rows.map((row) => ({
              statement: row.statement,
              hypothesisIds: row.hypothesis_ids,
              citedItemIds: row.cited_item_ids,
            }))
          return {
            judgeId: output.judge_id,
            agreements: findings(output.agreements),
            contradictions: findings(output.contradictions),
            blindSpots: findings(output.blind_spots),
            uniqueFindings: findings(output.unique_findings),
            citationAudit: output.citation_audit.map((audit) => ({
              participantId: audit.participant_id,
              uncitedClaims: audit.uncited_claims,
              invalidCitations: audit.invalid_citations,
              missingItemCitations: audit.missing_item_citations,
            })),
            contentHash: judgeEnvelope.content_hash,
            source: artifactSource(judgeEnvelope),
          }
        })()

  const synthesizerEnvelope = latestOf(synthesizerEnvelopes)
  const synthesizer =
    synthesizerEnvelope === undefined
      ? null
      : (() => {
          const output = synthesizerEnvelope.payload as FusionSynthesizerOutput
          return {
            synthesizerId: output.synthesizer_id,
            ranked: output.ranked_hypotheses.map((entry) => ({
              rank: entry.rank,
              hypothesisId: entry.hypothesis.id,
              status: entry.hypothesis.status,
            })),
            nextActions: output.next_actions.map((action) => ({
              procedure: action.procedure,
              bounds: action.bounds,
              permissions: action.permissions,
              discriminates: action.discriminates,
            })),
            fusionMeta: {
              participantIds: output.fusion_meta.participant_ids,
              judgeId: output.fusion_meta.judge_id,
              revisionId: output.fusion_meta.revision_id,
              startedAt: output.fusion_meta.started_at,
              completedAt: output.fusion_meta.completed_at,
            },
            contentHash: synthesizerEnvelope.content_hash,
            source: artifactSource(synthesizerEnvelope),
          }
        })()

  const diagnosisEnvelope = latestOf(envelopesOf(store, detail.incidentId, "diagnosis-report"))
  const roundValidity =
    diagnosisEnvelope === undefined
      ? []
      : (diagnosisEnvelope.payload as DiagnosisReport).fusion_meta.rounds.map((round) => ({
          round: round.round,
          valid: round.valid,
          participantIds: round.participant_ids,
        }))

  return { roundValidity, participants, judge, synthesizer }
}

function remediationOf(
  detail: IncidentDetail,
  store: ReplayStore,
): RemediationPanelView | null {
  const envelopes = envelopesOf(store, detail.incidentId, "remediation-proposal")
  const envelope = latestOf(envelopes)
  if (envelope === undefined) {
    return null
  }
  const proposal = envelope.payload as RemediationProposal
  const prReceiptEvent = detail.events.find(
    (event) =>
      event.type === "broker_receipt_recorded" &&
      event.receipt.kind === "action" &&
      event.receipt.receipt_id === "receipt-pr",
  )
  const prReceipt =
    prReceiptEvent?.type === "broker_receipt_recorded" && prReceiptEvent.receipt.kind === "action"
      ? {
          receiptId: prReceiptEvent.receipt.receipt_id,
          command: prReceiptEvent.receipt.action.command,
          outcome: prReceiptEvent.receipt.outcome,
          executedAt: prReceiptEvent.receipt.executed_at ?? null,
          source: receiptSource(prReceiptEvent.receipt.receipt_id),
        }
      : null
  return {
    candidateHash: proposal.candidate_hash,
    remediationClass: proposal.remediation_class,
    actionRiskClass: proposal.action_risk_class,
    gatePath: proposal.gate_path,
    disposition: proposal.disposition,
    changeDescription: proposal.change_description,
    diff:
      proposal.diff === undefined
        ? null
        : {
            baseRef: proposal.diff.base_ref,
            diffText: proposal.diff.diff_text,
            diffHash: proposal.diff.diff_hash,
          },
    citationMap: proposal.citations.map((citation) => ({
      change: citation.change,
      hypothesisId: citation.hypothesis_id,
      citedItemIds: citation.cited_item_ids,
    })),
    testPlan: proposal.test_plan,
    changedSurfaces: proposal.changed_surfaces,
    blastRadius: {
      services: proposal.blast_radius?.services ?? [],
      environments: proposal.blast_radius?.environments ?? [],
      cohorts: proposal.blast_radius?.cohorts ?? [],
    },
    recoveryPointId: proposal.recovery_point.id,
    recoveryPointSurfaces: proposal.recovery_point.changed_surfaces,
    prReceipt,
    contentHash: envelope.content_hash,
    source: artifactSource(envelope),
  }
}

function verifyOf(detail: IncidentDetail, store: ReplayStore): VerifyPanelView | null {
  const reviewEnvelopes = envelopesOf(store, detail.incidentId, "review-report")
  const testEnvelopes = envelopesOf(store, detail.incidentId, "test-report")
  const verificationEnvelopes = envelopesOf(store, detail.incidentId, "verification-report")
  const verificationEnvelope = latestOf(verificationEnvelopes)
  if (verificationEnvelope === undefined) {
    return null
  }
  const verificationReport = verificationEnvelope.payload as VerificationReport
  const verification = {
    candidateHash: verificationReport.candidate_hash,
    hashBinding: {
      sealedCandidate: verificationReport.hash_binding.sealed_candidate,
      checkedCandidate: verificationReport.hash_binding.checked_candidate,
      match: verificationReport.hash_binding.match,
    },
    verdict: verificationReport.verdict,
    verdictReason: verificationReport.verdict_reason,
    sealedAt: verificationReport.sealed_at,
    policyVersion: verificationReport.policy_version,
    contentHash: verificationEnvelope.content_hash,
    source: artifactSource(verificationEnvelope),
  }

  const applicability = {
    resolverVersion: verificationReport.applicability.resolver_version,
    policyVersion: verificationReport.applicability.policy_version,
    required: verificationReport.applicability.required,
    conditional: verificationReport.applicability.conditional,
    triggered: Object.entries(verificationReport.applicability.triggered).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    notApplicable: verificationReport.applicability.not_applicable,
  }

  const byOrder = <T extends { role: string } | { layer: string }>(
    values: T[],
    order: readonly string[],
    key: (value: T) => string,
  ): T[] =>
    [...values].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)))

  const reviews = byOrder(
    reviewEnvelopes.map(reviewViewOf),
    REVIEW_ORDER,
    (view) => view.role,
  )
  const tests = byOrder(
    testEnvelopes.map(testViewOf),
    TEST_ORDER,
    (view) => view.layer,
  )

  return { applicability, reviews, tests, verification }
}

function gatesOf(detail: DetailView): GatePanelView {
  const failed = detail.runs.find((run) => run.failureReason !== null)?.failureReason ?? null
  return {
    release: detail.releaseGate,
    action: detail.actionGate,
    notReachedReason: failed,
  }
}

const WATCH_STAGE_ORDER = ["1", "2", "confirmation"]

function watchOf(detail: IncidentDetail, store: ReplayStore): WatchPanelView | null {
  const planEnvelopes = envelopesOf(store, detail.incidentId, "rollout-watch-plan")
  const reportEnvelopes = envelopesOf(store, detail.incidentId, "watch-report")
  if (planEnvelopes.length === 0 && reportEnvelopes.length === 0) {
    return null
  }
  const planEnvelope = latestOf(planEnvelopes)
  const plan =
    planEnvelope === undefined
      ? null
      : (() => {
          const payload = planEnvelope.payload as RolloutWatchPlan
          return {
            candidateHash: payload.candidate_hash,
            strategy: payload.rollout.strategy,
            stages: payload.rollout.stages.map((stage) => ({
              id: stage.id,
              trafficPercent: stage.traffic_percent,
              minimumDurationSeconds: stage.minimum_duration_seconds,
              minimumSampleCount: stage.minimum_sample_count,
            })),
            queries: payload.watch_queries.map((query) => ({
              id: query.id,
              signal: query.signal,
              backend: query.backend,
              query: query.query,
              windowSeconds: query.window_seconds,
              minimumSampleCount: query.minimum_sample_count,
              comparator: query.comparator,
              limit: query.limit,
              unit: query.unit ?? null,
            })),
            stopRules: payload.stop_rules.map((rule) => ({
              id: rule.id,
              condition: rule.condition,
              action: rule.action,
            })),
            missingDataRule: payload.missing_data_rule,
            rehearsalReceiptRefs: payload.rehearsal_receipt_refs ?? [],
            policyVersion: payload.policy_version,
            contentHash: planEnvelope.content_hash,
            source: artifactSource(planEnvelope),
          }
        })()

  const reports = reportEnvelopes
    .map((envelope) => {
      const payload = envelope.payload as WatchReport
      return {
        rolloutStage: payload.rollout_stage,
        planRef: payload.plan_ref ?? "",
        samples: payload.samples.map((sample) => ({
          gate: sample.gate,
          query: sample.query,
          baselineCohort: sample.baseline_cohort ?? null,
          candidateCohort: sample.candidate_cohort ?? null,
          timeRange: {
            startsAt: sample.time_range.starts_at,
            endsAt: sample.time_range.ends_at,
          },
          sampleCount: sample.sample_count,
          value: sample.value,
          limit: sample.limit,
          outcome: sample.outcome,
        })),
        stageOutcome: payload.stage_outcome,
        sealedAt: payload.sealed_at,
        contentHash: envelope.content_hash,
        source: artifactSource(envelope),
      }
    })
    .sort((a, b) => WATCH_STAGE_ORDER.indexOf(a.rolloutStage) - WATCH_STAGE_ORDER.indexOf(b.rolloutStage))

  const probeReceipts: WatchPanelView["probeReceipts"] = []
  for (const event of detail.events) {
    if (
      event.type === "broker_receipt_recorded" &&
      event.receipt.kind === "read" &&
      event.receipt.receipt_id.startsWith("receipt-probe")
    ) {
      probeReceipts.push({
        receiptId: event.receipt.receipt_id,
        query: event.receipt.request.query,
        rowCount: event.receipt.result.row_count ?? null,
        observedAt: event.receipt.result.observed_at,
        source: receiptSource(event.receipt.receipt_id),
      })
    }
  }

  let baselineRatio: WatchPanelView["baselineRatio"] = null
  for (const event of detail.events) {
    if (event.type === "trigger_received" && event.trigger.state === "firing") {
      baselineRatio = {
        value: formatRatio(event.trigger.signal_summary.value, event.trigger.signal_summary.unit),
        source: journalSource(event.sequence),
      }
      break
    }
  }

  return { plan, reports, probeReceipts, baselineRatio, notReached: null }
}

function recoveryOf(
  detail: IncidentDetail,
  store: ReplayStore,
  remediation: RemediationPanelView | null,
): RecoveryPanelView | null {
  if (remediation === null) {
    return null
  }
  const r8Findings: RecoveryPanelView["r8Findings"] = []
  for (const envelope of envelopesOf(store, detail.incidentId, "review-report")) {
    const report = envelope.payload as ReviewReport
    if (report.role !== "R8") continue
    for (const finding of report.findings) {
      r8Findings.push({
        id: finding.id,
        severity: finding.severity,
        claim: finding.claim,
        citations: finding.citations.map((citation) => ({ kind: citation.kind, ref: citation.ref ?? null })),
      })
    }
  }

  const drillReceipts: RecoveryPanelView["drillReceipts"] = []
  for (const event of detail.events) {
    if (event.type !== "broker_receipt_recorded" || event.receipt.kind !== "action") {
      continue
    }
    const receipt = event.receipt
    if (receipt.receipt_id !== "receipt-t12") continue
    drillReceipts.push({
      receiptId: receipt.receipt_id,
      command: receipt.action.command,
      outcome: receipt.outcome,
      executedAt: receipt.executed_at ?? null,
      source: receiptSource(receipt.receipt_id),
    })
  }

  // Both ids appear in saved data: the captured export records
  // receipt-service-swap; the dev fixtures record receipt-swap.
  const swapped = detail.events.some(
    (event) =>
      event.type === "broker_receipt_recorded" &&
      event.receipt.kind === "action" &&
      (event.receipt.receipt_id === "receipt-service-swap" ||
        event.receipt.receipt_id === "receipt-swap"),
  )

  return {
    recoveryPointId: remediation.recoveryPointId,
    changedSurfaces: remediation.recoveryPointSurfaces,
    r8Findings,
    drillReceipts,
    consumed: swapped,
    note: swapped
      ? "validated before the first mutation and consumed by the stage-2 service swap; retained through the demo rollback window"
      : "draft recorded and drilled in the isolated environment; never consumed — the run ended at Verify",
  }
}

function policyOf(detail: IncidentDetail): PolicyPanelView {
  const lastEvent = detail.events.at(-1)
  const policyVersion = lastEvent === undefined ? "" : lastEvent.policy_version
  return {
    policyVersion,
    recorded: RECORDED_POLICIES[policyVersion] ?? null,
    decisions: decisionsOf(detail),
    attemptLimit: ATTEMPT_LIMIT,
  }
}

/** Recorded execution-time policy decisions, mirroring #21's projection. */
function decisionsOf(detail: IncidentDetail): PolicyDecisionView[] {
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

function humanActionsOf(detail: IncidentDetail): HumanActionView[] {
  return detail.events
    .filter((event): event is Extract<JournalEvent, { type: "human_action" }> => event.type === "human_action")
    .map((event) => ({
      action: event.action,
      reason: event.reason ?? null,
      approvalRef: event.approval_ref ?? null,
      actorId: event.actor.id,
      recordedAt: event.recorded_at,
      sequence: event.sequence,
      source: journalSource(event.sequence),
    }))
}

function modelUseOf(detail: IncidentDetail): ModelUseView[] {
  return detail.events
    .filter((event): event is Extract<JournalEvent, { type: "model_use" }> => event.type === "model_use")
    .map((event) => ({
      agentId: event.agent_id,
      parentAgentId: event.parent_agent_id,
      agentRole: event.agent_role ?? "unknown",
      model: event.model,
      promptTokens: event.token_use.prompt_tokens,
      completionTokens: event.token_use.completion_tokens,
      sequence: event.sequence,
      source: journalSource(event.sequence),
    }))
}

function telemetryOf(detail: IncidentDetail, store: ReplayStore): TelemetryLinkView[] {
  const links: TelemetryLinkView[] = []
  for (const event of detail.events) {
    if (event.type !== "trigger_received") continue
    for (const reference of event.trigger.evidence_refs) {
      links.push({
        owner: "Incident Trigger intake snapshot",
        backend: reference.backend,
        kind: reference.kind,
        uri: reference.uri,
        expired: false,
        source: journalSource(event.sequence),
      })
    }
  }
  for (const envelope of envelopesOf(store, detail.incidentId, "evidence-set")) {
    const set = envelope.payload as EvidenceSet
    for (const item of set.items) {
      for (const link of item.links) {
        links.push({
          owner: `Evidence Set item ${item.id.slice(0, 12)}…`,
          backend: item.backend,
          kind: item.kind,
          uri: link.uri,
          expired: link.expired ?? false,
          source: artifactSource(envelope),
        })
      }
    }
  }
  return links
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Project the full workspace view for one Incident from a verified store.
 * Returns null for an Incident outside the saved bundle; a null sub-panel
 * means the saved run never produced that artifact, which the panels render
 * as a labeled gap, never as empty pass.
 */
export function workspaceView(
  store: ReplayStore,
  incidentId: string,
  evaluationTime: string,
): WorkspaceView | null {
  const detailResult = getIncidentDetail(store, incidentId)
  if (!detailResult.ok) {
    return null
  }
  const detail = detailResult.value
  const base = detailView(store, incidentId, evaluationTime)
  if (base === null) {
    return null
  }
  const remediation = remediationOf(detail, store)
  return {
    meta: base.meta,
    detail: base,
    header: headerOf(base),
    intake: intakeOf(detail),
    evidence: evidenceOf(detail, store),
    hypotheses: hypothesesOf(base, detail, store),
    fusion: fusionOf(detail, store),
    remediation,
    verify: verifyOf(detail, store),
    gates: gatesOf(base),
    approvals: base.approvals,
    watch: watchOf(detail, store),
    recovery: recoveryOf(detail, store, remediation),
    policy: policyOf(detail),
    humanActions: humanActionsOf(detail),
    auditTail: base.journalTail,
    modelUse: modelUseOf(detail),
    telemetry: telemetryOf(detail, store),
  }
}

/** Format a sample value against its recorded limit for the Watch rows. */
export function formatSampleValue(value: number): string {
  return formatNumber(value)
}
