/**
 * Re-exported TypeScript types, mechanically derived from the JSON Schemas by
 * `json-schema-to-ts`. Integrators should import types from here (or from the
 * individual schema modules) rather than hand-writing them.
 */
export type { ArtifactEnvelope } from "./schemas/artifact-envelope.js";
export type {
  AgentRoleName,
  CaptureManifest,
  CaptureManifestRoleRecord,
  ImplementedDiff,
  OrchestratorReport,
  RemediationDraft,
} from "./schemas/agent.js";
export type { BrokerReceipt } from "./schemas/broker-receipt.js";
export { AGENT_PHASE } from "./schemas/agent-run.js";
export type { AgentPhase, AgentPipelineCall, AgentRunArtifactWire } from "./schemas/agent-run.js";
export type { EvidenceItem, EvidenceSet } from "./schemas/evidence.js";
export type { GateEvaluation } from "./schemas/gate-evaluation.js";
export type {
  FusionJudgeOutput,
  FusionParticipantOutput,
  FusionSynthesizerOutput,
} from "./schemas/fusion.js";
export type {
  CandidateHashInput,
  DeliveryKeyInput,
  EvidenceHashInput,
  IncidentKeyInput,
} from "./schemas/hash-inputs.js";
export type { Hypothesis } from "./schemas/hypothesis.js";
export type {
  ClosureReason,
  Incident,
  IncidentRun,
  IncidentState,
  RunFailureReason,
  RunOutcome,
  RunState,
  StageRecord,
} from "./schemas/incident.js";
export type { DetectorState, IncidentTrigger } from "./schemas/incident-trigger.js";
export type {
  JournalCommand,
  JournalEvent,
  JournalEventType,
} from "./schemas/journal-event.js";
export type {
  DiagnosisReport,
  IncidentBrief,
  IncidentReport,
  RemediationProposal,
  ReviewReport,
  TestReport,
  VerificationReport,
  WatchReport,
} from "./schemas/reports.js";
export type { SavedBundleManifest } from "./schemas/saved-bundle-manifest.js";
export type { RolloutWatchPlan } from "./schemas/rollout-watch-plan.js";
export type { DirectActionRecord, RecoveryPoint, ReleaseRecord } from "./schemas/release-records.js";
export type {
  SchemaClassification,
  SchemaName,
  SchemaPayload,
  SchemaVersion,
  JsonSchema,
} from "./schemas/registry.js";
