/**
 * captureRun-level failure retention test (issue #30, AC 12). This is the
 * only Docker-gated test in the suite: `captureRun` resets the Control Plane
 * database through `scripts/db.sh` (docker exec), so it skips cleanly on a
 * host without Docker.
 *
 * It drives the real `captureRun` CLI path for a deterministic full capture
 * whose tiny wall-clock budget aborts mid-run, then proves the failed
 * attempt was retained in the append-only dev store with its partial
 * artifacts and cannot be finalized or promoted.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { beforeAll, describe, expect, test } from "bun:test"

import { captureRun, finalize } from "../capture.ts"
import { stagingDir } from "../src/export.js"
import { listCaptureRecords, runReachedTerminalState, devStoreFile } from "../src/dev-store.js"

process.env.SIH_HMAC_SECRET = "test-hmac-secret"
process.env.SIH_BROKER_TOKEN = "test-broker-token"
process.env.SIH_OPERATOR_TOKEN = "test-operator-token"

const dockerOk = (() => {
  try {
    const result = spawnSync("sg", ["docker", "-c", "docker info"], {
      timeout: 15_000,
      encoding: "utf8",
    })
    return result.status === 0
  } catch {
    return false
  }
})()

let tempStore: string

describe.skipIf(!dockerOk)("captureRun failure retention (Docker-gated)", () => {
  beforeAll(async () => {
    // Redirect the append-only dev store to a temp directory and clear the
    // scratch staging so no prior run interferes with the assertions.
    tempStore = await mkdtemp(join(tmpdir(), "sih-capture-retention-"))
    process.env.SIH_DEV_STORE_ROOT = tempStore
    await rm(stagingDir(1), { recursive: true, force: true })
    await rm(stagingDir(2), { recursive: true, force: true })
  })

  test("a failed full capture is retained as a partial dev-store record", async () => {
    await expect(
      captureRun(2, {
        demoRepo: "/tmp/opencode/demo-repo",
        skipBaseline: true,
        offline: true,
        agents: "real",
        mode: "full-capture",
        provider: "deterministic",
        model: "deepseek-v4-flash",
        reasoning: "high",
        budgets: {
          model_turns: 20,
          non_terminal_tool_calls: 32,
          session_wall_clock_ms: 12 * 60_000,
          run_wall_clock_ms: 1,
        },
      }),
    ).rejects.toThrow(/wall-clock budget exhausted|session aborted/)

    const records = await listCaptureRecords()
    const retained = records.find((record) => record.run === 2 && record.mode === "full-capture")
    expect(retained).toBeDefined()
    if (retained === undefined) return
    expect(retained.status).toBe("partial")
    expect(retained.agents).toBe("real")
    expect(retained.provider).toBe("deterministic")
    expect(retained.manifestSealed).toBe(false)
    expect(retained.finalRunState).toBe("failed")
    expect(retained.runPath).toMatch(/inc-demo-payment-2-partial$/)
    expect(runReachedTerminalState(retained)).toBe(false)

    // The retained run directory carries the partial artifacts and the
    // explicit failure record; a partial cannot be finalized as a success.
    const failure = JSON.parse(
      await readFile(join(tempStore, retained.runPath, "failure.json"), "utf8"),
    ) as { status: string; run: number; scenario: string; provider: string }
    expect(failure.status).toBe("partial")
    expect(failure.run).toBe(2)
    expect(failure.scenario).toBe("S2")
    expect(failure.provider).toBe("deterministic")

    // Stage a partial run 1 alongside the failed run 2 and prove finalize
    // refuses to promote the incomplete pair.
    await mkdir(join(stagingDir(1), "incidents"), { recursive: true })
    await writeFile(
      join(stagingDir(1), "capture.json"),
      JSON.stringify({
        run: 1,
        savedId: "inc-demo-payment-1",
        mode: "full-capture",
        agents: "real",
        manifestSealed: false,
        finalSequence: 1,
      }),
      "utf8",
    )
    await expect(finalize()).rejects.toThrow(/not a completed real full-capture/)
  })

  test("the deterministic failure never enters the presentation streak", async () => {
    const records = await listCaptureRecords()
    const partial = records.find((record) => record.run === 2 && record.status === "partial")
    expect(partial).toBeDefined()
    expect(runReachedTerminalState(partial!)).toBe(false)
  })

  test("the temp dev store keeps the append-only file alongside the run dir", async () => {
    const file = devStoreFile()
    const text = await readFile(file, "utf8")
    expect(text.trim().split("\n")).toHaveLength((await listCaptureRecords()).length)
  })
})
