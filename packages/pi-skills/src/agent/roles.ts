/**
 * Real Pi role sessions for the non-Fusion stages: repair planner, repair
 * implementer, reviewers, test subagents, and the end-of-run Orchestrator.
 *
 * Every role is one PiRoleSession that ends in one schema-valid typed
 * terminal submission whose payload is sealed through the caller's Control
 * Plane seam (`submit_remediation`, `submit_implemented_diff`,
 * `submit_review`, `submit_test_report`, `submit_orchestrator_report`). The
 * implementer works only inside its private copy-on-write worktree host.
 */
import type { ModelGateway, LeaseRef, ReadBroker } from "@sih/brokers"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type { ThinkingLevel } from "@earendil-works/pi-ai"
import { contentHash } from "@sih/contracts/hashes"
import type {
  ImplementedDiff,
  OrchestratorReport,
  RemediationDraft,
  ReviewReport,
  TestReport,
} from "@sih/contracts/types"

import {
  createReviewPrompt,
  createTestPrompt,
  ORCHESTRATOR_SYSTEM_PROMPT,
  REPAIR_IMPLEMENTER_SYSTEM_PROMPT,
  REPAIR_PLANNER_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
} from "../prompts.js"
import { PiRoleSession } from "../role/role-session.js"
import type { RoleLimits } from "../role/limits.js"
import { createReadTool } from "../role/broker-tools.js"
import { createTerminalTool } from "../role/terminal-tools.js"
import type { FusionSealSurface } from "../fusion/fusion-real.js"
import type { ReviewRoleCode } from "../reviews/review-runner.js"
import type { TestLayerCode } from "../tests/test-runner.js"

/** Everything a real role session needs to run. */
export interface AgentSessionKit {
  gateway: ModelGateway
  lease: LeaseRef
  candidateHash: string
  seal: FusionSealSurface
  model: { provider: string; id: string }
  reasoning?: ThinkingLevel
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
  readBroker?: ReadBroker
  /** The implementer's private copy-on-write worktree. */
  worktree?: WorktreeHost
}

/** Identity and outcome of one real role session, for the capture manifest. */
export interface AgentSessionRecord {
  role: string
  agentId: string
  status: "succeeded" | "failed" | "aborted"
  submissionId?: string
  modelUseAgentIds: string[]
  turns: number
  toolCalls: number
  durationMs: number
}

export interface AgentRoleResult<T> {
  payload: T | null
  status: "succeeded" | "failed" | "aborted"
  session: AgentSessionRecord
  failureReason?: string
}

const ROLE_TOOL = "role_session_tool"

function authorityTools(tools: readonly string[]): string[] {
  const out = [...tools]
  if (out.includes(ROLE_TOOL)) {
    return out
  }
  return [ROLE_TOOL, ...out]
}

interface RoleSessionRunOptions {
  kit: AgentSessionKit
  agentId: string
  parentAgentId?: string
  /** The journal-safe model_use agent_role value. */
  roleLabel: string
  /** The capture-vocabulary role name (planner, implementer, ...). */
  roleName: string
  systemPrompt: string
  promptText: string
  terminalName: string
  schemaName: string
  schemaVersion: string
  skill: string
  tools?: readonly string[]
}

async function runRoleSession<T>(
  options: RoleSessionRunOptions,
): Promise<AgentRoleResult<T>> {
  const started = Date.now()
  let capturedPayload: unknown = null
  let submissionId: string | undefined
  const terminal = createTerminalTool({
    name: options.terminalName,
    schemaName: options.schemaName,
    schemaVersion: options.schemaVersion,
    submit: async (payload) => {
      capturedPayload = payload
      const sealed = await options.kit.seal.seal({
        schemaId: options.schemaName,
        schemaVersion: options.schemaVersion,
        payload,
        producer: { skill: options.skill, skill_version: "1.0" },
      })
      submissionId = sealed.content_hash
      return { submissionId: sealed.content_hash }
    },
  })
  const registeredTools: AgentTool<any>[] = []
  if (options.kit.readBroker !== undefined) {
    registeredTools.push(
      createReadTool({
        broker: options.kit.readBroker,
        lease: options.kit.lease,
        candidateHash: options.kit.candidateHash,
      }),
    )
  }
  if (options.kit.worktree !== undefined) {
    registeredTools.push(...createWorktreeTools(options.kit.worktree))
  }
  const toolNames = authorityTools(options.tools ?? [])
  registeredTools.push(terminal.tool)
  const session = new PiRoleSession({
    agentId: options.agentId,
    parentAgentId: options.parentAgentId ?? options.agentId,
    agentRole: options.roleLabel,
    systemPrompt: options.systemPrompt,
    model: options.kit.model,
    reasoning: options.kit.reasoning,
    lease: options.kit.lease,
    gateway: options.kit.gateway,
    candidateHash: options.kit.candidateHash,
    tools: registeredTools,
    terminalTool: terminal,
    authority: {
      roleTools: toolNames,
      stageTools: toolNames,
      policyTools: toolNames,
      leaseTools: toolNames,
    },
    limits: options.kit.limits,
    signal: options.kit.signal,
  })
  const result = await session.run(options.promptText)
  const status = result.status
  const payload = status === "succeeded" ? (capturedPayload as T | null) : null
  const record: AgentSessionRecord = {
    role: options.roleName,
    agentId: options.agentId,
    status,
    turns: result.turns,
    toolCalls: result.toolCalls,
    durationMs: Date.now() - started,
    modelUseAgentIds: [options.agentId],
  }
  if (submissionId !== undefined) {
    record.submissionId = submissionId
  }
  return {
    payload,
    status,
    session: record,
    ...(status === "succeeded" ? {} : { failureReason: result.failureReason }),
  }
}

// ---------------------------------------------------------------------------
// Repair planner

export interface PlannerRoleOptions {
  incidentId: string
  runId: string
  attempt: number
  acceptedHypothesis: string
  changeSurfacePolicy: string
  recoveryPointSummary: string
  changedSurfaces: readonly string[]
  plannerTask: string
}

/** Run the repair planner role; the sealed payload is the Remediation
 * Draft v1. */
export function runPlannerRole(
  kit: AgentSessionKit,
  options: PlannerRoleOptions,
): Promise<AgentRoleResult<RemediationDraft>> {
  return runRoleSession<RemediationDraft>({
    kit,
    agentId: `repair-planner-${kit.lease.runId}`,
    // The journal's model_use agent_role vocabulary has one repair slot.
    roleLabel: "repair-agent",
    systemPrompt: REPAIR_PLANNER_SYSTEM_PROMPT,
    promptText: [
      options.plannerTask,
      "",
      `## Accepted Hypothesis\n${options.acceptedHypothesis}`,
      `## Recovery Point\n${options.recoveryPointSummary}`,
      `## Changed-surface policy\n${options.changeSurfacePolicy}`,
      `## Declared changed surfaces\n${options.changedSurfaces.join("\n")}`,
      "",
      "Return your final draft as the Remediation Draft v1 JSON object.",
    ].join("\n"),
    terminalName: "submit_remediation",
    schemaName: "remediation-draft",
    schemaVersion: "1.0",
    skill: "sih-repair-planner",
    roleName: "planner",
  })
}

// ---------------------------------------------------------------------------
// Repair implementer

/** The implementer's private copy-on-write worktree: base content plus the
 * implementer's edits, with a deterministic unified diff against the base
 * ref. */
export interface WorktreeHost {
  readonly baseRef: string
  read: (path: string) => string | undefined
  write: (path: string, content: string) => void
  diffText: () => string
}

const worktreeReadParameters = Type.Object({
  path: Type.String({ description: "The worktree file path" }),
})
const worktreeWriteParameters = Type.Object({
  path: Type.String({ description: "The worktree file path" }),
  content: Type.String({ description: "The full new file content" }),
})

/** The read-only worktree inspection tool. */
export function createWorktreeReadTool(host: WorktreeHost): AgentTool<any> {
  return {
    name: "worktree_read",
    description:
      "Read a file from the private copy-on-write worktree. Returns the full file content or an error for an absent path.",
    label: "Worktree read",
    parameters: worktreeReadParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const p = params as { path: string }
      const content = host.read(p.path)
      if (content === undefined) {
        return {
          content: [{ type: "text", text: `no such file in the worktree: ${p.path}` }],
          details: { path: p.path, found: false },
        }
      }
      return {
        content: [{ type: "text", text: content }],
        details: { path: p.path, found: true, bytes: content.length },
      }
    },
  }
}

/** The write tool that records the implementer's edit in the worktree. */
export function createWorktreeWriteTool(host: WorktreeHost): AgentTool<any> {
  return {
    name: "worktree_write",
    description:
      "Write a file in the private copy-on-write worktree. The edit only ever exists in this worktree; it is never merged or deployed by this session.",
    label: "Worktree write",
    parameters: worktreeWriteParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const p = params as { path: string; content: string }
      host.write(p.path, p.content)
      return {
        content: [
          { type: "text", text: `wrote ${p.path} (${p.content.length} bytes)` },
        ],
        details: { path: p.path, bytes: p.content.length },
      }
    },
  }
}

/** The diff inspection tool: the deterministic unified diff of the worktree
 * changes against the base ref. */
export function createWorktreeDiffTool(host: WorktreeHost): AgentTool<any> {
  return {
    name: "worktree_diff",
    description:
      "Return the complete deterministic unified diff of the worktree changes against the base ref.",
    label: "Worktree diff",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params) {
      const diffText = host.diffText()
      return {
        content: [{ type: "text", text: diffText }],
        details: { changed: diffText.length > 0 },
      }
    },
  }
}

/** Every worktree tool, for registration and allow-listing. */
export function createWorktreeTools(host: WorktreeHost): AgentTool<any>[] {
  return [
    createWorktreeReadTool(host),
    createWorktreeWriteTool(host),
    createWorktreeDiffTool(host),
  ]
}

export interface ImplementerRoleOptions {
  incidentId: string
  runId: string
  attempt: number
  baseRef: string
  changedFiles: readonly string[]
  implementerTask: string
}

/** Run the repair implementer role against its private worktree; the sealed
 * payload is the Implemented Diff v1. */
export async function runImplementerRole(
  kit: AgentSessionKit,
  options: ImplementerRoleOptions,
): Promise<AgentRoleResult<ImplementedDiff>> {
  if (kit.worktree === undefined) {
    throw new Error("runImplementerRole needs a worktree host")
  }
  const result = await runRoleSession<ImplementedDiff>({
    kit,
    agentId: `repair-implementer-${kit.lease.runId}`,
    // The journal's model_use agent_role vocabulary has one repair slot.
    roleLabel: "repair-agent",
    systemPrompt: REPAIR_IMPLEMENTER_SYSTEM_PROMPT,
    promptText: [
      options.implementerTask,
      "",
      `## Base ref\n${options.baseRef}`,
      `## Allowed changed files\n${options.changedFiles.join("\n")}`,
      "",
      "Inspect the worktree, apply the remediation there, then return the " +
        "complete diff as the Implemented Diff v1 JSON object.",
    ].join("\n"),
    terminalName: "submit_implemented_diff",
    schemaName: "implemented-diff",
    schemaVersion: "1.0",
    skill: "sih-repair-implementer",
    tools: ["worktree_read", "worktree_write", "worktree_diff"],
    roleName: "implementer",
  })
  return result
}

// ---------------------------------------------------------------------------
// Review roles

export interface ReviewRoleOptions {
  incidentId: string
  runId: string
  attempt: number
  role: ReviewRoleCode
  reviewer: string
  revision: number
  candidateHash: string
  hypothesis: string
  revisionId: string
  diffText: string
  changedFiles: readonly string[]
  checkHints?: readonly string[]
  inputRefs?: readonly string[]
}

const REVIEW_SKILL_BY_ROLE: Record<ReviewRoleCode, string> = {
  R1: "sih-review-correctness",
  R2: "sih-review-causal-fit",
  R3: "sih-review-code-quality",
  R4: "sih-review-security",
  R8: "sih-review-recovery-point",
}

/** Run one review role session; the sealed payload is the Review Report v1. */
export function runReviewRole(
  kit: AgentSessionKit,
  options: ReviewRoleOptions,
): Promise<AgentRoleResult<ReviewReport>> {
  return runRoleSession<ReviewReport>({
    kit,
    agentId: `review-${options.role}-${kit.lease.runId}`,
    // The journal's model_use agent_role vocabulary has one review slot.
    roleLabel: "reviewer",
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    promptText: createReviewPrompt({
      role: options.role,
      candidateHash: options.candidateHash,
      hypothesis: options.hypothesis,
      revisionId: options.revisionId,
      diffText: options.diffText,
      changedFiles: options.changedFiles,
      checkHints: options.checkHints,
      inputRefs: options.inputRefs,
    }),
    terminalName: "submit_review",
    schemaName: "review-report",
    schemaVersion: "1.0",
    skill: REVIEW_SKILL_BY_ROLE[options.role],
    roleName: "review",
  })
}

// ---------------------------------------------------------------------------
// Test roles

export interface TestRoleOptions {
  incidentId: string
  runId: string
  attempt: number
  layer: TestLayerCode
  tool: string
  toolVersion: string
  target: string
  receiptRef: string
  runs: {
    run_hash: string
    result: "pass" | "fail" | "error"
    at: string
    detail?: string
  }[]
  candidateHash: string
  diffText: string
  changedFiles: readonly string[]
}

const TEST_SKILL_BY_LAYER: Record<string, string> = {
  T1: "sih-test-static-analysis",
  T2: "sih-test-build",
  T3: "sih-test-unit",
  T4: "sih-test-contract",
  T5: "sih-test-regression",
  T7: "sih-test-security-scan",
  T9: "sih-test-isolated-env",
  T10: "sih-test-browser",
  T12: "sih-test-fault-recovery",
  T13: "sih-test-watch-rehearsal",
}

/** Run one test role session; the sealed payload is the Test Report v1. */
export function runTestRole(
  kit: AgentSessionKit,
  options: TestRoleOptions,
): Promise<AgentRoleResult<TestReport>> {
  const runsSummary = options.runs
    .map(
      (run) =>
        `- ${run.result} ${run.run_hash} at ${run.at}${run.detail === undefined ? "" : ` (${run.detail})`}`,
    )
    .join("\n")
  return runRoleSession<TestReport>({
    kit,
    agentId: `test-${options.layer}-${kit.lease.runId}`,
    // The journal's model_use agent_role vocabulary has one test slot.
    roleLabel: "test-agent",
    systemPrompt: TEST_SYSTEM_PROMPT,
    promptText: createTestPrompt({
      layer: options.layer,
      candidateHash: options.candidateHash,
      diffText: options.diffText,
      changedFiles: options.changedFiles,
      runsSummary,
      target: options.target,
    }),
    terminalName: "submit_test_report",
    schemaName: "test-report",
    schemaVersion: "1.0",
    skill: TEST_SKILL_BY_LAYER[options.layer] ?? "sih-test-unit",
    roleName: "test",
  })
}

// ---------------------------------------------------------------------------
// Orchestrator

export interface OrchestratorRoleOptions {
  incidentId: string
  runId: string
  attempt: number
  stageOutcomes: {
    detect: string
    diagnose: string
    repair: string
    verify: string
  }
  runContext: string
}

/** Run the end-of-run Orchestrator role; the sealed payload is the
 * Orchestrator Report v1. */
export function runOrchestratorRole(
  kit: AgentSessionKit,
  options: OrchestratorRoleOptions,
): Promise<AgentRoleResult<OrchestratorReport>> {
  return runRoleSession<OrchestratorReport>({
    kit,
    agentId: `orchestrator-${kit.lease.runId}`,
    roleLabel: "orchestrator",
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    promptText: [
      "# Run Summary",
      options.runContext,
      "",
      "## Deterministic stage outcomes",
      `- detect: ${options.stageOutcomes.detect}`,
      `- diagnose: ${options.stageOutcomes.diagnose}`,
      `- repair: ${options.stageOutcomes.repair}`,
      `- verify: ${options.stageOutcomes.verify}`,
      "",
      "Return your final report as the Orchestrator Report v1 JSON object.",
    ].join("\n"),
    terminalName: "submit_orchestrator_report",
    schemaName: "orchestrator-report",
    schemaVersion: "1.0",
    skill: "sih-orchestrator",
    roleName: "orchestrator",
  })
}

/** Deterministic unified diff between two file states, for the worktree
 * host. Line-based; unchanged files produce no hunks. */
export function buildUnifiedDiff(options: {
  baseRef: string
  base: ReadonlyMap<string, string>
  current: ReadonlyMap<string, string>
}): string {
  const paths = new Set([...options.base.keys(), ...options.current.keys()])
  const hunks: string[] = []
  for (const path of [...paths].sort()) {
    const before = options.base.get(path)
    const after = options.current.get(path)
    if (before === after) {
      continue
    }
    const beforeLines = (before ?? "").split("\n")
    const afterLines = (after ?? "").split("\n")
    hunks.push(
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
      ...beforeLines.map((line) => `-${line}`),
      ...afterLines.map((line) => `+${line}`),
    )
  }
  const diffText = hunks.join("\n")
  const digest = contentHash({
    base_ref: options.baseRef,
    diff: diffText,
  })
  if (!digest.ok) {
    throw new Error(`diff hash failed: ${digest.error.message}`)
  }
  return diffText
}

/** An in-memory copy-on-write worktree seeded from a base file map. */
export function createWorktreeHost(
  baseRef: string,
  baseFiles: ReadonlyMap<string, string>,
): WorktreeHost {
  const current = new Map(baseFiles)
  return {
    baseRef,
    read(path: string): string | undefined {
      return current.get(path)
    },
    write(path: string, content: string): void {
      current.set(path, content)
    },
    diffText(): string {
      return buildUnifiedDiff({ baseRef, base: baseFiles, current })
    },
  }
}