/**
 * The append-only dev store for real-agent captures (issue #23). Every real
 * capture appends one record; fixture runs never enter the store, and a
 * failed capture is recorded as failed, never replaced by a canned run.
 * Presentation selection requires three consecutive full-capture runs under
 * one unchanged configuration digest.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { contentHash } from "@sih/contracts/hashes"

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
  /** How many agent-run-artifacts the run sealed (every session attempt,
   * including failed and aborted ones). */
  agentRunArtifacts: number
  /** Hash of every configuration value that must be frozen across the
   * three-run streak. */
  configDigest: string
  /** The captured run's assembled directory (journal + artifacts). */
  runPath: string
}

export const DEV_STORE_ROOT = new URL("../dev-runs", import.meta.url).pathname
export const DEV_STORE_FILE = join(DEV_STORE_ROOT, "dev-store.jsonl")

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
  storeFile: string = DEV_STORE_FILE,
): Promise<void> {
  await mkdir(DEV_STORE_ROOT, { recursive: true })
  await writeFile(
    storeFile,
    `${JSON.stringify(record)}\n`,
    { flag: "a" },
  )
}

/** Read every stored capture record, in capture order. */
export async function listCaptureRecords(
  storeFile: string = DEV_STORE_FILE,
): Promise<StoredCaptureRecord[]> {
  const text = await readFile(storeFile, "utf8").catch(() => "")
  const records: StoredCaptureRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    const parsed = JSON.parse(line) as StoredCaptureRecord
    if (parsed.version !== 1) {
      throw new Error(`unknown dev store record version ${String(parsed.version)}`)
    }
    records.push(parsed)
  }
  return records
}

/** True when the run reached the terminal state its scenario requires:
 * run 1 completes verified-remediation, run 2 fails verification. */
export function runReachedTerminalState(record: StoredCaptureRecord): boolean {
  if (record.agents !== "real" || record.mode !== "full-capture") {
    return false
  }
  if (!record.manifestSealed) {
    return false
  }
  return record.run === 1
    ? record.finalRunState === "completed" && record.outcome === "verified-remediation"
    : record.finalRunState === "failed"
}

export interface PresentationSelection {
  records: StoredCaptureRecord[]
  /** The capturedAt of the streak start. */
  startedAt: string
}

/** Select the presentation streak: the latest three consecutive
 * full-capture real runs, in capture order, under one unchanged config
 * digest, each reaching its scenario's terminal state, covering both
 * scenarios at least once. Returns null when no such streak exists. */
export function selectPresentationStreak(
  records: readonly StoredCaptureRecord[],
): PresentationSelection | null {
  if (records.length < 3) {
    return null
  }
  for (let start = records.length - 3; start >= 0; start -= 1) {
    const window = records.slice(start, start + 3)
    const digests = new Set(window.map((record) => record.configDigest))
    if (digests.size !== 1) {
      continue
    }
    const scenarios = new Set(window.map((record) => record.run))
    if (scenarios.size < 2) {
      continue
    }
    if (!window.every(runReachedTerminalState)) {
      continue
    }
    const byCapturedAt = [...window].sort(
      (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
    )
    if (byCapturedAt.map((record) => record.capturedAt).join() !==
        window.map((record) => record.capturedAt).join()) {
      continue
    }
    return { records: window, startedAt: window[0]?.capturedAt ?? "" }
  }
  return null
}