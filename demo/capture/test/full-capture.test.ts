/**
 * Deterministic full-capture tests (issue #30). Both Payment Incident
 * scenarios run end to end through real Pi role sessions with the
 * deterministic streaming provider double, starting from the seeded Signals
 * and Incident Trigger (never a frozen Evidence Set), against the real
 * Control Plane and PostgreSQL.
 *
 * These prove:
 * - Run 1 reaches verified-remediation and closes; Run 2 fails verification
 *   with no Release record, no permit, and no production Watch Report.
 * - Every applicable role executes through Pi with fresh, ordered, isolated
 *   sessions; both runs seal a complete capture manifest explicitly marked
 *   as a deterministic-provider development fixture.
 * - The exported bundles pass the saved-bundle verifier and replay offline.
 * - Tampering with agent records, config, receipts, role order, or terminal
 *   outcomes fails verification.
 * - A failed full capture is retained with partial artifacts and cannot be
 *   finalized as though it succeeded; the run respects the finite wall-clock
 *   budget.
 *
 * Requires local PostgreSQL (apps/control-plane/scripts/db.sh start).
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { bootstrap } from "@sih/control-plane/src/bootstrap.js"
import { loadConfig } from "@sih/control-plane/src/config.js"
import { contentHash } from "@sih/contracts/hashes"
import { verifySavedBundle } from "@sih/contracts/saved-bundle"
import type { ArtifactEnvelope, JournalEvent } from "@sih/contracts/types"

import { exportPartialRun, finalize, offlineAdapters, recordedFacts } from "../capture.ts"
import {
  DETECTOR_KEY,
  RULE_VERSION,
  SAVED_INCIDENT_1,
  SAVED_INCIDENT_2,
} from "../src/constants.js"
import { driveCapture, recordedReadAdapters } from "../src/driver.js"
import type { CaptureReport } from "../src/driver.js"
import { assembleIncident, buildManifest, stagingDir, verifyBundle } from "../src/export.js"
import type { ExportRunner } from "../src/export.js"
import { assemblePresentation, manifestIsPresentationEligible, missingRequiredRoles, presentFromStore } from "../src/presentation.js"
import type { StoredCaptureRecord } from "../src/dev-store.js"
import {
  appendCaptureRecord,
  listSelectionRecords,
  manifestConfigDigestOf,
  runReachedTerminalState,
  scenarioStreak,
  selectPresentationStreak,
} from "../src/dev-store.js"
import { seededCardJs } from "../src/worktree-seed.js"

const TEST_DATABASE_URL = "postgres://sih:sih@127.0.0.1:5433/sih_test_full_capture"

process.env.SIH_DATABASE_URL = TEST_DATABASE_URL
process.env.SIH_HMAC_SECRET = "test-hmac-secret"
process.env.SIH_BROKER_TOKEN = "test-broker-token"
process.env.SIH_OPERATOR_TOKEN = "test-operator-token"
process.env.SIH_LEASE_TTL_SECONDS = "7200"
process.env.SIH_PERMIT_TTL_SECONDS = "3600"
process.env.SIH_APPROVAL_TTL_SECONDS = "3600"
process.env.CP_PORT = "8080"

const BUDGETS = {
  model_turns: 20,
  non_terminal_tool_calls: 32,
  session_wall_clock_ms: 12 * 60_000,
  run_wall_clock_ms: 120 * 60_000,
}

async function resetDatabase(): Promise<void> {
  const runtime = await bootstrap(loadConfig())
  await runtime.store.reset()
  await runtime.store.close()
}

function alertFor(run: 1 | 2) {
  return {
    fingerprint: `payment-error-rate-${run}`,
    status: "firing",
    startsAt: new Date(Date.now() - 600_000).toISOString(),
    endsAt: null,
    labels: { detector_key: DETECTOR_KEY, service_name: "payment", rule_version: RULE_VERSION, severity: "critical" },
    annotations: { summary: "Payment failures exceed 20 percent" },
  }
}

function optionsFor(run: 1 | 2) {
  const facts = recordedFacts(run)
  const adapters = offlineAdapters(facts, run)
  return {
    facts,
    adapters,
    savedId: run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2,
  }
}

async function runCapture(
  run: 1 | 2,
  options: { onFailure?: (input: { incidentId: string; runId: string; cp: Awaited<ReturnType<typeof bootstrap>>["cp"] }) => Promise<void>; runWallClockMs?: number; watchWindowMs?: number; preAborted?: boolean; signal?: AbortSignal } = {},
): Promise<CaptureReport> {
  await resetDatabase()
  process.env.SIH_ARTIFACT_DIR = `/tmp/opencode/sih-test-artifacts-${run}`
  const { facts, adapters, savedId } = optionsFor(run)
  const preAborted = options.preAborted === true ? new AbortController() : undefined
  preAborted?.abort()
  const report = await driveCapture(
    {
      run,
      facts,
      alert: alertFor(run),
      offline: true,
      savedId,
      agents: "real",
      mode: "full-capture",
      agent: {
        provider: "deterministic",
        model: "deepseek-v4-flash",
        reasoning: "high",
        providerClass: "fixture",
        budgets: options.runWallClockMs === undefined ? BUDGETS : { ...BUDGETS, run_wall_clock_ms: options.runWallClockMs },
        perspectives: [
          { participantId: "p-1", order: 1, perspective: "code-level defect hunt: trace the failing charge path from the error text and the seeded diff" },
          { participantId: "p-2", order: 2, perspective: "system-level causation: weigh runtime telemetry, flagd state, and the pre-seed baseline" },
        ],
      },
      budgets: options.runWallClockMs === undefined ? BUDGETS : { ...BUDGETS, run_wall_clock_ms: options.runWallClockMs },
      agentSeedFiles: { "src/payment/card.js": seededCardJs(run === 1 ? "S1" : "S2") },
      readAdapters: recordedReadAdapters({
        errorRatio: facts.firingRatio,
        callsPerSecond: facts.firingCallsPerSecond,
        flagFailure: facts.paymentFailure,
        flagUnreachable: facts.paymentUnreachable,
      }),
      releaseAdapter: adapters.releaseAdapter,
      evidenceRunner: adapters.evidenceRunner,
      watchWindowMs: options.watchWindowMs ?? 5,
      onFailure: options.onFailure,
      signal: options.signal ?? preAborted?.signal,
    },
    loadConfig(),
  )
  return report
}

interface ExportedRun {
  files: Map<string, string>
  manifest: ReturnType<typeof buildManifest>
  verified: ReturnType<typeof verifyBundle>
  journalText: string
  artifacts: Map<string, ArtifactEnvelope>
  events: JournalEvent[]
}

async function exportBundle(run: 1 | 2, report: CaptureReport): Promise<ExportedRun> {
  const config = loadConfig()
  const runtime = await bootstrap(config)
  const cp = runtime.cp
  await cp.journal.ensureLoaded(report.incidentId)
  const runner: ExportRunner = {
    loadEvents: (incidentId) => cp.journal.events(incidentId),
    loadEnvelope: async (contentHash) => {
      const envelope = await cp.artifacts.get(contentHash)
      if (!envelope.ok) throw new Error(envelope.error.message)
      return envelope.value
    },
  }
  const savedId = run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
  const assembled = await assembleIncident(
    { capturedIncidentId: report.incidentId, savedId },
    { [report.incidentId]: savedId },
    runner,
  )
  const files = new Map(assembled.artifactFiles)
  files.set(`incidents/${savedId}/journal.jsonl`, assembled.journalText)
  const manifest = buildManifest({
    files,
    incidents: [{ incident_id: savedId, final_sequence: assembled.finalSequence }],
    captureTime: new Date().toISOString(),
  })
  files.set("manifest.json", manifest)
  const verified = verifyBundle(files, new Date().toISOString())
  await runtime.store.close()
  return {
    files,
    manifest,
    verified,
    journalText: assembled.journalText,
    artifacts: new Map(
      [...assembled.artifactFiles.keys()].map((path) => {
        const envelope = JSON.parse(files.get(path) ?? "") as ArtifactEnvelope
        return [envelope.content_hash, envelope]
      }),
    ),
    events: assembled.journalText
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JournalEvent),
  }
}

function artifactsOfType(exported: ExportedRun, schemaId: string): ArtifactEnvelope[] {
  return [...exported.artifacts.values()].filter(
    (envelope) => envelope.artifact_schema_id === schemaId,
  )
}

function captureManifestOf(exported: ExportedRun): {
  payload: {
    provider_class: string
    provider: string
    mode: string
    manifest_digest: string
    role_records: Array<{ role: string; agent_id: string; status: string; run_artifact_ref?: string }>
  }
} {
  const manifest = artifactsOfType(exported, "capture-manifest")[0]
  if (manifest === undefined) throw new Error("no capture manifest sealed")
  return manifest as never
}

function reManifest(files: Map<string, string>): Map<string, string> {
  const next = new Map(files)
  next.delete("manifest.json")
  const fileEntries: Record<string, { sha256: string; size: number }> = {}
  for (const path of [...next.keys()].sort()) {
    const bytes = next.get(path) ?? ""
    const encoded = new TextEncoder().encode(bytes)
    fileEntries[path] = { sha256: `sha256:${sha256Hex(encoded)}`, size: encoded.byteLength }
  }
  next.set(
    "manifest.json",
    JSON.stringify(
      {
        format_version: "1.0",
        capture_time: new Date().toISOString(),
        incident_ids: [{ incident_id: next.has("incidents/inc-demo-payment-1/journal.jsonl") ? "inc-demo-payment-1" : "inc-demo-payment-2", final_sequence: (() => {
          const journalPath = next.has("incidents/inc-demo-payment-1/journal.jsonl")
            ? "incidents/inc-demo-payment-1/journal.jsonl"
            : "incidents/inc-demo-payment-2/journal.jsonl"
          const lines = (next.get(journalPath) ?? "").split("\n").filter((line) => line.trim().length > 0)
          const last = JSON.parse(lines.at(-1) ?? "{}") as { sequence?: number }
          return last.sequence ?? 0
        })() }],
        files: fileEntries,
      },
      null,
      2,
    ),
  )
  return next
}

function sha256Hex(bytes: Uint8Array): string {
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest()
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

let runOne: CaptureReport
let runTwo: CaptureReport
let exportOne: ExportedRun
let exportTwo: ExportedRun

describe("deterministic full captures through Pi (issue #30)", () => {
  beforeAll(async () => {
    runOne = await runCapture(1, { watchWindowMs: 5 })
    exportOne = await exportBundle(1, runOne)
    runTwo = await runCapture(2, { watchWindowMs: 5 })
    exportTwo = await exportBundle(2, runTwo)
  })

  test("Run 1 reaches verified-remediation, closes, and passes the Release gate", () => {    expect(runOne.finalRunState).toBe("completed")
    expect(runOne.finalIncidentState).toBe("closed")
    expect(runOne.outcome).toBe("verified-remediation")
    expect(runOne.agents).toBe("real")
    expect(runOne.manifestSealed).toBe(true)
    expect(runOne.agentRunArtifacts).toBeGreaterThan(20)
    expect(runOne.gateVerdicts).toContain("hypothesis:pass")
    expect(runOne.gateVerdicts).toContain("release:pass")
    expect(runOne.stageRecords).toContain("watch:completed")
    expect(runOne.stageRecords).toContain("release:completed")
  })

  test("Run 2 reaches verification-failed with no Release, no permit, no production Watch", () => {
    expect(runTwo.finalRunState).toBe("failed")
    expect(runTwo.finalIncidentState).toBe("open")
    expect(runTwo.failureReason).toBe("verification-failed")
    expect(runTwo.outcome).toBeNull()
    expect(runTwo.agents).toBe("real")
    expect(runTwo.manifestSealed).toBe(true)
    expect(runTwo.gateVerdicts).toContain("hypothesis:pass")
    expect(runTwo.gateVerdicts).not.toContain("release")
    expect(runTwo.stageRecords).toContain("verify:failed")
    expect(runTwo.stageRecords).not.toContain("release:")
    expect(runTwo.stageRecords).not.toContain("watch:")
  })

  test("both exported bundles pass the saved-bundle verifier and replay offline", () => {
    expect(exportOne.verified.ok).toBe(true)
    expect(exportTwo.verified.ok).toBe(true)
    if (exportOne.verified.ok) {
      expect(exportOne.verified.value.incidents).toHaveLength(1)
    }
  })

  test("both runs start from the seeded Incident Trigger, not a frozen Evidence Set", () => {
    // Full captures mint a fresh trigger id and build the Evidence Set from
    // the recorded seeded rows; they never reuse a saved bundle's trigger.
    for (const [exported, run] of [[exportOne, 1], [exportTwo, 2]] as const) {
      const trigger = exported.events.find((event) => event.type === "trigger_received")
      expect(trigger).toBeDefined()
      if (trigger?.type !== "trigger_received") continue
      expect(trigger.trigger.trigger_id).toMatch(/^trig-demo-firing-/)
      expect(trigger.trigger.signal_summary.value).toBe(0.92)
    }
  })

  test("both runs seal a complete capture manifest marked as deterministic fixtures", () => {
    for (const [exported, run] of [[exportOne, 1], [exportTwo, 2]] as const) {
      const manifest = captureManifestOf(exported).payload
      expect(manifest.provider_class).toBe("fixture")
      expect(manifest.provider).toBe("deterministic")
      expect(manifest.mode).toBe("full-capture")
      expect(manifest.manifest_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
      const roles = new Set(manifest.role_records.map((record) => record.role))
      // Fusion participants, judge, and synthesizer always run; planner and
      // implementer run in Repair; reviews and tests in Verify; the
      // orchestrator runs as both scheduler and final report.
      expect(roles.has("participant")).toBe(true)
      expect(roles.has("judge")).toBe(true)
      expect(roles.has("synthesizer")).toBe(true)
      expect(roles.has("planner")).toBe(true)
      expect(roles.has("implementer")).toBe(true)
      expect(roles.has("review")).toBe(true)
      expect(roles.has("test")).toBe(true)
      expect(roles.has("orchestrator")).toBe(true)
      expect(manifest.role_records.every((record) => record.status === "succeeded")).toBe(true)
    }
  })

  test("role sessions are fresh and isolated with ordered, settled calls", () => {
    for (const exported of [exportOne, exportTwo]) {
      const runArtifacts = artifactsOfType(exported, "agent-run-artifact")
      expect(runArtifacts.length).toBeGreaterThan(20)
      const agentIds = runArtifacts.map((artifact) => (artifact.payload as { agent_id: string }).agent_id)
      expect(new Set(agentIds).size).toBe(agentIds.length)
      for (const artifact of runArtifacts) {
        const payload = artifact.payload as {
          status: string
          calls: Array<{ order: number; status: string; call_id: string }>
        }
        expect(payload.calls.map((call) => call.order)).toEqual(
          payload.calls.map((_, index) => index),
        )
        for (const call of payload.calls) {
          expect(["succeeded", "failed", "aborted"]).toContain(call.status)
        }
      }
    }
  })

  test("Run 1 seals Remediation, reviews, test reports, Release record, and Watch reports", () => {
    const schemas = new Set(exportOne.artifacts.values().map((envelope) => envelope.artifact_schema_id))
    expect(schemas.has("remediation-proposal")).toBe(true)
    expect(schemas.has("recovery-point")).toBe(true)
    expect(schemas.has("rollout-watch-plan")).toBe(true)
    expect(schemas.has("release-record")).toBe(true)
    expect(schemas.has("watch-report")).toBe(true)
    expect(schemas.has("verification-report")).toBe(true)
    expect(schemas.has("fusion-participant-output")).toBe(true)
    expect(schemas.has("fusion-judge-output")).toBe(true)
    expect(schemas.has("fusion-synthesizer-output")).toBe(true)
    expect(schemas.has("capture-manifest")).toBe(true)
    const reviews = artifactsOfType(exportOne, "review-report")
    const tests = artifactsOfType(exportOne, "test-report")
    expect(reviews.length).toBeGreaterThanOrEqual(5)
    expect(tests.length).toBeGreaterThanOrEqual(10)
  })

  test("Run 2 seals no Release record, no Watch plan, and no production Watch report", () => {
    const schemas = new Set(exportTwo.artifacts.values().map((envelope) => envelope.artifact_schema_id))
    expect(schemas.has("release-record")).toBe(false)
    expect(schemas.has("rollout-watch-plan")).toBe(false)
    expect(schemas.has("watch-report")).toBe(false)
    expect(schemas.has("remediation-proposal")).toBe(true)
    expect(schemas.has("verification-report")).toBe(true)
    expect(schemas.has("capture-manifest")).toBe(true)
  })

  test("tampering with agent records, config, receipts, role order, or terminal outcomes fails verification", () => {
    // 1. Reorder the capture-manifest role records: the manifest digest fails.
    const reordered = new Map(exportOne.files)
    const manifestHash = [...exportOne.artifacts.keys()].find((hash) => {
      const artifact = exportOne.artifacts.get(hash)
      return artifact?.artifact_schema_id === "capture-manifest"
    })
    expect(manifestHash).toBeDefined()
    const manifestPath = `artifacts/sha256/${manifestHash!.slice("sha256:".length)}.json`
    const manifestEnvelope = JSON.parse(reordered.get(manifestPath)!) as {
      payload: { role_records: unknown[] }
    }
    manifestEnvelope.payload.role_records = [...manifestEnvelope.payload.role_records].reverse()
    reordered.set(manifestPath, JSON.stringify(manifestEnvelope))
    const reorderedVerified = verifyBundle(reManifest(reordered), new Date().toISOString())
    expect(reorderedVerified.ok).toBe(false)

    // 2. Change the manifest provider: digest fails.
    const configChanged = new Map(exportOne.files)
    const configEnvelope = JSON.parse(configChanged.get(manifestPath)!) as { payload: Record<string, unknown> }
    configEnvelope.payload.provider = "opencode-go"
    configChanged.set(manifestPath, JSON.stringify(configEnvelope))
    expect(verifyBundle(reManifest(configChanged), new Date().toISOString()).ok).toBe(false)

    // 3. Tamper a recorded receipt event: the journal hash fails.
    const receiptTampered = new Map(exportOne.files)
    const journalPath = "incidents/inc-demo-payment-1/journal.jsonl"
    const lines = (receiptTampered.get(journalPath) ?? "").split("\n").filter((line) => line.trim().length > 0)
    const index = lines.findIndex((line) => line.includes('"broker_receipt_recorded"'))
    expect(index).toBeGreaterThan(-1)
    const event = JSON.parse(lines[index]!) as { receipt: { result?: unknown } }
    if (event.receipt.result !== undefined) {
      ;(event.receipt.result as Record<string, unknown>).ratio = 0.99
    } else {
      event.receipt = { ...event.receipt, outcome: "fail" }
    }
    lines[index] = JSON.stringify(event)
    receiptTampered.set(journalPath, `${lines.join("\n")}\n`)
    // No re-manifest: the file bytes no longer match the manifest hash.
    expect(verifyBundle(receiptTampered, new Date().toISOString()).ok).toBe(false)

    // 4. Flip Run 2's terminal outcome to completed and re-manifest: the
    //    illegal run transition fails.
    const outcomeChanged = new Map(exportTwo.files)
    const runTwoJournal = "incidents/inc-demo-payment-2/journal.jsonl"
    const runTwoLines = (outcomeChanged.get(runTwoJournal) ?? "").split("\n").filter((line) => line.trim().length > 0)
    const changed = runTwoLines.map((line) => {
      const event = JSON.parse(line) as JournalEvent
      if (event.type === "run_transition" && event.to === "failed" && event.run_id === "run-1") {
        return JSON.stringify({ ...event, to: "completed" })
      }
      return line
    })
    outcomeChanged.set(runTwoJournal, `${changed.join("\n")}\n`)
    const outcomeVerified = verifyBundle(reManifest(outcomeChanged), new Date().toISOString())
    expect(outcomeVerified.ok).toBe(false)
    if (!outcomeVerified.ok) {
      expect(outcomeVerified.error.some((error) => error.code === "MALFORMED_CONTRACT" || error.code === "ILLEGAL_TRANSITION")).toBe(true)
    }
  })

  test("a failed full capture is retained with partial artifacts and cannot be finalized", async () => {
    // Abort only after the run is provably running (four journal events:
    // trigger, open, queued, running), so the incident always exists when the
    // failure hook snapshots the partial artifacts. The poll reads the
    // journal table directly (the journal service cache would go stale).
    await rm(stagingDir(1), { recursive: true, force: true })
    const controller = new AbortController()
    const abortOnceRunning = (async () => {
      const runtime = await bootstrap(loadConfig())
      try {
        for (let i = 0; i < 2000; i += 1) {
          if (controller.signal.aborted) return
          let count = 0
          try {
            const incidents = await runtime.cp.store.listIncidentIndex()
            if (incidents.length > 0) {
              count = (await runtime.cp.store.loadJournal(incidents[0]?.incident_id ?? "")).length
            }
          } catch {
            count = 0
          }
          if (count >= 4) {
            controller.abort()
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        controller.abort()
      } finally {
        await runtime.store.close()
      }
    })()
    await expect(
      runCapture(1, {
        signal: controller.signal,
        onFailure: async ({ incidentId, cp }) => {
          await exportPartialRun(1, SAVED_INCIDENT_1, incidentId, cp, "full-capture", true)
        },
      }),
    ).rejects.toThrow()
    await abortOnceRunning
    // exportPartialRun wrote the partial snapshot into the staging dir with a
    // capture record that is explicitly not a completed full capture.
    const record = JSON.parse(
      await Bun.file(join(stagingDir(1), "capture.json")).text(),
    ) as { manifestSealed: boolean; agents: string; mode: string; failureReason: string }
    expect(record.manifestSealed).toBe(false)
    expect(record.agents).toBe("real")
    expect(record.mode).toBe("full-capture")
    expect(record.failureReason).toMatch(/partial|failed/i)
    await expect(finalize()).rejects.toThrow(/not a completed real full-capture/)
  })

  test("the full Incident Run respects the finite wall-clock budget", async () => {
    // A run with an already-aborted run signal fails closed at the first
    // budget guard with the wall-clock reason.
    await expect(runCapture(2, { preAborted: true })).rejects.toThrow(/wall-clock budget exhausted/)
  })
})

/**
 * Presentation selection and freeze (issue #31), exercised against the same
 * deterministic full captures sealed above. The exported bundles are copied
 * into a redirected append-only dev store, eligible records are written for
 * both scenarios, and the selection layer proves:
 * - a record whose bundle manifest is a deterministic fixture is rejected
 *   even though its record fields and bundle otherwise verify (fixture
 *   misclassification).
 * - a sealed manifest missing a required succeeded role is rejected.
 * - an unexpected terminal outcome is never selected.
 * - a fixture never forms a scenario streak even with valid outcomes.
 * - presentFromStore records selection provenance back into the dev store on
 *   a successful selection and never deletes or rewrites retained runs.
 */
describe("presentation selection and freeze (issue #31)", () => {
  let tempRoot: string
  let outRoot: string
  let run1Path: string
  let run2Path: string
  let digest1: string
  let digest2: string

  function recordFor(
    run: 1 | 2,
    capturedAt: string,
    runPath: string,
    digest: string,
    provider = "opencode",
  ): StoredCaptureRecord {
    return {
      version: 1,
      run,
      scenario: run === 1 ? "S1" : "S2",
      agents: "real",
      mode: "full-capture",
      provider,
      model: "deepseek-v4-flash",
      reasoning: "high",
      capturedAt,
      savedId: run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2,
      incidentId: `inc-${run}`,
      finalSequence: 21,
      finalRunState: run === 1 ? "completed" : "failed",
      outcome: run === 1 ? "verified-remediation" : null,
      candidateHash: null,
      manifestSealed: true,
      manifestDigest: `sha256:${String(run).repeat(64)}`,
      agentRunArtifacts: 24,
      configDigest: digest,
      runPath,
      status: "completed",
      failureReason: run === 2 ? "verification-failed" : null,
    }
  }

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "sih-presentation-"))
    outRoot = join(tempRoot, "saved-runs")
    process.env.SIH_DEV_STORE_ROOT = tempRoot
    run1Path = "runs/run-1-bundle"
    run2Path = "runs/run-2-bundle"
    for (const [dir, exported] of [[run1Path, exportOne], [run2Path, exportTwo]] as const) {
      for (const [relative, bytes] of exported.files) {
        const target = join(tempRoot, dir, relative)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes, "utf8")
      }
    }
    const manifest1 = captureManifestOf(exportOne).payload
    const manifest2 = captureManifestOf(exportTwo).payload
    digest1 = manifestConfigDigestOf(manifest1 as never)
    digest2 = manifestConfigDigestOf(manifest2 as never)
  })

  test("a fixture bundle is rejected even when its record and bundle verify (fixture misclassification)", async () => {
    // exportOne is a deterministic-provider development fixture: its sealed
    // manifest records provider_class fixture. A forged record that claims a
    // real provider must still be rejected from presentation finalization.
    expect(captureManifestOf(exportOne).payload.provider_class).toBe("fixture")
    expect(runReachedTerminalState(recordFor(1, "2026-08-19T11:00:00.000Z", run1Path, digest1))).toBe(true)
    const files = await readBundleDir(join(tempRoot, run1Path))
    expect(manifestIsPresentationEligible(files)).toMatch(/not real|fixture/)
    await expect(
      assemblePresentation([recordFor(1, "2026-08-19T11:00:00.000Z", run1Path, digest1)], outRoot),
    ).rejects.toThrow(/not a real full capture/)
  })

  test("a sealed manifest missing a required succeeded role is rejected", async () => {
    // Drop the judge role record from a copy of the run-2 bundle; the
    // required-role check must refuse before bundle verification.
    const files = new Map(exportTwo.files)
    const manifestHash = [...exportTwo.artifacts.keys()].find((hash) => {
      const artifact = exportTwo.artifacts.get(hash)
      return artifact?.artifact_schema_id === "capture-manifest"
    })
    expect(manifestHash).toBeDefined()
    const manifestPath = `artifacts/sha256/${manifestHash!.slice("sha256:".length)}.json`
    const envelope = JSON.parse(files.get(manifestPath)!) as {
      payload: { role_records: Array<{ role: string }> }
    }
    envelope.payload.role_records = envelope.payload.role_records.filter((record) => record.role !== "judge")
    files.set(manifestPath, JSON.stringify(envelope))
    expect(missingRequiredRoles(files)).toContain("judge>=1")
  })

  test("an unexpected terminal outcome is never selected", () => {
    // Run 2 completed is not its expected verification-failed outcome.
    const unexpected = { ...recordFor(2, "2026-08-19T11:20:00.000Z", run2Path, digest2), finalRunState: "completed", outcome: "verified-remediation", failureReason: null }
    expect(runReachedTerminalState(unexpected)).toBe(false)
    expect(selectPresentationStreak([...Array.from({ length: 3 }, (_, index) => recordFor(1, `2026-08-19T09:0${index}:00.000Z`, run1Path, digest1)), unexpected, recordFor(2, "2026-08-19T09:05:00.000Z", run2Path, digest2)])).toBeNull()
  })

  test("a deterministic fixture never forms a scenario streak even with valid outcomes", () => {
    const fixtures = [0, 1, 2].map((index) =>
      recordFor(1, `2026-08-19T12:0${index}:00.000Z`, run1Path, digest1, "deterministic"),
    )
    const streak = scenarioStreak(fixtures, 1)
    expect(streak.selectable).toBe(false)
    expect(streak.records).toHaveLength(0)
  })

  test("a rejected presentation never records provenance or touches retained runs", async () => {
    // The retained bundles are deterministic fixtures; forged records that
    // claim a real provider select, but the fixture manifests refuse the
    // presentation and no provenance is recorded.
    for (let index = 0; index < 3; index += 1) {
      await appendCaptureRecord(recordFor(1, `2026-08-19T13:0${index}:00.000Z`, run1Path, digest1))
      await appendCaptureRecord(recordFor(2, `2026-08-19T13:0${index + 3}:00.000Z`, run2Path, digest2))
    }
    const before = await readBundleDir(join(tempRoot, run1Path))
    await expect(presentFromStore(outRoot)).rejects.toThrow(/not a real full capture/)
    const selections = await listSelectionRecords()
    expect(selections).toHaveLength(0)
    const after = await readBundleDir(join(tempRoot, run1Path))
    expect(after).toEqual(before)
  })
})

async function readStoreRecords(): Promise<StoredCaptureRecord[]> {
  const { listCaptureRecords } = await import("../src/dev-store.js")
  return listCaptureRecords()
}

async function readBundleDir(dir: string): Promise<Map<string, string>> {
  const { readdir, readFile } = await import("node:fs/promises")
  const files = new Map<string, string>()
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), relative)
      } else {
        files.set(relative, await readFile(join(current, entry.name), "utf8"))
      }
    }
  }
  await walk(dir, "")
  return files
}
