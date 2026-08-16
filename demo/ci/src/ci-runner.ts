/**
 * Local CI-shaped runner: runs a scoped command against a candidate in a fresh
 * worktree and returns a CI-shaped receipt. The Demo Profile stand-in for the
 * company pipeline; the product never re-runs what the company already ran.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { contentHash } from "@sih/contracts/hashes"

const exec = promisify(execFile)

export interface ScopedRun {
  /** The command and args to run, scoped to the candidate worktree. */
  command: string[]
  workdir: string
  candidateHash: string
  layer?: string
}

export interface ScopedResult {
  status: "success" | "failure"
  exitCode: number
  stdout: string
  stderr: string
  receipt: CIRunReceipt
}

export interface CIRunReceipt {
  pipeline: string
  pipeline_run_id: string
  candidate_hash: string
  steps: { name: string; status: "success" | "failure"; log_ref?: string }[]
  status: "success" | "failure"
  artifact_digest: string
}

/**
 * The CI runner. It executes a scoped command in the candidate worktree and
 * emits a CI-shaped receipt bound to the candidate hash. It never mutates
 * shared state and never reaches production.
 */
export class CIRunner {
  constructor(private readonly pipeline = "local-ci") {}

  async run(request: ScopedRun): Promise<ScopedResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    try {
      const result = await exec(request.command[0] ?? "true", request.command.slice(1), {
        cwd: request.workdir,
        timeout: 60_000,
      })
      stdout = result.stdout
      stderr = result.stderr
      exitCode = 0
    } catch (cause) {
      const failure = cause as { code?: number | string; stdout?: string; stderr?: string }
      stdout = failure.stdout ?? ""
      stderr = failure.stderr ?? ""
      exitCode = typeof failure.code === "number" ? failure.code : 1
    }

    const status: "success" | "failure" = exitCode === 0 ? "success" : "failure"
    const logRef = contentHash({ stdout, stderr, exitCode })
    const receipt: CIRunReceipt = {
      pipeline: this.pipeline,
      pipeline_run_id: `ci-${request.candidateHash.slice(0, 16)}-${Date.now().toString(36)}`,
      candidate_hash: request.candidateHash,
      steps: [
        {
          name: request.layer ?? "scoped-command",
          status,
          ...(logRef.ok ? { log_ref: logRef.value } : {}),
        },
      ],
      status,
      artifact_digest: request.candidateHash,
    }

    return { status, exitCode, stdout, stderr, receipt }
  }
}
