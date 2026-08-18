/**
 * Capture CLI for the two saved Demo Runs (issue #19).
 *
 *   bun run demo/capture/capture.ts run --run 1|2    full capture + export
 *   bun run demo/capture/capture.ts export --run 1|2 export the captured run
 *   bun run demo/capture/capture.ts finalize         assemble + verify the bundle
 *   bun run demo/capture/capture.ts verify           re-verify demo/saved-runs
 *   bun run demo/capture/capture.ts store            list the dev store
 *   bun run demo/capture/capture.ts present          assemble the presentation
 *
 * Real-agent captures (issue #23): `--agents=real` drives Pi role sessions
 * through the Model Gateway for Fusion, repair, review, test, and
 * orchestrator roles; `--mode=rehearsal|full` marks the run; every real
 * capture appends to the dev store, and `present` requires three consecutive
 * full-capture real runs under one unchanged configuration digest.
 *
 * The capture drives the real reduced Compose profile (payment:seeded image,
 * pinned rule, charge driver) to source the real firing numbers, then drives
 * the real Control Plane + Worker end to end. See README.md.
 */
import { mkdir, readdir, rm, writeFile, readFile, cp } from "node:fs/promises"
import { join } from "node:path"

import { bootstrap } from "@sih/control-plane/src/bootstrap.js"
import { loadConfig } from "@sih/control-plane/src/config.js"

import {
  applySourceState,
  candidateImageFor,
  createEvidenceRunner,
  createReleaseAdapter,
  demoRepoExists,
  liveLogLine,
  runSeededT3,
  runShell,
  seededImageFor,
} from "./src/adapters.js"
import {
  PINNED_COMMIT,
  PORTS,
  SAVED_INCIDENT_1,
  SAVED_INCIDENT_2,
} from "./src/constants.js"
import {
  DEV_STORE_FILE,
  DEV_STORE_ROOT,
  appendCaptureRecord,
  configDigestOf,
  listCaptureRecords,
} from "./src/dev-store.js"
import { driveCapture, driverLogPath, liveReadAdapters } from "./src/driver.js"
import type { CaptureReport, RealCaptureAgent } from "./src/driver.js"
import { assembleIncident, buildManifest, listBundle, savedRunsRoot, stagingDir, verifyBundle, writeBundle } from "./src/export.js"
import type { ExportRunner } from "./src/export.js"
import { assemblePresentation, presentFromStore } from "./src/presentation.js"
import type { CaptureFacts } from "./src/payloads.js"
import { seededCardJs } from "./src/worktree-seed.js"
import * as shop from "./src/shop.js"
import { hashOf } from "./src/receipts.js"

const REPO_ROOT = new URL("../..", import.meta.url).pathname
const DB_SCRIPT = join(REPO_ROOT, "apps/control-plane/scripts/db.sh")
const COMPOSE_FILE = join(REPO_ROOT, "demo/compose/docker-compose.reduced.yaml")
const DB_INIT = join(REPO_ROOT, "apps/control-plane/db/init.sql")

/** Reset the Control Plane schema. `db.sh reset` has a quoting bug through the
 * sg wrapper; this applies the same drop-and-recreate with correct quoting. */
async function resetDatabase(): Promise<void> {
  await runShell(`bash ${DB_SCRIPT} start`)
  await runShell(
    `sg docker -c "docker exec sih-control-plane-pg psql -U sih -d sih_control_plane -c \\"DROP SCHEMA public CASCADE; CREATE SCHEMA public;\\""`,
  )
  await runShell(
    `sg docker -c "docker exec -i sih-control-plane-pg psql -U sih -d sih_control_plane" < ${DB_INIT}`,
  )
  await runShell(`sg docker -c "docker exec sih-control-plane-pg createdb -U sih sih_test_state" 2>/dev/null || true`)
  await runShell(`sg docker -c "docker exec sih-control-plane-pg createdb -U sih sih_test_leases" 2>/dev/null || true`)
  console.log(`[capture] control plane database reset`)
}

async function composeUp(image: string, demoRepo: string): Promise<void> {
  await runShell(
    `OTEL_DEMO_ROOT=${demoRepo} PAYMENT_IMAGE=${image} sg docker -c "docker compose -f ${COMPOSE_FILE} up -d flagd otel-collector prometheus alertmanager payment"`,
  )
}

async function composeDown(): Promise<void> {
  await runShell(`sg docker -c "docker compose -f ${COMPOSE_FILE} down"`).catch(() => undefined)
  await shop.docker(["rm", "-f", "payment-candidate"]).catch(() => undefined)
}

async function startDriver(run: 1 | 2, port: number, rps: number): Promise<void> {
  const child = shop.startTrafficDriver(port, rps, driverLogPath(run))
  await new Promise((resolve) => setTimeout(resolve, 3000))
  if (child.exitCode !== null) {
    throw new Error("traffic driver exited immediately")
  }
}

async function stopDriver(): Promise<void> {
  await runShell("pkill -f 'scripts/traffic.ts' || true").catch(() => undefined)
}

interface ShopFacts {
  facts: CaptureFacts
  alert: shop.LiveAlert
}

/** Run the real shop phases for one capture and record the real rows. */
async function collectShopFacts(run: 1 | 2, demoRepo: string, skipBaseline: boolean): Promise<ShopFacts> {
  const seededImage = seededImageFor(run)
  const baselineImage = "payment:demo-baseline"

  console.log(`[shop] resetting the demo repo to the pinned commit`)
  await applySourceState(demoRepo, "overlay")
  await runShell(
    `cd ${demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile -t ${baselineImage} ."`,
  )

  let baselineRatio = 0
  let baselineCallsPerSecond = 0
  let baselineImageId = "baseline-digest"
  if (!skipBaseline) {
    console.log(`[shop] baseline phase: healthy image + driver traffic`)
    await composeDown()
    await composeUp(baselineImage, demoRepo)
    await startDriver(run, PORTS.livePayment, 2)
    console.log(`[shop] recording the baseline window (120s)`)
    await new Promise((resolve) => setTimeout(resolve, 120_000))
    baselineRatio = (await shop.liveErrorRatio()) ?? 0
    baselineCallsPerSecond = (await shop.liveCallsPerSecond()) ?? 0
    baselineImageId = await shop.paymentContainerImageId("payment")
    console.log(`[shop] baseline ratio=${baselineRatio.toFixed(3)} calls/s=${baselineCallsPerSecond.toFixed(2)} image=${baselineImageId}`)
    await stopDriver()
  }

  // Seed and rebuild the live payment image.
  console.log(`[shop] seeding (${run === 1 ? "S1" : "S2"}) and rebuilding the live payment image`)
  await applySourceState(demoRepo, run === 1 ? "s1" : "s2")
  await runShell(
    `cd ${demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile -t ${seededImage} ."`,
  )
  const seededT3 = await runSeededT3(demoRepo, run)
  console.log(`[shop] seeded T3 prediction run: ${seededT3.passed ? "pass" : "fail (expected)"}`)

  await composeDown()
  await composeUp(seededImage, demoRepo)
  const seedAppliedAt = new Date().toISOString()
  await startDriver(run, PORTS.livePayment, 2)

  console.log(`[shop] waiting for the pinned rule to fire (up to 10 minutes)`)
  const alert = await shop.pollAlert("firing", 600_000)
  if (alert === null) {
    throw new Error("the pinned rule never fired; check ruler freshness and the traffic floor")
  }
  const firingRatio = (await shop.liveErrorRatio()) ?? 0
  const firingCallsPerSecond = (await shop.liveCallsPerSecond()) ?? 0
  const seededImageId = await shop.paymentContainerImageId("payment")
  const logLine = (await liveLogLine()) ?? "Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted."
  const flagFailure = await shop.flagdValue("paymentFailure", demoRepo)
  const flagUnreachable = await shop.flagdValue("paymentUnreachable", demoRepo)
  console.log(
    `[shop] fired: ratio=${firingRatio.toFixed(3)} calls/s=${firingCallsPerSecond.toFixed(2)} fingerprint=${alert.fingerprint} image=${seededImageId}`,
  )
  console.log(`[shop] log line: ${logLine.slice(0, 110)}`)
  console.log(`[shop] flagd paymentFailure=${String(flagFailure.value)} paymentUnreachable=${String(flagUnreachable.value)}`)

  // Candidate source state for the Verify builds.
  await applySourceState(demoRepo, run === 1 ? "s1-fixed" : "s2-fixed")
  console.log(`[shop] candidate source state applied (${run === 1 ? "S1 + fix" : "S2 + fix"})`)

  const facts: CaptureFacts = {
    seed: run === 1 ? "S1" : "S2",
    firingRatio,
    firingCallsPerSecond,
    baselineRatio,
    baselineCallsPerSecond,
    seededImageId,
    baselineImageId,
    windowStart: alert.startsAt,
    seedAppliedAt,
    logLine,
    traceId: null,
    spanId: null,
    paymentFailure: flagFailure.value === "off" || flagFailure.value === null ? 0 : Number(flagFailure.value),
    paymentUnreachable: Boolean(flagUnreachable.value ?? false),
    seededT3: { passed: seededT3.passed, output: seededT3.output },
    seedDiffHash: hashOf({ seed: run === 1 ? "S1" : "S2", file: "src/payment/card.js" }),
  }
  return { facts, alert }
}

/** Export one captured incident into the staging directory. */
async function exportRun(run: 1 | 2, savedId: string): Promise<void> {
  const recordPath = join(stagingDir(run), "capture.json")
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    capturedIncidentId: string
    savedId: string
  }
  const runtime = await bootstrap(loadConfig())
  const cp = runtime.cp
  await cp.journal.ensureLoaded(record.capturedIncidentId)
  const runner: ExportRunner = {
    loadEvents: (incidentId) => cp.journal.events(incidentId),
    loadEnvelope: async (contentHash) => {
      const envelope = await cp.artifacts.get(contentHash)
      if (!envelope.ok) throw new Error(envelope.error.message)
      return envelope.value
    },
  }
  const remap: Record<string, string> = { [record.capturedIncidentId]: savedId }
  const assembled = await assembleIncident(
    { capturedIncidentId: record.capturedIncidentId, savedId },
    remap,
    runner,
  )
  await rm(stagingDir(run), { recursive: true, force: true })
  await mkdir(join(stagingDir(run), "incidents", savedId), { recursive: true })
  await writeFile(join(stagingDir(run), "incidents", savedId, "journal.jsonl"), assembled.journalText, "utf8")
  for (const [path, bytes] of assembled.artifactFiles) {
    await mkdir(join(stagingDir(run), path, ".."), { recursive: true })
    await writeFile(join(stagingDir(run), path), bytes, "utf8")
  }
  await writeFile(
    recordPath,
    JSON.stringify(
      { ...record, savedId, finalSequence: assembled.finalSequence, exportedAt: new Date().toISOString() },
      null,
      2,
    ),
    "utf8",
  )
  await runtime.store.close()
  console.log(`[export] run ${run} -> ${stagingDir(run)} (${assembled.artifactFiles.size} artifacts, final sequence ${assembled.finalSequence})`)
}

/** Combine both staging dirs into demo/saved-runs and verify strictly. */
async function finalize(): Promise<void> {
  const staging1 = stagingDir(1)
  const staging2 = stagingDir(2)
  const files = new Map<string, string>()
  const incidents: Array<{ incident_id: string; final_sequence: number }> = []
  const captureTime = new Date().toISOString()

  for (const [run, dir] of [[1, staging1], [2, staging2]] as const) {
    const recordPath = join(dir, "capture.json")
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      savedId: string
      finalSequence: number
    }
    const savedId = run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
    const walk = async (current: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(join(current, entry.name), relative)
        } else if (relative !== "capture.json") {
          files.set(relative, await readFile(join(current, entry.name), "utf8"))
        }
      }
    }
    await walk(dir, "")
    incidents.push({ incident_id: savedId, final_sequence: record.finalSequence })
  }

  const manifest = buildManifest({ files, incidents, captureTime })
  files.set("manifest.json", manifest)

  const verified = verifyBundle(files, captureTime)
  if (!verified.ok) {
    console.error("bundle verification failed:")
    for (const error of verified.error) {
      console.error(`  ${error.code}: ${error.message}${error.path !== undefined ? ` @ ${error.path}` : ""}`)
    }
    process.exit(1)
  }
  await writeBundle(files, savedRunsRoot())
  const listing = await listBundle(savedRunsRoot())
  console.log(`[finalize] demo/saved-runs verified and written (${listing.length} files)`)

  // Print the integrity summary.
  const verification = verified.value
  console.log(`[finalize] manifest format=${verification.manifest.format_version} capture_time=${verification.manifest.capture_time}`)
  for (const incident of verification.incidents) {
    console.log(`[finalize]   ${incident.incidentId}: ${incident.events.length} events, final sequence ${incident.finalSequence}`)
  }
  console.log(`[finalize]   artifacts: ${verification.artifacts.size} sealed envelopes`)
}

async function verifyOnly(): Promise<void> {
  const files = new Map<string, string>()
  const root = savedRunsRoot()
  const manifestText = await readFile(join(root, "manifest.json"), "utf8")
  files.set("manifest.json", manifestText)
  const manifest = JSON.parse(manifestText) as { files: Record<string, unknown> }
  for (const path of Object.keys(manifest.files)) {
    files.set(path, await readFile(join(root, path), "utf8"))
  }
  const verified = verifyBundle(files, new Date().toISOString())
  if (!verified.ok) {
    console.error("bundle verification failed:")
    for (const error of verified.error) {
      console.error(`  ${error.code}: ${error.message}${error.path !== undefined ? ` @ ${error.path}` : ""}`)
    }
    process.exit(1)
  }
  console.log(`[verify] demo/saved-runs passes all integrity checks (${verified.value.incidents.length} incidents, ${verified.value.artifacts.size} artifacts)`)
}

async function captureRun(run: 1 | 2, options: {
  demoRepo: string
  skipBaseline: boolean
  offline: boolean
  agents: "fixture" | "real"
  mode: "rehearsal" | "full-capture"
  provider: string
  model: string
  reasoning: string
}): Promise<void> {
  // Long-running phases; leases and permits must not expire mid-stage.
  process.env.SIH_LEASE_TTL_SECONDS = "7200"
  process.env.SIH_PERMIT_TTL_SECONDS = "3600"
  process.env.SIH_APPROVAL_TTL_SECONDS = "3600"
  process.env.SIH_ARTIFACT_DIR = `/tmp/opencode/sih-artifacts-${run}`
  process.env.CP_PORT = "8080"

  const savedId = run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2

  console.log(`[capture] run ${run}: resetting the Control Plane database`)
  await resetDatabase()

  let facts: CaptureFacts
  let alert: shop.LiveAlert
  let adapters: { releaseAdapter: ReleaseAdapterLike; evidenceRunner: EvidenceRunnerLike }

  if (options.offline) {
    // Recorded trigger shape (the documented fallback): deterministic rows,
    // no docker. Every value is a recorded row the export replays.
    facts = recordedFacts(run)
    alert = {
      fingerprint: `payment-error-rate-${run}`,
      status: "firing",
      startsAt: new Date(Date.now() - 600_000).toISOString(),
      endsAt: null,
      labels: { detector_key: "payment-error-rate", service_name: "payment", rule_version: "1", severity: "critical" },
      annotations: { summary: "Payment failures exceed 20 percent" },
    }
    adapters = offlineAdapters(facts, run)
  } else {
    const demoRepo = options.demoRepo
    if (!demoRepoExists(demoRepo)) {
      throw new Error(`demo repo missing at ${demoRepo}; clone open-telemetry/opentelemetry-demo at ${PINNED_COMMIT} first (see README.md)`)
    }
    const collected = await collectShopFacts(run, demoRepo, options.skipBaseline)
    facts = collected.facts
    alert = collected.alert
    adapters = {
      releaseAdapter: createReleaseAdapter({
        demoRepo,
        composeFile: COMPOSE_FILE,
        seededImage: seededImageFor(run),
        candidateImage: candidateImageFor(run),
        run,
      }),
      evidenceRunner: createEvidenceRunner({
        demoRepo,
        composeFile: COMPOSE_FILE,
        seededImage: seededImageFor(run),
        candidateImage: candidateImageFor(run),
        run,
      }),
    }
  }

  // Real-agent runs derive the implementer's base files from the demo repo
  // when present, and fall back to the recorded seeded state offline.
  const agentSeedFiles: Record<string, string> = {}
  if (options.agents === "real") {
    if (options.offline) {
      agentSeedFiles["src/payment/card.js"] = seededCardJs(run === 1 ? "S1" : "S2")
    } else {
      const demoRepo = options.demoRepo
      if (!demoRepoExists(demoRepo)) {
        throw new Error(`demo repo missing at ${demoRepo}; real-agent implementer needs the seeded sources`)
      }
      agentSeedFiles["src/payment/card.js"] = await readFile(
        join(demoRepo, "src/payment/card.js"),
        "utf8",
      )
    }
  }

  const config = loadConfig()
  const report: CaptureReport = await driveCapture(
    {
      run,
      facts,
      alert,
      offline: options.offline,
      savedId,
      agents: options.agents,
      mode: options.mode,
      agent:
        options.agents === "real"
          ? {
              provider: options.provider,
              model: options.model,
              reasoning: options.reasoning as RealCaptureAgent["reasoning"],
              perspectives: [
                { participantId: "p-1", order: 1, perspective: "code-level defect hunt: trace the failing charge path from the error text and the seeded diff" },
                { participantId: "p-2", order: 2, perspective: "system-level causation: weigh runtime telemetry, flagd state, and the pre-seed baseline" },
              ],
            }
          : undefined,
      agentSeedFiles,
      readAdapters: liveReadAdapters({
        errorRatio: facts.firingRatio,
        callsPerSecond: facts.firingCallsPerSecond,
        flagFailure: facts.paymentFailure,
        flagUnreachable: facts.paymentUnreachable,
      }),
      releaseAdapter: adapters.releaseAdapter,
      evidenceRunner: adapters.evidenceRunner,
    },
    config,
  )

  console.log(`[capture] run ${run} terminal state: run=${report.finalRunState} incident=${report.finalIncidentState} outcome=${report.outcome ?? report.failureReason}`)
  console.log(`[capture] gates: ${report.gateVerdicts.join(", ")}`)
  console.log(`[capture] stages: ${report.stageRecords.join(" -> ")}`)
  console.log(`[capture] final sequence: ${report.finalSequence}`)
  console.log(`[capture] agents: ${report.agents} manifestSealed: ${report.manifestSealed}`)

  await mkdir(stagingDir(run), { recursive: true })
  await writeFile(
    join(stagingDir(run), "capture.json"),
    JSON.stringify(
      {
        run,
        savedId,
        capturedIncidentId: report.incidentId,
        finalSequence: report.finalSequence,
        outcome: report.outcome,
        failureReason: report.failureReason,
        candidateHash: report.candidateHash,
        offline: options.offline,
        agents: report.agents,
        mode: options.mode,
        manifestSealed: report.manifestSealed,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  )

  // Real captures append to the dev store; fixture runs never enter it.
  if (report.agents === "real") {
    const capturedAt = new Date().toISOString()
    const runPath = join("runs", `${capturedAt.replace(/[:.]/g, "-")}-${savedId}`)
    await mkdir(join(DEV_STORE_ROOT, runPath), { recursive: true })
    await cp(stagingDir(run), join(DEV_STORE_ROOT, runPath), { recursive: true })
    await appendCaptureRecord({
      version: 1,
      run,
      scenario: run === 1 ? "S1" : "S2",
      agents: "real",
      mode: options.mode,
      provider: options.provider,
      model: options.model,
      reasoning: options.reasoning,
      capturedAt,
      savedId,
      incidentId: report.incidentId,
      finalSequence: report.finalSequence,
      finalRunState: report.finalRunState,
      outcome: report.outcome,
      candidateHash: report.candidateHash,
      manifestSealed: report.manifestSealed,
      configDigest: configDigestOf({
        run,
        scenario: run === 1 ? "S1" : "S2",
        agents: "real",
        mode: options.mode,
        provider: options.provider,
        model: options.model,
        reasoning: options.reasoning,
      }),
      runPath,
    })
    console.log(`[capture] dev store: appended ${savedId} (${options.mode})`)
  }

  if (!options.offline) {
    await stopDriver()
  }

  await exportRun(run, savedId)
  try {
    await finalize()
  } catch (error) {
    console.log(`[capture] finalize skipped: ${(error as Error).message}`)
  }

  if (!options.offline) {
    await composeDown()
    await applySourceState(options.demoRepo, "overlay")
    console.log(`[capture] run ${run} complete; shop reset to the overlay state`)
  }
}

import type { ReleaseAdapter, EvidenceRunner } from "./src/driver.js"

type ReleaseAdapterLike = ReleaseAdapter
type EvidenceRunnerLike = EvidenceRunner

function recordedFacts(run: 1 | 2): CaptureFacts {
  return {
    seed: run === 1 ? "S1" : "S2",
    firingRatio: 0.92,
    firingCallsPerSecond: 0.6,
    baselineRatio: 0.003,
    baselineCallsPerSecond: 0.6,
    seededImageId: run === 1 ? "seeded-digest" : "seeded-s2-digest",
    baselineImageId: "pristine-digest",
    windowStart: new Date(Date.now() - 900_000).toISOString(),
    seedAppliedAt: new Date(Date.now() - 900_000).toISOString(),
    logLine: "Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted.",
    traceId: null,
    spanId: null,
    paymentFailure: 0,
    paymentUnreachable: false,
    seededT3: { passed: false, output: "valid Visa accepted fails: card-type clause inverted (recorded)" },
    seedDiffHash: hashOf({ seed: run === 1 ? "S1" : "S2", file: "src/payment/card.js" }),
  }
}

function offlineAdapters(facts: CaptureFacts, run: 1 | 2): { releaseAdapter: ReleaseAdapterLike; evidenceRunner: EvidenceRunnerLike } {
  const releaseAdapter: ReleaseAdapterLike = {
    async startCandidate() {
      return { imageId: "candidate-digest" }
    },
    async stopCandidate() {},
    async swapLiveService() {
      return { actualVersion: "candidate-digest" }
    },
    async restoreDrill() {
      return { restored: true, output: "restored seeded service in isolated env (recorded)" }
    },
    async liveImageId() {
      return facts.seededImageId
    },
    async candidateImageId() {
      return "candidate-digest"
    },
  }
  const evidenceRunner: EvidenceRunnerLike = {
    async buildCandidateImage() {
      return { imageId: "candidate-digest", buildOutput: "recorded build" }
    },
    async runT3() {
      return { passed: true, output: "card.unit.test.js: pass (recorded)" }
    },
    async runT5() {
      return run === 1
        ? { passed: true, output: "payment.regression.test.js: pass (recorded)", failedCase: null }
        : { passed: false, output: "payment.regression.test.js: fail (recorded)", failedCase: "Luhn-failing Visa is rejected" }
    },
    async probeCandidate(count) {
      return { total: count, ok: count, err: 0, target: "127.0.0.1:50052", card: "4432801561520454", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }
    },
    async rehearseWatch() {
      return { g2: 0.01, g3: 0.08, g4: 1, calls: 60 }
    },
  }
  return { releaseAdapter, evidenceRunner }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const flagValue = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const demoRepo = flagValue("--demo-repo") ?? process.env.OTEL_DEMO_ROOT ?? "/tmp/opencode/demo-repo"

  if (command === "run") {
    const run = Number(flagValue("--run") ?? "0")
    if (run !== 1 && run !== 2) {
      console.error("usage: capture.ts run --run 1|2 [--demo-repo path] [--skip-baseline] [--offline] [--agents fixture|real] [--mode rehearsal|full] [--provider slug] [--model id] [--reasoning minimal|low|medium|high|xhigh]")
      process.exit(2)
    }
    const agents = (flagValue("--agents") ?? "fixture") as "fixture" | "real"
    if (agents !== "fixture" && agents !== "real") {
      console.error("--agents must be fixture or real")
      process.exit(2)
    }
    const mode = (flagValue("--mode") ?? "full-capture") as "rehearsal" | "full-capture"
    if (mode !== "rehearsal" && mode !== "full-capture") {
      console.error("--mode must be rehearsal or full")
      process.exit(2)
    }
    if (agents === "real" && mode === "full-capture" && (process.env.OPENCODE_API_KEY ?? "").trim().length === 0) {
      console.error("--agents=real requires OPENCODE_API_KEY")
      process.exit(2)
    }
    const reasoning = flagValue("--reasoning") ?? "high"
    const reasoningLevels = ["minimal", "low", "medium", "high", "xhigh"]
    if (!reasoningLevels.includes(reasoning)) {
      console.error("--reasoning must be minimal, low, medium, high, or xhigh")
      process.exit(2)
    }
    await captureRun(run as 1 | 2, {
      demoRepo,
      skipBaseline: args.includes("--skip-baseline"),
      offline: args.includes("--offline"),
      agents,
      mode,
      provider: flagValue("--provider") ?? "opencode",
      model: flagValue("--model") ?? "deepseek-v4-flash",
      reasoning,
    })
    return
  }
  if (command === "export") {
    const run = Number(flagValue("--run") ?? "0")
    if (run !== 1 && run !== 2) {
      console.error("usage: capture.ts export --run 1|2")
      process.exit(2)
    }
    await exportRun(run as 1 | 2, run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2)
    return
  }
  if (command === "finalize") {
    await finalize()
    return
  }
  if (command === "verify") {
    await verifyOnly()
    return
  }
  if (command === "store") {
    const records = await listCaptureRecords()
    console.log(`[capture] dev store: ${DEV_STORE_FILE} (${records.length} records)`)
    for (const record of records) {
      console.log(
        `  ${record.capturedAt} ${record.run} ${record.scenario} ${record.agents} ${record.mode} ${record.provider}/${record.model} state=${record.finalRunState} outcome=${record.outcome ?? "-"} manifest=${record.manifestSealed ? "sealed" : "none"} digest=${record.configDigest.slice(0, 12)}`,
      )
    }
    return
  }
  if (command === "present") {
    const result = await presentFromStore()
    if (result === null) {
      console.error("[capture] present: no presentation streak (three consecutive full-capture real runs, unchanged config, both scenarios)")
      process.exit(1)
    }
    console.log(`[capture] present: streak started ${result.streakStartedAt}`)
    console.log(`[capture] present: incidents ${result.incidentIds.join(", ")}`)
    console.log(`[capture] present: ${result.artifacts} artifacts; bundle at ${savedRunsRoot()}`)
    return
  }
  console.error("usage: capture.ts {run --run 1|2 | export --run 1|2 | finalize | verify | store | present}")
  process.exit(2)
}

void main().catch((error) => {
  console.error(`[capture] fatal: ${(error as Error).message}`)
  process.exit(1)
})
