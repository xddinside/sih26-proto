/**
 * Search-state helper tests: default fallbacks, tolerance of malformed
 * values, and href serialization that omits defaults.
 */
import { describe, expect, test } from "bun:test"

import {
  parseWorkspaceSearch,
  resolveRecordId,
  workspaceHref,
} from "./workspace-search"

describe("parseWorkspaceSearch", () => {
  test("empty search falls back to defaults", () => {
    expect(parseWorkspaceSearch({})).toEqual({ view: "review", tab: "summary", record: "" })
  })

  test("explicit values round-trip", () => {
    expect(parseWorkspaceSearch({ view: "full", tab: "files", record: "remediation" })).toEqual({
      view: "full",
      tab: "files",
      record: "remediation",
    })
  })

  test("malformed values fall back to defaults", () => {
    expect(parseWorkspaceSearch({ view: "magic", tab: 3 })).toEqual({
      view: "review",
      tab: "summary",
      record: "",
    })
  })

  test("non-string record falls back to empty", () => {
    expect(parseWorkspaceSearch({ record: null }).record).toBe("")
    expect(parseWorkspaceSearch({ record: ["a"] }).record).toBe("")
  })
})

describe("workspaceHref", () => {
  test("defaults produce a bare incident path", () => {
    expect(workspaceHref("inc-demo-payment-1")).toBe("/incidents/inc-demo-payment-1")
    expect(workspaceHref("inc-demo-payment-1", {})).toBe("/incidents/inc-demo-payment-1")
    expect(workspaceHref("inc-demo-payment-1", { view: "review", tab: "summary", record: "" })).toBe(
      "/incidents/inc-demo-payment-1",
    )
  })

  test("non-default values are included", () => {
    expect(workspaceHref("inc-1", { tab: "files" })).toBe("/incidents/inc-1?tab=files")
    expect(workspaceHref("inc-1", { view: "full" })).toBe("/incidents/inc-1?view=full")
    expect(workspaceHref("inc-1", { record: "hypothesis:H1" })).toBe("/incidents/inc-1?record=hypothesis%3AH1")
    expect(workspaceHref("inc-1", { tab: "files", record: "remediation" })).toBe(
      "/incidents/inc-1?tab=files&record=remediation",
    )
  })
})

describe("resolveRecordId", () => {
  const available = new Set(["run", "remediation", "source-host"])

  test("known ids pass through", () => {
    expect(resolveRecordId(available, "remediation", "source-host")).toBe("remediation")
  })

  test("unknown and empty ids fall back to the default record", () => {
    expect(resolveRecordId(available, "evidence:zzz", "source-host")).toBe("source-host")
    expect(resolveRecordId(available, "", "source-host")).toBe("source-host")
    expect(resolveRecordId(available, undefined, "source-host")).toBe("source-host")
  })
})