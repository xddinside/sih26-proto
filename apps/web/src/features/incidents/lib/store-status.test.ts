/**
 * Error-state mapping tests: each stable contracts integrity code maps to a
 * single rendered integrity state, and the full error list preserves the code
 * verbatim so the UI can cite the contract's error vocabulary.
 */
import { describe, expect, test } from "bun:test"

import { mapReplayFailures } from "./store-status"

describe("mapReplayFailures", () => {
  test("maps CHANGED_CONTENT to corrupt-content", () => {
    const result = mapReplayFailures([
      { code: "CHANGED_CONTENT", message: "bytes changed", path: "manifest.json" },
    ])
    expect(result.state).toBe("corrupt-content")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.code).toBe("CHANGED_CONTENT")
  })

  test("maps a filesystem failure to missing-bundle", () => {
    const result = mapReplayFailures([
      { kind: "filesystem", message: "not found", path: "manifest.json" },
    ])
    expect(result.state).toBe("missing-bundle")
    expect(result.errors[0]?.code).toBe("filesystem")
  })

  test("maps STALE_DATA, STALE_SCHEMA, and UNKNOWN_SCHEMA distinctly", () => {
    expect(mapReplayFailures([{ code: "STALE_DATA", message: "expired" }]).state).toBe("stale-data")
    expect(mapReplayFailures([{ code: "STALE_SCHEMA", message: "v2" }]).state).toBe("stale-schema")
    expect(mapReplayFailures([{ code: "UNKNOWN_SCHEMA", message: "unknown" }]).state).toBe("unknown-schema")
  })

  test("maps REDACTION_FAILURE and MISSING_ARTIFACT", () => {
    expect(mapReplayFailures([{ code: "REDACTION_FAILURE", message: "mask" }]).state).toBe("redaction-failure")
    expect(mapReplayFailures([{ code: "MISSING_ARTIFACT", message: "absent" }]).state).toBe("missing-artifact")
  })

  test("maps BAD_SEQUENCE, ILLEGAL_TRANSITION, DUPLICATE_TRANSITION", () => {
    expect(mapReplayFailures([{ code: "BAD_SEQUENCE", message: "gap" }]).state).toBe("bad-sequence")
    expect(mapReplayFailures([{ code: "ILLEGAL_TRANSITION", message: "bad move" }]).state).toBe("illegal-transition")
    expect(mapReplayFailures([{ code: "DUPLICATE_TRANSITION", message: "dup" }]).state).toBe("duplicate-transition")
  })

  test("chooses the highest-priority state when several failures are present", () => {
    const result = mapReplayFailures([
      { code: "STALE_DATA", message: "expired" },
      { code: "CHANGED_CONTENT", message: "bytes changed" },
    ])
    expect(result.state).toBe("corrupt-content")
    expect(result.errors).toHaveLength(2)
  })

  test("maps an unrecognized code to unknown", () => {
    expect(mapReplayFailures([{ code: "NOT_A_CODE", message: "odd" }]).state).toBe("unknown")
  })
})
