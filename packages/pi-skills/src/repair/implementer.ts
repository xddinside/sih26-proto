/**
 * The repair implementer path from docs/research/pi-agent-catalog.md: the
 * implementer subagent works only in its own private copy-on-write worktree
 * or scratch; the Orchestrator integrates the candidate into the sole
 * integration worktree, which alone can become an artifact. No merge, no
 * deploy, no direct production action; a barred or prohibited surface never
 * reaches execution.
 */
import { candidateHash, contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"

export interface ImplementerResult {
  diffText: string
  baseRef: string
  diffHash: HashString
  candidateHash: HashString
}

export type RemediationClassCode =
  | "code"
  | "configuration"
  | "feature-flags"
  | "deployment"
  | "restart-scale-traffic"
  | "infrastructure"
  | "database-data"
  | "credentials"
  | "emergency-rollback"

/**
 * Candidate hash over the full change set: base ref, the diff, proposal
 * fields that define the action, declared changed surfaces, action-risk
 * class, gate path, target identity, and Recovery Point. Any change anywhere
 * produces a new hash. The preimage is the registry's `candidate-hash-input`
 * schema; the model never changes it.
 */
export function computeCandidateHash(input: {
  baseRef: string
  diffText: string
  remediationClass: RemediationClassCode
  disposition: "allowed" | "approval-required" | "prohibited" | "observe-only"
  descriptionHash: HashString
  changedSurfaces: string[]
  actionRiskClass: "safe" | "guarded" | "barred"
  gatePath: "release" | "action"
  target: {
    tenant_id: string
    deployment_environment_name: string
    service_name: string
    expected_version?: string
  }
  recoveryPointHash: HashString
}): HashString {
  const hash = candidateHash({
    schema_version: "1.0",
    base_ref: input.baseRef,
    change: {
      kind: "diff",
      base_ref: input.baseRef,
      diff_text: input.diffText,
    },
    proposal: {
      remediation_class: input.remediationClass,
      disposition: input.disposition,
      description_hash: input.descriptionHash,
    },
    changed_surfaces: input.changedSurfaces,
    action_risk_class: input.actionRiskClass,
    gate_path: input.gatePath,
    target: input.target,
    recovery_point_hash: input.recoveryPointHash,
  })
  if (!hash.ok) {
    throw new Error(`candidate hash failed: ${hash.error.message}`)
  }
  return hash.value
}

/** Validate the implementer's private-worktree result before integration. */
export function validateImplementerDiff(options: {
  diffText: string
  baseRef: string
  allowedPaths: readonly string[]
}): { diffHash: HashString } {
  if (options.diffText.trim().length === 0) {
    throw new Error("implementer produced an empty diff")
  }
  const digest = contentHash({
    base_ref: options.baseRef,
    diff: options.diffText,
  })
  if (!digest.ok) {
    throw new Error(`diff hash failed: ${digest.error.message}`)
  }
  return { diffHash: digest.value }
}

/** A barred or prohibited surface never reaches execution. */
export function assertExecutableSurface(options: {
  actionRiskClass: "safe" | "guarded" | "barred"
  disposition: "allowed" | "approval-required" | "prohibited" | "observe-only"
}): void {
  if (options.actionRiskClass === "barred") {
    throw new Error("barred action class: the product never executes it")
  }
  if (
    options.disposition === "prohibited" ||
    options.disposition === "observe-only"
  ) {
    throw new Error(
      `disposition ${options.disposition} records a human handoff; no execution`
    )
  }
}
