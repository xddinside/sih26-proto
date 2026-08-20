/**
 * Source-host adapter (issue #32): the Demo Profile's real source host.
 *
 * When a capture runs with the real Gateway provider, the repair stage turns
 * the implementer's captured diff into a real GitHub pull request against a
 * dedicated throwaway repo, and the release stage merges it once the run ships
 * (Run 1 only). Deterministic/fixture runs use the recorded stand-in so
 * automated tests never touch GitHub.
 *
 * Credentials: the adapter runs in the operator environment and shells out to
 * the `gh` CLI, whose auth is already configured (keyring/ssh). The Pi worker
 * never sees a source-host credential — the implementer only returns its diff
 * text, and this adapter performs the git work itself, mirroring how the
 * compose-release adapter holds its own credentials.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export interface SourceHostPR {
  /** The hosted PR URL, or null for a recorded stand-in. */
  prUrl: string | null
  /** The PR number, or null for a recorded stand-in. */
  number: number | null
  branch: string
  headSha: string
}

export interface SourceHostAdapter {
  readonly kind: "real" | "recorded"
  createPullRequest(input: {
    incidentId: string
    runId: string
    diffText: string
    changeDescription: string
  }): Promise<SourceHostPR>
  mergePullRequest(pr: SourceHostPR): Promise<void>
}

/** The default throwaway demo repo (override with SIH_SOURCE_HOST_REPO). */
export function sourceHostRepo(): string {
  return process.env.SIH_SOURCE_HOST_REPO ?? "xddinside/sih26-payment-demo"
}

/** The persistent local clone used by the real adapter. */
export function sourceHostDir(): string {
  return process.env.SIH_SOURCE_HOST_DIR ?? "/tmp/opencode/sih-source-host"
}

/** Sanitize an incident id for use in a git branch name. */
function branchSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.\./g, "-")
}

/** A recorded stand-in PR: no network, no external state. Deterministic and
 * fixture runs use this so automated tests never hit GitHub. */
export function createRecordedSourceHostAdapter(): SourceHostAdapter {
  return {
    kind: "recorded",
    async createPullRequest({ incidentId, runId }) {
      const branch = `remediate/incident-${branchSafe(incidentId)}`
      return { prUrl: null, number: null, branch, headSha: `recorded-sha-${branchSafe(runId)}` }
    },
    async mergePullRequest() {},
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", args, { cwd })
  return stdout.trim()
}

/** Ensure the local clone exists and is on the current origin main. */
async function ensureClone(repo: string, dir: string): Promise<void> {
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true })
    await exec("gh", ["repo", "clone", repo, dir], {})
  }
  await git(["fetch", "--prune", "origin"], dir)
  await git(["checkout", "-B", "main", "origin/main"], dir)
  await git(["reset", "--hard", "origin/main"], dir)
  await git(["clean", "-fd"], dir)
}

/** Apply a unified diff to the working tree with `git apply`. The implementer
 * diff is built by splitting file text on "\n", which appends a phantom empty
 * element when the file ends with a newline; the `-`/`+` blocks then carry a
 * trailing empty line that does not exist in the real file, and `git apply`
 * rejects it. Those phantom lines are dropped and `--recount` recomputes the
 * hunk counts. */
async function applyDiff(dir: string, diffText: string): Promise<void> {
  const lines = diffText.split("\n")
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"))
  if (hunkStart !== -1) {
    const body = lines.slice(hunkStart + 1)
    let lastRemoved = -1
    for (let i = 0; i < body.length && body[i].startsWith("-"); i += 1) {
      if (body[i] !== "---") lastRemoved = i
    }
    if (lastRemoved !== -1 && body[lastRemoved] === "-") body.splice(lastRemoved, 1)
    if (body[body.length - 1] === "+") body.pop()
    lines.splice(hunkStart + 1, lines.length - hunkStart - 1, ...body)
  }
  while (
    lines.length > 0 &&
    (lines[lines.length - 1] === "-" ||
      lines[lines.length - 1] === "+" ||
      lines[lines.length - 1] === "")
  ) {
    lines.pop()
  }
  const patchPath = join(dir, ".sih-implementer.patch")
  writeFileSync(patchPath, lines.join("\n") + "\n", "utf8")
  try {
    await exec("git", ["apply", "--recount", "--whitespace=nowarn", patchPath], { cwd: dir })
  } finally {
    await exec("rm", ["-f", patchPath], {}).catch(() => undefined)
  }
}

/** Create a real GitHub pull request from the implementer's diff. */
export function createRealSourceHostAdapter(options: { repo?: string; dir?: string } = {}): SourceHostAdapter {
  const repo = options.repo ?? sourceHostRepo()
  const dir = options.dir ?? sourceHostDir()
  return {
    kind: "real",
    async createPullRequest({ incidentId, runId, diffText, changeDescription }) {
      await ensureClone(repo, dir)
      const branch = `remediate/${branchSafe(incidentId)}-${branchSafe(runId)}`
      const existing = await git(["branch", "--list", branch], dir)
      if (existing.length === 0) {
        await git(["checkout", "-b", branch], dir)
      } else {
        await git(["checkout", branch], dir)
        await git(["reset", "--hard", "origin/main"], dir)
      }
      await applyDiff(dir, diffText)
      const status = await git(["status", "--porcelain"], dir)
      if (status.length === 0) {
        throw new Error(`source-host: implementer diff produced no change against ${repo} main`)
      }
      await git(["add", "-A"], dir)
      const commitMessage = `remediate: ${changeDescription.split("\n")[0] ?? "payment charge failure"}\n\nIncident ${incidentId} run ${runId}.`
      await exec("git", ["-C", dir, "config", "user.email", "sih-agent@sih.dev"], {})
      await exec("git", ["-C", dir, "config", "user.name", "sih-demo-agent"], {})
      await git(["commit", "-m", commitMessage], dir)
      await git(["push", "-u", "origin", branch], dir)
      const headSha = await git(["rev-parse", "HEAD"], dir)
      const { stdout: prOut } = await exec(
        "gh",
        [
          "pr", "create", "-R", repo, "--base", "main", "--head", branch,
          "--title", `Remediate ${incidentId} (${runId})`,
          "--body", `Automated remediation PR from the SIH 2026 incident demo.\n\n${changeDescription}`,
        ],
        {},
      )
      const prUrl = prOut.trim().split("\n").pop() ?? ""
      const numberMatch = prUrl.match(/\/(\d+)\/?$/)
      return { prUrl: prUrl.length > 0 ? prUrl : null, number: numberMatch === null ? null : Number(numberMatch[1]), branch, headSha }
    },
    async mergePullRequest(pr) {
      if (pr.prUrl === null) {
        return
      }
      await exec("gh", ["pr", "merge", pr.prUrl, "-R", repo, "--squash", "--delete-branch"], {}).catch((error) => {
        console.log(`[source-host] PR merge skipped: ${(error as Error).message}`)
      })
    },
  }
}
