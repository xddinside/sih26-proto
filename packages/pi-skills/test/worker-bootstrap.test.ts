/**
 * Worker bootstrap tests: lease acquisition, checkpoint and artifact hash
 * verification, the pinned read snapshot, budgets (which caps the Demo
 * Profile removes and which stay), and the rootless Worker flags.
 */
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { contentHash } from "@sih/contracts/hashes"

import {
  bootstrapWorker,
  ReadSnapshot,
  ROOTLESS_WORKER_FLAGS,
  WorkerStartupError,
} from "../src/worker/bootstrap.js"
import {
  DEMO_BUDGETS,
  BudgetTracker,
  PRODUCTION_BUDGETS,
} from "../src/worker/budgets.js"
import type { LeaseHandle, StartupInputs } from "../src/worker/bootstrap.js"
import { fixtureHash } from "./helpers.js"

function startupInputs(
  leaseSource: StartupInputs["leaseSource"],
  artifacts: StartupInputs["artifacts"] = []
): StartupInputs {
  return {
    leaseSource,
    incidentId: "inc-test",
    runId: "run-1",
    attempt: 1,
    checkpoint: {
      incidentId: "inc-test",
      runId: "run-1",
      attempt: 1,
      currentStage: "detect",
      stageStatus: { detect: "entered" },
      restartCount: 0,
      sealedArtifactHashes: [],
    },
    snapshotDir: "/tmp/pi-skills-snapshot",
    evidenceRevisionId: fixtureHash("revision-1"),
    skillsRoot: join(import.meta.dir, ".."),
    toolCatalogVersion: "tool-catalog@1.0",
    budgets: DEMO_BUDGETS,
    allowedModels: {
      participant: ["stub-participant-1"],
      judge: ["stub-judge"],
      synthesizer: ["stub-synthesizer"],
    },
    artifacts,
  }
}

const leaseSource = (handle: LeaseHandle): StartupInputs["leaseSource"] => ({
  async acquire(incidentId, runId, stage) {
    expect(incidentId).toBe("inc-test")
    expect(runId).toBe("run-1")
    expect(stage).toBe("detect")
    return handle
  },
})

describe("worker bootstrap", () => {
  test("acquires the run lease for the checkpoint stage and assembles the runtime", async () => {
    const runtime = await bootstrapWorker(
      startupInputs(leaseSource({ leaseId: "lease-1", token: "tok" }))
    )
    expect(runtime.lease.leaseId).toBe("lease-1")
    expect(runtime.checkpoint.currentStage).toBe("detect")
    expect(runtime.skillsDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(runtime.toolCatalogVersion).toBe("tool-catalog@1.0")
  })

  test("an empty lease fails startup", async () => {
    await expect(
      bootstrapWorker(
        startupInputs({
          acquire: async (
            _incidentId: string,
            _runId: string,
            _stage: string
          ) => ({
            leaseId: "",
            token: "",
          }),
        })
      )
    ).rejects.toThrow("lease is empty")
  })

  test("a tampered artifact payload fails startup with ARTIFACT_MISMATCH", async () => {
    const payload = { schema_version: "1.0", value: 1 }
    const digest = contentHash(payload)
    if (!digest.ok) {
      throw new Error("unreachable")
    }
    const envelope = {
      schema_version: "1.0" as const,
      artifact_schema_id: "test",
      artifact_schema_version: "1.0",
      content_hash: digest.value,
      sealed_at: new Date().toISOString(),
      incident_id: "inc-test",
      run_id: "run-1",
      producer: { skill: "test", skill_version: "1.0" },
      payload: { ...payload, value: 2 },
    }
    await expect(
      bootstrapWorker(
        startupInputs(leaseSource({ leaseId: "l", token: "t" }), [envelope])
      )
    ).rejects.toThrow("does not match its content hash")
  })

  test("a valid artifact is indexed by its content hash", async () => {
    const payload = { schema_version: "1.0", value: 1 }
    const digest = contentHash(payload)
    if (!digest.ok) {
      throw new Error("unreachable")
    }
    const envelope = {
      schema_version: "1.0" as const,
      artifact_schema_id: "test",
      artifact_schema_version: "1.0",
      content_hash: digest.value,
      sealed_at: new Date().toISOString(),
      incident_id: "inc-test",
      run_id: "run-1",
      producer: { skill: "test", skill_version: "1.0" },
      payload,
    }
    const runtime = await bootstrapWorker(
      startupInputs(leaseSource({ leaseId: "l", token: "t" }), [envelope])
    )
    expect(runtime.artifacts.get(digest.value)?.payload).toEqual(payload)
  })

  test("a bad artifact hash in the checkpoint fails startup", async () => {
    const inputs = startupInputs(leaseSource({ leaseId: "l", token: "t" }))
    inputs.checkpoint.sealedArtifactHashes = ["not-a-hash"]
    await expect(bootstrapWorker(inputs)).rejects.toThrow("sha256:")
  })
})

describe("pinned read snapshot", () => {
  test("read, ls, grep, and find work; paths escaping the snapshot fail closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sih-snapshot-"))
    await writeFile(join(dir, "a.txt"), "hello world\n")
    const snapshot = new ReadSnapshot(dir)
    expect(await snapshot.read("a.txt")).toContain("hello")
    expect(await snapshot.ls()).toContain("a.txt")
    expect(await snapshot.grep("hello")).toContain("a.txt")
    expect(await snapshot.find("a.txt")).toContain("a.txt")
    expect(snapshot.read("../etc/passwd")).rejects.toThrow("escapes")
  })
})

describe("budgets", () => {
  test("the Demo Profile removes only the research, action, time, token, and cost caps", () => {
    expect(DEMO_BUDGETS.wallTimeMs).toBeNull()
    expect(DEMO_BUDGETS.tokenCap).toBeNull()
    expect(DEMO_BUDGETS.costCapUsd).toBeNull()
    expect(DEMO_BUDGETS.fusionRoundCap).toBeNull()
    expect(DEMO_BUDGETS.evidenceActionCap).toBeNull()
    expect(DEMO_BUDGETS.brokerActionCap).toBeNull()
    // Attempt Limit, revision cap, restart cap, gates, approvals, leases,
    // cancel, cleanup, and host limits stay.
    expect(DEMO_BUDGETS.attemptLimit).toBe(3)
    expect(DEMO_BUDGETS.revisionCap).toBe(2)
    expect(DEMO_BUDGETS.workerRestartCap).toBe(2)
    expect(DEMO_BUDGETS.attemptLimit).toBe(PRODUCTION_BUDGETS.attemptLimit)
  })

  test("null caps never block; the revision cap always blocks", () => {
    const tracker = new BudgetTracker(DEMO_BUDGETS)
    expect(tracker.consume("fusion-round").allowed).toBe(true)
    expect(tracker.consume("revision").allowed).toBe(true)
    expect(tracker.consume("revision").allowed).toBe(true)
    expect(tracker.consume("revision").allowed).toBe(false)
  })

  test("production fusion-round cap blocks past three rounds", () => {
    const tracker = new BudgetTracker(PRODUCTION_BUDGETS)
    tracker.consume("fusion-round")
    tracker.consume("fusion-round")
    expect(tracker.consume("fusion-round").allowed).toBe(true)
    expect(tracker.consume("fusion-round").allowed).toBe(false)
  })
})

describe("rootless Worker flags", () => {
  test("read-only root, cap-drop ALL, no-new-privileges, and --rm stay in the Demo Profile", () => {
    expect(ROOTLESS_WORKER_FLAGS).toContain("--read-only")
    expect(ROOTLESS_WORKER_FLAGS).toContain("--cap-drop=ALL")
    expect(ROOTLESS_WORKER_FLAGS).toContain("--security-opt=no-new-privileges")
    expect(ROOTLESS_WORKER_FLAGS).toContain("--rm")
  })
})

describe("worker startup errors", () => {
  test("errors carry stable codes", () => {
    expect(new WorkerStartupError("NO_LEASE", "x").code).toBe("NO_LEASE")
  })
})
