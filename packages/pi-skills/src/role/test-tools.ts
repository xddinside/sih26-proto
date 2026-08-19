/**
 * The assigned deterministic test tool for a Verify Test Agent session.
 *
 * Each Test Agent may invoke only its own assigned test tool. The tool
 * returns the recorded deterministic receipt for that layer — the run hashes,
 * results, tool identity, target, and receipt id — and nothing else. The
 * receipt owns pass/fail; the agent inspects it and then submits a Test
 * Report whose outcome must match it. The tool has no arguments, cannot run
 * a different layer, and cannot create or modify a receipt.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"

import type { AssignedTestReceipt } from "../tests/test-runner.js"
import { outcomeFromRuns } from "../tests/test-runner.js"

export interface AssignedTestToolOptions {
  /** The one layer this session may invoke. */
  layer: string
  /** The recorded deterministic receipt the tool returns. */
  receipt: AssignedTestReceipt
}

/** The deterministic, argument-less test tool bound to one assigned layer. */
export function createAssignedTestTool(
  options: AssignedTestToolOptions,
): AgentTool<any> {
  const outcome = outcomeFromRuns(options.receipt.runs)
  return {
    name: "run_assigned_test",
    description:
      `Run the assigned deterministic test for layer ${options.layer} and ` +
      `return its receipt. The receipt owns the outcome; it cannot be ` +
      `changed, re-run against another layer, or created by this session.`,
    label: `Run assigned test ${options.layer}`,
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              layer: options.receipt.layer,
              tool: options.receipt.tool,
              tool_version: options.receipt.toolVersion,
              target: options.receipt.target,
              receipt_ref: options.receipt.receiptRef,
              runs: options.receipt.runs,
              outcome,
            }),
          },
        ],
        details: {
          layer: options.receipt.layer,
          receipt_ref: options.receipt.receiptRef,
          outcome,
          run_count: options.receipt.runs.length,
        },
      }
    },
  }
}
