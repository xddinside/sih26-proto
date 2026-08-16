/**
 * End-to-end verification for the saved-replay Incident Workspace, issue #22.
 *
 * Suites:
 *   1. both saved runs replay from the captured bundle with their exact fixed
 *      outcomes, and saved controls cannot submit;
 *   2. six corruption classes render explicit error states;
 *   3. keyboard, 200% zoom, reduced motion, 1280 px, and 390 px checks;
 *   4. the 12-shot evidence kit screenshots;
 *   5. two timed 2-3 minute click-path rehearsals.
 *
 * The harness serves a copy of the captured bundle (`demo/saved-runs/`) to
 * the real dev server through a shadow working directory and drives it with
 * Playwright through `portless`. See README.md for the harness choice.
 *
 *     bun run run-e2e.ts            # every suite
 *     bun run run-e2e.ts --suite outcomes   # one suite
 */
import { chromium } from "playwright"

import { runRehearsals } from "./rehearsal"
import { SuiteRunner } from "./lib/report"
import { startDevServer } from "./lib/server"
import { runA11y } from "./suites/a11y"
import { runCorruption } from "./suites/corruption"
import { runOutcomes } from "./suites/outcomes"
import { runScreenshots } from "./suites/screenshots"

const args = process.argv.slice(2)
const only = args.includes("--suite") ? args[args.indexOf("--suite") + 1] : null

async function main(): Promise<void> {
  const runner = new SuiteRunner()
  const server = await startDevServer()
  console.log(`e2e dev server: ${server.baseUrl} (shadow bundle at ${server.bundleDir}, portless: ${server.viaPortless ? "yes" : "no, direct URL"})`)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  try {
    if (only === null || only === "outcomes") await runOutcomes(server, runner, page)
    if (only === null || only === "corruption") await runCorruption(server, runner, page)
    if (only === null || only === "a11y") await runA11y(server, runner, page, context)
    if (only === null || only === "screenshots") await runScreenshots(server, runner, page)
    if (only === null || only === "rehearsals") await runRehearsals(server, runner, page)
  } finally {
    await browser.close()
    await server.close()
  }
  const { failed, warned, total } = runner.render()
  console.log(`\nRESULT: ${failed > 0 ? "FAIL" : warned > 0 ? "PASS WITH WARNINGS" : "PASS"} (${total} checks, ${failed} failed, ${warned} warnings)`)
  process.exit(failed > 0 ? 1 : 0)
}

await main()
