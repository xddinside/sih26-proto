/**
 * Opt-in live smoke for the Pi role session: one real pi-agent-core role
 * driven through the Model Gateway with `opencode-go` / `deepseek-v4-flash`
 * / `high` reasoning. The role makes two permitted Broker-backed reads and
 * finishes with one schema-valid typed terminal submission.
 *
 * Opt-in: without `OPENCODE_API_KEY` set, the smoke prints a skip notice and
 * exits 0 (CI-safe). The key is read only by the Model Gateway; this script
 * never touches it. Journals, records, and artifacts are scanned for the key
 * and for provider authorization headers, and the smoke fails if any leak.
 *
 * Output goes to `/tmp/opencode/sih-live-smoke` (override with
 * `SIH_SMOKE_OUT_DIR`).
 *
 * Usage: `bun run scripts/live-role-smoke.ts`
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { FakeControlPlaneClient, ModelGateway, ReadBroker } from "@sih/brokers"
import type { LeaseRef } from "@sih/brokers"
import { sha256Hex } from "@sih/contracts/hashes"
import { validate } from "@sih/contracts/parse"

import { createReadTool } from "../src/role/broker-tools.js"
import { createTerminalTool } from "../src/role/terminal-tools.js"
import { PiRoleSession } from "../src/role/role-session.js"
import { containsNoSecrets } from "../src/role/redact.js"

const OUT_DIR = process.env.SIH_SMOKE_OUT_DIR ?? "/tmp/opencode/sih-live-smoke"

const CANDIDATE_HASH = `sha256:${sha256Hex("live-smoke-candidate")}`

function lease(): LeaseRef {
  return {
    leaseId: "lease-live-smoke",
    token: "tok",
    incidentId: "inc-live-smoke",
    runId: "run-live-smoke",
    attempt: 1,
    stage: "diagnose",
    actorId: "orch-live-smoke",
    actorKind: "orchestrator",
    toolClass: "diagnose",
  }
}

/** A schema-valid fusion-participant-output@1.0 payload the model fills in. */
function blankSubmission(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    participant_id: "participant-live-smoke",
    revision_id: CANDIDATE_HASH,
    hypotheses: [],
    stated_objections: [],
    completed_at: new Date().toISOString(),
  }
}

async function main(): Promise<void> {
  if (process.env.OPENCODE_API_KEY === undefined) {
    console.log(
      "live-role-smoke: skipped; OPENCODE_API_KEY is not set (opt-in, CI-safe).",
    )
    return
  }
  if (process.env.OPENCODE_API_KEY.length === 0) {
    console.log(
      "live-role-smoke: skipped; OPENCODE_API_KEY is empty (opt-in, CI-safe).",
    )
    return
  }
  const secret = process.env.OPENCODE_API_KEY

  const cp = new FakeControlPlaneClient()
  cp.leases.add("lease-live-smoke")
  const gateway = new ModelGateway(cp)
  const broker = new ReadBroker(cp)
  const l = lease()

  const readTool = createReadTool({ broker, lease: l, candidateHash: CANDIDATE_HASH })
  const terminal = createTerminalTool({
    name: "submit_fusion_output",
    schemaName: "fusion-participant-output",
    schemaVersion: "1.0",
    submit: async (payload) => {
      const result = validate("fusion-participant-output", "1.0", payload)
      if (!result.ok) {
        throw new Error(`submission did not validate: ${result.error.message}`)
      }
      return { submissionId: `sub-${sha256Hex(JSON.stringify(payload)).slice(0, 16)}` }
    },
  })

  const session = new PiRoleSession({
    agentId: "agent-live-smoke",
    parentAgentId: "run-live-smoke",
    agentRole: "sih-fusion-participant",
    phase: "participant",
    systemPrompt:
      "You are a bounded Fusion participant in the SIH incident workflow. " +
      "Use read_broker_query to gather evidence with at least two distinct queries. " +
      "Then fill in the blank fusion-participant-output payload with a concrete " +
      "hypothesis derived from what you read, and submit it with " +
      "submit_fusion_output. Do not invent evidence; only use what the reads return. " +
      "The blank payload has an empty hypotheses array; replace it with one " +
      "hypothesis object whose id, incident_id, incident_run_id, attempt, round, " +
      "causal_claim, affected_scope, predicted_observations, evidence, alternatives, " +
      "proposed_tests, and status fields all follow the schema.",
    model: { provider: "opencode-go", id: "deepseek-v4-flash" },
    reasoning: "high",
    lease: l,
    gateway,
    candidateHash: CANDIDATE_HASH,
    tools: [readTool, terminal.tool],
    terminalTool: terminal,
    authority: {
      roleTools: ["read_broker_query", "submit_fusion_output"],
      stageTools: ["read_broker_query", "submit_fusion_output"],
      policyTools: ["read_broker_query", "submit_fusion_output"],
      leaseTools: ["read_broker_query", "submit_fusion_output"],
    },
  })

  const result = await session.run(
    "Investigate the payment charge failure using the broker reads, then submit your typed output.",
  )

  await mkdir(OUT_DIR, { recursive: true })
  const artifact = {
    status: result.status,
    turns: result.turns,
    toolCalls: result.toolCalls,
    failureReason: result.failureReason,
    terminalSubmission: result.terminalSubmission,
    receipts: cp.receipts.map(({ receipt }) => ({
      kind: receipt.kind,
      receipt_id: receipt.receipt_id,
      stage: receipt.stage,
      candidate_hash: receipt.candidate_hash,
      request: "request" in receipt ? receipt.request : undefined,
      result: "result" in receipt ? receipt.result : undefined,
    })),
    modelUses: cp.modelUses.map(({ use }) => use),
    transcript: result.messages,
  }
  await writeFile(join(OUT_DIR, "live-smoke.json"), JSON.stringify(artifact, null, 2))

  const serialized = JSON.stringify(artifact)
  const clean = containsNoSecrets(serialized, [secret])
  const noAuthHeader = !/authorization:\s*\S+/i.test(serialized) && !/bearer\s+\S+/i.test(serialized)
  if (!clean || !noAuthHeader) {
    console.error(
      "live-role-smoke: FAILED — the provider key or an authorization header leaked into the artifact.",
    )
    process.exit(1)
  }

  if (result.status !== "succeeded" || result.terminalSubmission === undefined) {
    console.error(`live-role-smoke: FAILED — role status ${result.status}`)
    console.error(`  failure reason: ${result.failureReason ?? "unknown"}`)
    console.error(`  artifact written to ${OUT_DIR}/live-smoke.json`)
    process.exit(1)
  }
  if (cp.receipts.length < 2) {
    console.error(`live-role-smoke: FAILED — expected >= 2 broker receipts, got ${cp.receipts.length}`)
    process.exit(1)
  }

  console.log(`live-role-smoke: OK — ${result.status} in ${result.turns} turns, ${result.toolCalls} tool calls`)
  console.log(`  receipts: ${cp.receipts.length} (bound to ${CANDIDATE_HASH.slice(0, 16)}…)`)
  console.log(`  submission: ${result.terminalSubmission.submissionId}`)
  console.log(`  artifact: ${OUT_DIR}/live-smoke.json`)
}

await main().catch((error) => {
  console.error("live-role-smoke: FAILED —", error)
  process.exit(1)
})