/**
 * Demo CI tests: the local git adapter produces a content-hashed candidate,
 * the CI runner executes a scoped command and emits a CI-shaped receipt, and
 * the Compose release adapter contract declares reads/writes/idempotency.
 */
import { describe, expect, test } from "bun:test"
import { isHashString } from "@sih/contracts/hashes"

import { CIRunner } from "../src/ci-runner.js"
import { LocalGitAdapter } from "../src/git-adapter.js"
import { COMPOSE_RELEASE_CONTRACT, findContract, isWriteApproved } from "../src/release-adapter.js"

describe("Local git adapter", () => {
  test("produces a candidate with a content hash over the full change set", async () => {
    const adapter = new LocalGitAdapter()
    const bare = await adapter.init({ "src/payment/card.js": "if (true) {}\n" })
    expect(bare).toMatch(/repo\.git$/)

    const worktree = await adapter.applyPatch("remediate/incident-1", {
      "src/payment/card.js": "if (!['visa','mastercard'].includes(cardType)) {}\n",
    })
    const head = await adapter.currentRef(worktree)
    const diffHash = await adapter.diffHash(worktree, "HEAD~1")

    const candidate = await adapter.candidate({
      baseRef: head,
      diffText: "restore negation",
      changedSurfaces: ["src/payment/card.js"],
      actionRiskClass: "safe",
      gatePath: "release",
      target: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
      recoveryPointHash: diffHash,
      remediationClass: "code",
      disposition: "allowed",
      description: "restore card-type negation",
    })
    expect(isHashString(candidate)).toBe(true)
    expect(isHashString(diffHash)).toBe(true)
    expect(adapter.readFile(worktree, "src/payment/card.js")).toContain("cardType")
  })
})

describe("CI runner", () => {
  test("runs a scoped command and emits a CI-shaped receipt", async () => {
    const adapter = new LocalGitAdapter()
    await adapter.init()
    const worktree = await adapter.worktree("ci-test")
    const runner = new CIRunner()
    const result = await runner.run({
      command: ["node", "-e", "console.log('ok')"],
      workdir: worktree,
      candidateHash: "sha256:" + "c".repeat(64),
      layer: "T2",
    })
    expect(result.status).toBe("success")
    expect(result.receipt.status).toBe("success")
    expect(result.receipt.candidate_hash).toBe("sha256:" + "c".repeat(64))
    expect(result.receipt.pipeline).toBe("local-ci")
  })

  test("a failing command produces a failure receipt", async () => {
    const adapter = new LocalGitAdapter()
    await adapter.init()
    const worktree = await adapter.worktree("ci-fail")
    const runner = new CIRunner()
    const result = await runner.run({
      command: ["node", "-e", "process.exit(3)"],
      workdir: worktree,
      candidateHash: "sha256:" + "d".repeat(64),
    })
    expect(result.status).toBe("failure")
    expect(result.receipt.status).toBe("failure")
  })
})

describe("Compose release adapter contract", () => {
  test("declares reads, write classes, idempotency, and credential needs", () => {
    expect(COMPOSE_RELEASE_CONTRACT.length).toBeGreaterThanOrEqual(4)
    for (const entry of COMPOSE_RELEASE_CONTRACT) {
      expect(entry.credentials.never_issued_to_worker).toBe(true)
      expect(entry.idempotency.stores_first_result).toBe(true)
    }
  })

  test("isWriteApproved resolves the per-system table", () => {
    expect(isWriteApproved("compose-release", "submit_typed_action")).toBe(true)
    expect(isWriteApproved("compose-release", "submit_remediation_pr")).toBe(false)
    expect(isWriteApproved("local-git", "submit_remediation_pr")).toBe(true)
    expect(findContract("unknown-adapter")).toBeUndefined()
  })
})
