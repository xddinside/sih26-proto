/**
 * Server-render smoke test for the Incident Workspace view: renders the full
 * panel tree for both saved runs and asserts the key settled-outcome text is
 * present in the markup. This is the text-level evidence that every panel
 * renders for both runs without a router context (the panels use plain
 * anchors, never TanStack `<Link>`).
 */
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { loadReplayStoreFromDirectory } from "../../lib/replay/load-saved-bundle-fs"
import type { ReplayStore } from "../../lib/replay/replay-store"
import { IncidentWorkspaceView } from "./components/incident-workspace-view"
import { workspaceView } from "./lib/workspace-projection"

const RUNS_URL = new URL("../../../../../demo/fixtures/runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function verifiedStore(): Promise<ReplayStore> {
  const result = await loadReplayStoreFromDirectory(RUNS_URL, { evaluationTime: EVALUATION_TIME })
  if (!result.ok) {
    throw new Error(`bundle failed verification: ${result.error.map((e) => e.message).join("; ")}`)
  }
  return result.value
}

async function render(incidentId: string): Promise<string> {
  const store = await verifiedStore()
  const view = workspaceView(store, incidentId, EVALUATION_TIME)
  if (view === null) {
    throw new Error("null projection")
  }
  return renderToStaticMarkup(<IncidentWorkspaceView view={view} />)
}

describe("Incident Workspace render", () => {
  test("Run 1 renders the verified-remediation outcome across every panel", async () => {
    const html = await render("inc-demo-payment-1")
    expect(html).toContain("Saved Demo Run")
    expect(html).toContain("verified-remediation")
    expect(html).toContain("symptom-cleared")
    expect(html).toContain("payment-error-rate")
    expect(html).toContain("Evidence Set and receipts")
    expect(html).toContain("Hypotheses and the eight-check gate")
    expect(html).toContain("Fusion rounds")
    expect(html).toContain("restore the negation")
    expect(html).toContain("Verification Report")
    expect(html).toContain("Release or Action Gate")
    expect(html).toContain("Stage 1 — candidate probe ring")
    expect(html).toContain("Recovery Point")
    expect(html).toContain("scheduled hybrid")
    expect(html).toContain("Rollback records — Solution Contract")
    expect(html).toContain("proposed product scope")
    expect(html).toContain("Full review and test catalog — Solution Contract")
  })

  test("Run 2 renders the failed verification outcome with no gate reached", async () => {
    const html = await render("inc-demo-payment-2")
    expect(html).toContain("Saved Demo Run")
    expect(html).toContain("verification-failed")
    expect(html).toContain("Luhn-failing Visa is rejected")
    expect(html).toContain("Luhn guard")
    expect(html).toContain("not reached — run ended verification-failed")
    expect(html).toContain("No Watch Report")
    expect(html).toContain("autonomous at all times")
    expect(html).toContain("draft — never consumed")
    expect(html).toContain("Neither saved run contains a rollback")
  })
})
