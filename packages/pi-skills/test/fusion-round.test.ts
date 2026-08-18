/**
 * Fusion round tests: round validity, the SIH divergence from the live
 * harness (one failed participant with two valid outputs does not abort),
 * Demo Profile participant count, Judge/Synthesizer rerun rules, and trace
 * exclusion from later model context.
 */
import { describe, expect, test } from "bun:test"

import { isRoundValid, runFusionRound } from "../src/fusion/fusion-runtime.js"
import {
  assertExcludedFromContext,
  buildLaterContext,
  fusionRunArtifactWire,
} from "../src/fusion/traces.js"
import {
  REVISION_ID,
  SKILLS_ROOT,
  makeHypothesis,
  makeJudgeOutput,
  makeLease,
  makeParticipantOutput,
  makeStubGateway,
  makeSynthesizerOutput,
} from "./helpers.js"

const TASK = "Diagnose the payment charge failure."

function fusionConfig() {
  return {
    participantIds: ["p-1", "p-2"],
    participantModels: ["stub-participant-1", "stub-participant-2"],
    judgeId: "j-1",
    judgeModel: "stub-judge",
    synthesizerId: "s-1",
    synthesizerModel: "stub-synthesizer",
  }
}

describe("round validity", () => {
  test("two valid participants form a valid round even when a third fails: SIH does not abort like the live harness", async () => {
    const outputs = {
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({ participantId: "p-1", revisionId: REVISION_ID })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({ participantId: "p-2", revisionId: REVISION_ID })
      ),
      "stub-participant-3":
        "this participant produced prose, not a structured output",
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({ synthesizerId: "s-1", revisionId: REVISION_ID })
      ),
    }
    const { gateway } = makeStubGateway(outputs)
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: {
        ...fusionConfig(),
        participantIds: ["p-1", "p-2", "p-3"],
        participantModels: [
          "stub-participant-1",
          "stub-participant-2",
          "stub-participant-3",
        ],
      },
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-valid",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
    })
    expect(result.valid).toBe(true)
    expect(isRoundValid(result.participantRuns)).toBe(true)
    const failed = result.participantRuns.filter((run) => !run.wellFormed)
    expect(failed.length).toBe(1)
    expect(failed[0]?.failure?.message).toContain("schema")
    expect(result.synthesizer?.output).toBeDefined()
    expect(
      result.artifact.calls.filter((call) => call.kind === "participant")
    ).toHaveLength(3)
  })

  test("fewer than two well-formed outputs make the round invalid", async () => {
    const outputs = {
      "stub-participant-1": "prose, not structured",
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({ participantId: "p-2", revisionId: REVISION_ID })
      ),
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({ synthesizerId: "s-1", revisionId: REVISION_ID })
      ),
    }
    const { gateway } = makeStubGateway(outputs)
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: fusionConfig(),
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-invalid",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
    })
    expect(result.valid).toBe(false)
    expect(result.artifact.status).toBe("invalid")
    expect(result.judge).toBeUndefined()
    expect(result.synthesizer).toBeUndefined()
  })

  test("the Demo Profile runs exactly two participants", async () => {
    const { gateway } = makeStubGateway({})
    await expect(
      runFusionRound({
        round: 1,
        revisionId: REVISION_ID,
        task: TASK,
        config: {
          ...fusionConfig(),
          participantIds: ["p-1", "p-2", "p-3"],
          participantModels: ["a", "b", "c"],
        },
        skillsRoot: SKILLS_ROOT,
        scratchRoot: "/tmp/pi-skills-test/fusion-demo",
        parentAgentId: "orchestrator-run-1",
        gateway,
        lease: makeLease("diagnose"),
        activeTools: new Set(),
        demoProfile: true,
      })
    ).rejects.toThrow("exactly two")
  })
})

describe("Judge and Synthesizer rerun rules", () => {
  test("a malformed Judge output reruns once; a second failure invalidates the round", async () => {
    const outputs = {
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({ participantId: "p-1", revisionId: REVISION_ID })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({ participantId: "p-2", revisionId: REVISION_ID })
      ),
      "stub-judge": "always prose",
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({ synthesizerId: "s-1", revisionId: REVISION_ID })
      ),
    }
    const { gateway } = makeStubGateway(outputs)
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: fusionConfig(),
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-judge",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
    })
    expect(result.valid).toBe(false)
    expect(result.judge?.malformedReruns).toBe(1)
    const judgeCalls = result.artifact.calls.filter(
      (call) => call.kind === "judge"
    )
    expect(judgeCalls).toHaveLength(2)
    expect(result.synthesizer).toBeUndefined()
  })

  test("a malformed Synthesizer output reruns once, then the round ends needs-human", async () => {
    const outputs = {
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({ participantId: "p-1", revisionId: REVISION_ID })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({ participantId: "p-2", revisionId: REVISION_ID })
      ),
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": "prose again",
    }
    const { gateway } = makeStubGateway(outputs)
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: fusionConfig(),
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-synth",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
    })
    expect(result.valid).toBe(false)
    expect(result.synthesizer?.exhausted).toBe(true)
    expect(result.synthesizer?.malformedReruns).toBe(1)
    expect(result.artifact.status).toBe("failed")
    const synthCalls = result.artifact.calls.filter(
      (call) => call.kind === "synthesizer"
    )
    expect(synthCalls).toHaveLength(2)
  })

  test("one transient provider failure retries and the round still succeeds", async () => {
    const outputs = {
      "stub-participant-1": JSON.stringify(
        makeParticipantOutput({ participantId: "p-1", revisionId: REVISION_ID })
      ),
      "stub-participant-2": JSON.stringify(
        makeParticipantOutput({ participantId: "p-2", revisionId: REVISION_ID })
      ),
      "stub-judge": JSON.stringify(
        makeJudgeOutput({ judgeId: "j-1", revisionId: REVISION_ID })
      ),
      "stub-synthesizer": JSON.stringify(
        makeSynthesizerOutput({ synthesizerId: "s-1", revisionId: REVISION_ID })
      ),
    }
    const { gateway } = makeStubGateway(outputs, {
      failFirstN: { "stub-participant-1": 1 },
    })
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: fusionConfig(),
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-retry",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
      retry: { maxRetries: 2, maxRetryDelayMs: 5, timeoutMs: 5000 },
    })
    expect(result.valid).toBe(true)
    const p1 = result.artifact.calls.find((call) => call.role === "p-1")
    expect(p1?.retryDelaysMs.length).toBe(1)
    expect(p1?.attempts).toBe(2)
  })
})

describe("trace exclusion from later model context", () => {
  test("participant and Judge traces persist excluded; only the synthesis continues", async () => {
    const hypothesis = makeHypothesis()
    const participantText = JSON.stringify(
      makeParticipantOutput({
        participantId: "p-1",
        revisionId: REVISION_ID,
        hypothesis,
      })
    )
    const outputs = {
      "stub-participant-1": participantText,
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
    }
    const { gateway } = makeStubGateway(outputs)
    const result = await runFusionRound({
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      config: fusionConfig(),
      skillsRoot: SKILLS_ROOT,
      scratchRoot: "/tmp/pi-skills-test/fusion-traces",
      parentAgentId: "orchestrator-run-1",
      gateway,
      lease: makeLease("diagnose"),
      activeTools: new Set([
        "read",
        "grep",
        "find",
        "ls",
        "docs_proxy",
        "evidence_note",
      ]),
    })
    expect(result.valid).toBe(true)
    expect(result.artifact.excludeFromContext).toBe(true)

    const synthesis = JSON.stringify(result.synthesizer?.output)
    const later = buildLaterContext({
      synthesizerOutput: synthesis,
      fusionArtifact: result.artifact,
    })
    expect(later).toBe(synthesis)
    expect(later).not.toContain("stub-participant-1")

    // The artifact still persists every pipeline call for inspection.
    expect(result.artifact.calls.length).toBe(4)
    // The artifact itself must not contain the excluded synthesis claim.
    expect(assertExcludedFromContext(later, result.artifact)).toBe(true)
    // A context that leaks a participant trace fails the exclusion check.
    const leaked = `${later}\n${participantText}`
    expect(assertExcludedFromContext(leaked, result.artifact)).toBe(false)
  })

  test("fusionRunArtifactWire maps camelCase traces to the snake_case sealed shape", () => {
    const artifact = {
      schema_version: "1.0" as const,
      round: 2,
      revisionId: REVISION_ID,
      task: TASK,
      brief: "Analyze as a card-reader specialist.",
      calls: [
        {
          kind: "participant" as const,
          role: "fusion-participant",
          model: "stub-participant-1",
          status: "succeeded" as const,
          systemPrompt: "You are a participant.",
          inputPrompt: "Analyze from your perspective.",
          output: "participant hypotheses",
          attempts: 1,
          retryDelaysMs: [0, 100],
          promptTokens: 10,
          completionTokens: 5,
          startedAt: "2026-08-16T00:00:00Z",
          durationMs: 100,
          turns: 1,
          toolCalls: 0,
        },
      ],
      status: "succeeded" as const,
      excludeFromContext: true as const,
      sealedAt: "2026-08-16T00:00:02Z",
      perspectives: [
        { participantId: "p-1", perspective: "card-reader specialist", order: 1 },
      ],
      metrics: {
        participants: [
          { participantId: "p-1", status: "succeeded" as const, turns: 1, toolCalls: 0, durationMs: 100 },
        ],
        judge: { status: "succeeded" as const, turns: 1, toolCalls: 0, durationMs: 90 },
        synthesizer: null,
        totalWallClockMs: 200,
      },
    }

    const wire = fusionRunArtifactWire(artifact)
    expect(wire).toEqual({
      schema_version: "1.0",
      round: 2,
      revision_id: REVISION_ID,
      task: TASK,
      brief: "Analyze as a card-reader specialist.",
      calls: [
        {
          kind: "participant",
          role: "fusion-participant",
          model: "stub-participant-1",
          status: "succeeded",
          system_prompt: "You are a participant.",
          input_prompt: "Analyze from your perspective.",
          output: "participant hypotheses",
          attempts: 1,
          retry_delays_ms: [0, 100],
          prompt_tokens: 10,
          completion_tokens: 5,
          started_at: "2026-08-16T00:00:00Z",
          duration_ms: 100,
          turns: 1,
          tool_calls: 0,
        },
      ],
      status: "succeeded",
      exclude_from_context: true,
      sealed_at: "2026-08-16T00:00:02Z",
      perspectives: [
        { participant_id: "p-1", perspective: "card-reader specialist", order: 1 },
      ],
      metrics: {
        participants: [
          { participant_id: "p-1", status: "succeeded", turns: 1, tool_calls: 0, duration_ms: 100 },
        ],
        judge: { status: "succeeded", turns: 1, tool_calls: 0, duration_ms: 90 },
        synthesizer: null,
        total_wall_clock_ms: 200,
      },
    })
  })

  test("fusionRunArtifactWire omits optional fields when absent", () => {
    const wire = fusionRunArtifactWire({
      schema_version: "1.0",
      round: 1,
      revisionId: REVISION_ID,
      task: TASK,
      calls: [],
      status: "failed",
      statusReason: "Synthesizer output malformed",
      excludeFromContext: true,
      sealedAt: "2026-08-16T00:00:00Z",
    })
    expect(wire.brief).toBeUndefined()
    expect(wire.status_reason).toBe("Synthesizer output malformed")
    expect(wire.perspectives).toBeUndefined()
    expect(wire.metrics).toBeUndefined()
  })
})
