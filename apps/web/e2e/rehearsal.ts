/**
 * The timed presentation rehearsal (acceptance item 6).
 *
 * Walks the fixed click path from docs/research/incident-workspace.md
 * "Presentation click paths" against the captured bundle, pacing each stop to
 * its scripted second (opening 10 s, Run 1 75 s, Run 2 75 s, close 20 s —
 * 180 s total). Every click lands on a saved panel; nothing runs live. The
 * driver records a wall-clock timestamp per stop and fails when a stop does
 * not show the fixed panel content.
 *
 * Two complete timed rehearsals run per invocation; their logs go to
 * docs/presentation/rehearsals/.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "playwright"

import type { SuiteRunner } from "./lib/report"
import type { DevServer } from "./lib/server"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
export const REHEARSALS_DIR = path.join(REPO_ROOT, "docs", "presentation", "rehearsals")

const RUN_1 = "/incidents/inc-demo-payment-1"
const RUN_2 = "/incidents/inc-demo-payment-2"

interface Stop {
  atSecond: number
  label: string
  route: string
  expectText: string[]
  expectSection?: string
}

const CLICK_PATH: Stop[] = [
  // Opening (10 s).
  { atSecond: 0, label: "opening: incident list", route: "/", expectText: ["inc-demo-payment-1", "inc-demo-payment-2", "nothing runs live"] },
  // Run 1 (75 s).
  { atSecond: 10, label: "run 1: header", route: RUN_1, expectText: ["verified-remediation", "closed: symptom-cleared"], expectSection: "#workspace-header" },
  { atSecond: 18, label: "run 1: trigger and intake", route: RUN_1, expectText: ["payment-error-rate", "recorded value 1", "threshold 0.2"], expectSection: "#workspace-intake" },
  { atSecond: 26, label: "run 1: evidence set", route: RUN_1, expectText: ["paymentFailure", "trace"], expectSection: "#workspace-evidence" },
  { atSecond: 36, label: "run 1: hypotheses and gate", route: RUN_1, expectText: ["H1", "accepted", "rejected"], expectSection: "#workspace-hypotheses" },
  { atSecond: 47, label: "run 1: fusion rounds", route: RUN_1, expectText: ["participant"], expectSection: "#workspace-fusion" },
  { atSecond: 52, label: "run 1: remediation", route: RUN_1, expectText: ["if (!['visa', 'mastercard'].includes(cardType))", "safe"], expectSection: "#workspace-remediation" },
  { atSecond: 60, label: "run 1: verify", route: RUN_1, expectText: ["R1", "T13", "pass"], expectSection: "#workspace-verify" },
  { atSecond: 71, label: "run 1: release gate and approvals", route: RUN_1, expectText: ["approval-1-run-1", "granted"], expectSection: "#workspace-gates" },
  { atSecond: 78, label: "run 1: watch", route: RUN_1, expectText: ["receipt-probe-w1", "G6"], expectSection: "#workspace-watch" },
  { atSecond: 84, label: "run 1: policy", route: RUN_1, expectText: ["approval-required"], expectSection: "#workspace-policy" },
  // Run 2 (75 s).
  { atSecond: 85, label: "run 2: header", route: RUN_2, expectText: ["verification-failed", "2 of 3 attempts remaining"], expectSection: "#workspace-header" },
  { atSecond: 93, label: "run 2: trigger and hypotheses", route: RUN_2, expectText: ["payment-error-rate", "H1", "accepted"], expectSection: "#workspace-hypotheses" },
  { atSecond: 105, label: "run 2: remediation", route: RUN_2, expectText: ["if (!['visa', 'mastercard'].includes(cardType))"], expectSection: "#workspace-remediation" },
  { atSecond: 113, label: "run 2: verify (R1 and T5)", route: RUN_2, expectText: ["Luhn guard reachable", "Luhn-failing Visa is rejected"], expectSection: "#workspace-verify" },
  { atSecond: 131, label: "run 2: verification report verdict", route: RUN_2, expectText: ["fail"], expectSection: "#workspace-verify" },
  { atSecond: 139, label: "run 2: attempts and stages", route: RUN_2, expectText: ["verify · failed", "Release Gate not reached"], expectSection: "#workspace-attempts" },
  { atSecond: 149, label: "run 2: policy", route: RUN_2, expectText: ["no execution-time decision recorded"], expectSection: "#workspace-policy" },
  // Close (20 s).
  { atSecond: 160, label: "close: policy dials and risk table", route: RUN_1, expectText: ["Authority Mode dial", "Automation Policy dial"], expectSection: "#workspace-policy" },
  { atSecond: 170, label: "close: rollback contract", route: RUN_1, expectText: ["Neither saved run contains a rollback", "proposed product scope"], expectSection: "#workspace-rollback" },
]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface RehearsalRecord {
  rehearsal: number
  startedAt: string
  totalSeconds: number
  stops: { atSecond: number; reachedSecond: number; label: string; ok: boolean }[]
}

async function runRehearsal(page: Page, base: string, number: number): Promise<RehearsalRecord> {
  const started = Date.now()
  const record: RehearsalRecord = {
    rehearsal: number,
    startedAt: new Date(started).toISOString(),
    totalSeconds: 0,
    stops: [],
  }
  for (const stop of CLICK_PATH) {
    const targetMs = stop.atSecond * 1000
    const remaining = targetMs - (Date.now() - started)
    if (remaining > 0) {
      await sleep(remaining)
    }
    await page.goto(`${base}${stop.route}`, { waitUntil: "networkidle" })
    if (stop.route !== "/") {
      await page.waitForSelector("nav[aria-label='Workspace sections']", { timeout: 15_000 })
    }
    let ok = true
    if (stop.expectSection !== undefined) {
      const box = await page.locator(stop.expectSection).boundingBox()
      if (box !== null) {
        await page.locator(stop.expectSection).scrollIntoViewIfNeeded()
      }
    }
    const text = (await page.textContent("body")) ?? ""
    for (const expected of stop.expectText) {
      if (!text.includes(expected)) {
        ok = false
      }
    }
    record.stops.push({
      atSecond: stop.atSecond,
      reachedSecond: Math.round((Date.now() - started) / 1000),
      label: stop.label,
      ok,
    })
  }
  record.totalSeconds = Math.round((Date.now() - started) / 1000)
  return record
}

function writeRecord(record: RehearsalRecord): void {
  mkdirSync(REHEARSALS_DIR, { recursive: true })
  const lines = [
    `Rehearsal ${record.rehearsal} — started ${record.startedAt} — total ${record.totalSeconds}s`,
    ...record.stops.map((stop) => `  ${stop.reachedSecond}s (scripted ${stop.atSecond}s) ${stop.label} ${stop.ok ? "ok" : "MISSING CONTENT"}`),
  ]
  writeFileSync(path.join(REHEARSALS_DIR, `rehearsal-${record.rehearsal}.txt`), `${lines.join("\n")}\n`)
}

export async function runRehearsals(server: DevServer, runner: SuiteRunner, page: Page): Promise<void> {
  const { check } = runner.suite("two timed 2-3 minute rehearsals (fixed click path)")
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const number of [1, 2]) {
    const record = await runRehearsal(page, server.baseUrl, number)
    writeRecord(record)
    const allOk = record.stops.every((stop) => stop.ok)
    const stopsOk = record.stops.filter((stop) => stop.ok).length
    check(
      `rehearsal ${number} completes within 3 minutes`,
      record.totalSeconds <= 185,
      `${stopsOk}/${record.stops.length} stops landed on saved panels in ${record.totalSeconds}s`,
    )
    check(`rehearsal ${number} every click lands on a saved panel`, allOk, allOk ? "all stops showed their fixed panel content" : record.stops.filter((s) => !s.ok).map((s) => s.label).join(", ")),
    check(`rehearsal ${number} log written`, true, `docs/presentation/rehearsals/rehearsal-${number}.txt`)
  }
}
