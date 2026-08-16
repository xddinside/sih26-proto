/**
 * Docker-backed release adapter and evidence runner for the capture. Every
 * hook performs real docker work through the `sg docker` wrapper: image
 * builds, the isolated candidate container, the T12 restore drill, the T3/T5
 * test-runtime runs, and the stage-2 live service swap.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { EvidenceRunner, ReleaseAdapter } from "./driver.js"
import {
  CANDIDATE_SERVICE_NAME,
  IMAGES,
  PORTS,
  PROBES_PER_WINDOW,
} from "./constants.js"
import * as shop from "./shop.js"

export interface AdapterConfig {
  demoRepo: string
  composeFile: string
  /** The seeded live image tag for this run. */
  seededImage: string
  /** The candidate image tag for this run. */
  candidateImage: string
  run: 1 | 2
}

export function runShell(command: string): Promise<string> {
  return runShellCode(command).then((result) => {
    if (result.code !== 0) {
      throw new Error(`${command} failed (${result.code}): ${result.output.slice(0, 2000)}`)
    }
    return result.output
  })
}

/** Run a shell command and return its output plus exit code without throwing. */
export function runShellCode(command: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let errOut = ""
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      errOut += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ code, output: `${out}\n${errOut}` })
    })
  })
}

function composeNetwork(): Promise<string> {
  return shop
    .docker(["inspect", "payment", "--format", '"{{json .NetworkSettings.Networks}}"'])
    .then((out) => {
      const networks = JSON.parse(out.trim()) as Record<string, unknown>
      return Object.keys(networks)[0] ?? ""
    })
}

async function candidateRunArgs(imageId: string, seeded: boolean): Promise<string[]> {
  const network = await composeNetwork()
  const args = [
    "run",
    "-d",
    "--name",
    "payment-candidate",
    "--network",
    network,
    "-p",
    `${PORTS.candidatePayment}:50051`,
    "-e",
    "IPV6_ENABLED=false",
    "-e",
    "PAYMENT_PORT=50051",
    "-e",
    "FLAGD_HOST=flagd",
    "-e",
    "FLAGD_PORT=8013",
    "-e",
    `"NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register"`,
    "-e",
    "OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317",
    "-e",
    "OTEL_EXPORTER_OTLP_PROTOCOL=grpc",
    "-e",
    `"OTEL_RESOURCE_ATTRIBUTES=service.namespace=opentelemetry-demo,service.version=${imageId},service.instance.id=${seeded ? "restored" : "candidate"}"`,
    "-e",
    "OTEL_SERVICE_NAME=" + CANDIDATE_SERVICE_NAME,
  ]
  return args
}

/** The real docker release adapter (compose release adapter stand-in). */
export function createReleaseAdapter(config: AdapterConfig): ReleaseAdapter {
  return {
    async startCandidate(): Promise<{ imageId: string }> {
      await shop.docker(["rm", "-f", "payment-candidate"]).catch(() => undefined)
      const imageId = await shop.paymentContainerImageId("payment").catch(() => "")
      // The candidate container id for the record is the real image id of the
      // candidate image; read it directly from the image.
      const candidateImageId = await shop.docker(["inspect", config.candidateImage, "--format", "{{.Id}}"]).then((out) => out.trim().slice(7, 19))
      const args = await candidateRunArgs(candidateImageId, false)
      await shop.docker([...args, config.candidateImage])
      return { imageId: candidateImageId }
    },
    async stopCandidate(): Promise<void> {
      await shop.docker(["rm", "-f", "payment-candidate"]).catch(() => undefined)
    },
    async swapLiveService(): Promise<{ actualVersion: string }> {
      const project = join(config.composeFile)
      await runShell(
        `OTEL_DEMO_ROOT=${config.demoRepo} PAYMENT_IMAGE=${config.candidateImage} sg docker -c "docker compose -f ${project} up -d payment"`,
      )
      const actualVersion = await shop.paymentContainerImageId("payment")
      return { actualVersion }
    },
    async restoreDrill(): Promise<{ restored: boolean; output: string }> {
      // Drill the recorded restore command in the isolated environment: stop
      // the candidate and recreate the SEEDED service exactly as the Recovery
      // Point restore command would, then assert it serves (rejecting valid
      // cards, the seeded behavior).
      await shop.docker(["rm", "-f", "payment-candidate"]).catch(() => undefined)
      const seededImageId = await shop.docker(["inspect", config.seededImage, "--format", "{{.Id}}"]).then((out) => out.trim().slice(7, 19))
      const args = await candidateRunArgs(seededImageId, true)
      await shop.docker([...args, config.seededImage])
      const running = await shop.containerRunning("payment-candidate")
      let probeOutcome: shop.ProbeOutcome | null = null
      if (running) {
        probeOutcome = await shop.runProbe(PORTS.candidatePayment, 5)
      }
      const output = `restored seeded service in isolated env: running=${running} probe=${probeOutcome === null ? "n/a" : `${probeOutcome.ok}/${probeOutcome.total} accepted`}`
      // The seeded behavior rejects every valid card; acceptance would mean
      // the drill did not restore the seeded state.
      const restored = running && probeOutcome !== null && probeOutcome.ok === 0
      await shop.docker(["rm", "-f", "payment-candidate"]).catch(() => undefined)
      return { restored, output }
    },
    async liveImageId(): Promise<string> {
      return shop.paymentContainerImageId("payment")
    },
    async candidateImageId(): Promise<string> {
      return shop.docker(["inspect", config.candidateImage, "--format", "{{.Id}}"]).then((out) => out.trim().slice(7, 19))
    },
  }
}

/** The real evidence runner: builds the candidate, runs T3/T5, probes, rehearses. */
export function createEvidenceRunner(config: AdapterConfig): EvidenceRunner {
  const candidateTestRuntime = `payment-test-runtime-${config.candidateImage}`
  return {
    async buildCandidateImage(): Promise<{ imageId: string; buildOutput: string }> {
      const output = await runShell(
        `cd ${config.demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile -t ${config.candidateImage} ."`,
      )
      const imageId = await shop.docker(["inspect", config.candidateImage, "--format", "{{.Id}}"]).then((out) => out.trim())
      return { imageId, buildOutput: output.trim().slice(-2000) }
    },
    async runT3(): Promise<{ passed: boolean; output: string }> {
      await runShell(
        `cd ${config.demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile --target test-runtime -t ${candidateTestRuntime} ."`,
      )
      const output = await runShell(
        `sg docker -c "docker run --rm ${candidateTestRuntime} node --test card.unit.test.js"`,
      )
      return { passed: testRunPassed(output), output: output.trim().slice(-1500) }
    },
    async runT5(): Promise<{ passed: boolean; output: string; failedCase: string | null }> {
      await runShell(
        `cd ${config.demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile --target test-runtime -t ${candidateTestRuntime} ."`,
      )
      const result = await runShellCode(
        `sg docker -c "docker run --rm ${candidateTestRuntime} node --test payment.regression.test.js"`,
      )
      const output = result.output
      const failedCase =
        output.includes("Luhn-failing Visa is rejected") &&
        /✖|✗/.test(output)
          ? "Luhn-failing Visa is rejected"
          : null
      return { passed: testRunPassed(output), output: output.trim().slice(-1500), failedCase }
    },
    async probeCandidate(count: number): Promise<shop.ProbeOutcome> {
      return shop.runProbe(PORTS.candidatePayment, count)
    },
    async rehearseWatch(): Promise<{ g2: number | null; g3: number | null; g4: number | null; calls: number }> {
      const g2 = await shop.candidateErrorRatio()
      const g3 = await shop.latencyP95("candidate")
      const calls = await shop.candidateSpanCount()
      return { g2, g3, g4: calls === null ? null : calls >= 1 ? 1 : 0, calls: calls ?? 0 }
    },
  }
}

/** Apply a demo-repo source state: overlay, s1, s2, s1-fixed, s2-fixed. */
export async function applySourceState(demoRepo: string, state: "overlay" | "s1" | "s2" | "s1-fixed" | "s2-fixed"): Promise<void> {
  const seedsDir = new URL("../../seeds", import.meta.url).pathname
  const applyScript = join(seedsDir, "apply-seed.sh")
  const resetScript = join(seedsDir, "reset.sh")
  await runShell(`bash ${resetScript} --repo ${demoRepo}`)
  if (state === "overlay") {
    await runShell(`bash ${applyScript} S1 --repo ${demoRepo}`)
    await runShell(`cd ${demoRepo} && git apply -R ${join(seedsDir, "seeds/S1.patch")}`)
    return
  }
  if (state === "s1") {
    await runShell(`bash ${applyScript} S1 --repo ${demoRepo}`)
    return
  }
  if (state === "s2") {
    await runShell(`bash ${applyScript} S2 --repo ${demoRepo}`)
    return
  }
  if (state === "s1-fixed") {
    await runShell(`bash ${applyScript} S1 --repo ${demoRepo}`)
    await runShell(`cd ${demoRepo} && git apply -R ${join(seedsDir, "seeds/S1.patch")}`)
    return
  }
  // s2-fixed: the S2 seed with the card-type fix; the Luhn guard stays removed.
  // S1.patch's context no longer applies against the S2 state (S2 removes the
  // !valid block above the flipped clause), so restore the negation directly.
  await runShell(`bash ${applyScript} S2 --repo ${demoRepo}`)
  await runShell(
    `python3 -c "import sys; p=sys.argv[1]; s=open(p).read(); f=\\"if (['visa', 'mastercard'].includes(cardType)) {\\"; r=\\"if (!['visa', 'mastercard'].includes(cardType)) {\\"; open(p,'w').write(s.replace(f,r,1)) if f in s else None; print('card-type clause restored' if f in s else 'flipped clause not found')" ${demoRepo}/src/payment/card.js`,
  )
}

/** The seeded live image tag for a run. */
export function seededImageFor(run: 1 | 2): string {
  return run === 1 ? IMAGES.seeded1 : IMAGES.seeded2
}

export function candidateImageFor(run: 1 | 2): string {
  return run === 1 ? IMAGES.candidate1 : IMAGES.candidate2
}

/** The real seeded T3 run (prediction receipt evidence). */
export async function runSeededT3(demoRepo: string, run: 1 | 2): Promise<{ passed: boolean; output: string }> {
  const image = `payment-test-runtime-${run === 1 ? IMAGES.seeded1 : IMAGES.seeded2}`
  await runShell(
    `cd ${demoRepo} && sg docker -c "docker build -f src/payment/Dockerfile --target test-runtime -t ${image} ."`,
  )
  const result = await runShellCode(`sg docker -c "docker run --rm ${image} node --test card.unit.test.js"`)
  const output = result.output
  return { passed: output.includes("0 fail") && !output.includes("fail 1"), output: output.trim().slice(-1500) }
}

/** The real pino error line from the live payment container logs. */
export async function liveLogLine(): Promise<string | null> {
  const logs = await shop.docker(["logs", "payment", "--tail", "300"]).catch(() => "")
  const lines = logs.split("\n").filter((line) => line.includes("cannot process"))
  return lines.at(-1)?.trim() ?? null
}

export function demoRepoExists(path: string): boolean {
  return existsSync(join(path, ".git"))
}

export async function readPinnedHead(path: string): Promise<string> {
  return (await readFile(join(path, ".git/HEAD"), "utf8")).trim()
}

/**
 * Node's test runner prints "fail 0" and Bun prints "0 fail". Treat any
 * non-zero failure count in either form as a failed run.
 */
function testRunPassed(output: string): boolean {
  return !/(?:fail\s+[1-9])|(?:[1-9]\s+fail)/.test(output)
}
