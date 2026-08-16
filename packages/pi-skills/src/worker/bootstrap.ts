/**
 * Worker bootstrap: the eight startup inputs from
 * docs/research/pi-agent-catalog.md, assembled before the Orchestrator runs.
 *
 * 1. the scoped run lease (Control Plane-signed; the Worker exchanges its
 *    projected token for it — `LeaseSource`);
 * 2. the journal checkpoint (current stage, per-stage status, restart count,
 *    sealed artifact hashes);
 * 3. the sealed artifacts applicable to the stage, by content hash;
 * 4. the pinned read snapshot paths (read-only: read, grep, find, ls);
 * 5. the Evidence Set revision id;
 * 6. the skills directory digest and tool catalog version;
 * 7. budgets;
 * 8. the Model Gateway configuration (allowed models per role, per policy).
 *
 * The Worker is disposable and untrusted: brokers outside it enforce every
 * access rule, and the journal plus sealed artifacts are the only resume
 * path. The Demo Profile runs the whole Worker in one rootless Docker
 * container per attempt with a read-only root filesystem, all capabilities
 * dropped, and no-new-privileges (the flags below; the compose slice owns
 * the image build).
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

import type { ArtifactEnvelope } from "@sih/contracts/types"
import { contentHash, isHashString } from "@sih/contracts/hashes"

import { BudgetTracker } from "./budgets.js"
import type { Budgets } from "./budgets.js"
import { loadSkillTree, skillsDigest } from "../skill-catalog.js"

export interface LeaseHandle {
  leaseId: string
  token: string
}

/** How the Worker acquires its scoped run lease. The Control Plane issues it
 * (`ControlPlane.startRun` for Detect; per-stage re-issuance for later
 * stages); the Demo Profile boot path calls it directly, and the deployed
 * Worker exchanges its projected token at the Control Plane. This interface
 * keeps the acquisition seam explicit. */
export interface LeaseSource {
  acquire: (
    incidentId: string,
    runId: string,
    stage: string
  ) => Promise<LeaseHandle>
}

export interface Checkpoint {
  incidentId: string
  runId: string
  attempt: number
  currentStage: string
  stageStatus: Record<string, string>
  restartCount: number
  sealedArtifactHashes: string[]
}

export interface StartupInputs {
  leaseSource: LeaseSource
  incidentId: string
  runId: string
  attempt: number
  checkpoint: Checkpoint
  snapshotDir: string
  evidenceRevisionId: string
  skillsRoot: string
  toolCatalogVersion: string
  budgets: Budgets
  /** Allowed model per role, from the Model Gateway configuration. */
  allowedModels: Record<string, string[]>
  artifacts: readonly ArtifactEnvelope[]
}

export class WorkerStartupError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** The Demo Profile rootless Docker flags: read-only root, cap-drop ALL,
 * no-new-privileges, seccomp default, PID and memory bounds, --rm. Host
 * limits stay in the Demo Profile. */
export const ROOTLESS_WORKER_FLAGS = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--rm",
] as const

export interface WorkerRuntime {
  lease: LeaseHandle
  checkpoint: Checkpoint
  snapshot: ReadSnapshot
  evidenceRevisionId: string
  skillsRoot: string
  skillsDigest: string
  toolCatalogVersion: string
  budgets: BudgetTracker
  allowedModels: Readonly<Record<string, string[]>>
  artifacts: ReadonlyMap<string, ArtifactEnvelope>
}

/** The pinned read snapshot: copied into the Worker and mounted read-only,
 * never a host bind mount. Only read tools exist on it. */
export class ReadSnapshot {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async read(relativePath: string): Promise<string> {
    return readFile(this.inside(relativePath), "utf8")
  }

  async ls(relativePath = "."): Promise<string[]> {
    return readdir(this.inside(relativePath))
  }

  async find(name: string): Promise<string[]> {
    const matches: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir)
      for (const entry of entries) {
        const path = join(dir, entry)
        const info = await stat(path)
        if (info.isDirectory()) {
          await walk(path)
        } else if (entry === name) {
          matches.push(path.slice(this.root.length + 1))
        }
      }
    }
    await walk(this.root)
    return matches
  }

  async grep(pattern: string): Promise<string[]> {
    const matches: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir)
      for (const entry of entries) {
        const path = join(dir, entry)
        const info = await stat(path)
        if (info.isDirectory()) {
          await walk(path)
        } else {
          const text = await readFile(path, "utf8").catch(() => null)
          if (text !== null && text.includes(pattern)) {
            matches.push(path.slice(this.root.length + 1))
          }
        }
      }
    }
    await walk(this.root)
    return matches
  }

  /** Only paths inside the snapshot resolve; escape attempts fail closed. */
  private inside(relativePath: string): string {
    const path = resolve(this.root, relativePath)
    if (!path.startsWith(this.root + "/") && path !== this.root) {
      throw new WorkerStartupError(
        "SNAPSHOT_ESCAPE",
        `path ${relativePath} escapes the pinned read snapshot`
      )
    }
    return path
  }
}

/** Assemble the Worker runtime from the fixed startup inputs. */
export async function bootstrapWorker(
  inputs: StartupInputs
): Promise<WorkerRuntime> {
  if (inputs.attempt < 1) {
    throw new WorkerStartupError("BAD_ATTEMPT", "attempt must be >= 1")
  }
  if (inputs.evidenceRevisionId.length === 0) {
    throw new WorkerStartupError(
      "NO_REVISION",
      "Evidence Set revision id required"
    )
  }
  for (const hash of inputs.checkpoint.sealedArtifactHashes) {
    if (!isHashString(hash)) {
      throw new WorkerStartupError(
        "BAD_HASH",
        `artifact hash ${hash} is not a sha256: string`
      )
    }
  }
  const lease = await inputs.leaseSource.acquire(
    inputs.checkpoint.incidentId,
    inputs.checkpoint.runId,
    inputs.checkpoint.currentStage
  )
  if (lease.leaseId.length === 0 || lease.token.length === 0) {
    throw new WorkerStartupError("NO_LEASE", "the run lease is empty")
  }
  const digest = await skillsDigest(inputs.skillsRoot)
  // Skills load at startup; a broken tool group fails the Worker, never
  // widens access.
  await loadSkillTree(inputs.skillsRoot)
  const artifacts = new Map<string, ArtifactEnvelope>()
  for (const artifact of inputs.artifacts) {
    const expected = artifact.content_hash
    const recomputed = contentHash(artifact.payload as never)
    if (!recomputed.ok || recomputed.value !== expected) {
      throw new WorkerStartupError(
        "ARTIFACT_MISMATCH",
        `artifact ${expected} payload does not match its content hash`
      )
    }
    artifacts.set(expected, artifact)
  }
  return {
    lease,
    checkpoint: inputs.checkpoint,
    snapshot: new ReadSnapshot(inputs.snapshotDir),
    evidenceRevisionId: inputs.evidenceRevisionId,
    skillsRoot: inputs.skillsRoot,
    skillsDigest: digest,
    toolCatalogVersion: inputs.toolCatalogVersion,
    budgets: new BudgetTracker(inputs.budgets),
    allowedModels: inputs.allowedModels,
    artifacts,
  }
}

/**
 * Fetch a sealed artifact by content hash from the Control Plane read API
 * and verify the hash before use.
 */
export async function fetchArtifactByHash(options: {
  baseUrl: string
  incidentId: string
  hash: string
}): Promise<ArtifactEnvelope> {
  const response = await fetch(
    `${options.baseUrl}/api/incidents/${options.incidentId}/artifacts/${options.hash}`
  )
  if (!response.ok) {
    throw new WorkerStartupError(
      "ARTIFACT_UNAVAILABLE",
      `artifact ${options.hash}: ${response.status}`
    )
  }
  const envelope = (await response.json()) as ArtifactEnvelope
  if (envelope.content_hash !== options.hash) {
    throw new WorkerStartupError(
      "ARTIFACT_MISMATCH",
      `artifact ${options.hash} returned under hash ${envelope.content_hash}`
    )
  }
  const recomputed = contentHash(envelope.payload as never)
  if (!recomputed.ok || recomputed.value !== options.hash) {
    throw new WorkerStartupError(
      "ARTIFACT_MISMATCH",
      `artifact ${options.hash} payload does not match its content hash`
    )
  }
  return envelope
}
