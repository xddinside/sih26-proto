/**
 * Unified-diff parser tests: line accounting, path extraction (including
 * renames and `/dev/null`), the fixture's headerless diff failing closed, and
 * the empty-diff "absent" failure.
 */
import { describe, expect, test } from "bun:test"

import { parseUnifiedDiff } from "./unified-diff"

/** The exact diff text recorded in `demo/saved-runs` for inc-demo-payment-1. */
const FIXTURE_DIFF = "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {"

describe("parseUnifiedDiff", () => {
  test("parses one changed file with a hunk and line numbers", () => {
    const diff = [
      "diff --git a/src/payment/card.js b/src/payment/card.js",
      "--- a/src/payment/card.js",
      "+++ b/src/payment/card.js",
      "@@ -10,5 +10,5 @@ export function validateCard(cardType, cardNumber) {",
      " export function validateCard(cardType, cardNumber) {",
      "   const knownCard = ['visa', 'mastercard'].includes(cardType)",
      "-  if (knownCard) return cannotProcess()",
      "+  if (!knownCard) return cannotProcess()",
      "   return passesLuhn(cardNumber) ? accepted() : invalidCard()",
      " }",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diff.files).toHaveLength(1)
    const file = result.diff.files[0]
    expect(file.path).toBe("src/payment/card.js")
    expect(file.oldPath).toBe("src/payment/card.js")
    expect(file.newPath).toBe("src/payment/card.js")
    expect(file.additions).toBe(1)
    expect(file.deletions).toBe(1)
    expect(result.diff.additions).toBe(1)
    expect(result.diff.deletions).toBe(1)
    const lines = file.hunks[0].lines
    expect(lines.map((row) => row.type)).toEqual(["context", "context", "delete", "add", "context", "context"])
    const deleted = lines[2]
    const added = lines[3]
    expect(deleted.oldLine).toBe(12)
    expect(deleted.newLine).toBeNull()
    expect(deleted.text).toBe("-  if (knownCard) return cannotProcess()")
    expect(added.oldLine).toBeNull()
    expect(added.newLine).toBe(12)
    expect(added.text).toBe("+  if (!knownCard) return cannotProcess()")
    expect(lines[4].oldLine).toBe(13)
    expect(lines[4].newLine).toBe(13)
  })

  test("parses multiple files and counts additions and deletions", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1,2 @@",
      " old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,2 +1 @@",
      "-gone",
      " kept",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diff.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"])
    expect(result.diff.additions).toBe(1)
    expect(result.diff.deletions).toBe(1)
  })

  test("records the old and new path for a rename", () => {
    const diff = [
      "diff --git a/src/old.js b/src/new.js",
      "similarity index 100%",
      "rename from src/old.js",
      "rename to src/new.js",
      "diff --git a/src/kept.js b/src/kept.js",
      "--- a/src/kept.js",
      "+++ b/src/kept.js",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [renamed, kept] = result.diff.files
    expect(renamed.oldPath).toBe("src/old.js")
    expect(renamed.newPath).toBe("src/new.js")
    expect(renamed.path).toBe("src/new.js")
    expect(renamed.additions).toBe(0)
    expect(renamed.deletions).toBe(0)
    expect(kept.path).toBe("src/kept.js")
  })

  test("handles a new file whose old side is /dev/null", () => {
    const diff = [
      "diff --git a/src/new.txt b/src/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.txt",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const file = result.diff.files[0]
    expect(file.oldPath).toBe("/dev/null")
    expect(file.path).toBe("src/new.txt")
    expect(file.additions).toBe(1)
  })

  test("handles a deleted file whose new side is /dev/null", () => {
    const diff = [
      "diff --git a/src/old.txt b/src/old.txt",
      "deleted file mode 100644",
      "--- a/src/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const file = result.diff.files[0]
    expect(file.newPath).toBe("/dev/null")
    expect(file.path).toBe("src/old.txt")
    expect(file.deletions).toBe(1)
  })

  test("skips \\ No newline markers without corrupting counts", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "\\ No newline at end of file",
      "+y",
      "\\ No newline at end of file",
    ].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diff.additions).toBe(1)
    expect(result.diff.deletions).toBe(1)
  })

  test("fails closed on the recorded fixture diff (no file headers)", () => {
    const result = parseUnifiedDiff(FIXTURE_DIFF)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("unparseable")
    expect(result.note).toContain("content line before any hunk")
  })

  test("fails closed on an empty and on a whitespace-only diff", () => {
    expect(parseUnifiedDiff("")).toEqual({ ok: false, reason: "absent", note: "the recorded diff text is empty" })
    expect(parseUnifiedDiff("   \n  ").ok).toBe(false)
  })

  test("fails closed on a content line before any hunk", () => {
    const diff = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "just some text"].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("unparseable")
  })

  test("fails closed on a malformed hunk header", () => {
    const diff = ["diff --git a/src/a.ts b/src/a.ts", "@@ broken header @@", " line"].join("\n")
    const result = parseUnifiedDiff(diff)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("unparseable")
  })
})