/**
 * Shared fixtures for the pi-skills tests: leases, structured model stubs,
 * Fusion role outputs, Evidence items, and Review/Test reports built from the
 * @sih/contracts registry schemas.
 */
import { join } from "node:path"

import { FakeControlPlaneClient, ModelGateway } from "@sih/brokers"
import type { LeaseRef, ModelProvider } from "@sih/brokers"
import { sha256Hex } from "@sih/contracts/hashes"
import type {
  EvidenceItem,
  Hypothesis,
  ReviewReport,
  TestReport,
} from "@sih/contracts/types"

/** The package root: the skills tree lives here. */
export const SKILLS_ROOT = join(import.meta.dir, "..")

export function fixtureHash(tag: string): `sha256:${string}` {
  return `sha256:${sha256Hex(tag)}`
}

export function makeLease(
  stage: LeaseRef["stage"],
  leaseId = "lease-test-1"
): LeaseRef {
  return {
    leaseId,
    token: "token-test",
    incidentId: "inc-test",
    runId: "run-1",
    attempt: 1,
    stage,
    actorId: "orchestrator-run-1",
    actorKind: "orchestrator",
    toolClass: stage,
  }
}

/** A ModelGateway whose provider returns a canned text per model slug. */
export function makeStubGateway(
  outputs: Record<string, string | undefined>,
  options: { failFirstN?: Record<string, number> } = {}
): { gateway: ModelGateway; cp: FakeControlPlaneClient } {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const failures = new Map(Object.entries(options.failFirstN ?? {}))
  const provider: ModelProvider = {
    async complete(model, prompt) {
      const remaining = failures.get(model) ?? 0
      if (remaining > 0) {
        failures.set(model, remaining - 1)
        throw new Error(`transient failure for ${model}`)
      }
      const text = outputs[model]
      if (text === undefined) {
        throw new Error(`no stub output for model ${model}`)
      }
      return {
        text,
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
      }
    },
  }
  return { gateway: new ModelGateway(cp, provider), cp }
}

export function makeHypothesis(
  overrides: Partial<Hypothesis> = {}
): Hypothesis {
  const now = new Date().toISOString()
  const itemId = fixtureHash("item-1")
  return {
    schema_version: "1.0",
    id: "H1",
    incident_id: "inc-test",
    incident_run_id: "run-1",
    attempt: 1,
    round: 1,
    causal_claim: {
      trigger: "deployment of seeded commit",
      defect: "inverted card-type clause",
      propagation: [
        {
          from: "seeded commit",
          to: "charge failure",
          cited_item_ids: [itemId],
        },
      ],
      failure: "every charge fails",
    },
    affected_scope: {
      service_names: ["payment"],
      deployment_environment_names: ["demo"],
      versions: ["seed-digest"],
      window: { starts_at: now, ends_at: null },
    },
    predicted_observations: [
      { id: "P1", statement: "valid Visa is rejected", registered_at: now },
    ],
    evidence: { supporting: [itemId], opposing: [], unexplained: [] },
    alternatives: ["H2", "H3"],
    proposed_tests: [
      {
        id: "T1",
        procedure: "run card.unit.test.js",
        bounds: "payment package",
        permissions: ["request_isolated_ci"],
        expected: { this_hypothesis: "valid Visa accepted" },
      },
    ],
    status: "proposed",
    ...overrides,
  }
}

export function makeParticipantOutput(options: {
  participantId: string
  revisionId: string
  hypothesis?: Hypothesis
}): Record<string, unknown> {
  return {
    schema_version: "1.0",
    participant_id: options.participantId,
    revision_id: options.revisionId,
    hypotheses: [options.hypothesis ?? makeHypothesis()],
    stated_objections: [],
    completed_at: new Date().toISOString(),
  }
}

export function makeJudgeOutput(options: {
  judgeId: string
  revisionId: string
}): Record<string, unknown> {
  return {
    schema_version: "1.0",
    judge_id: options.judgeId,
    revision_id: options.revisionId,
    agreements: [],
    contradictions: [],
    blind_spots: [],
    unique_findings: [],
    citation_audit: [
      {
        participant_id: "p-1",
        uncited_claims: 0,
        invalid_citations: 0,
        missing_item_citations: 0,
      },
    ],
    completed_at: new Date().toISOString(),
  }
}

export function makeSynthesizerOutput(options: {
  synthesizerId: string
  revisionId: string
  hypothesis?: Hypothesis
}): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    schema_version: "1.0",
    synthesizer_id: options.synthesizerId,
    revision_id: options.revisionId,
    ranked_hypotheses: [
      { rank: 1, hypothesis: options.hypothesis ?? makeHypothesis() },
    ],
    contradictions: [],
    gaps: [],
    next_actions: [],
    fusion_meta: {
      participant_ids: ["p-1", "p-2"],
      judge_id: "j-1",
      synthesizer_id: options.synthesizerId,
      revision_id: options.revisionId,
      started_at: now,
      completed_at: now,
    },
    completed_at: now,
  }
}

export const REVISION_ID = fixtureHash("revision-1")

export function makeEvidenceItem(
  overrides: Partial<EvidenceItem> = {}
): EvidenceItem {
  return {
    id: fixtureHash("item-1"),
    kind: "metric",
    backend: "prometheus",
    identity: {
      metric_name: "error_ratio",
      metric_labels: { service_name: "payment" },
      window: {
        starts_at: new Date().toISOString(),
        ends_at: null,
      },
    },
    snapshot: 0.92,
    content_hash: fixtureHash("content-1"),
    links: [],
    observed_at: new Date().toISOString(),
    fresh_until: null,
    provenance: ["prometheus"],
    trust: "backend",
    joins: { service_name: "payment" },
    redaction: { profile_id: "default", masked_fields: [] },
    outcome: "ok",
    ...overrides,
  }
}

export function makeReviewReport(options: {
  role: "R1" | "R2" | "R3" | "R4" | "R8"
  candidateHash: string
  findings?: ReviewReport["findings"]
  status?: "pass" | "fail"
}): ReviewReport {
  return {
    schema_version: "1.0",
    incident_id: "inc-test",
    run_id: "run-1",
    attempt: 1,
    candidate_hash: options.candidateHash,
    role: options.role,
    reviewer: `reviewer-${options.role}`,
    revision: 1,
    input_refs: ["diff-hash"],
    findings: options.findings ?? [],
    status: options.status ?? "pass",
    sealed_at: new Date().toISOString(),
  }
}

export function makeFinding(options: {
  id: string
  severity: "blocker" | "major" | "minor" | "info"
  claim: string
  citations?: ReviewReport["findings"][number]["citations"]
  status?: "open" | "retracted" | "fixed-in-revision"
  uncited?: boolean
}): ReviewReport["findings"][number] {
  return {
    id: options.id,
    severity: options.severity,
    claim: options.claim,
    citations: options.citations ?? [
      { kind: "file-line", file: "src/payment/card.js", line: 12 },
    ],
    status: options.status ?? "open",
    ...(options.uncited === undefined ? {} : { uncited: options.uncited }),
  }
}

export function makeTestReport(options: {
  layer: "T1" | "T2" | "T3" | "T4" | "T5" | "T7" | "T9" | "T10" | "T12" | "T13"
  candidateHash: string
  outcome: TestReport["outcome"]
  runs?: TestReport["runs"]
  tool?: string
  target?: string
  receiptRef?: string
}): TestReport {
  return {
    schema_version: "1.0",
    incident_id: "inc-test",
    run_id: "run-1",
    attempt: 1,
    candidate_hash: options.candidateHash,
    layer: options.layer,
    tool: options.tool ?? `tool-${options.layer}`,
    tool_version: "1.0.0",
    target: options.target ?? "payment",
    receipt_ref: options.receiptRef ?? `rcpt-${options.layer}`,
    runs: options.runs ?? [
      {
        run_hash: fixtureHash(`run-${options.layer}`),
        result: options.outcome === "fail" ? "fail" : "pass",
        at: new Date().toISOString(),
      },
    ],
    outcome: options.outcome,
    flaky: options.outcome === "flaky-pass",
    coverage_checked: true,
    sealed_at: new Date().toISOString(),
  }
}
