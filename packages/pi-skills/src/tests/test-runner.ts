/**
 * Test layer runner from docs/research/review-verification.md and
 * docs/research/pi-agent-catalog.md. Every applicable test layer runs in its
 * own skilled subagent. The subagent plans and scopes exactly one layer,
 * maps the fixed catalog inputs to an execution request, requests the pinned
 * run through the broker (or consumes the company-pipeline result), and
 * returns a structured receipt-bound Test Report.
 *
 * The deterministic tool, the broker, the company pipeline, the applicability
 * resolver, and the Control Plane verdict own execution facts and pass/fail
 * authority: a model cannot forge a receipt, re-scope applicability, or
 * reinterpret a failed or flaky run as passing. The report cites receipts;
 * it never asserts a result the receipt does not contain. Test secrets never
 * enter model context: where a test needs one, the broker mounts a masked,
 * stage-bound value only into the isolated test process.
 */
import { validate } from "@sih/contracts/parse"
import type { TestReport } from "@sih/contracts/types"

export type TestLayerCode =
  "T1" | "T2" | "T3" | "T4" | "T5" | "T7" | "T9" | "T10" | "T12" | "T13"

export type ReceiptOutcome =
  "pass" | "fail" | "flaky-pass" | "error" | "not-run"

/** The layer's pinned tool/catalog entry with tool and database versions. */
export interface PinnedToolEntry {
  tool: string
  tool_version: string
  target: string
}

/**
 * The recorded deterministic receipt for one assigned test layer. The receipt
 * owns the outcome; a Test Agent can inspect it (through its assigned test
 * tool) but can never change it, mint a new one, or reinterpret a failed run
 * as passing.
 */
export interface AssignedTestReceipt {
  layer: TestLayerCode
  tool: string
  toolVersion: string
  target: string
  receiptRef: string
  runs: {
    run_hash: string
    result: "pass" | "fail" | "error"
    at: string
    detail?: string
  }[]
}

/** The deterministic outcome of a recorded receipt: any fail is a fail, any
 * error an error, else pass. A model cannot override this mapping. */
export function outcomeFromRuns(
  runs: readonly { result: "pass" | "fail" | "error" }[],
): ReceiptOutcome {
  if (runs.length === 0) {
    return "not-run"
  }
  if (runs.some((run) => run.result === "fail")) {
    return "fail"
  }
  if (runs.some((run) => run.result === "error")) {
    return "error"
  }
  return "pass"
}

/** The Test Report's recorded runs must equal the deterministic receipt runs
 * verbatim: same hashes, same results, same order. The model cannot add,
 * drop, or relabel a run. */
export function runsMatchReceipt(
  reportRuns: readonly { run_hash: string; result: string }[],
  receiptRuns: readonly { run_hash: string; result: string }[],
): { match: boolean; reason: string } {
  if (reportRuns.length !== receiptRuns.length) {
    return {
      match: false,
      reason: `report records ${reportRuns.length} runs; the receipt records ${receiptRuns.length}`,
    }
  }
  for (let index = 0; index < receiptRuns.length; index += 1) {
    const reportRun = reportRuns[index]
    const receiptRun = receiptRuns[index]
    if (reportRun.run_hash !== receiptRun.run_hash) {
      return {
        match: false,
        reason: `run ${index + 1} hash does not match the receipt`,
      }
    }
    if (reportRun.result !== receiptRun.result) {
      return {
        match: false,
        reason: `run ${index + 1} result ${reportRun.result} does not match the receipt result ${receiptRun.result}`,
      }
    }
  }
  return { match: true, reason: "runs match the deterministic receipt" }
}

/** Parse and validate a Test Report v1 against the registry schema. */
export function parseTestReport(text: string): TestReport | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  const result = validate(
    "test-report",
    "1.0",
    JSON.parse(text.slice(start, end + 1)) as unknown
  )
  return result.ok ? (result.value as TestReport) : null
}

/** The receipt owns the outcome. A model cannot reinterpret a failed or
 * flaky run as passing: the report copies the receipt's outcome verbatim. */
export function outcomeFromReceipt(receipt: {
  outcome: ReceiptOutcome
}): ReceiptOutcome {
  return receipt.outcome
}

/** Fail-then-pass on the same candidate hash records `flaky-pass` with both
 * runs — the same fail-then-pass detection CI systems use. */
export function detectFlakyPass(
  runs: readonly {
    run_hash: string
    result: "pass" | "fail" | "error"
  }[]
): {
  flaky: boolean
  runs: { run_hash: string; result: "pass" | "fail" | "error" }[]
} {
  const failed = runs.filter((run) => run.result === "fail")
  const passed = runs.filter((run) => run.result === "pass")
  return { flaky: failed.length > 0 && passed.length > 0, runs: [...runs] }
}

/** The receipt-binding rule: a result bound to any other candidate hash is
 * stale and cannot enter the gate. */
export function assertReceiptBinding(options: {
  reportCandidateHash: string
  receiptCandidateHash: string
}): { bound: boolean } {
  return {
    bound:
      options.reportCandidateHash === options.receiptCandidateHash &&
      /^sha256:[0-9a-f]{64}$/.test(options.reportCandidateHash),
  }
}

/** The scoped T5 rule: the report target must equal the ownership-map
 * selection the resolver returned. The subagent confirms the selection
 * matches the receipt; it never re-scopes the suite. */
export function assertT5Selection(options: {
  resolverSelection: string | null
  reportTarget: string
}): { ok: boolean; reason: string } {
  if (options.resolverSelection === null) {
    return {
      ok: false,
      reason:
        "ownership map could not resolve the changed files: needs-human, never a default",
    }
  }
  if (options.reportTarget !== options.resolverSelection) {
    return {
      ok: false,
      reason: `report target ${options.reportTarget} does not match the ownership-map selection ${options.resolverSelection}`,
    }
  }
  return { ok: true, reason: "target matches the ownership-map selection" }
}

/** Malformed report: rerun once, then needs-human. A timeout records `error`,
 * reruns once, then needs-human. */
export function decideTestRerun(options: {
  report: TestReport | null
  rerunsSoFar: number
}): { action: "accept" | "rerun-once" | "needs-human"; reason: string } {
  if (options.report === null) {
    return options.rerunsSoFar === 0
      ? { action: "rerun-once", reason: "malformed Test Report; rerun once" }
      : {
          action: "needs-human",
          reason: "Test Report still malformed after one rerun",
        }
  }
  if (options.report.outcome === "error") {
    return options.rerunsSoFar === 0
      ? { action: "rerun-once", reason: "test run errored; rerun once" }
      : {
          action: "needs-human",
          reason: "test run errored again after one rerun",
        }
  }
  return { action: "accept", reason: "report is well-formed" }
}

/** A required or triggered-conditional `flaky-pass` yields needs-human; it
 * never counts toward pass. */
export function flakyPassNeedsHuman(options: {
  outcome: ReceiptOutcome
  binding: "required" | "triggered" | "not-applicable"
}): boolean {
  return (
    options.outcome === "flaky-pass" && options.binding !== "not-applicable"
  )
}
