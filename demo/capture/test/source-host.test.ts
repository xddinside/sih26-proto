/**
 * Source-host adapter tests (issue #32). The recorded adapter is the
 * deterministic/fixture stand-in: it never touches the network and returns
 * the recorded branch shape the older "PR-shaped record" receipts used.
 */
import { describe, expect, test } from "bun:test"

import { createRecordedSourceHostAdapter, sourceHostRepo } from "../src/source-host.js"

describe("source-host adapter (issue #32)", () => {
  test("the recorded adapter returns a stand-in PR without any network call", async () => {
    const adapter = createRecordedSourceHostAdapter()
    expect(adapter.kind).toBe("recorded")
    const pr = await adapter.createPullRequest({
      incidentId: "inc-demo-payment-1",
      runId: "run-1",
      diffText: "--- a/src/payment/card.js\n+++ b/src/payment/card.js\n@@ -1 +1 @@\n-seeded\n+fixed",
      changeDescription: "one-line card-type clause restoration",
    })
    expect(pr.prUrl).toBeNull()
    expect(pr.number).toBeNull()
    expect(pr.branch).toBe("remediate/incident-inc-demo-payment-1")
    expect(pr.headSha).toMatch(/^recorded-sha-/)
    // Merge is a no-op for the recorded stand-in.
    await expect(adapter.mergePullRequest(pr)).resolves.toBeUndefined()
  })

  test("the default source-host repo is the dedicated throwaway demo repo", () => {
    expect(sourceHostRepo()).toContain("sih26-payment-demo")
  })
})
