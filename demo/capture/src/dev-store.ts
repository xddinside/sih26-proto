/**
 * The append-only dev store for real-agent captures (issue #23). Every real
 * capture appends one record; fixture runs never enter the store, and a
 * failed capture is recorded as failed, never replaced by a canned run.
 * Presentation selection (issue #31) requires three consecutive eligible
 * full-capture runs per scenario, each under one unchanged configuration
 * digest, and records the selection provenance back into this store.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { contentHash } from "@sih/contracts/hashes"
import type { CaptureManifest } from "@sih/contracts/types"

export interface StoredCaptureRecord {
  version: 1
  /** The captured scenario id (S1/S2). */
  run: 1 | 2
  scenario: string
  agents: "fixture" | "real"
  mode: "rehearsal" | "full-capture"
  provider: string
  model: string
  reasoning: string
  capturedAt: string
  savedId: string
  incidentId: string
  finalSequence: number
  finalRunState: string
  outcome: string | null
  candidateHash: string | null
  manifestSealed: boolean
  /** The sealed capture manifest's own digest, when one was sealed. */
  manifestDigest: string | null
  /** How many agent-run-artifacts the run sealed (every session attempt,
   * including failed and aborted ones). */
  agentRunArtifacts: number
  /** Hash of every configuration value that must be frozen across the
   * three-run streak (issue #31): the sealed manifest's frozen fields, or
   * the narrow pre-manifest set for attempts that never sealed one. */
  configDigest: string
  /** The captured run's assembled directory (journal + artifacts). */
  runPath: string
  /** A completed terminal report or a retained partial/failed attempt. */
  status?: "completed" | "partial" | "failed"
  failureReason?: string | null
}

export const DEV_STORE_ROOT = fileURLToPath(new URL("../dev-runs", import.meta.url))
export const DEV_STORE_FILE = join(DEV_STORE_ROOT, "dev-store.jsonl")

/** The dev store root resolved at call time. Tests redirect it with
 * `SIH_DEV_STORE_ROOT` so a capture run never pollutes the real store. */
export function devStoreRoot(): string {
  return process.env.SIH_DEV_STORE_ROOT ?? DEV_STORE_ROOT
}

/** The dev store file resolved at call time (same env override). */
export function devStoreFile(): string {
  return join(devStoreRoot(), "dev-store.jsonl")
}

/** The frozen configuration values a presentation streak must keep unchanged
 * (issue #31). Run identity — manifest_id, incident_id, run_id, attempt,
 * role records, sealed_at, manifest_digest — is excluded: an identical
 * configuration must produce an identical digest across the three runs. */
export function manifestConfigDigestOf(manifest: CaptureManifest): string {
  const digest = contentHash({
    agents: "real",
    scenario: manifest.scenario,
    mode: manifest.mode,
    provider_class: manifest.provider_class,
    provider: manifest.provider,
    model: manifest.model,
    reasoning: manifest.reasoning,
    pi_agent_core_version: manifest.pi_agent_core_version,
    pi_ai_version: manifest.pi_ai_version,
    skill_tree_digest: manifest.skill_tree_digest,
    tool_catalog_revision: manifest.tool_catalog_revision,
    prompt_revision: manifest.prompt_revision,
    policy_revision: manifest.policy_revision,
    perspectives: manifest.perspectives,
    seeds: manifest.seeds,
    budgets: manifest.budgets,
    schema_versions: manifest.schema_versions,
  })
  if (!digest.ok) {
    throw new Error(`config digest failed: ${digest.error.message}`)
  }
  return digest.value
}

/** The configuration values a presentation streak must keep unchanged. */
export function configDigestOf(record: {
  run: 1 | 2
  scenario: string
  agents: "fixture" | "real"
  mode: "rehearsal" | "full-capture"
  provider: string
  model: string
  reasoning: string
}): string {
  const digest = contentHash({
    scenario: record.scenario,
    agents: record.agents,
    mode: record.mode,
    provider: record.provider,
    model: record.model,
    reasoning: record.reasoning,
  })
  if (!digest.ok) {
    throw new Error(`config digest failed: ${digest.error.message}`)
  }
  return digest.value
}

/** Append one capture record. */
export async function appendCaptureRecord(
  record: StoredCaptureRecord,
  storeFile: string = devStoreFile(),
): Promise<void> {
  await mkdir(dirname(storeFile), { recursive: true })
  await writeFile(
    storeFile,
    `${JSON.stringify(record)}\n`,
    { flag: "a" },
  )
}

/** One presentation selection, recorded back into the append-only store
 * (issue #31): which eligible runs were selected, when, and under which
 * frozen configuration. */
export interface SelectionRecord {
  kind: "selection"
  version: 1
  selectedAt: string
  /** The frozen configuration digests the selected streaks ran under. */
  configDigests: string[]
  /** The selected runs, in capture order, with their store provenance. */
  records: Array<{
    run: 1 | 2
    scenario: string
    savedId: string
    capturedAt: string
    runPath: string
    manifestDigest: string | null
    configDigest: string
  }>
}

/** Append a presentation selection provenance record. */
export async function appendSelectionRecord(
  selection: SelectionRecord,
  storeFile: string = devStoreFile(),
): Promise<void> {
  await mkdir(dirname(storeFile), { recursive: true })
  await writeFile(
    storeFile,
    `${JSON.stringify(selection)}\n`,
    { flag: "a" },
  )
}

/** Read every stored capture record, in capture order. Selection provenance
 * records are skipped; callers read them via `listSelectionRecords`. */
export async function listCaptureRecords(
  storeFile: string = devStoreFile(),
): Promise<StoredCaptureRecord[]> {
  const text = await readFile(storeFile, "utf8").catch(() => "")
  const records: StoredCaptureRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    const parsed = JSON.parse(line) as StoredCaptureRecord & { kind?: string }
    if (parsed.kind === "selection") {
      continue
    }
    if (parsed.version !== 1) {
      throw new Error(`unknown dev store record version ${String(parsed.version)}`)
    }
    records.push(parsed)
  }
  return records
}

/** Read every recorded presentation selection, in selection order. */
export async function listSelectionRecords(
  storeFile: string = devStoreFile(),
): Promise<SelectionRecord[]> {
  const text = await readFile(storeFile, "utf8").catch(() => "")
  const selections: SelectionRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    const parsed = JSON.parse(line) as SelectionRecord & { version?: number }
    if (parsed.kind !== "selection") {
      continue
    }
    if (parsed.version !== 1) {
      throw new Error(`unknown selection record version ${String(parsed.version)}`)
    }
    selections.push(parsed)
  }
  return selections
}

/** True when the run reached the terminal state its scenario requires AND is
 * presentation-eligible. Deterministic-provider runs are development
 * fixtures: they reach their terminal state and are fully verifiable, but
 * they never form a presentation streak. Run 2 is eligible only for its
 * expected `verification-failed` / "Blocked safely" outcome, never for a
 * run that failed some other way. */
export function runReachedTerminalState(record: StoredCaptureRecord): boolean {
  if (record.agents !== "real" || record.mode !== "full-capture") {
    return false
  }
  if (record.provider === "deterministic") {
    return false
  }
  if (record.status !== undefined && record.status !== "completed") {
    return false
  }
  if (!record.manifestSealed) {
    return false
  }
  return record.run === 1
    ? record.finalRunState === "completed" && record.outcome === "verified-remediation"
    : record.finalRunState === "failed" && record.failureReason === "verification-failed"
}

export interface ScenarioStreak {
  run: 1 | 2
  digest: string
  records: StoredCaptureRecord[]
  /** True when the scenario is selectable (three or more consecutive runs). */
  selectable: boolean
}

/** The scenario's current consecutive streak: the eligible runs at the tail
 * of its capture order under one identical frozen-config digest. A failed,
 * incomplete, unexpected, fixture, or differently configured run breaks the
 * streak; only the runs after the break count. */
export function scenarioStreak(
  records: readonly StoredCaptureRecord[],
  run: 1 | 2,
): ScenarioStreak {
  const ofScenario = records.filter((record) => record.run === run)
  const streak: StoredCaptureRecord[] = []
  for (let index = ofScenario.length - 1; index >= 0; index -= 1) {
    const record = ofScenario[index]
    if (record === undefined || !runReachedTerminalState(record)) {
      break
    }
    if (streak.length > 0 && streak[0]?.configDigest !== record.configDigest) {
      break
    }
    streak.unshift(record)
  }
  return {
    run,
    digest: streak[0]?.configDigest ?? "",
    records: streak,
    selectable: streak.length >= 3,
  }
}

export interface PresentationSelection {
  /** The selected presentation runs: the latest eligible run of each
   * scenario's three-run streak (issue #31). */
  records: StoredCaptureRecord[]
  /** The per-scenario streaks that met the three-run threshold. */
  streaks: Array<{ run: 1 | 2; digest: string; startedAt: string }>
  /** The capturedAt of the selection's earliest accepted run. */
  startedAt: string
}

/** Select the presentation runs (issue #31): each scenario becomes selectable
 * only after three consecutive eligible real-provider full captures under one
 * unchanged config digest, and the presentation needs both scenarios. The
 * bundle carries the latest eligible run of each scenario's streak; the
 * earlier accepted runs stay retained in the append-only dev store. Returns
 * null when either scenario is not selectable. */
export function selectPresentationStreak(
  records: readonly StoredCaptureRecord[],
): PresentationSelection | null {
  const run1 = scenarioStreak(records, 1)
  const run2 = scenarioStreak(records, 2)
  if (!run1.selectable || !run2.selectable) {
    return null
  }
  const selected = [run1.records[run1.records.length - 1], run2.records[run2.records.length - 1]]
    .filter((record): record is StoredCaptureRecord => record !== undefined)
  const startedAt = selected.length === 0
    ? ""
    : selected.reduce((earliest, record) => (
      Date.parse(record.capturedAt) < Date.parse(earliest) ? record.capturedAt : earliest
    ), selected[0]?.capturedAt ?? "")
  return {
    records: selected,
    streaks: [
      { run: 1, digest: run1.digest, startedAt: run1.records[0]?.capturedAt ?? "" },
      { run: 2, digest: run2.digest, startedAt: run2.records[0]?.capturedAt ?? "" },
    ],
    startedAt,
  }
}
