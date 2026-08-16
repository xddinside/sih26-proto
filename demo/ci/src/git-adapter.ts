/**
 * Local git adapter: the Demo Profile stand-in for a source host. A Worker's
 * repair produces a candidate in a bare repository plus a worktree, and the
 * adapter computes the candidate content hash from the full change set.
 */
import { execFile } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { candidateHash, contentHash } from "@sih/contracts/hashes"

const exec = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd })
  return stdout.trim()
}

export interface GitAdapterOptions {
  /** Where the bare repository and worktrees live. */
  root?: string
}

export interface CandidateResult {
  candidateHash: string
  diffHash: string
  baseRef: string
  branch: string
  repoPath: string
  worktreePath: string
}

/**
 * A local bare git repository plus the means to apply a repair and compute a
 * content-hashed candidate. The Demo Profile uses a PR-shaped record, not a
 * hosted pull request.
 */
export class LocalGitAdapter {
  readonly root: string
  readonly barePath: string

  constructor(options: GitAdapterOptions = {}) {
    this.root = options.root ?? mkdtempSync(join(tmpdir(), "sih-ci-"))
    this.barePath = join(this.root, "repo.git")
  }

  /** Initialize the bare repository and seed an initial commit. */
  async init(seedFiles: Record<string, string> = { "README.md": "# demo\n" }): Promise<string> {
    if (!existsSync(this.barePath)) {
      await exec("git", ["init", "--bare", this.barePath], {})
    }
    const seedDir = join(this.root, "seed")
    if (!existsSync(seedDir)) {
      await exec("git", ["init", seedDir], {})
      await exec("git", ["-C", seedDir, "config", "user.email", "agent@sih.dev"], {})
      await exec("git", ["-C", seedDir, "config", "user.name", "sih-agent"], {})
      for (const [file, content] of Object.entries(seedFiles)) {
        const target = join(seedDir, file)
        await exec("mkdir", ["-p", join(target, "..")], {})
        writeFileSync(target, content)
      }
      await git(["add", "-A"], seedDir)
      await git(["commit", "-m", "seed"], seedDir)
      await git(["remote", "add", "origin", this.barePath], seedDir)
      await git(["push", "-u", "origin", "HEAD"], seedDir)
    }
    return this.barePath
  }

  /** Create a fresh worktree for a branch. */
  async worktree(branch: string): Promise<string> {
    const worktreePath = join(this.root, `worktree-${branch.replace(/[/]/g, "-")}`)
    if (!existsSync(worktreePath)) {
      await git(["clone", this.barePath, worktreePath], this.root)
      await git(["checkout", "-b", branch], worktreePath)
      await exec("git", ["-C", worktreePath, "config", "user.email", "agent@sih.dev"], {})
      await exec("git", ["-C", worktreePath, "config", "user.name", "sih-agent"], {})
    }
    return worktreePath
  }

  /** Apply a patch (new or changed file contents) and commit it on a branch. */
  async applyPatch(branch: string, changes: Record<string, string>): Promise<string> {
    const worktreePath = await this.worktree(branch)
    for (const [file, content] of Object.entries(changes)) {
      const target = join(worktreePath, file)
      await exec("mkdir", ["-p", join(target, "..")], {})
      writeFileSync(target, content)
    }
    await git(["add", "-A"], worktreePath)
    await git(["commit", "-m", `remediate/incident`], worktreePath)
    await git(["push", "-u", "origin", branch], worktreePath)
    return worktreePath
  }

  async currentRef(worktreePath: string): Promise<string> {
    return git(["rev-parse", "HEAD"], worktreePath)
  }

  /** The diff hash of the candidate against its base. */
  async diffHash(worktreePath: string, baseRef: string): Promise<string> {
    const diff = await git(["diff", `${baseRef}..HEAD`], worktreePath)
    const hash = contentHash({ diff })
    return hash.ok ? hash.value : "sha256:" + "0".repeat(64)
  }

  /** Compute the candidate content hash over the full change set. */
  async candidate(input: {
    baseRef: string
    diffText: string
    changedSurfaces: string[]
    actionRiskClass: "safe" | "guarded" | "barred"
    gatePath: "release" | "action"
    target: { tenant_id: string; deployment_environment_name: string; service_name: string; expected_version?: string }
    recoveryPointHash: string
    remediationClass:
      | "code"
      | "configuration"
      | "feature-flags"
      | "deployment"
      | "restart-scale-traffic"
      | "infrastructure"
      | "database-data"
      | "credentials"
      | "emergency-rollback"
    disposition: "allowed" | "approval-required" | "prohibited" | "observe-only"
    description: string
  }): Promise<string> {
    const descriptionHash = contentHash({ description: input.description })
    const hash = candidateHash({
      schema_version: "1.0",
      base_ref: input.baseRef,
      change: { kind: "diff", base_ref: input.baseRef, diff_text: input.diffText },
      proposal: {
        remediation_class: input.remediationClass,
        disposition: input.disposition,
        ...(descriptionHash.ok ? { description_hash: descriptionHash.value } : {}),
      },
      changed_surfaces: input.changedSurfaces,
      action_risk_class: input.actionRiskClass,
      gate_path: input.gatePath,
      target: input.target,
      recovery_point_hash: input.recoveryPointHash,
    })
    return hash.ok ? hash.value : "sha256:" + "0".repeat(64)
  }

  /** Read a file from the worktree. */
  readFile(worktreePath: string, file: string): string {
    return readFileSync(join(worktreePath, file), "utf8")
  }
}
