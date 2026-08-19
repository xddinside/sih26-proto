/**
 * Deterministic provider tests for the real repair round
 * (`runRealRepairRound`, issue #27): one scripted streaming provider drives
 * two bounded Pi role sessions — a read-only planner ending in
 * `submit_remediation`, then an implementer bound to its isolated worktree
 * ending in `submit_implemented_diff`. No network, no real model.
 *
 * Covered seams: a valid bounded change; an invalid Remediation corrected in
 * the same session; out-of-scope mutation rejection before Verify; candidate
 * mismatch (the submitted diff does not match the worktree); planner failure
 * (no implementer runs); implementer failure; and an aborted round. In every
 * case the honest session records survive and no canned fallback is used.
 */
import { describe, expect, test } from "bun:test"

import {
  FakeControlPlaneClient,
  ModelGateway,
  ReadBroker,
  scriptedStreamingProvider,
} from "@sih/brokers"
import type { ScriptedTurn } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import { validate } from "@sih/contracts/parse"

import { runRealRepairRound } from "../src/repair/repair-real.js"
import type { RepairSealSurface } from "../src/repair/repair-real.js"
import { createWorktreeHost } from "../src/agent/roles.js"
import { changedFilesFromDiff } from "../src/repair/implementer.js"
import {
  makeHypothesis,
  makeLease,
  REVISION_ID,
  fixtureHash,
} from "./helpers.js"

const READ_TOOL = "read_broker_query"
const TERMINAL_PLANNER = "submit_remediation"
const TERMINAL_IMPLEMENTER = "submit_implemented_diff"
const CARD_PATH = "src/payment/card.js"

const MODEL = { provider: "opencode-go", id: "deepseek-v4-flash" }
const BASE_REF = fixtureHash("base-ref")

const BASE_FILES = new Map([
  [
    CARD_PATH,
    [
      "export function validateCard(card) {",
      '  if (card.type !== "VISA") return true;',
      "  return false;",
      "}",
      "",
    ].join("\n"),
  ],
])
const FIXED_CONTENT = [
  "export function validateCard(card) {",
  '  if (card.type !== "VISA") return false;',
  "  return true;",
  "}",
  "",
].join("\n")

const worktree = createWorktreeHost(BASE_REF, BASE_FILES)
worktree.write(CARD_PATH, FIXED_CONTENT)
const DIFF_TEXT = worktree.diffText()
const diffDigest = contentHash({ base_ref: BASE_REF, diff: DIFF_TEXT })
if (!diffDigest.ok) {
  throw new Error(diffDigest.error.message)
}
const DIFF_HASH = diffDigest.value

function remediationDraft(): Record<string, unknown> {
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
    changed_surfaces: [CARD_PATH],
    typed_action_plan: {
      adapter: "compose-release",
      action_class: "merge-deploy",
      command: "swap",
    },
    completed_at: new Date().toISOString(),
  }
}

function implementedDiff(diffText: string, diffHash: string): Record<string, unknown> {
  return {
    schema_version: "1.0",
    incident_id: "inc-test",
    run_id: "run-1",
    attempt: 1,
    base_ref: BASE_REF,
    diff_text: diffText,
    diff_hash: diffHash,
    changed_files: [CARD_PATH],
    completed_at: new Date().toISOString(),
  }
}

function readTurn(id: string): ScriptedTurn {
  return {
    kind: "tool-call",
    id,
    name: READ_TOOL,
    args: { backend: "git", connection_id: "demo-repo", query: "grep card-type clause" },
  }
}

function terminalTurn(
  id: string,
  name: string,
  payload: unknown,
): ScriptedTurn {
  return { kind: "tool-call", id, name, args: { submission: payload } }
}

/** The two scripted sessions of a successful round, keyed by agent id. */
function successTurns(overrides: {
  planner?: readonly ScriptedTurn[]
  implementer?: readonly ScriptedTurn[]
} = {}): Record<string, readonly ScriptedTurn[]> {
  return {
    "repair-planner-run-1": overrides.planner ?? [
      readTurn("pl-1"),
      terminalTurn("pl-2", TERMINAL_PLANNER, remediationDraft()),
    ],
    "repair-implementer-run-1": overrides.implementer ?? [
      {
        kind: "tool-call",
        id: "im-1",
        name: "worktree_read",
        args: { path: CARD_PATH },
      },
      {
        kind: "tool-call",
        id: "im-2",
        name: "worktree_write",
        args: { path: CARD_PATH, content: FIXED_CONTENT },
      },
      terminalTurn(
        "im-3",
        TERMINAL_IMPLEMENTER,
        implementedDiff(DIFF_TEXT, DIFF_HASH),
      ),
    ],
  }
}

function sealSurface(sealed: unknown[] = []): RepairSealSurface {
  return {
    async seal(input) {
      const digest = contentHash(
        JSON.parse(JSON.stringify(input.payload)) as never,
      )
      if (!digest.ok) {
        throw new Error(`seal digest failed: ${digest.error.message}`)
      }
      sealed.push({ schema_id: input.schemaId, payload: input.payload })
      return { content_hash: digest.value }
    },
  }
}

interface RoundHarness {
  cp: FakeControlPlaneClient
  broker: ReadBroker
  sealed: unknown[]
  run: () => ReturnType<typeof runRealRepairRound>
}

function makeHarness(options: {
  turns: Record<string, readonly ScriptedTurn[]>
  signal?: AbortSignal
}): RoundHarness {
  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-test-1")
  const gateway = new ModelGateway(
    cp,
    undefined,
    scriptedStreamingProvider({ turns: options.turns, honorSignal: true }),
    "sk-test-0123456789abcdef",
  )
  const broker = new ReadBroker(cp)
  const sealed: unknown[] = []
  return {
    cp,
    broker,
    sealed,
    run: () =>
      runRealRepairRound({
        incidentId: "inc-test",
        runId: "run-1",
        attempt: 1,
        revisionId: REVISION_ID,
        acceptedHypothesis: JSON.stringify(makeHypothesis()),
        changeSurfacePolicy: "only src/payment/card.js may change",
        recoveryPointSummary:
          "restores the compose project file hash, the seeded image digest, and the flagd defaults",
        declaredSurfaces: [CARD_PATH],
        allowedChangedFiles: [CARD_PATH],
        baseRef: BASE_REF,
        baseFiles: BASE_FILES,
        plannerTask: "plan the one-line card-type restoration",
        implementerTask: "apply the one-line card-type restoration",
        parentAgentId: "orchestrator-run-1",
        gateway,
        lease: makeLease("repair"),
        readBroker: broker,
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

describe("runRealRepairRound", () => {
  test("changedFilesFromDiff reads only real header pairs, never content lines", () => {
    const diffText = [
      "--- a/src/payment/card.js",
      "+++ b/src/payment/card.js",
      "@@ -1,5 +1,5 @@",
      "+ ++ b/not-a-header.js",
      "+++ b/also-not-a-header.js",
    ].join("\n")
    // The content line `++ b/not-a-header.js` is prefixed with one `+` and
    // has no `--- a/` partner; the bare `+++ b/also-not-a-header.js` line has
    // no `--- a/` predecessor. Only the real pair is counted.
    expect(changedFilesFromDiff(diffText)).toEqual(["src/payment/card.js"])
  })

  test("success: the planner reads evidence, the implementer applies a bounded change, and both artifacts seal", async () => {
    const { run, sealed, cp } = makeHarness({ turns: successTurns() })
    const result = await run()

    expect(result.valid).toBe(true)
    expect(result.failure).toBeUndefined()
    expect(result.planner?.draft.change_description).toContain(
      "card-type clause",
    )
    expect(result.implementer?.diffText).toBe(DIFF_TEXT)
    expect(result.implementer?.diffHash).toBe(DIFF_HASH)
    expect(result.implementer?.changedFiles).toEqual([CARD_PATH])

    // Two sessions in run order: planner, then implementer.
    expect(result.sessions.map((session) => session.agentId)).toEqual([
      "repair-planner-run-1",
      "repair-implementer-run-1",
    ])
    expect(
      result.sessions.every((session) => session.status === "succeeded"),
    ).toBe(true)
    expect(result.sessions.map((session) => session.role)).toEqual([
      "planner",
      "implementer",
    ])

    // The planner made one lease-scoped broker read.
    expect(cp.receipts).toHaveLength(1)
    expect(cp.receipts[0]?.receipt.kind).toBe("read")

    // The terminal artifacts and per-session run artifacts were sealed.
    expect(sealedSubmissions(sealed, "remediation-draft")).toHaveLength(1)
    expect(sealedSubmissions(sealed, "implemented-diff")).toHaveLength(1)
    expect(sealedSubmissions(sealed, "agent-run-artifact")).toHaveLength(2)

    // The sealed draft satisfies its registered schema.
    const check = validate(
      "remediation-draft",
      "1.0",
      sealedSubmissions(sealed, "remediation-draft")[0],
    )
    expect(check.ok).toBe(true)
  })

  test("an invalid Remediation is returned to the same planner session and corrected", async () => {
    const { run, sealed } = makeHarness({
      turns: successTurns({
        planner: [
          terminalTurn("pl-1", TERMINAL_PLANNER, {
            schema_version: "9.9",
          }),
          readTurn("pl-2"),
          terminalTurn("pl-3", TERMINAL_PLANNER, remediationDraft()),
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(true)
    expect(result.sessions[0]?.status).toBe("succeeded")
    expect(result.sessions[0]?.turns).toBe(3)
    expect(result.sessions[0]?.toolCalls).toBe(1)
    // The invalid `9.9` payload never reached the durability seam.
    const drafts = sealedSubmissions(
      sealed,
      "remediation-draft",
    ) as { schema_version: string }[]
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.schema_version).toBe("1.0")
  })

  test("an out-of-scope mutation is rejected before Verify", async () => {
    const rogueWorktree = createWorktreeHost(BASE_REF, BASE_FILES)
    rogueWorktree.write(CARD_PATH, FIXED_CONTENT)
    rogueWorktree.write("src/flagd/demo.flagd.json", "{}\n")
    const rogueDiffText = rogueWorktree.diffText()
    const rogueDigest = contentHash({
      base_ref: BASE_REF,
      diff: rogueDiffText,
    })
    if (!rogueDigest.ok) {
      throw new Error(rogueDigest.error.message)
    }
    const { run, sealed } = makeHarness({
      turns: successTurns({
        implementer: [
          {
            kind: "tool-call",
            id: "im-1",
            name: "worktree_write",
            args: { path: CARD_PATH, content: FIXED_CONTENT },
          },
          {
            kind: "tool-call",
            id: "im-2",
            name: "worktree_write",
            args: { path: "src/flagd/demo.flagd.json", content: "{}\n" },
          },
          terminalTurn(
            "im-3",
            TERMINAL_IMPLEMENTER,
            implementedDiff(rogueDiffText, rogueDigest.value),
          ),
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("implementer")
    expect(result.failure?.message).toContain(
      "out of the accepted Remediation scope",
    )
    // The changed files are parsed deterministically from the diff.
    expect(changedFilesFromDiff(rogueDiffText)).toContain(
      "src/flagd/demo.flagd.json",
    )
    // The implementer's terminal artifact still sealed (the session ran), but
    // no proposal or Verify can follow an invalid round.
    expect(sealedSubmissions(sealed, "implemented-diff")).toHaveLength(1)
    expect(result.sessions).toHaveLength(2)
  })

  test("a candidate mismatch (diff does not match the worktree) fails the round", async () => {
    const tampered = `${DIFF_TEXT}\n-- tampered --\n`
    const { run } = makeHarness({
      turns: successTurns({
        implementer: [
          {
            kind: "tool-call",
            id: "im-1",
            name: "worktree_write",
            args: { path: CARD_PATH, content: FIXED_CONTENT },
          },
          terminalTurn(
            "im-2",
            TERMINAL_IMPLEMENTER,
            implementedDiff(tampered, DIFF_HASH),
          ),
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("implementer")
    expect(result.failure?.message).toContain("does not match its worktree diff")
  })

  test("a candidate hash mismatch fails the round", async () => {
    const wrongHash = fixtureHash("wrong-hash")
    const { run } = makeHarness({
      turns: successTurns({
        implementer: [
          {
            kind: "tool-call",
            id: "im-1",
            name: "worktree_write",
            args: { path: CARD_PATH, content: FIXED_CONTENT },
          },
          terminalTurn(
            "im-2",
            TERMINAL_IMPLEMENTER,
            implementedDiff(DIFF_TEXT, wrongHash),
          ),
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("implementer")
    expect(result.failure?.message).toContain(
      "diff hash mismatches the deterministic diff hash",
    )
  })

  test("a planner failure stops the round before the implementer", async () => {
    const { run, sealed } = makeHarness({
      turns: successTurns({
        planner: [
          { kind: "error", message: "provider exploded", stopReason: "error" },
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("planner")
    expect(result.planner).toBeUndefined()
    expect(result.implementer).toBeUndefined()
    // Only the planner session ran; the implementer never started.
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.status).toBe("failed")
    // No terminal artifact for a failed planner.
    expect(sealedSubmissions(sealed, "remediation-draft")).toHaveLength(0)
    expect(sealedSubmissions(sealed, "implemented-diff")).toHaveLength(0)
  })

  test("an implementer failure preserves the planner draft and both session records", async () => {
    const { run } = makeHarness({
      turns: successTurns({
        implementer: [
          { kind: "error", message: "provider exploded", stopReason: "error" },
        ],
      }),
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.role).toBe("implementer")
    expect(result.planner?.draft.change_description).toContain("card-type")
    expect(result.implementer).toBeUndefined()
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[1]?.status).toBe("failed")
  })

  test("an aborted round records the honest aborted status on both sessions", async () => {
    const abort = new AbortController()
    abort.abort()
    const { run } = makeHarness({
      turns: successTurns(),
      signal: abort.signal,
    })
    const result = await run()

    expect(result.valid).toBe(false)
    expect(result.failure?.status).toBe("aborted")
    expect(result.failure?.role).toBe("planner")
    expect(result.sessions.every((session) => session.status === "aborted")).toBe(
      true,
    )
    expect(result.implementer).toBeUndefined()
  })
})
