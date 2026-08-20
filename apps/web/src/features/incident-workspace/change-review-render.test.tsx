/**
 * Server-render smoke test for the Change Review: renders the full surface
 * for both saved runs and asserts the settled key text is present in the
 * markup. This is the text-level evidence that the view renders without a
 * router context (plain anchors only, no TanStack `<Link>`), that the
 * right rail previews the default source-host record, and that the Files tab
 * parses issue #32's recorded headerless unified diff.
 */
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { loadReplayStoreFromDirectory } from "../../lib/replay/load-saved-bundle-fs"
import type { ReplayStore } from "../../lib/replay/replay-store"
import { ChangeReviewView } from "./components/change-review/change-review-view"
import { changeWorkspaceView } from "./lib/change-workspace-projection"
import type { ChangeReviewTab } from "./lib/workspace-search"

const RUNS_URL = new URL("../../../../../demo/saved-runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function verifiedStore(): Promise<ReplayStore> {
  const result = await loadReplayStoreFromDirectory(RUNS_URL, {
    evaluationTime: EVALUATION_TIME,
  })
  if (!result.ok) {
    throw new Error(
      `bundle failed verification: ${result.error.map((e) => e.message).join("; ")}`
    )
  }
  return result.value
}

async function render(
  incidentId: string,
  tab: ChangeReviewTab = "summary",
  record = ""
): Promise<string> {
  const store = await verifiedStore()
  const view = changeWorkspaceView(store, incidentId, EVALUATION_TIME)
  if (view === null) {
    throw new Error("null projection")
  }
  return renderToStaticMarkup(
    <ChangeReviewView view={view} tab={tab} record={record} />
  )
}

describe("Change Review render", () => {
  test("incident 1 renders the resolved change with honest source-host facts", async () => {
    const html = await render("inc-demo-payment-1")
    expect(html).toContain("Incident Response")
    expect(html).toContain("Saved Demo Run")
    expect(html).toContain("Change Review")
    expect(html).toContain("change Resolved")
    expect(html).toContain("Remediate inc-demo-payment-1 (run-1)")
    expect(html).toContain("#4")
    expect(html).toContain("Inspect PR record")
    expect(html).toContain(">payment<")
    expect(html).toContain("</strong> environment")
    expect(html).toContain("H1")
    expect(html).toContain("Review state")
    expect(html).toContain("Release Gate pass")
    expect(html).toContain("Files changed")
    expect(html).toContain("Review diff")
    expect(html).toContain("1 file")
    expect(html).toContain("Summary")
    expect(html).toContain("Files changed")
    // The source-host record is the default right-rail preview.
    expect(html).toContain("Source-host record")
    expect(html).toContain("merged")
    expect(html).toContain("#4 Remediate inc-demo-payment-1 (run-1)")
    expect(html).toContain("View details")
    expect(html).not.toContain("<dt>Repository</dt>")
    expect(html).not.toContain("github.com/xddinside/sih26-payment-demo/pull/4")
    expect(html).not.toContain("Replay provenance")
    expect(html).not.toContain("<dt>Candidate</dt>")
    expect(html).not.toContain("<dialog")
  })

  test("the source-host dialog contains the useful PR facts", async () => {
    const html = await render("inc-demo-payment-1", "summary", "source-host")
    expect(html).toContain("<dialog")
    expect(html).toContain("<dt>Repository</dt>")
    expect(html).toContain("github.com/xddinside/sih26-payment-demo/pull/4")
    expect(html).toContain("Copy PR link")
  })

  test("incident 2 renders the blocked change with no Release Gate", async () => {
    const html = await render("inc-demo-payment-2")
    expect(html).toContain("change Blocked")
    expect(html).toContain("verification-failed")
    expect(html).toContain("Release Gate not reached")
    expect(html).toContain("verification-failed")
  })

  test("the Files tab renders the source-host PR diff", async () => {
    const html = await render("inc-demo-payment-1", "files")
    expect(html).toContain("src/payment/card.js")
    expect(html).toContain("cardTypeCheck(cardNumber)")
    expect(html).toContain("Change-to-Hypothesis map")
    expect(html).toContain("supporting evidence items")
    expect(html).not.toContain("Copy commit")
  })

  test("the Checks tab renders saved review and test artifacts", async () => {
    const html = await render("inc-demo-payment-1", "checks", "check:R1")
    expect(html).toContain("All required checks passed")
    expect(html).toContain("Reviews 5")
    expect(html).toContain("Tests 10")
    expect(html).toContain("R1")
    expect(html).toContain("Review")
  })

  test("the Release tab renders the gate and recovery records", async () => {
    const html = await render("inc-demo-payment-1", "release", "gate-release")
    expect(html).toContain("Release and Watch")
    expect(html).toContain("Recovery Point")
    expect(html).toContain("Review rollback record")
  })

  test("a selected record opens in the details dialog", async () => {
    const html = await render("inc-demo-payment-1", "summary", "remediation")
    expect(html).toContain('class="cr-record-overlay"')
    expect(html).toContain("<dialog")
    expect(html).toContain('aria-label="Close details"')
    expect(html).toContain("Remediation")
    expect(html).toContain("Restore the dropped negation")
    const raw = await render("inc-demo-payment-1", "summary", "hypothesis:H1")
    expect(raw).toContain("<dialog")
    expect(raw).toContain("Accepted Hypothesis")
  })

  test("Policies opens the recorded policy in the inspector", async () => {
    const html = await render("inc-demo-payment-1", "summary", "policy")
    expect(html).toContain('aria-current="page">Policies</a>')
    expect(html).toContain("Policy record")
    expect(html).toContain("Policies and limits")
    expect(html).toContain("approval-required")
    expect(html).toContain("outside autonomous window")
    expect(html).toContain("Decision 241")
  })

  test("Audit opens the saved journal index and linked raw events", async () => {
    const index = await render("inc-demo-payment-1", "summary", "audit:index")
    expect(index).toContain('aria-current="page">Audit</a>')
    expect(index).toContain("Audit index")
    expect(index).toContain("Saved journal audit")
    expect(index).toContain("Append-only by sequence")
    expect(index).toContain("243 human action")

    const event = await render("inc-demo-payment-1", "summary", "audit:241")
    expect(event).toContain("Audit event")
    expect(event).toContain("Policy decision")
    expect(event).toContain("Show raw record")
    expect(event).toContain("Pacific/Chatham")
  })

  test("an unknown record falls back to the default source-host record", async () => {
    const html = await render(
      "inc-demo-payment-1",
      "summary",
      "evidence:does-not-exist"
    )
    expect(html).toContain("Source-host record")
    expect(html).not.toContain("does-not-exist")
    expect(html).not.toContain("<dialog")
  })
})
