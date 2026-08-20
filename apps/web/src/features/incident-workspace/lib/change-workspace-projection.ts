/**
 * Change Review projections for the verified saved bundle.
 *
 * This is the data seam for the Change Review workspace (issue #34): the
 * finalized application header, Incident selector, change header, run
 * context strip, Summary and Files tabs, and the shared record inspector.
 * Everything here projects from the verified {@link ReplayStore} and binds
 * to the saved journal, receipts, or sealed artifacts; nothing is invented.
 *
 * Hard honesty rules implemented here:
 * - The source-host record renders only the recorded `submit_remediation_pr`
 *   receipt: adapter, command, outcome, and execution time. No PR number,
 *   repository, branch, or merge state exists in the bundle, so none appears.
 * - Run selection is manifest-bound: a capture manifest's incident/run/attempt
 *   pins the run, an ambiguous set of manifests is a named data gap, and a
 *   bundle without a capture manifest falls back to the journal's latest
 *   progressed run. Artifact reads are run-scoped, so attempts never mix.
 * - The recorded diff is parsed by `parseUnifiedDiff` and fails closed: a
 *   diff that cannot be split by file renders an explicit unavailable state
 *   with the raw diff kept inspectable.
 */
import type {
  ArtifactEnvelope,
  CaptureManifest,
  DiagnosisReport,
  EvidenceSet,
  FusionJudgeOutput,
  FusionParticipantOutput,
  FusionSynthesizerOutput,
  JournalEvent,
  RemediationProposal,
  ReviewReport,
  TestReport,
  VerificationReport,
} from "@sih/contracts/types"

import { getIncidentDetail } from "../../../lib/replay/replay-reads"
import type { ReplayStore } from "../../../lib/replay/replay-store"
import { detailView, listView } from "../../incidents/lib/projections"
import type { GateView } from "../../incidents/lib/projections"
import type { Source } from "../../incidents/lib/format"
import { formatRatio } from "../../incidents/lib/format"
import { ATTEMPT_LIMIT } from "../constants"
import { parseUnifiedDiff } from "./unified-diff"
import type { DiffHunk } from "./unified-diff"

/** A deeply JSON-serializable value, matching the sealed artifact payloads. */
type SerializableJson =
  | string
  | number
  | boolean
  | null
  | SerializableJson[]
  | { [key: string]: SerializableJson }

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

/** The derived change state, from docs/research/issue-33 spec `status()`. */
export type ChangeState =
  | "Not prepared"
  | "Prepared"
  | "Blocked"
  | "Verified"
  | "Approved for Release"
  | "Released"
  | "Resolved"

/** Presentation and capture metadata for the app header. */
export interface ChangeMetaView {
  formatVersion: string
  captureTime: string
  evaluationTime: string
  incidentCount: number
  /** From the capture manifest when it is sealed for the bound run. */
  providerClass: string | null
  provider: string | null
  model: string | null
  reasoning: string | null
  manifestId: string | null
  manifestSealedAt: string | null
}

/** One saved Incident row for the Incident selector. */
export interface IncidentNavigatorRow {
  incidentId: string
  state: string | null
  closureReason: string | null
  severity: string | null
  serviceName: string | null
  environmentName: string | null
  signalName: string | null
  signalValue: string | null
  firstTriggerAt: string | null
  latestOutcome: string | null
  latestOutcomeSource: Source | null
}

/** The manifest-bound run the Change Review presents. */
export interface ChangeRunView {
  runId: string
  attempt: number
  attemptLimit: number
  state: string
  outcome: string | null
  failureReason: string | null
  restartCount: number
  startedAt: string | null
  endedAt: string | null
  startedSource: Source | null
  endedSource: Source | null
  durationSeconds: number | null
  durationSource: Source | null
  /** How the run was chosen: manifest-bound, journal fallback, or a gap. */
  binding: "manifest" | "journal" | "gap"
  bindingReason: string
  policyVersion: string | null
  policySource: Source | null
}

/** One changed file derived from the recorded diff. */
export interface ChangedFileView {
  /** Stable inspector record id, for example `file:0`. */
  id: string
  path: string | null
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

/** The recorded diff, parsed or failed closed. */
export interface ChangeDiffView {
  state: "parsed" | "unparseable" | "absent"
  files: ChangedFileView[]
  additions: number
  deletions: number
  rawText: string | null
  rawSource: Source | null
  note: string | null
}

/** The review state summary for the Summary tab. */
export interface ReviewStateView {
  reviewsPassed: number
  reviewsTotal: number
  testsPassed: number
  testsTotal: number
  failedIds: string[]
  releaseGate: {
    verdict: string
    evaluatedAt: string | null
    candidateHash: string | null
    source: Source | null
  } | null
}

/** One supporting-evidence entry for the accepted Hypothesis. */
export interface SupportingEvidenceView {
  itemId: string
  recordId: string
  kind: string | null
  backend: string | null
  observedAt: string | null
}

/** The change summary card for the Summary tab. */
export interface ChangeSummaryView {
  state: ChangeState
  description: string | null
  remediationClass: string | null
  actionRiskClass: string | null
  gatePath: string | null
  candidateHash: string | null
  baseRef: string | null
  hypothesisId: string | null
  citationChange: string | null
  citedItemIds: string[]
  changedSurfaces: string[]
  services: string[]
  environments: string[]
  recoveryPointId: string | null
  recoveryConsumed: boolean
  testPlan: string[]
  supporting: SupportingEvidenceView[]
  artifactSource: Source | null
}

/** One record the Change inspector can open. */
export interface InspectorRecord {
  id: string
  kind: string
  title: string
  status: string | null
  statusTone: "positive" | "negative" | "warning" | "info" | "neutral" | null
  summary: string
  facts: { label: string; value: string; source: Source | null }[]
  related: { recordId: string; label: string }[]
  /** The sealed artifact content hash, for the artifact deep link. */
  artifactLink: string | null
  /** The value "Copy reference" copies. */
  reference: string | null
  raw: SerializableJson | null
}

/** The full Change Review workspace view for one Incident. */
export interface ChangeWorkspaceView {
  meta: ChangeMetaView
  navigator: IncidentNavigatorRow[]
  incident: {
    incidentId: string
    state: string | null
    closureReason: string | null
    severity: string | null
    service: string | null
    environment: string | null
    attemptsUsed: number
    finalSequence: number
  }
  run: ChangeRunView
  change: ChangeSummaryView | null
  diff: ChangeDiffView
  reviewState: ReviewStateView
  records: Record<string, InspectorRecord>
  defaultRecordId: string
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Run selection
// ---------------------------------------------------------------------------

export type RunBinding =
  | { kind: "bound"; runId: string; attempt: number; manifest: CaptureManifest | null; manifestSource: Source | null }
  | { kind: "ambiguous"; reason: string }
  | { kind: "gap"; reason: string }

/**
 * Select the run the Change Review presents. A capture manifest pins the
 * run; all capture manifests for the Incident must agree, and an ambiguous
 * set is rejected as a named data gap. Without a capture manifest the
 * journal's latest progressed run is used, so a queued second attempt never
 * mixes with the run that produced the Remediation.
 */
export function resolveRunBinding(store: ReplayStore, incidentId: string): RunBinding {
  const incident = store.incidents.find((candidate) => candidate.incidentId === incidentId)
  if (incident === undefined) {
    return { kind: "gap", reason: "incident is not part of this saved bundle" }
  }
  const manifests: { manifest: CaptureManifest; source: Source }[] = []
  for (const hash of incident.artifactHashes) {
    const artifact = store.artifacts.get(hash)
    if (artifact !== undefined && artifact.envelope.artifact_schema_id === "capture-manifest") {
      manifests.push({
        manifest: artifact.envelope.payload as CaptureManifest,
        source: artifactSource(artifact.envelope),
      })
    }
  }
  if (manifests.length > 0) {
    const first = manifests[0]
    const agree = manifests.every(
      (entry) =>
        entry.manifest.incident_id === first.manifest.incident_id &&
        entry.manifest.run_id === first.manifest.run_id &&
        entry.manifest.attempt === first.manifest.attempt,
    )
    if (!agree) {
      return { kind: "ambiguous", reason: "capture manifests disagree on the incident, run, or attempt" }
    }
    return { kind: "bound", runId: first.manifest.run_id, attempt: first.manifest.attempt, manifest: first.manifest, manifestSource: first.source }
  }
  let fallback: Extract<JournalEvent, { type: "run_transition" }> | null = null
  for (let i = incident.events.length - 1; i >= 0; i -= 1) {
    const event = incident.events[i]
    if (event.type === "run_transition" && event.from !== null) {
      fallback = event
      break
    }
  }
  if (fallback === null) {
    return { kind: "gap", reason: "no run progressed in the journal" }
  }
  return {
    kind: "bound",
    runId: fallback.run_id,
    attempt: fallback.attempt,
    manifest: null,
    manifestSource: null,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every envelope of one schema sealed for the Incident and run, in order. */
function envelopesOf(
  store: ReplayStore,
  incidentId: string,
  schemaId: string,
  runId: string,
): ArtifactEnvelope[] {
  const incident = store.incidents.find((candidate) => candidate.incidentId === incidentId)
  if (incident === undefined) {
    return []
  }
  const envelopes: ArtifactEnvelope[] = []
  for (const hash of incident.artifactHashes) {
    const artifact = store.artifacts.get(hash)
    if (
      artifact !== undefined &&
      artifact.envelope.artifact_schema_id === schemaId &&
      artifact.envelope.run_id === runId
    ) {
      envelopes.push(artifact.envelope)
    }
  }
  return envelopes
}

/** The latest envelope of a schema for the run, or undefined. */
function latestOf(envelopes: ArtifactEnvelope[]): ArtifactEnvelope | undefined {
  return envelopes.at(-1)
}

/** A short, stable record id for a long hash. */
function itemRecordId(itemId: string): string {
  return `evidence:${itemId}`
}

// ---------------------------------------------------------------------------
// Fact projections
// ---------------------------------------------------------------------------

/** The recorded diff projection, parsed or failed closed. */
function diffOf(proposal: RemediationProposal | undefined, source: Source | null): ChangeDiffView {
  if (proposal === undefined || proposal.diff === undefined) {
    return { state: "absent", files: [], additions: 0, deletions: 0, rawText: null, rawSource: null, note: "the recorded Remediation carries no diff" }
  }
  const parsed = parseUnifiedDiff(proposal.diff.diff_text)
  if (!parsed.ok) {
    return {
      state: parsed.reason,
      files: [],
      additions: 0,
      deletions: 0,
      rawText: proposal.diff.diff_text,
      rawSource: source,
      note: parsed.note,
    }
  }
  return {
    state: "parsed",
    files: parsed.diff.files.map((file, index) => ({
      id: `file:${index}`,
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.hunks,
    })),
    additions: parsed.diff.additions,
    deletions: parsed.diff.deletions,
    rawText: proposal.diff.diff_text,
    rawSource: source,
    note: null,
  }
}

/** The derived change state, per the #33 spec `status()` function. */
export function deriveChangeState(input: {
  hasRemediation: boolean
  verificationVerdict: string | null
  releaseGate: { verdict: string } | null
  releaseSucceeded: boolean
  watchConfirmed: boolean
  incidentClosed: boolean
}): ChangeState {
  if (!input.hasRemediation) {
    return "Not prepared"
  }
  if (input.verificationVerdict === null) {
    return "Prepared"
  }
  if (input.verificationVerdict !== "pass") {
    return "Blocked"
  }
  if (input.releaseGate === null || input.releaseGate.verdict !== "pass") {
    return "Verified"
  }
  if (!input.releaseSucceeded) {
    return "Approved for Release"
  }
  if (!input.watchConfirmed) {
    return "Released"
  }
  return input.incidentClosed ? "Resolved" : "Released"
}

/** The recorded action receipt that prepared the change, if any. */
function sourceHostReceipt(detail: {
  events: readonly JournalEvent[]
}): Extract<JournalEvent, { type: "broker_receipt_recorded" }> | null {
  for (const event of detail.events) {
    if (
      event.type === "broker_receipt_recorded" &&
      event.receipt.kind === "action" &&
      event.receipt.action.action_class === "submit_remediation_pr"
    ) {
      return event
    }
  }
  return null
}

/** The narrowed action receipt of a source-host event, or null. */
function actionReceiptOf(
  event: Extract<JournalEvent, { type: "broker_receipt_recorded" }> | null,
): Extract<JournalEvent, { type: "broker_receipt_recorded" }>["receipt"] & { kind: "action" } | null {
  return event === null || event.receipt.kind !== "action" ? null : event.receipt
}

/** True when a release action receipt for the run records a success. */
function releaseSucceeded(detail: { events: readonly JournalEvent[] }, runId: string): boolean {
  for (const event of detail.events) {
    if (
      event.type === "broker_receipt_recorded" &&
      event.run_id === runId &&
      event.receipt.kind === "action" &&
      (event.receipt.receipt_id === "receipt-service-swap" || event.receipt.receipt_id === "receipt-swap") &&
      event.receipt.outcome === "ok"
    ) {
      return true
    }
  }
  return false
}

/** True when a confirmation-stage Watch report passed for the run. */
function watchConfirmed(store: ReplayStore, incidentId: string, runId: string): boolean {
  for (const envelope of envelopesOf(store, incidentId, "watch-report", runId)) {
    const report = envelope.payload as { rollout_stage: string; stage_outcome: string }
    if (report.rollout_stage === "confirmation" && report.stage_outcome === "pass") {
      return true
    }
  }
  return false
}

/** The run-scoped journal window for the run context strip. */
function runWindow(detail: { events: readonly JournalEvent[] }, runId: string): {
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  startedSource: Source | null
  endedSource: Source | null
} {
  let startedAt: string | null = null
  let endedAt: string | null = null
  let startedSource: Source | null = null
  let endedSource: Source | null = null
  for (const event of detail.events) {
    if (!("run_id" in event) || event.run_id !== runId) continue
    if (startedAt === null || event.recorded_at < startedAt) {
      startedAt = event.recorded_at
      startedSource = journalSource(event.sequence)
    }
    if (endedAt === null || event.recorded_at > endedAt) {
      endedAt = event.recorded_at
      endedSource = journalSource(event.sequence)
    }
  }
  const durationSeconds =
    startedAt !== null && endedAt !== null
      ? Math.max(Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000), 0)
      : null
  return { startedAt, endedAt, durationSeconds, startedSource, endedSource }
}

// ---------------------------------------------------------------------------
// Records registry
// ---------------------------------------------------------------------------

function factsOf(rows: [string, string, Source | null][]): { label: string; value: string; source: Source | null }[] {
  return rows.map(([label, value, source]) => ({ label, value, source }))
}

/** Build the inspector record registry for one Incident view. */
function recordsOf(context: {
  store: ReplayStore
  incidentId: string
  runId: string
  run: ChangeRunView
  proposal: RemediationProposal | undefined
  proposalEnvelope: ArtifactEnvelope | undefined
  receiptEvent: Extract<JournalEvent, { type: "broker_receipt_recorded" }> | null
  diagnosis: DiagnosisReport | undefined
  evidenceItems: EvidenceSet["items"]
  verification: VerificationReport | undefined
  verificationEnvelope: ArtifactEnvelope | undefined
  releaseGate: GateView | null
  hypothesisGate: GateView | null
  recoveryConsumed: boolean
  diff: ChangeDiffView
  manifest: CaptureManifest | null
  manifestSource: Source | null
}): Record<string, InspectorRecord> {
  const { store, incidentId, runId } = context
  const records: Record<string, InspectorRecord> = {}

  const acceptedId = context.proposal?.citations[0]?.hypothesis_id ?? null
  const hypothesis =
    context.diagnosis?.hypotheses.find((candidate) => candidate.id === acceptedId) ??
    context.diagnosis?.hypotheses.find((candidate) => candidate.status === "accepted") ??
    context.diagnosis?.hypotheses[0]
  const hypothesisId = hypothesis?.id ?? null

  const add = (record: InspectorRecord) => {
    records[record.id] = record
  }

  // Run record -------------------------------------------------------------
  add({
    id: "run",
    kind: "Run record",
    title: `${runId} · ${context.run.state}${context.run.outcome !== null ? ` · ${context.run.outcome}` : ""}`,
    status: context.run.state,
    statusTone: context.run.state === "completed" ? "positive" : context.run.state === "failed" ? "negative" : "neutral",
    summary:
      context.run.failureReason !== null
        ? `The run failed: ${context.run.failureReason}.`
        : context.run.outcome !== null
          ? `The run completed with outcome ${context.run.outcome}.`
          : "The run is recorded in the journal.",
    facts: factsOf([
      ["Run", runId, null],
      ["Attempt", String(context.run.attempt), null],
      ["State", context.run.state, null],
      ["Started", context.run.startedAt ?? "unrecorded", context.run.startedSource],
      ["Ended", context.run.endedAt ?? "unrecorded", context.run.endedSource],
      ["Duration", context.run.durationSeconds === null ? "unrecorded" : `${context.run.durationSeconds}s`, context.run.durationSource],
      ["Policy", context.run.policyVersion ?? "unrecorded", context.run.policySource],
      ["Candidate", context.proposal?.candidate_hash ?? "unrecorded", context.proposalEnvelope === undefined ? null : artifactSource(context.proposalEnvelope)],
    ]),
    related: [
      { recordId: "source-host", label: "Source-host receipt" },
      { recordId: "remediation", label: "Remediation" },
      { recordId: "verification", label: "Verification" },
    ],
    artifactLink: null,
    reference: runId,
    raw: {
      run_id: runId,
      attempt: context.run.attempt,
      state: context.run.state,
      outcome: context.run.outcome,
      failure_reason: context.run.failureReason,
    },
  })

  // Capture manifest record ------------------------------------------------
  if (context.manifest !== null) {
    add({
      id: "manifest",
      kind: "Capture manifest",
      title: `capture-manifest · ${context.manifest.manifest_id}`,
      status: context.manifest.mode,
      statusTone: context.manifest.mode === "full-capture" ? "positive" : "info",
      summary: `Sealed capture manifest for run ${context.manifest.run_id}, attempt ${context.manifest.attempt}.`,
      facts: factsOf([
        ["Manifest", context.manifest.manifest_id, context.manifestSource],
        ["Mode", context.manifest.mode, null],
        ["Provider", `${context.manifest.provider_class} · ${context.manifest.provider}`, null],
        ["Model", context.manifest.model, null],
        ["Reasoning", context.manifest.reasoning, null],
        ["Sealed", context.manifest.sealed_at, null],
        ["Core", context.manifest.pi_agent_core_version, null],
      ]),
      related: [{ recordId: "run", label: "Run record" }],
      artifactLink: context.manifestSource?.kind === "artifact" ? context.manifestSource.ref : null,
      reference: context.manifest.manifest_id,
      raw: context.manifest,
    })
  }

  // Source-host record -----------------------------------------------------
  const receiptEvent = context.receiptEvent
  const sourceHostReceiptView = actionReceiptOf(receiptEvent)
  const notRecorded = "not recorded in this bundle"
  add({
    id: "source-host",
    kind: "Source-host record",
    title: sourceHostReceiptView === null ? "Source-host record" : `receipt ${sourceHostReceiptView.receipt_id}`,
    status: sourceHostReceiptView === null ? "Not recorded" : sourceHostReceiptView.outcome === "ok" ? "Recorded" : "Unresolved",
    statusTone: sourceHostReceiptView === null ? "neutral" : sourceHostReceiptView.outcome === "ok" ? "positive" : "warning",
    summary:
      sourceHostReceiptView === null
        ? "The saved bundle records no source-host action for this run. There is no PR number, repository, branch, or merge state to show."
        : "The recorded source-host receipt for the Remediation. The bundle records the command and its outcome; it does not record a PR number, repository, branch, or merge state.",
    facts: factsOf([
      ...(sourceHostReceiptView === null
        ? [
            ["Receipt", notRecorded, null],
            ["Action class", notRecorded, null],
            ["Adapter", notRecorded, null],
            ["Command", notRecorded, null],
          ]
        : [
            ["Receipt", sourceHostReceiptView.receipt_id, receiptSource(sourceHostReceiptView.receipt_id)],
            ["Action class", sourceHostReceiptView.action.action_class, null],
            ["Adapter", sourceHostReceiptView.action.adapter, null],
            ["Command", sourceHostReceiptView.action.command, null],
            ["Outcome", sourceHostReceiptView.outcome, null],
            ["Executed", sourceHostReceiptView.executed_at ?? "unrecorded", null],
            ["Candidate", sourceHostReceiptView.candidate_hash ?? "unrecorded", null],
          ]) as [string, string, Source | null][],
      ["PR number", notRecorded, null],
      ["Repository", notRecorded, null],
      ["Branch", notRecorded, null],
      ["Merge state", notRecorded, null],
    ]),
    related: [
      { recordId: "remediation", label: "Remediation" },
      { recordId: "run", label: "Run record" },
      { recordId: "verification", label: "Verification" },
    ],
    artifactLink: null,
    reference: sourceHostReceiptView?.receipt_id ?? null,
    raw: sourceHostReceiptView === null ? null : (sourceHostReceiptView),
  })

  // Remediation record -----------------------------------------------------
  const proposal = context.proposal
  if (proposal !== undefined) {
    add({
      id: "remediation",
      kind: "Remediation",
      title: proposal.change_description,
      status: context.diff.state === "parsed" ? "Diff parsed" : context.diff.state === "unparseable" ? "Diff unparseable" : "No diff",
      statusTone: context.diff.state === "parsed" ? "positive" : "warning",
      summary: `${proposal.remediation_class} change prepared under ${proposal.action_risk_class} risk on the ${proposal.gate_path} path.`,
      facts: factsOf([
        ["Change", proposal.change_description, null],
        ["Candidate", proposal.candidate_hash, context.proposalEnvelope === undefined ? null : artifactSource(context.proposalEnvelope)],
        ["Class", proposal.remediation_class, null],
        ["Risk class", proposal.action_risk_class, null],
        ["Gate path", proposal.gate_path, null],
        ["Disposition", proposal.disposition, null],
        ["Base ref", proposal.diff?.base_ref ?? "unrecorded", null],
        ["Diff hash", proposal.diff?.diff_hash ?? "unrecorded", null],
        ["Changed surfaces", proposal.changed_surfaces.join(", ") || "unrecorded", null],
        ["Blast radius", [...(proposal.blast_radius?.services ?? []), ...(proposal.blast_radius?.environments ?? [])].join(" · ") || "unrecorded", null],
        ["Test plan", proposal.test_plan.join(", "), null],
      ]),
      related: [
        { recordId: "source-host", label: "Source-host receipt" },
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
        { recordId: "recovery:point", label: "Recovery Point" },
        ...context.diff.files.map((file) => ({ recordId: file.id, label: file.path ?? file.id })),
        ...(context.diff.rawText === null ? [] : [{ recordId: "diff-raw", label: "Raw diff" }]),
      ],
      artifactLink: context.proposalEnvelope?.content_hash ?? null,
      reference: proposal.candidate_hash,
      raw: proposal,
    })
  }

  // Diff raw record --------------------------------------------------------
  if (context.diff.rawText !== null) {
    add({
      id: "diff-raw",
      kind: "Recorded diff",
      title: "Raw recorded diff",
      status: context.diff.state === "parsed" ? "Parsed" : "Could not be split by file",
      statusTone: context.diff.state === "parsed" ? "positive" : "warning",
      summary:
        context.diff.state === "parsed"
          ? "The full diff text recorded in the Remediation, as sealed."
          : "The full diff text recorded in the Remediation, as sealed. It could not be split by file, so no file paths or line counts are shown.",
      facts: factsOf([
        ["State", context.diff.state, null],
        ...(context.diff.note === null ? [] : ([["Note", context.diff.note, null]] as [string, string, Source | null][])),
      ]),
      related: context.diff.files.map((file) => ({ recordId: file.id, label: file.path ?? file.id })),
      artifactLink: context.proposalEnvelope?.content_hash ?? null,
      reference: null,
      raw: { diff_text: context.diff.rawText },
    })
  }

  // Changed-file records ---------------------------------------------------
  context.diff.files.forEach((file) => {
    add({
      id: file.id,
      kind: "Changed file",
      title: file.path ?? "unrecorded path",
      status: `${file.additions} additions · ${file.deletions} deletions`,
      statusTone: "neutral",
      summary: "One file derived from the recorded unified diff.",
      facts: factsOf([
        ["Path", file.path ?? "unrecorded", null],
        ["Additions", String(file.additions), null],
        ["Deletions", String(file.deletions), null],
        ["Hunks", String(file.hunks.length), null],
      ]),
      related: [
        { recordId: "remediation", label: "Remediation" },
        { recordId: "diff-raw", label: "Raw diff" },
      ],
      artifactLink: context.proposalEnvelope?.content_hash ?? null,
      reference: file.path ?? null,
      raw: file.hunks as unknown as SerializableJson,
    })
  })

  // Hypothesis records -----------------------------------------------------
  const diagnosis = context.diagnosis
  if (diagnosis !== undefined) {
    for (const candidate of diagnosis.hypotheses) {
      const id = `hypothesis:${candidate.id}`
      const isAccepted = candidate.id === hypothesisId
      add({
        id,
        kind: "Hypothesis",
        title: `${candidate.id} · ${candidate.causal_claim.defect}`,
        status: isAccepted ? "Accepted" : candidate.status,
        statusTone: isAccepted ? "positive" : "neutral",
        summary: candidate.causal_claim.failure,
        facts: factsOf([
          ["Causal trigger", candidate.causal_claim.trigger, null],
          ["Defect", candidate.causal_claim.defect, null],
          ["Failure", candidate.causal_claim.failure, null],
          ["Supporting evidence", candidate.evidence.supporting.map((item) => item.slice(0, 12)).join(", ") || "none recorded", null],
          ["Opposing evidence", candidate.evidence.opposing.map((item) => item.slice(0, 12)).join(", ") || "none recorded", null],
          ["Unexplained items", candidate.evidence.unexplained.map((item) => item.slice(0, 12)).join(", ") || "none recorded", null],
          ["Alternatives", candidate.alternatives.join(", ") || "none recorded", null],
          ["Status", candidate.status, null],
        ]),
        related: [
          ...candidate.evidence.supporting.map((itemId) => ({ recordId: itemRecordId(itemId), label: `Evidence ${itemId.slice(0, 12)}` })),
          { recordId: "hypothesis-gate", label: "Hypothesis gate" },
          { recordId: "judge", label: "Fusion judge" },
          { recordId: "synthesizer", label: "Fusion synthesizer" },
        ],
        artifactLink: context.verificationEnvelope?.content_hash ?? null,
        reference: candidate.id,
        raw: candidate,
      })
    }
  }

  // Hypothesis gate --------------------------------------------------------
  if (context.hypothesisGate !== null) {
    const gate = context.hypothesisGate
    add({
      id: "hypothesis-gate",
      kind: "Gate",
      title: `Hypothesis Gate · ${gate.verdict}`,
      status: gate.verdict,
      statusTone: gate.verdict === "pass" ? "positive" : gate.verdict === "fail" ? "negative" : "neutral",
      summary: `The gate evaluated ${gate.checks.length} deterministic checks and recorded ${gate.checks.filter((check) => check.result).length} passes.`,
      facts: factsOf([
        ["Verdict", gate.verdict, gate.source],
        ["Evaluated", gate.evaluatedAt, null],
        ["Checks", String(gate.checks.length), null],
        ["Failed", gate.checks.filter((check) => !check.result).map((check) => check.check).join(", ") || "none", null],
      ]),
      related: [
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
      ],
      artifactLink: null,
      reference: null,
      raw: gate as unknown as SerializableJson,
    })
  }

  // Evidence records -------------------------------------------------------
  for (const item of context.evidenceItems) {
    add({
      id: itemRecordId(item.id),
      kind: "Evidence",
      title: `${item.kind} evidence · ${item.backend}`,
      status: item.outcome,
      statusTone: item.outcome === "ok" ? "positive" : item.outcome === "quarantined" ? "negative" : "neutral",
      summary: `Observed ${item.observed_at} with trust "${item.trust}".`,
      facts: factsOf([
        ["Evidence ID", item.id, null],
        ["Kind", item.kind, null],
        ["Backend", item.backend, null],
        ["Observed", item.observed_at, null],
        ["Trust", item.trust, null],
        ["Query", item.query ?? "unrecorded", null],
        ["Fresh until", item.fresh_until ?? "unrecorded", null],
      ]),
      related: [
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
        ...(proposal?.citations.some((citation) => citation.cited_item_ids.includes(item.id)) ?? false
          ? [{ recordId: "remediation", label: "Remediation" }]
          : []),
      ],
      artifactLink: context.proposalEnvelope?.content_hash ?? null,
      reference: item.id,
      raw: item.snapshot as SerializableJson,
    })
  }

  // Fusion records ---------------------------------------------------------
  const participantEnvelopes = envelopesOf(store, incidentId, "fusion-participant-output", runId)
  const judgeEnvelope = latestOf(envelopesOf(store, incidentId, "fusion-judge-output", runId))
  const synthesizerEnvelope = latestOf(envelopesOf(store, incidentId, "fusion-synthesizer-output", runId))

  for (const envelope of participantEnvelopes) {
    const output = envelope.payload as FusionParticipantOutput
    add({
      id: `participant:${output.participant_id}`,
      kind: "Fusion participant",
      title: `Participant ${output.participant_id}`,
      status: "Completed",
      statusTone: "info",
      summary: `Participated in diagnosis with ${output.hypotheses.length} hypothesis contribution(s).`,
      facts: factsOf([
        ["Participant", output.participant_id, null],
        ["Hypotheses", output.hypotheses.map((h) => h.id).join(", "), null],
        ["Objections", output.stated_objections.length > 0 ? String(output.stated_objections.length) : "none", null],
      ]),
      related: [
        { recordId: "judge", label: "Fusion judge" },
        { recordId: "synthesizer", label: "Fusion synthesizer" },
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
      ],
      artifactLink: envelope.content_hash,
      reference: output.participant_id,
      raw: output,
    })
  }

  if (judgeEnvelope !== undefined) {
    const output = judgeEnvelope.payload as FusionJudgeOutput
    add({
      id: "judge",
      kind: "Fusion judge",
      title: `Judge ${output.judge_id}`,
      status: "Completed",
      statusTone: "info",
      summary: "Compared participant outputs and recorded agreements, contradictions, blind spots, and unique findings.",
      facts: factsOf([
        ["Judge", output.judge_id, null],
        ["Agreements", String(output.agreements.length), null],
        ["Contradictions", String(output.contradictions.length), null],
        ["Blind spots", String(output.blind_spots.length), null],
        ["Unique findings", String(output.unique_findings.length), null],
      ]),
      related: [
        { recordId: "synthesizer", label: "Fusion synthesizer" },
        ...participantEnvelopes.map((envelope) => {
          const participant = envelope.payload as FusionParticipantOutput
          return { recordId: `participant:${participant.participant_id}`, label: `Participant ${participant.participant_id}` }
        }),
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
      ],
      artifactLink: judgeEnvelope.content_hash,
      reference: output.judge_id,
      raw: output,
    })
  }

  if (synthesizerEnvelope !== undefined) {
    const output = synthesizerEnvelope.payload as FusionSynthesizerOutput
    add({
      id: "synthesizer",
      kind: "Fusion synthesizer",
      title: `Synthesizer ${output.synthesizer_id}`,
      status: "Completed",
      statusTone: "info",
      summary: "Ranked the participant hypotheses and recommended next actions.",
      facts: factsOf([
        ["Synthesizer", output.synthesizer_id, null],
        ["Ranked", output.ranked_hypotheses.map((entry) => `${entry.rank}. ${entry.hypothesis.id}`).join(", "), null],
        ["Next actions", output.next_actions.map((action) => action.procedure).join(", "), null],
      ]),
      related: [
        { recordId: "judge", label: "Fusion judge" },
        ...participantEnvelopes.map((envelope) => {
          const participant = envelope.payload as FusionParticipantOutput
          return { recordId: `participant:${participant.participant_id}`, label: `Participant ${participant.participant_id}` }
        }),
        ...(hypothesisId === null ? [] : [{ recordId: `hypothesis:${hypothesisId}`, label: `Hypothesis ${hypothesisId}` }]),
      ],
      artifactLink: synthesizerEnvelope.content_hash,
      reference: output.synthesizer_id,
      raw: output,
    })
  }

  // Verification record ----------------------------------------------------
  if (context.verification !== undefined && context.verificationEnvelope !== undefined) {
    add({
      id: "verification",
      kind: "Verification",
      title: `Verification · ${context.verification.verdict}`,
      status: context.verification.verdict,
      statusTone: context.verification.verdict === "pass" ? "positive" : "negative",
      summary: context.verification.verdict_reason,
      facts: factsOf([
        ["Verdict", context.verification.verdict, null],
        ["Reason", context.verification.verdict_reason, null],
        ["Sealed", context.verification.sealed_at, null],
        ["Policy", context.verification.policy_version, null],
        ["Hash binding", context.verification.hash_binding.match ? "candidate matches" : "candidate mismatch", null],
      ]),
      related: [
        { recordId: "remediation", label: "Remediation" },
        { recordId: "source-host", label: "Source-host receipt" },
        { recordId: "run", label: "Run record" },
        ...(context.releaseGate === null ? [] : [{ recordId: "gate-release", label: "Release Gate" }]),
      ],
      artifactLink: context.verificationEnvelope.content_hash,
      reference: context.verification.candidate_hash,
      raw: context.verificationEnvelope.payload as SerializableJson,
    })
  }

  // Release Gate record ----------------------------------------------------
  if (context.releaseGate !== null) {
    const gate = context.releaseGate
    add({
      id: "gate-release",
      kind: "Gate",
      title: `Release Gate · ${gate.verdict}`,
      status: gate.verdict,
      statusTone: gate.verdict === "pass" ? "positive" : gate.verdict === "fail" ? "negative" : "neutral",
      summary: `The gate evaluated ${gate.facts.length} deterministic facts.`,
      facts: factsOf([
        ["Verdict", gate.verdict, gate.source],
        ["Evaluated", gate.evaluatedAt, null],
        ["Candidate", gate.candidateHash ?? "unrecorded", null],
        ["Facts", gate.facts.length > 0 ? String(gate.facts.length) : "not evaluated", null],
      ]),
      related: [
        { recordId: "verification", label: "Verification" },
        { recordId: "remediation", label: "Remediation" },
        { recordId: "recovery:point", label: "Recovery Point" },
      ],
      artifactLink: null,
      reference: null,
      raw: gate as unknown as SerializableJson,
    })
  }

  // Recovery Point record --------------------------------------------------
  if (proposal !== undefined) {
    add({
      id: "recovery:point",
      kind: "Recovery Point",
      title: `${proposal.recovery_point.id} · ${context.recoveryConsumed ? "consumed" : "drafted"}`,
      status: context.recoveryConsumed ? "Consumed" : "Drafted",
      statusTone: context.recoveryConsumed ? "positive" : "neutral",
      summary: context.recoveryConsumed
        ? "Validated and consumed by the recorded release action."
        : "Recorded but never consumed; the run did not release.",
      facts: factsOf([
        ["Recovery Point", proposal.recovery_point.id, null],
        ["Changed surfaces", proposal.recovery_point.changed_surfaces.join(", "), null],
        ["State", context.recoveryConsumed ? "consumed" : "drafted", null],
      ]),
      related: [
        { recordId: "remediation", label: "Remediation" },
        ...(context.releaseGate === null ? [] : [{ recordId: "gate-release", label: "Release Gate" }]),
      ],
      artifactLink: context.proposalEnvelope?.content_hash ?? null,
      reference: proposal.recovery_point.id,
      raw: proposal.recovery_point,
    })
  }

  return records
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Project the Change Review workspace for one Incident from a verified
 * store. Returns null for an Incident outside the saved bundle.
 */
export function changeWorkspaceView(
  store: ReplayStore,
  incidentId: string,
  evaluationTime: string,
): ChangeWorkspaceView | null {
  const detailResult = getIncidentDetail(store, incidentId)
  if (!detailResult.ok) {
    return null
  }
  const detail = detailResult.value
  const base = detailView(store, incidentId, evaluationTime)
  if (base === null) {
    return null
  }
  const list = listView(store)

  const binding = resolveRunBinding(store, incidentId)
  if (binding.kind !== "bound") {
    return null
  }
  const { runId, attempt, manifest, manifestSource } = binding

  const proposalEnvelope = latestOf(envelopesOf(store, incidentId, "remediation-proposal", runId))
  const proposal = proposalEnvelope === undefined ? undefined : (proposalEnvelope.payload as RemediationProposal)
  const receiptEvent = sourceHostReceipt(detail)
  const diagnosisEnvelope = latestOf(envelopesOf(store, incidentId, "diagnosis-report", runId))
  const diagnosis = diagnosisEnvelope === undefined ? undefined : (diagnosisEnvelope.payload as DiagnosisReport)
  const evidenceEnvelope = latestOf(envelopesOf(store, incidentId, "evidence-set", runId))
  const evidenceItems = evidenceEnvelope === undefined ? [] : (evidenceEnvelope.payload as EvidenceSet).items
  const verificationEnvelope = latestOf(envelopesOf(store, incidentId, "verification-report", runId))
  const verification = verificationEnvelope === undefined ? undefined : (verificationEnvelope.payload as VerificationReport)

  const runRecord = detail.runs.find((run) => run.runId === runId) ?? null
  const window = runWindow(detail, runId)
  const lastPolicyEvent = [...detail.events].reverse().find((event) => "run_id" in event && event.run_id === runId)

  const diff = diffOf(proposal, proposalEnvelope === undefined ? null : artifactSource(proposalEnvelope))
  const releaseGate = base.releaseGate
  const hypothesisGate = base.hypothesisGate
  const releaseSucceededFlag = releaseSucceeded(detail, runId)
  const watchConfirmedFlag = watchConfirmed(store, incidentId, runId)
  const incidentClosed = detail.state === "closed"
  const state = deriveChangeState({
    hasRemediation: proposal !== undefined,
    verificationVerdict: verification?.verdict ?? null,
    releaseGate,
    releaseSucceeded: releaseSucceededFlag,
    watchConfirmed: watchConfirmedFlag,
    incidentClosed,
  })

  const reviewEnvelopes = envelopesOf(store, incidentId, "review-report", runId)
  const testEnvelopes = envelopesOf(store, incidentId, "test-report", runId)
  const reviewsPassed = reviewEnvelopes.filter((envelope) => (envelope.payload as ReviewReport).status === "pass").length
  const testsPassed = testEnvelopes.filter((envelope) => (envelope.payload as TestReport).outcome === "pass").length
  const failedIds = [
    ...reviewEnvelopes
      .filter((envelope) => (envelope.payload as ReviewReport).status !== "pass")
      .map((envelope) => (envelope.payload as ReviewReport).role),
    ...testEnvelopes
      .filter((envelope) => (envelope.payload as TestReport).outcome !== "pass")
      .map((envelope) => (envelope.payload as TestReport).layer),
  ]

  const acceptedHypothesisId = proposal?.citations[0]?.hypothesis_id ?? diagnosis?.hypotheses.find((candidate) => candidate.status === "accepted")?.id ?? null
  const acceptedHypothesis = diagnosis?.hypotheses.find((candidate) => candidate.id === acceptedHypothesisId)
  const supporting: SupportingEvidenceView[] = (acceptedHypothesis?.evidence.supporting ?? []).map((itemId) => ({
    itemId,
    recordId: itemRecordId(itemId),
    kind: evidenceItems.find((item) => item.id === itemId)?.kind ?? null,
    backend: evidenceItems.find((item) => item.id === itemId)?.backend ?? null,
    observedAt: evidenceItems.find((item) => item.id === itemId)?.observed_at ?? null,
  }))

  const navigator: IncidentNavigatorRow[] = list.incidents.map((row) => {
    const sourceIncident = store.incidents.find((candidate) => candidate.incidentId === row.incidentId)
    const trigger = sourceIncident?.events.find((event) => event.type === "trigger_received")
    return {
      incidentId: row.incidentId,
      state: row.state,
      closureReason: row.closureReason,
      severity: row.severity,
      serviceName: row.serviceName,
      environmentName: row.environmentName,
      signalName: trigger?.type === "trigger_received" ? trigger.trigger.signal_summary.name : null,
      signalValue: trigger?.type === "trigger_received" ? formatRatio(trigger.trigger.signal_summary.value, trigger.trigger.signal_summary.unit) : null,
      firstTriggerAt: row.firstTriggerAt,
      latestOutcome:
        row.latestRun === null
          ? null
          : row.latestRun.failureReason !== null
            ? `failed · ${row.latestRun.failureReason}`
            : row.latestRun.outcome ?? row.latestRun.state,
      latestOutcomeSource: row.latestRunSource,
    }
  })

  const records = recordsOf({
    store,
    incidentId,
    runId,
    run: {
      runId,
      attempt,
      attemptLimit: ATTEMPT_LIMIT,
      state: runRecord?.state ?? "unrecorded",
      outcome: runRecord?.outcome ?? null,
      failureReason: runRecord?.failureReason ?? null,
      restartCount: runRecord?.restartCount ?? 0,
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      startedSource: window.startedSource,
      endedSource: window.endedSource,
      durationSeconds: window.durationSeconds,
      durationSource: window.durationSeconds === null ? null : window.startedSource,
      binding: manifest === null ? "journal" : "manifest",
      bindingReason: manifest === null ? "no capture manifest; the journal's progressed run is used" : "capture manifest",
      policyVersion: lastPolicyEvent?.policy_version ?? null,
      policySource: lastPolicyEvent === undefined ? null : journalSource(lastPolicyEvent.sequence),
    },
    proposal,
    proposalEnvelope,
    receiptEvent,
    diagnosis,
    evidenceItems,
    verification,
    verificationEnvelope,
    releaseGate,
    hypothesisGate,
    recoveryConsumed: releaseSucceededFlag,
    diff,
    manifest,
    manifestSource,
  })

  const change: ChangeSummaryView | null =
    proposal === undefined
      ? null
      : {
          state,
          description: proposal.change_description,
          remediationClass: proposal.remediation_class,
          actionRiskClass: proposal.action_risk_class,
          gatePath: proposal.gate_path,
          candidateHash: proposal.candidate_hash,
          baseRef: proposal.diff?.base_ref ?? null,
          hypothesisId: acceptedHypothesisId,
          citationChange: proposal.citations[0]?.change ?? null,
          citedItemIds: proposal.citations[0]?.cited_item_ids ?? [],
          changedSurfaces: proposal.changed_surfaces,
          services: proposal.blast_radius?.services ?? [],
          environments: proposal.blast_radius?.environments ?? [],
          recoveryPointId: proposal.recovery_point.id,
          recoveryConsumed: releaseSucceededFlag,
          testPlan: proposal.test_plan,
          supporting,
          artifactSource: proposalEnvelope === undefined ? null : artifactSource(proposalEnvelope),
        }

  return {
    meta: {
      formatVersion: base.meta.formatVersion,
      captureTime: base.meta.captureTime,
      evaluationTime,
      incidentCount: list.incidents.length,
      providerClass: manifest?.provider_class ?? null,
      provider: manifest?.provider ?? null,
      model: manifest?.model ?? null,
      reasoning: manifest?.reasoning ?? null,
      manifestId: manifest?.manifest_id ?? null,
      manifestSealedAt: manifest?.sealed_at ?? null,
    },
    navigator,
    incident: {
      incidentId,
      state: detail.state,
      closureReason: detail.closureReason ?? null,
      severity: base.severity,
      service: base.scope?.service ?? null,
      environment: base.scope?.environment ?? null,
      attemptsUsed: detail.attemptsUsed,
      finalSequence: detail.finalSequence,
    },
    run: {
      runId,
      attempt,
      attemptLimit: ATTEMPT_LIMIT,
      state: runRecord?.state ?? "unrecorded",
      outcome: runRecord?.outcome ?? null,
      failureReason: runRecord?.failureReason ?? null,
      restartCount: runRecord?.restartCount ?? 0,
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      startedSource: window.startedSource,
      endedSource: window.endedSource,
      durationSeconds: window.durationSeconds,
      durationSource: window.durationSeconds === null ? null : window.startedSource,
      binding: manifest === null ? "journal" : "manifest",
      bindingReason: manifest === null ? "no capture manifest; the journal's progressed run is used" : "capture manifest",
      policyVersion: lastPolicyEvent?.policy_version ?? null,
      policySource: lastPolicyEvent === undefined ? null : journalSource(lastPolicyEvent.sequence),
    },
    change,
    diff,
    reviewState: {
      reviewsPassed,
      reviewsTotal: reviewEnvelopes.length,
      testsPassed,
      testsTotal: testEnvelopes.length,
      failedIds,
      releaseGate:
        releaseGate === null
          ? null
          : {
              verdict: releaseGate.verdict,
              evaluatedAt: releaseGate.evaluatedAt,
              candidateHash: releaseGate.candidateHash,
              source: releaseGate.source,
            },
    },
    records,
    defaultRecordId: "source-host",
  }
}