/**
 * Server-render smoke test for the Change Review: renders the full surface
 * for both saved runs and asserts the settled key text is present in the
 * markup. This is the text-level evidence that the view renders without a
 * router context (plain anchors only, no TanStack `<Link>`), that the
 * inspector opens the default source-host record, and that the Files tab
 * fails closed on the fixture's headerless diff.
 */
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { loadReplayStoreFromDirectory } from "../../lib/replay/load-saved-bundle-fs"
import type { ReplayStore } from "../../lib/replay/replay-store"
import { ChangeReviewView } from "./components/change-review/change-review-view"
import { changeWorkspaceView } from "./lib/change-workspace-projection"

const RUNS_URL = new URL("../../../../../demo/saved-runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function verifiedStore(): Promise<ReplayStore> {
  const result = await loadReplayStoreFromDirectory(RUNS_URL, { evaluationTime: EVALUATION_TIME })
  if (!result.ok) {
    throw new Error(`bundle failed verification: ${result.error.map((e) => e.message).join("; ")}`)
  }
  return result.value
}

async function render(incidentId: string, tab: "summary" | "files" = "summary", record = ""): Promise<string> {
  const store = await verifiedStore()
  const view = changeWorkspaceView(store, incidentId, EVALUATION_TIME)
  if (view === null) {
    throw new Error("null projection")
  }
  return renderToStaticMarkup(<ChangeReviewView view={view} tab={tab} record={record} />)
}

describe("Change Review render", () => {
  test("incident 1 renders the resolved change with honest source-host facts", async () => {
    const html = await render("inc-demo-payment-1")
    expect(html).toContain("Incident Response")
    expect(html).toContain("Saved Demo Run")
    expect(html).toContain("Change Review")
    expect(html).toContain("change Resolved")
    expect(html).toContain("restore the negation in")
    expect(html).toContain("validateCard card-type clause")
    expect(html).toContain("candidate sha256:")
    expect(html).toContain("…6ea4fa")
    expect(html).toContain("Inspect source-host record")
    expect(html).toContain("receipt")
    expect(html).toContain("payment service")
    expect(html).toContain("demo environment")
    expect(html).toContain("H1")
    expect(html).toContain("Review state")
    expect(html).toContain("Release Gate pass")
    expect(html).toContain("Files changed")
    expect(html).toContain("Review diff")
    expect(html).toContain("diff could not be split by file")
    expect(html).toContain("Inspect the raw recorded diff")
    expect(html).toContain("Summary")
    expect(html).toContain("Files changed")
    expect(html).toContain("Replay provenance")
    expect(html).toContain("run run-1")
    // The source-host record is the default inspector record.
    expect(html).toContain("Source-host record")
    expect(html).toContain("Recorded")
    expect(html).toContain("PR number")
    expect(html).toContain("not recorded in this bundle")
    expect(html).not.toContain("github.com")
  })

  test("incident 2 renders the blocked change with no Release Gate", async () => {
    const html = await render("inc-demo-payment-2")
    expect(html).toContain("change Blocked")
    expect(html).toContain("verification-failed")
    expect(html).toContain("Release Gate not reached")
    expect(html).toContain("Some recorded checks did not pass")
    expect(html).toContain("sha256:bb8885")
  })

  test("the Files tab keeps the failed-closed diff and its raw text", async () => {
    const html = await render("inc-demo-payment-1", "files")
    expect(html).toContain("content line before any hunk")
    expect(html).toContain("includes(cardType)")
    expect(html).toContain("open the diff record")
  })

  test("a selected record opens in the inspector", async () => {
    const html = await render("inc-demo-payment-1", "summary", "remediation")
    expect(html).toContain("Remediation")
    expect(html).toContain("restore the negation")
    const raw = await render("inc-demo-payment-1", "summary", "hypothesis:H1")
    expect(raw).toContain("Accepted Hypothesis")
  })

  test("an unknown record falls back to the default source-host record", async () => {
    const html = await render("inc-demo-payment-1", "summary", "evidence:does-not-exist")
    expect(html).toContain("Source-host record")
    expect(html).not.toContain("does-not-exist")
  })
})