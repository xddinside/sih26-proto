/**
 * @sih/pi-skills: the SIH Worker, SIH extension, Fusion diagnosis, repair,
 * review, and test skills. One Worker per Incident attempt hosts one Pi
 * Orchestrator and skill-bound specialist subagents. Deterministic tools,
 * broker receipts, the applicability resolver, and Control Plane gates own
 * pass or fail; a model cannot forge a receipt, re-scope applicability,
 * reinterpret a failure, or replace a gate.
 */
export {
  TOOL_GROUPS,
  WRITE_TOOLS,
  SHELL_TOOLS,
  PRODUCTION_TOOLS,
  CREDENTIAL_TOOLS,
  OPEN_WEB_TOOLS,
  FORBIDDEN_TOOLS,
  resolveAllowList,
  applyActiveTools,
  diagnoseReadOnlyTools,
  hasForbiddenTool,
  stageAllows,
} from "./allow-lists.js"
export type { ToolName, ToolAllowListError } from "./allow-lists.js"

export {
  DEMO_SKILL_NAMES,
  NOT_DEMO_SKILL_NAMES,
  loadSkill,
  loadSkillTree,
  assertDemoSubset,
  skillsDigest,
  registeredSchemaNames,
} from "./skill-catalog.js"
export type { Skill, SkillContract } from "./skill-catalog.js"

export {
  composeSystemPrompt,
  extractJson,
  SkillSession,
  DEFAULT_RETRY_SETTINGS,
} from "./session.js"
export type {
  RetrySettings,
  SessionRunResult,
  SkillSessionOptions,
  ToolCallRecord,
} from "./session.js"

export {
  PiRoleSession,
  RoleSessionError,
} from "./role/role-session.js"
export type {
  RoleSessionOptions,
  RoleSessionResult,
  RoleSessionStatus,
} from "./role/role-session.js"
export {
  DEFAULT_ROLE_LIMITS,
} from "./role/limits.js"
export type { RoleLimits } from "./role/limits.js"
export { effectiveToolSet } from "./role/authority.js"
export type { ToolAuthority } from "./role/authority.js"
export { createReadTool } from "./role/broker-tools.js"
export type { BrokerReadToolOptions } from "./role/broker-tools.js"
export { createTerminalTool, TerminalToolError } from "./role/terminal-tools.js"
export type { TerminalTool, TerminalToolOptions } from "./role/terminal-tools.js"
export { redactSecrets, containsNoSecrets } from "./role/redact.js"

export {
  PARTICIPANT_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  SYNTHESIZER_SYSTEM_PROMPT,
  BRIEF_SYSTEM_PROMPT,
  buildDeterministicBrief,
  createParticipantPrompt,
  createJudgePrompt,
  createSynthesizerPrompt,
} from "./prompts.js"

export {
  runFusionRound,
  isRoundValid,
  FusionRoundError,
  DIAGNOSE_GUARDRAILS,
} from "./fusion/fusion-runtime.js"
export type {
  FusionRoleConfig,
  FusionRoundOptions,
  FusionRoundResult,
  ParticipantRun,
  JudgeRun,
  SynthesizerRun,
} from "./fusion/fusion-runtime.js"
export {
  emptyFusionRunArtifact,
  artifactDigest,
  buildLaterContext,
  assertExcludedFromContext,
  fusionRunArtifactWire,
} from "./fusion/traces.js"
export type {
  FusionRunArtifact,
  FusionPipelineCall,
  FusionCallKind,
  FusionPerspective,
  FusionRunMetrics,
  FusionRunArtifactWire,
} from "./fusion/traces.js"

export {
  consolidateReviews,
  detectContradictions,
  adjudicateContradiction,
  assembleVerdictInput,
  severityMaxOf,
  isCitedRetraction,
  contradictionCitationKey,
} from "./consolidation.js"
export type {
  ConsolidatedReviews,
  Contradiction,
  Severity,
  AssembledVerdictInput,
} from "./consolidation.js"

export {
  PRODUCTION_BUDGETS,
  DEMO_BUDGETS,
  REHEARSAL_BUDGETS,
  BudgetTracker,
} from "./worker/budgets.js"
export type { Budgets, BudgetMetric, BudgetResult } from "./worker/budgets.js"

export {
  bootstrapWorker,
  ReadSnapshot,
  fetchArtifactByHash,
  ROOTLESS_WORKER_FLAGS,
  WorkerStartupError,
} from "./worker/bootstrap.js"
export type {
  LeaseHandle,
  LeaseSource,
  Checkpoint,
  StartupInputs,
  WorkerRuntime,
} from "./worker/bootstrap.js"

export {
  assembleProposalDraft,
  uncoveredSurfaces,
  validateProposalPayload,
  fromRemediationDraft,
} from "./repair/planner.js"
export type {
  PlannerDraft,
  PlannerDraftView,
  RemediationDisposition,
} from "./repair/planner.js"
export {
  computeCandidateHash,
  validateImplementerDiff,
  assertExecutableSurface,
  changedFilesFromDiff,
  assertDiffInScope,
} from "./repair/implementer.js"
export { runRealRepairRound } from "./repair/repair-real.js"
export type {
  RealRepairRoundOptions,
  RepairRoundResult,
  RepairSealSurface,
} from "./repair/repair-real.js"

export {
  parseReviewReport,
  decideReviewRerun,
  uncitedBlockingFindings,
  validateFindingScope,
} from "./reviews/review-runner.js"
export type {
  ReviewRoleCode,
  ReviewRerunDecision,
} from "./reviews/review-runner.js"

export {
  parseTestReport,
  outcomeFromReceipt,
  outcomeFromRuns,
  runsMatchReceipt,
  detectFlakyPass,
  assertReceiptBinding,
  assertT5Selection,
  decideTestRerun,
  flakyPassNeedsHuman,
} from "./tests/test-runner.js"
export type {
  TestLayerCode,
  ReceiptOutcome,
  PinnedToolEntry,
  AssignedTestReceipt,
} from "./tests/test-runner.js"

export {
  createAssignedTestTool,
} from "./role/test-tools.js"
export type { AssignedTestToolOptions } from "./role/test-tools.js"

export { runRealVerifyRound } from "./verify/verify-real.js"
export type {
  RealVerifyRoundOptions,
  VerifyRoundResult,
} from "./verify/verify-real.js"

export {
  PiOrchestratorExtension,
  dispositionFromAuthorityMode,
  compareWatchSamples,
  NO_CANDIDATE_HASH,
  OrchestratorError,
} from "./orchestrator/orchestrator.js"
export type {
  ControlPlaneProposals,
  OrchestratorOptions,
  EvidenceBundle,
  HypothesisGateInput,
  ApplicabilityInput,
  ApplicabilityResult,
  VerificationInput,
  GateEvaluationResponse,
  SubagentRunRecord,
  StageOutcome,
  RepairRoundInput,
  WatchSample,
} from "./orchestrator/orchestrator.js"
export { HttpControlPlaneProposals } from "./orchestrator/http-proposals.js"
export type { HttpProposalsOptions } from "./orchestrator/http-proposals.js"
export {
  ORCHESTRATOR_INSPECT_TOOL,
  ORCHESTRATOR_REQUEST_TOOL,
  createOrchestratorTools,
  isOrchestratorWorkRequest,
} from "./orchestrator/tools.js"
export type { OrchestratorToolService } from "./orchestrator/tools.js"

export { runRealFusionRound } from "./fusion/fusion-real.js"
export type {
  RealFusionRoundOptions,
  RealFusionRoundResult,
  FusionRoleSessionRecord,
  FusionSealSurface,
} from "./fusion/fusion-real.js"

export {
  runPlannerRole,
  runImplementerRole,
  runReviewRole,
  runTestRole,
  runOrchestratorRole,
  createWorktreeHost,
  createWorktreeTools,
  buildUnifiedDiff,
} from "./agent/roles.js"
export type {
  AgentSessionKit,
  AgentSessionRecord,
  AgentRoleResult,
  WorktreeHost,
  PlannerRoleOptions,
  ImplementerRoleOptions,
  ReviewRoleOptions,
  TestRoleOptions,
  OrchestratorRoleOptions,
} from "./agent/roles.js"
