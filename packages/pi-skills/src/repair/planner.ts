/**
 * The repair planner path from docs/research/pi-agent-catalog.md: one
 * `sih-repair-planner` subagent turns the accepted Hypothesis and Remediation
 * disposition into a Remediation Proposal draft; one
 * `sih-repair-implementer` subagent then produces the candidate in its own
 * private copy-on-write worktree or scratch (see implementer.ts). The
 * planner and implementer run sequentially; only one implementer works per
 * candidate revision, and only the Orchestrator's integration worktree can
 * become an artifact.
 *
 * The planner receives the risk table and adapter declarations, not a
 * precomputed class: it proposes the action and surfaces, and the Control
 * Plane computes the deterministic action-risk class after the proposal
 * exists. The planner never reviews or tests its own plan.
 */
import { validate } from "@sih/contracts/parse"
import type { RemediationProposal } from "@sih/contracts/types"

export type RemediationDisposition =
  "allowed" | "approval-required" | "prohibited" | "observe-only"

export interface PlannerDraft {
  changeDescription: string
  citations: RemediationProposal["citations"]
  testPlan: string[]
  changedSurfaces: string[]
  blastRadius: RemediationProposal["blast_radius"]
  recoveryPointDraft: {
    id: string
    changedSurfaces: string[]
  }
  declaredAction: { adapter: string; actionClass: string; command: string }
}

/**
 * Assemble the Remediation Proposal draft from the planner session output.
 * The action-risk class is NOT computed here: the Control Plane derives it
 * from the sealed proposal and the adapter declarations.
 */
export function assembleProposalDraft(plannerText: string): PlannerDraft {
  const draft = extractJsonObject(plannerText) as unknown as PlannerDraft
  const required: (keyof PlannerDraft)[] = [
    "changeDescription",
    "citations",
    "testPlan",
    "changedSurfaces",
    "recoveryPointDraft",
    "declaredAction",
  ]
  for (const field of required) {
    if (draft[field] === undefined) {
      throw new Error(`planner draft missing field ${field}`)
    }
  }
  for (const citation of draft.citations) {
    if (citation.cited_item_ids.some((id) => !isHashLike(id))) {
      throw new Error("citation item ids must be hash strings")
    }
  }
  return draft
}

/** Every changed surface needs a Recovery Point entry or a flagged gap. */
export function uncoveredSurfaces(draft: PlannerDraft): string[] {
  const covered = new Set(draft.recoveryPointDraft.changedSurfaces)
  return draft.changedSurfaces.filter((surface) => !covered.has(surface))
}

/** Sealed Remediation Proposal shape check, before the Control Plane seals. */
export function validateProposalPayload(payload: unknown): RemediationProposal {
  const result = validate("remediation-proposal", "1.0", payload)
  if (!result.ok) {
    throw new Error(
      `proposal payload failed validation: ${result.error.message}`
    )
  }
  return result.value as RemediationProposal
}

function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("planner output carries no JSON object")
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1))
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("planner output is not a JSON object")
  }
  return parsed as Record<string, unknown>
}

function isHashLike(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value)
}
