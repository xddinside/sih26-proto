/**
 * Deterministic provider tests for the real Fusion round (`runRealFusionRound`,
 * issue #26): one scripted streaming provider drives two parallel Pi
 * participant sessions, a Judge, and a Synthesizer. No network, no real model.
 *
 * Covered seams: success; reversed participant completion order (artifact
 * order follows configured perspective order); participant failure and abort
 * (no Judge/Synthesizer, partial artifact); invalid terminal correction;
 * low-diversity output recorded honestly; and the sealed Fusion Run Artifact
 * validates against the registered `fusion-run-artifact@1.0` schema.
 */
import { describe, expect, test } from "bun:test"

import {
  FakeControlPlaneClient,
  ModelGateway,
  ReadBroker,
  scriptedStreamingProvider,
} from "@sih/brokers"
import type { GatewayStreamingProvider, ScriptedTurn } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import { validate } from "@sih/contracts/parse"

import { runRealFusionRound } from "../src/fusion/fusion-real.js"
import type { FusionSealSurface } from "../src/fusion/fusion-real.js"
import { fusionRunArtifactWire } from "../src/fusion/traces.js"
import {
  makeHypothesis,
  makeJudgeOutput,
  makeLease,
  makeParticipantOutput,
  makeSynthesizerOutput,
  REVISION_ID,
} from "./helpers.js"

const READ_TOOL = "read_broker_query"
const TERMINAL_PARTICIPANT = "submit_hypotheses"
const TERMINAL_JUDGE = "submit_judgment"
const TERMINAL_SYNTHESIZER = "submit_synthesis"

const TASK =
  "Diagnose the payment charge failure from the pinned Evidence Set revision."

const MODEL = { provider: "opencode-go", id: "deepseek-v4-flash" }

const PERSPECTIVES = [
  "code-level defect hunt: trace the failing charge path from the error text and the seeded diff",
  "system-level causation: weigh runtime telemetry, flagd state, and the pre-seed baseline",
]

function readTurn(id: string, backend = "prometheus"): ScriptedTurn {
  return {
    kind: "tool-call",
    id,
    name: READ_TOOL,
    args: { backend, connection_id: "c1", query: "sum(rate(http_errors[5m]))" },
  }
}

function terminalTurn(
  id: string,
  name: string,
  payload: unknown
): ScriptedTurn {
  return { kind: "tool-call", id, name, args: { submission: payload } }
}

function participantOutput(participantId: string): Record<string, unknown> {
  return makeParticipantOutput({ participantId, revisionId: REVISION_ID })
}

function judgeOutput(judgeId: string): Record<string, unknown> {
  return makeJudgeOutput({ judgeId, revisionId: REVISION_ID })
}

function synthesizerOutput(synthesizerId: string): Record<string, unknown> {
  return makeSynthesizerOutput({
    synthesizerId,
    revisionId: REVISION_ID,
    hypothesis: makeHypothesis(),
  })
}

/** The four scripted sessions of a successful round, keyed by their agent
 * ids (`<role-id>-1` for round 1). */
function successTurns(
  overrides: {
    p1?: readonly ScriptedTurn[]
    p2?: readonly ScriptedTurn[]
    judge?: readonly ScriptedTurn[]
    synthesizer?: readonly ScriptedTurn[]
  } = {}
): Record<string, readonly ScriptedTurn[]> {
  return {
    "p-1-1": overrides.p1 ?? [
      readTurn("p1-c1"),
      readTurn("p1-c2", "flagd"),
      terminalTurn("p1-c3", TERMINAL_PARTICIPANT, participantOutput("p-1")),
    ],
    "p-2-1": overrides.p2 ?? [
      readTurn("p2-c1", "git"),
      terminalTurn("p2-c2", TERMINAL_PARTICIPANT, participantOutput("p-2")),
    ],
    "j-1-1": overrides.judge ?? [
      terminalTurn("j1-c1", TERMINAL_JUDGE, judgeOutput("j-1")),
    ],
    "s-1-1": overrides.synthesizer ?? [
      terminalTurn("s1-c1", TERMINAL_SYNTHESIZER, synthesizerOutput("s-1")),
    ],
  }
}

function sealSurface(sealed: unknown[] = []): FusionSealSurface {
  return {
    async seal(input) {
      const digest = contentHash(
        JSON.parse(JSON.stringify(input.payload)) as never
      )
      if (!digest.ok) {
        throw new Error(`seal digest failed: ${digest.error.message}`)
      }
      sealed.push({
        schema_id: input.schemaId,
        payload: input.payload,
      })
      return { content_hash: digest.value }
    },
  }
}

interface RoundHarness {
  cp: FakeControlPlaneClient
  broker: ReadBroker
  sealed: unknown[]
  run: () => ReturnType<typeof runRealFusionRound>
}

function makeHarness(options: {
  turns: Record<string, readonly ScriptedTurn[]>
  streaming?: GatewayStreamingProvider
  signal?: AbortSignal
  perspectives?: string[]
}): RoundHarness {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const gateway = new ModelGateway(
    cp,
    undefined,
    options.streaming ??
      scriptedStreamingProvider({ turns: options.turns, honorSignal: true }),
    "sk-test-0123456789abcdef"
  )
  const broker = new ReadBroker(cp)
  const sealed: unknown[] = []
  return {
    cp,
    broker,
    sealed,
    run: () =>
      runRealFusionRound({
        round: 1,
        revisionId: REVISION_ID,
        task: TASK,
        participantIds: ["p-1", "p-2"],
        participantPerspectives: options.perspectives ?? PERSPECTIVES,
        judgeId: "j-1",
        synthesizerId: "s-1",
        parentAgentId: "orchestrator-run-1",
        gateway,
        lease: makeLease("diagnose"),
        readBroker: broker,
        candidateHash: "no-candidate-hash",
        seal: sealSurface(sealed),
        model: MODEL,
        reasoning: "high",
        signal: options.signal,
      }),
  }
}

/** The sealed terminal submissions of a given schema, in seal order. */
function sealedSubmissions(sealed: unknown[], schemaId: string): unknown[] {
  return sealed
    .filter((entry) => (entry as { schema_id: string }).schema_id === schemaId)
    .map((entry) => (entry as { payload: unknown }).payload)
}

describe("runRealFusionRound", () => {
  test("success: two participants, Judge, and Synthesizer settle and the artifact validates", async () => {
    const { run, sealed, cp } = makeHarness({ turns: successTurns() })
    const result = await run()

    expect(result.valid).toBe(true)
    expect(result.artifact.status).toBe("succeeded")
    expect(result.participantRuns.every((entry) => entry.wellFormed)).toBe(true)
    expect(result.judge?.wellFormed).toBe(true)
    expect(result.synthesizer?.wellFormed).toBe(true)

    // Four sessions in perspective-then-pipeline order.
    expect(result.sessions.map((session) => session.agentId)).toEqual([
      "p-1-1",
      "p-2-1",
      "j-1-1",
      "s-1-1",
    ])
    expect(
      result.sessions.every((session) => session.status === "succeeded")
    ).toBe(true)
    expect(
      result.sessions
        .map((session) => session.submissionId)
        .every((id) => id !== undefined)
    ).toBe(true)

    // Four ordered pipeline calls: participants first, then Judge, then
    // Synthesizer; every call records turns and non-terminal tool calls.
    expect(result.artifact.calls.map((call) => call.role)).toEqual([
      "p-1",
      "p-2",
      "j-1",
      "s-1",
    ])
    const p1 = result.artifact.calls[0]
    expect(p1.kind).toBe("participant")
    expect(p1.status).toBe("succeeded")
    expect(p1.turns).toBe(3)
    expect(p1.toolCalls).toBe(2)

    // Participant metrics follow the configured perspective order.
    expect(
      result.artifact.metrics?.participants.map((entry) => entry.participantId)
    ).toEqual(["p-1-1", "p-2-1"])

    // The perspectives are recorded in configured order.
    expect(
      result.artifact.perspectives?.map((entry) => entry.participantId)
    ).toEqual(["p-1", "p-2"])

    // The participants actually made lease-scoped broker reads.
    expect(cp.receipts).toHaveLength(3)
    expect(
      cp.receipts.every(
        ({ receipt }) =>
          receipt.kind === "read" && receipt.result.outcome === "ok"
      )
    ).toBe(true)

    // The terminal and run artifacts were sealed for every session.
    expect(sealedSubmissions(sealed, "fusion-participant-output")).toHaveLength(
      2
    )
    expect(sealedSubmissions(sealed, "fusion-judge-output")).toHaveLength(1)
    expect(sealedSubmissions(sealed, "fusion-synthesizer-output")).toHaveLength(
      1
    )
    expect(sealedSubmissions(sealed, "agent-run-artifact")).toHaveLength(4)

    // The wire shape satisfies the registered Fusion Run Artifact schema.
    const check = validate(
      "fusion-run-artifact",
      "1.0",
      fusionRunArtifactWire(result.artifact)
    )
    expect(check.ok).toBe(true)
  })

  test("reversed participant completion order: the artifact still follows configured perspective order", async () => {
    const base = scriptedStreamingProvider({
      turns: successTurns({
        // p-2 finishes in one turn; p-1 needs three turns, each delayed, so
        // p-2 settles well before p-1.
        p2: [
          terminalTurn("p2-c1", TERMINAL_PARTICIPANT, participantOutput("p-2")),
        ],
      }),
      honorSignal: true,
    })
    const streaming: GatewayStreamingProvider = (request, resolved) => {
      if (request.agentId === "p-1-1") {
        return new Promise((resolve) => {
          setTimeout(() => resolve(base(request, resolved)), 40)
        })
      }
      return base(request, resolved)
    }
    const { run, sealed } = makeHarness({
      turns: {},
      streaming,
    })
    const result = await run()

    // Completion order was reversed: p-2's participant output sealed first.
    const participantSubmissions = sealedSubmissions(
      sealed,
      "fusion-participant-output"
    ) as { participant_id: string }[]
    expect(participantSubmissions[0]?.participant_id).toBe("p-2")

    // Persisted order still follows the configured perspectives.
    expect(result.valid).toBe(true)
    expect(result.artifact.calls.map((call) => call.role)).toEqual([
      "p-1",
      "p-2",
      "j-1",
      "s-1",
    ])
    expect(result.sessions.map((session) => session.agentId)).toEqual([
      "p-1-1",
      "p-2-1",
      "j-1-1",
      "s-1-1",
    ])
    expect(
      result.artifact.metrics?.participants.map((entry) => entry.participantId)
    ).toEqual(["p-1-1", "p-2-1"])
  })

  test("a failed participant invalidates the round; Judge and Synthesizer do not run", async () => {
    const { run, sealed } = makeHarness({
      turns: successTurns({
        p1: [
          { kind: "error", message: "provider exploded", stopReason: "error" },
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.artifact.status).toBe("invalid")
    expect(result.judge).toBeUndefined()
    expect(result.synthesizer).toBeUndefined()
    expect(result.participantRuns[0]?.wellFormed).toBe(false)
    expect(result.participantRuns[0]?.failure?.message).toContain(
      "participant session failed"
    )
    expect(result.participantRuns[1]?.wellFormed).toBe(true)

    // The failed participant's call is recorded as failed; the partial
    // artifact remains inspectable and schema-valid.
    expect(result.artifact.calls[0]?.status).toBe("failed")
    expect(result.artifact.calls.map((call) => call.kind)).toEqual([
      "participant",
      "participant",
    ])
    const check = validate(
      "fusion-run-artifact",
      "1.0",
      fusionRunArtifactWire(result.artifact)
    )
    expect(check.ok).toBe(true)
    // No terminal artifact was sealed for the failed participant.
    expect(sealedSubmissions(sealed, "fusion-participant-output")).toHaveLength(
      1
    )
  })

  test("an aborted round stops before the Judge; every call records aborted", async () => {
    const abort = new AbortController()
    abort.abort()
    const { run } = makeHarness({
      turns: successTurns(),
      signal: abort.signal,
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.artifact.status).toBe("aborted")
    expect(result.artifact.statusReason).toContain("aborted")
    expect(result.judge).toBeUndefined()
    expect(result.synthesizer).toBeUndefined()
    expect(result.participantRuns.every((entry) => !entry.wellFormed)).toBe(
      true
    )
    expect(
      result.participantRuns.every((entry) =>
        entry.failure?.message.includes("aborted")
      )
    ).toBe(true)
    expect(result.artifact.calls.map((call) => call.status)).toEqual([
      "aborted",
      "aborted",
    ])
  })

  test("an invalid terminal submission returns to the same session and is corrected", async () => {
    const { run, sealed } = makeHarness({
      turns: successTurns({
        p1: [
          terminalTurn("p1-c1", TERMINAL_PARTICIPANT, {
            schema_version: "9.9",
          }),
          readTurn("p1-c2"),
          terminalTurn("p1-c3", TERMINAL_PARTICIPANT, participantOutput("p-1")),
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(true)
    expect(result.participantRuns[0]?.wellFormed).toBe(true)
    const p1 = result.artifact.calls[0]
    expect(p1.status).toBe("succeeded")
    // Three turns: the rejected submission, a read, then the corrected one.
    expect(p1.turns).toBe(3)
    expect(p1.toolCalls).toBe(1)
    // Both participants sealed a valid output; the invalid `9.9` payload
    // never reached the durability seam.
    const sealedOutputs = sealedSubmissions(
      sealed,
      "fusion-participant-output"
    ) as { schema_version: string }[]
    expect(sealedOutputs).toHaveLength(2)
    expect(sealedOutputs.every((entry) => entry.schema_version === "1.0")).toBe(
      true
    )
  })

  test("low-diversity output is recorded honestly and still forms a valid round", async () => {
    const identical = participantOutput("p-1")
    const { run, sealed } = makeHarness({
      turns: successTurns({
        p2: [
          readTurn("p2-c1", "git"),
          terminalTurn("p2-c2", TERMINAL_PARTICIPANT, identical),
        ],
      }),
    })
    const result = await run()

    // Diversity is configurable policy, not code: identical outputs do not
    // abort the round, are persisted byte-for-byte, and the deterministic
    // Hypothesis gate (the caller's seam) remains the only authority.
    expect(result.valid).toBe(true)
    expect(result.artifact.calls[0]?.output).toBe(
      result.artifact.calls[1]?.output
    )
    expect(result.participantRuns[0]?.output).toEqual(
      result.participantRuns[1]?.output
    )
    expect(sealedSubmissions(sealed, "fusion-participant-output")).toHaveLength(
      2
    )
    const check = validate(
      "fusion-run-artifact",
      "1.0",
      fusionRunArtifactWire(result.artifact)
    )
    expect(check.ok).toBe(true)
  })

  test("perspectives are recorded in configured order and the shared context is identical across participants", async () => {
    const perspectives = [
      "first independent perspective",
      "second independent perspective",
    ]
    const { run } = makeHarness({ turns: successTurns(), perspectives })
    const result = await run()

    expect(
      result.artifact.perspectives?.map((entry) => entry.perspective)
    ).toEqual(perspectives)
    // Both participants received byte-identical Shared Starting Context; only
    // their system prompt carried the assigned perspective.
    expect(result.artifact.calls[0]?.inputPrompt).toBe(
      result.artifact.calls[1]?.inputPrompt
    )
    expect(result.artifact.calls[0]?.systemPrompt).not.toBe(
      result.artifact.calls[1]?.systemPrompt
    )
  })
})
