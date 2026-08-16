/**
 * The Demo Profile skill catalog from docs/research/pi-agent-catalog.md §10:
 * every skill is a directory under the Worker image's read-only skills root,
 * shipped and pinned by image digest, never installed during a run.
 *
 * Each skill directory holds `SKILL.md` (standard frontmatter + role contract
 * prose), `contract.json` (SIH metadata: version, stage, tool group, access,
 * independence, scope, output schema ref), and `schemas/`. Output schemas
 * reference the `@sih/contracts` registry by name and version; no skill may
 * define a duplicate schema for a registry-owned artifact.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

import { classifySchema, SCHEMA_REGISTRY } from "@sih/contracts/schemas"
import { contentHash, sha256Bytes } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"

import { resolveAllowList } from "./allow-lists.js"

export interface SkillContract {
  name: string
  version: string
  stage: string
  tool_group: string
  access: string
  independence: string
  scope: "solution" | "demo" | "both"
  role_code?: string
  layer?: string
  output_schema?: { name: string; version: string }
  retry: {
    malformed: "rerun-once-then-needs-human"
    timeout: "rerun-once-then-needs-human"
  }
  demo_subset: boolean
}

export interface Skill {
  dir: string
  contract: SkillContract
  skillMd: string
}

/** The exact Demo Profile subset from docs/build-handoff.md §10. */
export const DEMO_SKILL_NAMES: readonly string[] = [
  "sih-orchestrator",
  "sih-fusion-participant",
  "sih-fusion-judge",
  "sih-fusion-synthesizer",
  "sih-repair-planner",
  "sih-repair-implementer",
  "sih-review-correctness",
  "sih-review-causal-fit",
  "sih-review-code-quality",
  "sih-review-security",
  "sih-review-recovery-point",
  "sih-test-static-analysis",
  "sih-test-build",
  "sih-test-unit",
  "sih-test-contract",
  "sih-test-regression",
  "sih-test-security-scan",
  "sih-test-isolated-env",
  "sih-test-browser",
  "sih-test-fault-recovery",
  "sih-test-watch-rehearsal",
] as const

/** Solution Contract only: not packaged for the Demo Profile. */
export const NOT_DEMO_SKILL_NAMES: readonly string[] = [
  "sih-review-dependencies",
  "sih-review-data-migration",
  "sih-review-infrastructure",
  "sih-review-operations",
  "sih-test-fuzz",
  "sih-test-migration",
  "sih-test-load",
] as const

const CONTRACT_REQUIRED_FIELDS = [
  "name",
  "version",
  "stage",
  "tool_group",
  "access",
  "independence",
  "scope",
  "retry",
  "demo_subset",
] as const

/** Skills without a registry-owned output schema produce a stage proposal or
 * a candidate diff that the Control Plane seals. */
const PROPOSAL_SKILLS: ReadonlySet<string> = new Set([
  "sih-orchestrator",
  "sih-repair-implementer",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Parse and check one skill directory's `contract.json`. */
export async function loadSkill(dir: string): Promise<Skill> {
  const contractText = await readFile(join(dir, "contract.json"), "utf8")
  const skillMd = await readFile(join(dir, "SKILL.md"), "utf8")
  const parsed: unknown = JSON.parse(contractText)
  if (!isRecord(parsed)) {
    throw new Error(`${dir}: contract.json is not an object`)
  }
  for (const field of CONTRACT_REQUIRED_FIELDS) {
    if (parsed[field] === undefined) {
      throw new Error(`${dir}: contract.json missing field ${field}`)
    }
  }
  if (
    typeof parsed.name !== "string" ||
    !/^[a-z0-9-]{1,64}$/.test(parsed.name)
  ) {
    throw new Error(
      `${dir}: contract name must be lowercase-hyphens, <= 64 chars`
    )
  }
  const outputSchema = parsed.output_schema
  if (outputSchema === undefined) {
    if (!PROPOSAL_SKILLS.has(parsed.name)) {
      throw new Error(`${dir}: ${parsed.name} must declare output_schema`)
    }
  } else if (
    !isRecord(outputSchema) ||
    typeof outputSchema.name !== "string" ||
    typeof outputSchema.version !== "string"
  ) {
    throw new Error(
      `${dir}: output_schema must name a registry schema and version`
    )
  } else {
    const classification = classifySchema(
      outputSchema.name,
      outputSchema.version
    )
    if (classification.kind !== "ok") {
      throw new Error(
        `${dir}: output_schema ${outputSchema.name}@${outputSchema.version} is not registered`
      )
    }
  }
  const contract = parsed as unknown as SkillContract
  // A broken tool group fails the skill load, never silently widens access.
  resolveAllowList(contract.tool_group)
  return { dir, contract, skillMd }
}

/** Load every skill under the skills root (core/, reviews/, tests/). */
export async function loadSkillTree(root: string): Promise<Map<string, Skill>> {
  const skills = new Map<string, Skill>()
  for (const group of ["core", "reviews", "tests"]) {
    const groupDir = join(root, group)
    const entries = await readdir(groupDir).catch(() => [])
    for (const entry of entries) {
      const dir = join(groupDir, entry)
      const info = await stat(dir).catch(() => null)
      if (info === null || !info.isDirectory()) {
        continue
      }
      const skill = await loadSkill(dir)
      if (skills.has(skill.contract.name)) {
        throw new Error(`duplicate skill name ${skill.contract.name}`)
      }
      skills.set(skill.contract.name, skill)
    }
  }
  return skills
}

/**
 * The Demo Profile builds exactly the subset of §10 of the build handoff:
 * the six core skills, reviews R1-R4 and R8, and tests T1-T5, T7, T9, T10,
 * T12, T13. R5-R7, R9, T6, T8, and T11 stay Solution Contract only.
 */
export function assertDemoSubset(skills: ReadonlyMap<string, Skill>): void {
  for (const name of DEMO_SKILL_NAMES) {
    if (!skills.has(name)) {
      throw new Error(`demo subset missing skill ${name}`)
    }
  }
  for (const name of NOT_DEMO_SKILL_NAMES) {
    if (skills.has(name)) {
      throw new Error(
        `skill ${name} is Solution Contract only; not packaged for the demo`
      )
    }
  }
  const packaged = new Set(skills.keys())
  for (const name of [...DEMO_SKILL_NAMES, ...NOT_DEMO_SKILL_NAMES]) {
    packaged.delete(name)
  }
  if (packaged.size > 0) {
    throw new Error(`unknown skills packaged: ${[...packaged].join(", ")}`)
  }
}

/**
 * The skills/tool-catalog digest recorded with the run: a content hash over
 * every file in the skills tree, so a changed tree changes the digest.
 */
export async function skillsDigest(root: string): Promise<HashString> {
  const files: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const path = join(dir, entry)
      const info = await stat(path)
      if (info.isDirectory()) {
        await walk(path)
      } else {
        const bytes = await readFile(path)
        files[path.replace(root, "").replace(/^[/\\]/, "")] = sha256Bytes(bytes)
      }
    }
  }
  await walk(root)
  const digest = contentHash(files)
  if (!digest.ok) {
    throw new Error(`skills digest failed: ${digest.error.message}`)
  }
  return digest.value
}

/** The schema registry is the single source of every skill output schema. */
export function registeredSchemaNames(): string[] {
  return Object.keys(SCHEMA_REGISTRY)
}
