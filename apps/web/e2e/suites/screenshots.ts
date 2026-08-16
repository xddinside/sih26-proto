/**
 * The fixed 12-shot evidence kit (acceptance item 5 support). Captures the
 * exact views named in docs/build-handoff.md section 13 from the captured
 * bundle, at the 1280 px presentation width, into docs/presentation/shots/.
 *
 * Shots that combine panels capture the union of their sections in one
 * image; the mapping lives in docs/presentation/evidence-kit.md.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "playwright"

import type { SuiteRunner } from "../lib/report"
import type { DevServer } from "../lib/server"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
export const SHOTS_DIR = path.join(REPO_ROOT, "docs", "presentation", "shots")

const RUN_1 = "/incidents/inc-demo-payment-1"
const RUN_2 = "/incidents/inc-demo-payment-2"

interface Shot {
  file: string
  route: string
  sections?: string[]
  fullPage?: boolean
}

const SHOTS: Shot[] = [
  { file: "01-incident-list.png", route: "/", fullPage: true },
  { file: "02-run1-header-trigger-intake.png", route: RUN_1, sections: ["#workspace-header", "#workspace-intake"] },
  { file: "03-run1-evidence-set.png", route: RUN_1, sections: ["#workspace-evidence"] },
  { file: "04-run1-hypotheses-gate.png", route: RUN_1, sections: ["#workspace-hypotheses"] },
  { file: "05-run1-remediation-recovery.png", route: RUN_1, sections: ["#workspace-remediation", "#workspace-recovery"] },
  { file: "06-run1-verify.png", route: RUN_1, sections: ["#workspace-verify"] },
  { file: "07-run1-release-gate-approvals.png", route: RUN_1, sections: ["#workspace-gates", "#workspace-approvals"] },
  { file: "08-run1-watch.png", route: RUN_1, sections: ["#workspace-watch"] },
  { file: "09-run2-r1-t5.png", route: RUN_2, sections: ["#workspace-verify"] },
  { file: "10-run2-verdict-open-attempts.png", route: RUN_2, sections: ["#workspace-header", "#workspace-verify"] },
  { file: "11-policy-panel.png", route: RUN_1, sections: ["#workspace-policy"] },
  { file: "12-rollback-panel.png", route: RUN_1, sections: ["#workspace-rollback"] },
]

async function clipOfSections(page: Page, sections: string[]): Promise<{ x: number; y: number; width: number; height: number }> {
  const boxes = await Promise.all(
    sections.map(async (selector) => {
      const box = await page.locator(selector).boundingBox()
      if (box === null) throw new Error(`section ${selector} not visible`)
      return box
    }),
  )
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: right - x + 16, height: bottom - y + 16 }
}

export async function runScreenshots(server: DevServer, runner: SuiteRunner, page: Page): Promise<void> {
  const { check } = runner.suite("12-shot evidence kit screenshots")
  mkdirSync(SHOTS_DIR, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const shot of SHOTS) {
    await page.goto(`${server.baseUrl}${shot.route}`, { waitUntil: "networkidle" })
    if (shot.route !== "/") {
      await page.waitForSelector(shot.route === RUN_2 ? "text=verification-failed" : "text=verified-remediation", { timeout: 15_000 })
    }
    const target = path.join(SHOTS_DIR, shot.file)
    if (shot.fullPage === true) {
      await page.screenshot({ path: target, fullPage: true })
    } else if (shot.sections !== undefined) {
      const clip = await clipOfSections(page, shot.sections)
      await page.screenshot({ path: target, clip, fullPage: true })
    }
    check(`shot ${shot.file}`, true, `${shot.route} ${shot.sections?.join(" ") ?? "full page"}`)
  }
  const count = SHOTS.length
  check("12 screenshots captured", count === 12, `${count} PNG files in docs/presentation/shots/`)
}
