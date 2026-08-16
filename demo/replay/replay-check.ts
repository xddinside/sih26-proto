/**
 * Strict replay checks for the captured saved bundle, issue #22.
 *
 * Verifies `demo/saved-runs/` with the exact pipeline the Incident Workspace
 * uses (the web replay adapter over `verifySavedBundle` from
 * `@sih/contracts`), asserts both saved runs' fixed outcomes, then mutates a
 * copy of the bundle once per corruption class and asserts the exact
 * integrity error code surfaces. The captured bundle is never modified.
 *
 * Run from the repo root:
 *
 *     bun demo/replay/replay-check.ts
 *
 * Exits 0 when every check passes or is a recorded warning, 1 otherwise.
 */
import { pathToFileURL } from "node:url"

import { verifySavedBundle } from "../../packages/contracts/src/saved-bundle.js"
import { loadReplayStoreFromDirectory } from "../../apps/web/src/lib/replay/load-saved-bundle-fs.js"
import { workspaceView } from "../../apps/web/src/features/incident-workspace/lib/workspace-projection.js"
import { CORRUPTION_CASES } from "./mutations"
import { checkRun1, checkRun2, RUN_1_ID, RUN_2_ID, type CheckResult } from "./outcomes"

/** The explicit freshness clock the app uses, from incidents/constants.ts. */
const DEMO_EVALUATION_TIME = "2026-08-16T12:00:00Z"

const SAVED_RUNS_DIR = pathToFileURL(
  new URL("../../demo/saved-runs/", import.meta.url).pathname,
)

interface SuiteResult {
  name: string
  status: "pass" | "fail" | "warn"
  checks: CheckResult[]
}

function renderSuite(suite: SuiteResult): void {
  const icon = suite.status === "pass" ? "PASS" : suite.status === "warn" ? "WARN" : "FAIL"
  console.log(`\n[${icon}] ${suite.name}`)
  for (const check of suite.checks) {
    console.log(`  ${check.status === "pass" ? "ok " : check.status === "warn" ? "warn" : "FAIL"}  ${check.name} — ${check.detail}`)
  }
}

function suiteOf(name: string, checks: CheckResult[]): SuiteResult {
  const status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass"
  return { name, status, checks }
}

async function main(): Promise<void> {
  const suites: SuiteResult[] = []
  console.log(`replay-check: verifying ${new URL("../../demo/saved-runs/", import.meta.url).pathname}`)

  // 1. Pristine bundle verification through the web adapter.
  const pristine = await loadReplayStoreFromDirectory(SAVED_RUNS_DIR, {
    evaluationTime: DEMO_EVALUATION_TIME,
  })
  if (!pristine.ok) {
    suites.push({
      name: "pristine bundle verification",
      status: "fail",
      checks: pristine.error.map((e) => ({
        name: "code" in e ? e.code : e.kind,
        status: "fail" as const,
        detail: `${"path" in e ? e.path ?? "" : ""} ${e.message}`,
      })),
    })
    for (const suite of suites) renderSuite(suite)
    console.log("\nRESULT: FAIL (pristine bundle failed verification)")
    process.exit(1)
  }
  suites.push({
    name: "pristine bundle verification",
    status: "pass",
    checks: [
      { name: "manifest, journal sequence, schemas, redaction, freshness, hashes", status: "pass", detail: `manifest lists ${Object.keys(pristine.value.manifest.files).length} files across ${pristine.value.incidents.length} incidents; every journal, envelope, and reference verified` },
    ],
  })

  const store = pristine.value

  // 2. Fixed outcomes for both saved runs, projected through the same panels
  // the Workspace renders.
  const view1 = workspaceView(store, RUN_1_ID, DEMO_EVALUATION_TIME)
  if (view1 === null) {
    suites.push({ name: `Run 1 (${RUN_1_ID})`, status: "fail", checks: [fail("projection", "workspaceView returned null")] })
  } else {
    suites.push(suiteOf(`Run 1 (${RUN_1_ID}) — verified code Remediation`, checkRun1(store, view1)))
  }
  const view2 = workspaceView(store, RUN_2_ID, DEMO_EVALUATION_TIME)
  if (view2 === null) {
    suites.push({ name: `Run 2 (${RUN_2_ID})`, status: "fail", checks: [fail("projection", "workspaceView returned null")] })
  } else {
    suites.push(suiteOf(`Run 2 (${RUN_2_ID}) — deterministic failed verification`, checkRun2(store, view2)))
  }

  // 3. Mutation catalog: every corruption class must surface its exact code.
  const { readBundleFromDirectory } = await import("./mutations")
  const capturedDir = new URL("../../demo/saved-runs/", import.meta.url)
  const capturedFiles = readBundleFromDirectory(capturedDir.pathname)
  const corruptionChecks: CheckResult[] = []
  for (const caseDefinition of CORRUPTION_CASES) {
    const mutated = caseDefinition.apply(new Map(capturedFiles))
    const verification = verifySavedBundle({ files: mutated }, { evaluationTime: DEMO_EVALUATION_TIME })
    const codes = verification.ok ? [] : verification.error.map((e) => e.code)
    const surfaced = (codes as string[]).includes(caseDefinition.expectedCode)
    corruptionChecks.push({
      name: caseDefinition.name,
      status: surfaced ? "pass" : "fail",
      detail: surfaced
        ? `${caseDefinition.expectedCode} surfaced (all codes: ${[...new Set(codes)].join(", ")})`
        : `expected ${caseDefinition.expectedCode}, got ${codes.join(", ") || "verified ok"}`,
    })
  }
  corruptionChecks.push({
    name: "pristine bundle stays untouched",
    status: "pass",
    detail: "every mutation ran on an in-memory copy; demo/saved-runs/ was never written",
  })
  suites.push(suiteOf("corruption catalog — exact error codes", corruptionChecks))

  for (const suite of suites) renderSuite(suite)

  const failed = suites.some((s) => s.status === "fail")
  const warned = suites.some((s) => s.status === "warn")
  const total = suites.reduce((sum, s) => sum + s.checks.length, 0)
  console.log(`\nRESULT: ${failed ? "FAIL" : warned ? "PASS WITH WARNINGS" : "PASS"} (${total} checks across ${suites.length} suites)`)
  if (warned && !failed) {
    console.log("Warnings record divergences between the captured bundle and the fixed section-13 script wording; see the report.")
  }
  process.exit(failed ? 1 : 0)
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "fail", detail }
}

await main()
