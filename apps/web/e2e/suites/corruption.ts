/**
 * Acceptance item 2: each of the six corruption classes renders an explicit
 * error state in the Workspace.
 *
 * For every class the suite writes a corrupted copy of the captured bundle
 * into the shadow `demo/fixtures/runs` directory (see `lib/server.ts`), lets
 * the replay loader verify it, and asserts the rendered page shows both the
 * mapped integrity state and the exact error code from the contract
 * vocabulary. The bundle is restored to the pristine capture after each
 * case.
 */
import type { Page } from "playwright"

import { CORRUPTION_CASES, readBundleFromDirectory, writeBundleToDirectory } from "../../../../demo/replay/mutations.ts"
import type { SuiteRunner } from "../lib/report"
import type { DevServer } from "../lib/server"

/** The rendered integrity state each error code maps to (store-status.ts). */
const EXPECTED_STATES: Record<string, string> = {
  CHANGED_CONTENT: "corrupt-content",
  BAD_SEQUENCE: "bad-sequence",
  UNKNOWN_SCHEMA: "unknown-schema",
  STALE_DATA: "stale-data",
  REDACTION_FAILURE: "redaction-failure",
  MISSING_ARTIFACT: "missing-artifact",
  STALE_SCHEMA: "stale-schema",
}

/** The fixed titles the ErrorState renders per state (store-status.ts). */
const EXPECTED_TITLES: Record<string, string> = {
  "corrupt-content": "Content does not match its hash",
  "bad-sequence": "Journal sequence is broken",
  "unknown-schema": "Unknown schema",
  "stale-data": "Evidence has expired",
  "redaction-failure": "Redaction is broken",
  "missing-artifact": "Artifact not in this saved bundle",
  "stale-schema": "Unsupported schema version",
}

export async function runCorruption(server: DevServer, runner: SuiteRunner, page: Page): Promise<void> {
  const { check } = runner.suite("six corruption classes render explicit error states")
  const pristine = readBundleFromDirectory(server.bundleDir)

  // The shadow dev server sometimes aborts a navigation while the corrupt
  // bundle re-verifies (font /@fs requests 403 under the shadow root). Retry
  // each case until the error state renders.
  const loadErrorState = async (url: string): Promise<string> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 })
      } catch {
        // navigation aborted; retry
      }
      await page.waitForTimeout(800)
      const text = (await page.textContent("body")) ?? ""
      if (text.includes("integrity state:")) {
        return text
      }
    }
    return (await page.textContent("body")) ?? ""
  }

  for (const caseDefinition of CORRUPTION_CASES) {
    const mutated = caseDefinition.apply(new Map(pristine))
    writeBundleToDirectory(server.bundleDir, mutated)
    const text = await loadErrorState(`${server.baseUrl}/`)
    const state = EXPECTED_STATES[caseDefinition.expectedCode] ?? "unknown"
    const stateShown = text.includes(`integrity state: ${state}`)
    const codeShown = text.includes(caseDefinition.expectedCode)
    const titleShown = text.includes(EXPECTED_TITLES[state] ?? "Replay failed")
    check(
      `${caseDefinition.name} renders ${state}`,
      stateShown && codeShown && titleShown,
      `${caseDefinition.name} → ${caseDefinition.expectedCode}: state=${stateShown ? state : "missing"}, code=${codeShown ? caseDefinition.expectedCode : "missing"}, title=${titleShown ? EXPECTED_TITLES[state] : "missing"}`,
    )
    // The detail route must refuse the same way, never half-render.
    const detailText = await loadErrorState(`${server.baseUrl}/incidents/inc-demo-payment-1`)
    check(
      `${caseDefinition.name} detail route errors too`,
      detailText.includes(`integrity state: ${state}`),
      "the incident detail route renders the same explicit error, never a partial view",
    )
  }

  writeBundleToDirectory(server.bundleDir, pristine)
  const restored = await loadErrorState(`${server.baseUrl}/`)
  check("bundle restored after the catalog", restored.includes("inc-demo-payment-1"), "the pristine capture renders again after every corruption case")
}
