/**
 * Orchestrator tests: Detect and Diagnose drivers against a fake proposal
 * surface, the invalid-round rerun loop, spawn_subagent isolation (no nested
 * Orchestrator, distinct session ids, no peer outputs), and the
 * trace-exclusion rule for later context.
 */
import { describe, expect, test } from "bun:test"

import { FakeControlPlaneClient, ModelGateway } from "@sih/brokers"
import type { ModelProvider } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import type { IncidentBrief, RemediationDraft } from "@sih/contracts/types"

import {
  PiOrchestratorExtension,
  dispositionFromAuthorityMode,
} from "../src/orchestrator/orchestrator.js"
import type {
  ControlPlaneProposals,
  EvidenceBundle,
  RepairRoundInput,
} from "../src/orchestrator/orchestrator.js"
import type { RepairRoundResult } from "../src/repair/repair-real.js"
import { bootstrapWorker } from "../src/worker/bootstrap.js"
import { DEMO_BUDGETS } from "../src/worker/budgets.js"
import { loadSkillTree } from "../src/skill-catalog.js"
import {
  REVISION_ID,
  SKILLS_ROOT,
  fixtureHash,
  makeEvidenceItem,
  makeHypothesis,
  makeJudgeOutput,
  makeLease,
  makeParticipantOutput,
  makeStubGateway,
  makeSynthesizerOutput,
} from "./helpers.js"

const hypothesis = makeHypothesis()

function evidence(): EvidenceBundle {
  const item = makeEvidenceItem({ id: fixtureHash("item-1") })
  return {
    revisionId: REVISION_ID,
    items: [item],
    criticalItemIds: [item.id],
    observedScope: {
      tenant_id: "demo",
      deployment_environment_name: "demo",
      service_name: "payment",
    },
    freshnessWindow: {
      starts_at: new Date(Date.now() - 3600_000).toISOString(),
      ends_at: null,
    },
    expectedDeploymentVersion: "seed-digest",
    coverage: new Map(),
    materialAlternatives: [
      {
        hypothesis_id: "H2",
        eliminated_by_item_ids: [item.id],
        failed_prediction_of_h: false,
        rejected: false,
      },
    ],
    testRuns: [],
    counterfactualItemIds: [],
  }
}

function fakeProposals(options: {
  gateVerdict: () => string
}): ControlPlaneProposals & {
  sealed: unknown[]
  stageCommands: unknown[]
  completedRuns: string[]
  failedRuns: string[]
} {
  const sealed: unknown[] = []
  const stageCommands: unknown[] = []
  const completedRuns: string[] = []
  const failedRuns: string[] = []
  return {
    async sealArtifact(input) {
      const digest = contentHash(input.payload as never)
      if (!digest.ok) {
        throw new Error("bad payload")
      }
      sealed.push(input.payload)
      return {
        artifact_ref: {
          schema_id: input.schemaId,
          schema_version: input.schemaVersion,
          content_hash: digest.value,
        },
      }
    },
    async stageCommand(command) {
      stageCommands.push(command)
    },
    async completeRun(outcome) {
      completedRuns.push(outcome)
    },
    async failRun(reason) {
      failedRuns.push(reason)
    },
    async requestHypothesisGate(input) {
      const verdict = options.gateVerdict()
      void input
      return { verdict, evaluation: { gate: "hypothesis", verdict } }
    },
    async resolveApplicability() {
      throw new Error("not used")
    },
    async requestVerificationVerdict() {
      throw new Error("not used")
    },
    async requestReleaseGate() {
      return { verdict: "pass", permit: null }
    },
    async requestActionGate() {
      return { verdict: "pass", permit: null }
    },
    async policyDecision() {
      return { decision: "autonomous", reason: "ok", riskClass: "safe" }
    },
    sealed,
    stageCommands,
    completedRuns,
    failedRuns,
  }
}

async function buildOrchestrator(
  gateway: ModelGateway,
  proposals: ControlPlaneProposals
) {
  const runtime = await bootstrapWorker({
    leaseSource: {
      async acquire() {
        return { leaseId: "lease-test-1", token: "token-test" }
      },
    },
    incidentId: "inc-test",
    runId: "run-1",
    attempt: 1,
    checkpoint: {
      incidentId: "inc-test",
      runId: "run-1",
      attempt: 1,
      currentStage: "detect",
      stageStatus: {},
      restartCount: 0,
      sealedArtifactHashes: [],
    },
    snapshotDir: "/tmp/pi-skills-orch-snapshot",
    evidenceRevisionId: REVISION_ID,
    skillsRoot: SKILLS_ROOT,
    toolCatalogVersion: "tool-catalog@1.0",
    budgets: DEMO_BUDGETS,
    allowedModels: {
      participant: ["stub-participant-1"],
      judge: ["stub-judge"],
      synthesizer: ["stub-synthesizer"],
    },
    artifacts: [],
  })
  const skills = await loadSkillTree(SKILLS_ROOT)
  return new PiOrchestratorExtension(
    {
      runtime,
      proposals,
      gateway,
      lease: makeLease("diagnose"),
      evidence: evidence(),
      modelForRole: () => "stub-model",
    },
    skills,
    "detect"
  )
}

/** A provider that returns a malformed participant output for the first
 * round and valid structured outputs for the second, to exercise the
 * invalid-round rerun path. */
function phasedProvider(): ModelProvider {
  const participantCalls = new Map<string, number>()
  const valid = (id: string, revisionId: string) =>
    JSON.stringify(
      makeParticipantOutput({ participantId: id, revisionId, hypothesis })
    )
  return {
    async complete(model, prompt) {
      if (model.startsWith("stub-participant")) {
        const count = (participantCalls.get(model) ?? 0) + 1
        participantCalls.set(model, count)
        return {
          text:
            count === 1
              ? "prose, not a structured participant output"
              : valid(
                  model === "stub-participant-1" ? "p-1" : "p-2",
                  REVISION_ID
                ),
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: 8,
        }
      }
      if (model === "stub-judge") {
        return {
          text: JSON.stringify(
            makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
          ),
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: 8,
        }
      }
      return {
        text: JSON.stringify(
          makeSynthesizerOutput({
            synthesizerId: "s-1",
            revisionId: REVISION_ID,
            hypothesis,
          })
        ),
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: 8,
      }
    },
  }
}

const fusionConfig = () => ({
  participantIds: ["p-1", "p-2"],
  participantModels: ["stub-participant-1", "stub-participant-2"],
  judgeId: "j-1",
  judgeModel: "stub-judge",
  synthesizerId: "s-1",
  synthesizerModel: "stub-synthesizer",
})

describe("driveDetect", () => {
  test("seals the Incident Brief and completes the stage through the proposal API", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)
    const outcome = await orchestrator.driveDetect({
      symptom: "every charge fails",
      severity: "critical",
      scope: {
        tenant_id: "demo",
        deployment_environment_name: "demo",
        service_name: "payment",
      },
      policyVersion: "policy-1",
    })
    expect(outcome.ok).toBe(true)
    expect(proposals.sealed).toHaveLength(1)
    const brief = proposals.sealed[0] as {
      schema_version: string
      symptom: string
    }
    expect(brief.schema_version).toBe("1.0")
    expect(brief.symptom).toBe("every charge fails")
    expect(proposals.stageCommands).toEqual([
      { kind: "enter-stage", stage: "detect" },
      { kind: "stage-status", stage: "detect", to: "in-progress" },
      {
        kind: "stage-status",
        stage: "detect",
        to: "completed",
        artifact_ref: expect.any(Object),
      },
    ])
  })
})

describe("driveDiagnose", () => {
  test("an invalid first round reruns; the second round seals the Diagnosis Report", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, phasedProvider())
    const orchestrator = await buildOrchestrator(gateway, proposals)

    const outcome = await orchestrator.driveDiagnose({
      task: "Diagnose the payment charge failure.",
      roundCap: 2,
      demoProfile: true,
      fusionConfig: fusionConfig(),
      remediationDisposition: "allowed",
    })
    expect(outcome.ok).toBe(true)
    expect(orchestrator.fusionRounds).toHaveLength(2)
    expect(orchestrator.fusionRounds[0]?.valid).toBe(false)
    expect(orchestrator.fusionRounds[1]?.valid).toBe(true)

    const report = proposals.sealed[0] as {
      schema_version: string
      fusion_meta: {
        rounds: { round: number; valid: boolean; participant_ids: string[] }[]
      }
      remediation_disposition: string
    }
    expect(report.schema_version).toBe("1.0")
    expect(report.fusion_meta.rounds).toEqual([
      { round: 1, valid: false, participant_ids: ["p-1", "p-2"] },
      { round: 2, valid: true, participant_ids: ["p-1", "p-2"] },
    ])
    expect(report.remediation_disposition).toBe("allowed")
    expect(proposals.stageCommands).toEqual([
      { kind: "enter-stage", stage: "diagnose" },
      { kind: "stage-status", stage: "diagnose", to: "in-progress" },
      {
        kind: "stage-status",
        stage: "diagnose",
        to: "completed",
        artifact_ref: expect.any(Object),
      },
    ])
  })

  test("only the synthesis continues: later context excludes participant and Judge traces", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, phasedProvider())
    const orchestrator = await buildOrchestrator(gateway, proposals)
    await orchestrator.driveDiagnose({
      task: "Diagnose the payment charge failure.",
      roundCap: 2,
      demoProfile: true,
      fusionConfig: fusionConfig(),
      remediationDisposition: "allowed",
    })
    const lastRound = orchestrator.fusionRounds[1]
    const later = orchestrator.laterContext(lastRound)
    expect(later).toContain("ranked_hypotheses")
    for (const call of lastRound.artifact.calls) {
      if (call.kind === "participant" || call.kind === "judge") {
        expect(later).not.toContain(JSON.stringify(call.output))
      }
    }
  })

  test("a gate continue without an evidence gatherer fails the stage", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "continue" })
    const { gateway } = makeStubGateway({
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({
          participantId: "p-1",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({
          participantId: "p-2",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({
          synthesizerId: "s-1",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
    })
    const orchestrator = await buildOrchestrator(gateway, proposals)
    await expect(
      orchestrator.driveDiagnose({
        task: "Diagnose the payment charge failure.",
        roundCap: 3,
        demoProfile: true,
        fusionConfig: fusionConfig(),
        remediationDisposition: "allowed",
      })
    ).rejects.toThrow("evidence gathering drives the next round")
  })

  test("a gate-rejected round is rerun through the Orchestrator; the report is sealed only for the accepted round", async () => {
    let gateCalls = 0
    const proposals = fakeProposals({
      gateVerdict: () => {
        gateCalls += 1
        return gateCalls === 1 ? "reject" : "pass"
      },
    })
    const { gateway } = makeStubGateway({
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({
          participantId: "p-1",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({
          participantId: "p-2",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({
          synthesizerId: "s-1",
          revisionId: REVISION_ID,
          hypothesis,
        })
      ),
    })
    const orchestrator = await buildOrchestrator(gateway, proposals)
    const outcome = await orchestrator.driveDiagnose({
      task: "Diagnose the payment charge failure.",
      roundCap: 2,
      demoProfile: true,
      fusionConfig: fusionConfig(),
      remediationDisposition: "allowed",
    })
    expect(outcome.ok).toBe(true)
    expect(gateCalls).toBe(2)
    expect(orchestrator.fusionRounds).toHaveLength(2)
    expect(orchestrator.fusionRounds.every((round) => round.valid)).toBe(true)
    // The Diagnosis Report is sealed exactly once, carrying both rounds.
    const reports = proposals.sealed.filter(
      (entry) =>
        (entry as { schema_version: string; fusion_meta?: unknown })
          .schema_version === "1.0" &&
        (entry as { fusion_meta?: unknown }).fusion_meta !== undefined
    )
    expect(reports).toHaveLength(1)
    const report = reports[0] as {
      fusion_meta: {
        rounds: { round: number; valid: boolean; participant_ids: string[] }[]
      }
    }
    expect(report.fusion_meta.rounds).toEqual([
      { round: 1, valid: true, participant_ids: ["p-1", "p-2"] },
      { round: 2, valid: true, participant_ids: ["p-1", "p-2"] },
    ])
  })

  test("driveDiagnose assembles the Shared Starting Context deterministically from the Incident Brief", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const gateway = new ModelGateway(cp, phasedProvider())
    const orchestrator = await buildOrchestrator(gateway, proposals)
    const incidentBrief: IncidentBrief = {
      schema_version: "1.0",
      incident_id: "inc-test",
      run_id: "run-1",
      attempt: 1,
      severity: "critical",
      scope: {
        tenant_id: "demo",
        deployment_environment_name: "demo",
        service_name: "payment",
      },
      symptom: "every valid charge fails in the payment service",
      initial_evidence_item_ids: [fixtureHash("item-1")],
      service_topology: "checkout -> payment (gRPC)",
      known_limits: "reduced Compose profile",
      policy_version: "policy-1",
      sealed_at: new Date().toISOString(),
    }
    await orchestrator.driveDiagnose({
      task: "Diagnose the payment charge failure.",
      incidentBrief,
      roundCap: 2,
      demoProfile: true,
      fusionConfig: fusionConfig(),
      remediationDisposition: "allowed",
    })
    const brief = orchestrator.fusionRounds[0]?.artifact.brief
    expect(brief).toContain(
      "Symptom: every valid charge fails in the payment service"
    )
    expect(brief).toContain("Severity: critical")
    expect(brief).toContain(
      "Scope: tenant demo, environment demo, service payment"
    )
    expect(brief).toContain("Policy version in force: policy-1")
    expect(brief).toContain("Known limits: reduced Compose profile")
    expect(brief).toContain("Service topology: checkout -> payment (gRPC)")
    // No model-generated conversation brief is created.
    expect(brief).not.toContain("conversation")
    // The pinned Evidence Set revision id is part of the shared context.
    expect(
      orchestrator.fusionRounds[0]?.artifact.calls[0]?.inputPrompt
    ).toContain(REVISION_ID)
  })

  test("the fusion-round cap stops the loop", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "continue" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)
    await expect(
      orchestrator.driveDiagnose({
        task: "x",
        roundCap: 1,
        demoProfile: true,
        fusionConfig: fusionConfig(),
        remediationDisposition: "allowed",
        gatherEvidence: async () => ({
          newRevisionId: REVISION_ID,
          newItems: [],
        }),
      })
    ).rejects.toThrow("fusion round cap exhausted")
  })

  test("dispositionFromAuthorityMode maps the fixed mode table", () => {
    expect(dispositionFromAuthorityMode("observe")).toBe("observe-only")
    expect(dispositionFromAuthorityMode("prepare")).toBe("allowed")
    expect(dispositionFromAuthorityMode("repair")).toBe("allowed")
    expect(dispositionFromAuthorityMode("emergency")).toBe("observe-only")
    expect(dispositionFromAuthorityMode("unknown")).toBe("observe-only")
  })
})

describe("driveRepair", () => {
  const BASE_REF = fixtureHash("base-ref")
  const DIFF_TEXT = [
    "--- a/src/payment/card.js",
    "+++ b/src/payment/card.js",
    "@@ -1,5 +1,5 @@",
    " export function validateCard(card) {",
    '-  if (card.type !== "VISA") return true;',
    '+  if (card.type !== "VISA") return false;',
    "  return true;",
    "}",
  ].join("\n")
  const diffHash = contentHash({ base_ref: BASE_REF, diff: DIFF_TEXT })
  if (!diffHash.ok) throw new Error(diffHash.error.message)

  function draft(): RemediationDraft {
    return {
      schema_version: "1.0",
      incident_id: "inc-test",
      run_id: "run-1",
      attempt: 1,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      disposition: "allowed",
      change_description: "restore the negation in the card-type clause",
      citations: [
        {
          change: "card-type clause negation restored",
          hypothesis_id: "H1",
          cited_item_ids: [fixtureHash("item-1")],
        },
      ],
      test_plan: ["node --test src/payment/card.unit.test.js"],
      changed_surfaces: ["src/payment/card.js"],
      typed_action_plan: {
        adapter: "compose-release",
        action_class: "merge-deploy",
        command: "swap",
      },
      completed_at: new Date().toISOString(),
    }
  }

  function repairOptions(overrides: {
    runRepair?: (options: RepairRoundInput) => Promise<RepairRoundResult>
  }): Parameters<PiOrchestratorExtension["driveRepair"]>[0] {
    return {
      acceptedHypothesis: hypothesis,
      disposition: "allowed",
      plannerTask: "plan the one-line card-type restoration",
      implementerTask: "apply the one-line card-type restoration",
      baseRef: BASE_REF,
      adapterDeclarations: {
        adapter: "compose-release",
        action_class: "merge-deploy",
        command: "swap",
        category: "code",
        target: "demo/demo/payment",
      },
      target: {
        tenant_id: "demo",
        deployment_environment_name: "demo",
        service_name: "payment",
        expected_version: "seed-digest",
      },
      policyVersion: "policy-1",
      recoveryPoint: {
        id: fixtureHash("recovery-point"),
        changed_surfaces: ["src/payment/card.js"],
      },
      changedFiles: ["src/payment/card.js"],
      changedSurfaces: ["src/payment/card.js"],
      runRepair: overrides.runRepair,
    }
  }

  test("a valid real repair round seals a deterministic candidate and proposal", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)

    const outcome = await orchestrator.driveRepair(
      repairOptions({
        runRepair: async () => ({
          valid: true,
          planner: { draft: draft() },
          implementer: {
            diffText: DIFF_TEXT,
            diffHash: diffHash.value,
            changedFiles: ["src/payment/card.js"],
          },
          sessions: [],
        }),
      }),
    )
    expect(outcome.ok).toBe(true)

    // The proposal was sealed once with the accepted plan's description and
    // the deterministic diff hash and candidate hash.
    const proposalsSealed = proposals.sealed as Record<string, unknown>[]
    const proposal = proposalsSealed.find(
      (entry) =>
        entry.schema_version === "1.0" &&
        typeof entry.candidate_hash === "string",
    )
    expect(proposal).toBeDefined()
    expect(proposal?.change_description).toBe(
      "restore the negation in the card-type clause",
    )
    expect((proposal?.diff as { diff_hash: string }).diff_hash).toBe(
      diffHash.value,
    )
    expect(outcome.detail).toBe(proposal?.candidate_hash as string)
    expect(orchestrator.repairRounds).toHaveLength(1)
    expect(orchestrator.repairRounds[0]?.valid).toBe(true)
  })

  test("a failed real repair round stops the stage and seals no proposal", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)

    await expect(
      orchestrator.driveRepair(
        repairOptions({
          runRepair: async () => ({
            valid: false,
            sessions: [],
            failure: {
              role: "implementer",
              status: "failed",
              message: "implementer diff is out of the accepted Remediation scope: src/other.js",
            },
          }),
        }),
      ),
    ).rejects.toThrow("repair round implementer failed")
    expect(orchestrator.repairRounds).toHaveLength(1)
    expect(orchestrator.repairRounds[0]?.valid).toBe(false)
    const proposalsSealed = proposals.sealed as Record<string, unknown>[]
    expect(
      proposalsSealed.some(
        (entry) =>
          entry.schema_version === "1.0" &&
          typeof entry.candidate_hash === "string",
      ),
    ).toBe(false)
  })
})

describe("spawn_subagent isolation", () => {
  test("subagents cannot spawn a nested Orchestrator", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)
    expect(() =>
      orchestrator.spawnSubagent({
        skillName: "sih-orchestrator",
        role: "nested",
        taskInput: "x",
        stage: "detect",
        scratchDir: "/tmp/x",
      })
    ).toThrow("nested Workers")
  })

  test("two sessions have distinct ids and never see each other's tasks", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)
    const a = orchestrator.spawnSubagent({
      skillName: "sih-review-correctness",
      role: "reviewer-r1",
      taskInput: "TASK-A-SECRET-LEAK-TEST",
      stage: "verify",
      scratchDir: "/tmp/a",
    })
    const b = orchestrator.spawnSubagent({
      skillName: "sih-review-security",
      role: "reviewer-r4",
      taskInput: "TASK-B-DIFFERENT",
      stage: "verify",
      scratchDir: "/tmp/b",
    })
    expect(a.agentId).not.toBe(b.agentId)
    expect(JSON.stringify(a.conversation)).not.toContain("TASK-B-DIFFERENT")
    expect(JSON.stringify(b.conversation)).not.toContain(
      "TASK-A-SECRET-LEAK-TEST"
    )
    const records = orchestrator.records
    expect(records.map((record) => record.agentId).sort()).toEqual(
      [a.agentId, b.agentId].sort()
    )
    expect(
      records.every((record) => record.parentAgentId === "orchestrator-run-1")
    ).toBe(true)
  })

  test("the authoring subagent id differs from every reviewer id", async () => {
    const proposals = fakeProposals({ gateVerdict: () => "pass" })
    const { gateway } = makeStubGateway({})
    const orchestrator = await buildOrchestrator(gateway, proposals)
    const implementer = orchestrator.spawnSubagent({
      skillName: "sih-repair-implementer",
      role: "repair-implementer",
      taskInput: "write the fix",
      stage: "repair",
      scratchDir: "/tmp/impl",
    })
    const reviewer = orchestrator.spawnSubagent({
      skillName: "sih-review-correctness",
      role: "reviewer-r1",
      taskInput: "review the fix",
      stage: "verify",
      scratchDir: "/tmp/rev",
    })
    expect(implementer.agentId).not.toBe(reviewer.agentId)
  })
})
