/**
 * Load verification tests for the static saved-bundle replay adapter.
 *
 * These tests load the real byte-accurate contract fixture from
 * `demo/fixtures/contracts/valid/` into memory, then apply each tamper in
 * memory. They assert the adapter's named integrity errors without faking a
 * weaker contract: every check delegates to `@sih/contracts`.
 */
import { describe, expect, test } from "bun:test"

import type { IntegrityError } from "@sih/contracts/errors"

import { loadFixtureBundle } from "./fixture-bundle"
import type { SavedFileMap } from "./replay-files"
import { loadReplayStore } from "./replay-store"

const EVALUATION_TIME = "2026-08-16T12:00:00Z"

const BRIEF_ARTIFACT_PATH =
  "artifacts/sha256/4d4ee3d8370445e6542b04a826f26d30a5d3ef89407c71d4d2b19f9a23040d1a.json"
const REVIEW_ARTIFACT_PATH =
  "artifacts/sha256/07fd0f49c85d5029c601599ecd1dc6c355ac8811b213836a642e7ff5e67d75ef.json"
const JOURNAL_PATH = "incidents/inc-demo-payment-1/journal.jsonl"

/** Replace one file's text in a copied file map, leaving the input untouched. */
function withFile(
  files: SavedFileMap,
  path: string,
  transform: (text: string) => string,
): SavedFileMap {
  const next = new Map(files)
  const text = files.get(path)
  if (text === undefined) {
    throw new Error(`fixture file is missing: ${path}`)
  }
  next.set(path, transform(text))
  return next
}

/** The error codes of a failed load, or an empty list when the load passed. */
function errorCodes(result: ReturnType<typeof loadReplayStore>): string[] {
  if (result.ok) {
    return []
  }
  return result.error.map((error: IntegrityError) => error.code)
}

describe("loadReplayStore", () => {
  test("loads the valid fixture bundle with full verification", async () => {
    const result = loadReplayStore(await loadFixtureBundle(), {
      evaluationTime: EVALUATION_TIME,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.manifest.format_version).toBe("1.0")
    expect(result.value.incidents.map((incident) => incident.incidentId)).toEqual([
      "inc-demo-payment-1",
      "inc-demo-payment-2",
    ])
    expect(result.value.incidents.map((incident) => incident.finalSequence)).toEqual([
      44, 25,
    ])
    expect(result.value.artifacts.size).toBe(18)
  })

  test("rejects changed file bytes with CHANGED_CONTENT", async () => {
    const files = withFile(
      await loadFixtureBundle(),
      BRIEF_ARTIFACT_PATH,
      (text) => text.replace('"sealed_at":"2026-08-15T15:42:00Z"', '"sealed_at":"2026-08-15T15:42:01Z"'),
    )
    const result = loadReplayStore(files, { evaluationTime: EVALUATION_TIME })
    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain("CHANGED_CONTENT")
  })

  test("rejects a journal sequence gap with BAD_SEQUENCE", async () => {
    const files = withFile(await loadFixtureBundle(), JOURNAL_PATH, (text) =>
      text.replace('"sequence":1,', '"sequence":2,'),
    )
    const result = loadReplayStore(files, { evaluationTime: EVALUATION_TIME })
    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain("BAD_SEQUENCE")
  })

  test("rejects an unknown artifact schema with UNKNOWN_SCHEMA", async () => {
    const files = withFile(
      await loadFixtureBundle(),
      REVIEW_ARTIFACT_PATH,
      (text) => text.replace('"artifact_schema_id":"review-report"', '"artifact_schema_id":"not-a-schema"'),
    )
    const result = loadReplayStore(files, { evaluationTime: EVALUATION_TIME })
    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain("UNKNOWN_SCHEMA")
  })

  test("rejects an unsupported schema version with STALE_SCHEMA", async () => {
    const files = withFile(await loadFixtureBundle(), REVIEW_ARTIFACT_PATH, (text) =>
      text.replace('"artifact_schema_version":"1.0"', '"artifact_schema_version":"2.0"'),
    )
    const result = loadReplayStore(files, { evaluationTime: EVALUATION_TIME })
    expect(result.ok).toBe(false)
    expect(errorCodes(result)).toContain("STALE_SCHEMA")
  })
})
