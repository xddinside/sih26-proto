/**
 * The real-agent repair round (issue #27): two separate bounded Pi sessions.
 *
 * The planner runs first in a fresh role session with the accepted Diagnosis
 * and cited Evidence inputs, read tools only, and the `submit_remediation`
 * terminal tool. It has no worktree, journal, artifact-store, gate, permit,
 * Release, or Watch authority. Its schema-valid `remediation-draft`
 * submission is the accepted Remediation.
 *
 * The implementer runs second in a separate fresh session with only the
 * accepted Remediation, the admitted Evidence, and its isolated
 * copy-on-write worktree assignment. Its mutation and inspection authority
 * is limited to that worktree (`worktree_read` / `worktree_write` /
 * `worktree_diff`) plus `submit_implemented_diff`. It cannot change shared
 * or production state.
 *
 * Deterministic code, not the model, records the resulting diff, diff hash,
 * changed-file scope, and candidate identity. A missing, malformed,
 * timed-out, cancelled, or failed planner or implementer result is returned
 * honestly with its session records and never replaced by a canned
 * fallback; dependent scheduling stops.
 */
import type { ModelGateway, LeaseRef, ReadBroker } from "@sih/brokers"
import type { ImplementedDiff, RemediationDraft } from "@sih/contracts/types"
import type { ThinkingLevel } from "@earendil-works/pi-ai"

import type {
  AgentSessionKit,
  AgentSessionRecord,
} from "../agent/roles.js"
import {
  createWorktreeHost,
  runImplementerRole,
  runPlannerRole,
} from "../agent/roles.js"
import type { RoleLimits } from "../role/limits.js"
import {
  assertDiffInScope,
  changedFilesFromDiff,
  validateImplementerDiff,
} from "./implementer.js"

/** The durability seam: seal one role output as an artifact and return its
 * content hash (the submission id). */
export interface RepairSealSurface {
  seal: (input: {
    schemaId: string
    schemaVersion: string
    payload: unknown
    producer?: { skill?: string; skill_version?: string }
  }) => Promise<{ content_hash: string }>
}

export interface RealRepairRoundOptions {
  incidentId: string
  runId: string
  attempt: number
  /** The pinned Evidence Set revision the Diagnosis was accepted against. */
  revisionId: string
  /** The accepted Hypothesis, serialized, for the planner context. */
  acceptedHypothesis: string
  changeSurfacePolicy: string
  recoveryPointSummary: string
  /** The surfaces the plan may declare, bounded by the change-surface
   * policy. */
  declaredSurfaces: readonly string[]
  /** The file paths the implementer's diff may touch. Deterministic scope. */
  allowedChangedFiles: readonly string[]
  baseRef: string
  /** The base file map the implementer's isolated worktree starts from. */
  baseFiles: ReadonlyMap<string, string>
  plannerTask: string
  implementerTask: string
  parentAgentId: string
  gateway: ModelGateway
  lease: LeaseRef
  readBroker?: ReadBroker
  seal: RepairSealSurface
  /** The provider/model pair every session in the round uses. */
  model: { provider: string; id: string }
  providerClass?: "real" | "fixture"
  reasoning?: ThinkingLevel
  limits?: Partial<RoleLimits>
  signal?: AbortSignal
}

export interface RepairRoundResult {
  /** Whether the accepted plan and the applied diff both exist and passed
   * every deterministic check. */
  valid: boolean
  /** The accepted schema-valid Remediation Draft, when the planner
   * succeeded. */
  planner?: { draft: RemediationDraft }
  /** The implementer's applied diff and its deterministic identity, when the
   * implementer succeeded and passed every deterministic check. */
  implementer?: {
    diffText: string
    diffHash: string
    changedFiles: string[]
  }
  sessions: AgentSessionRecord[]
  /** Present when the round failed or was aborted; no canned fallback. */
  failure?: {
    role: "planner" | "implementer"
    status: "failed" | "aborted"
    message: string
  }
}

/**
 * Run one real repair round: planner then implementer, each in a fresh
 * bounded Pi role session. A planner failure stops the round before the
 * implementer; an implementer failure stops before Verify. The result always
 * carries the honest session records.
 */
export async function runRealRepairRound(
  options: RealRepairRoundOptions,
): Promise<RepairRoundResult> {
  const sessions: AgentSessionRecord[] = []
  const kit: AgentSessionKit = {
    gateway: options.gateway,
    lease: options.lease,
    candidateHash: "no-candidate-hash",
    seal: options.seal,
    model: options.model,
    providerClass: options.providerClass,
    reasoning: options.reasoning,
    limits: options.limits,
    signal: options.signal,
    readBroker: options.readBroker,
  }

  // Planner: fresh read-only session, `submit_remediation` only.
  const plannerResult = await runPlannerRole(kit, {
    incidentId: options.incidentId,
    runId: options.runId,
    attempt: options.attempt,
    acceptedHypothesis: options.acceptedHypothesis,
    changeSurfacePolicy: options.changeSurfacePolicy,
    recoveryPointSummary: options.recoveryPointSummary,
    changedSurfaces: options.declaredSurfaces,
    plannerTask: options.plannerTask,
    parentAgentId: options.parentAgentId,
  })
  sessions.push(plannerResult.session)
  if (plannerResult.payload === null || plannerResult.status !== "succeeded") {
    return {
      valid: false,
      sessions,
      failure: {
        role: "planner",
        status:
          plannerResult.status === "aborted" ? "aborted" : "failed",
        message:
          plannerResult.status === "aborted"
            ? "planner session aborted"
            : plannerResult.failureReason ??
              "planner produced no valid remediation draft",
      },
    }
  }
  const draft = plannerResult.payload

  // Implementer: a separate fresh session bound to its isolated worktree. It
  // receives the accepted Remediation and the admitted Diagnosis, and can
  // read cited Evidence Items through the brokered read tool.
  const worktree = createWorktreeHost(options.baseRef, options.baseFiles)
  kit.worktree = worktree
  const implementerResult = await runImplementerRole(kit, {
    incidentId: options.incidentId,
    runId: options.runId,
    attempt: options.attempt,
    baseRef: options.baseRef,
    changedFiles: options.allowedChangedFiles,
    implementerTask: options.implementerTask,
    acceptedRemediation: JSON.stringify(draft),
    admittedDiagnosis: options.acceptedHypothesis,
    parentAgentId: options.parentAgentId,
  })
  sessions.push(implementerResult.session)
  if (
    implementerResult.payload === null ||
    implementerResult.status !== "succeeded"
  ) {
    return {
      valid: false,
      planner: { draft },
      sessions,
      failure: {
        role: "implementer",
        status:
          implementerResult.status === "aborted" ? "aborted" : "failed",
        message:
          implementerResult.status === "aborted"
            ? "implementer session aborted"
            : implementerResult.failureReason ??
              "implementer produced no valid diff",
      },
    }
  }
  const diff = implementerResult.payload
  // Deterministic scope identity, never the model's declared list.
  const declaredChangedFiles = changedFilesFromDiff(diff.diff_text)

  // Deterministic identity: the model never records the diff or its hash.
  if (diff.diff_text !== worktree.diffText()) {
    return {
      valid: false,
      planner: { draft },
      implementer: {
        diffText: diff.diff_text,
        diffHash: diff.diff_hash,
        changedFiles: declaredChangedFiles,
      },
      sessions,
      failure: {
        role: "implementer",
        status: "failed",
        message: "implementer diff does not match its worktree diff",
      },
    }
  }
  const { diffHash } = validateImplementerDiff({
    diffText: diff.diff_text,
    baseRef: options.baseRef,
    allowedPaths: options.allowedChangedFiles,
  })
  if (diff.diff_hash !== diffHash) {
    return {
      valid: false,
      planner: { draft },
      implementer: {
        diffText: diff.diff_text,
        diffHash,
        changedFiles: declaredChangedFiles,
      },
      sessions,
      failure: {
        role: "implementer",
        status: "failed",
        message: "implementer diff hash mismatches the deterministic diff hash",
      },
    }
  }

  // Out-of-scope changes fail before Verify, deterministically. The failure
  // is returned (never thrown) so the honest session records and the partial
  // result survive for inspection.
  let changedFiles: string[]
  try {
    changedFiles = assertDiffInScope({
      diffText: diff.diff_text,
      allowedPaths: options.allowedChangedFiles,
    })
  } catch (error) {
    return {
      valid: false,
      planner: { draft },
      implementer: {
        diffText: diff.diff_text,
        diffHash,
        changedFiles: declaredChangedFiles,
      },
      sessions,
      failure: {
        role: "implementer",
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }

  return {
    valid: true,
    planner: { draft },
    implementer: { diffText: diff.diff_text, diffHash, changedFiles },
    sessions,
  }
}
