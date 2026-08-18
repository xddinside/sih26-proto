/**
 * The terminal tool that completes a Pi role with one schema-valid typed
 * submission. The payload is validated against a registered @sih/contracts
 * schema; an invalid payload returns an error result inside the same bounded
 * session so the model can correct it. The first valid submission is
 * durable; prose and repeated terminal calls can never create an additional
 * durable result.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import { validate } from "@sih/contracts/parse"

export class TerminalToolError extends Error {}

export interface TerminalToolOptions {
  /** The tool name the model calls, e.g. `submit_fusion_output`. */
  name: string
  /** The @sih/contracts schema name the payload must satisfy. */
  schemaName: string
  /** The schema version, e.g. `1.0`. */
  schemaVersion: string
  /** The durability seam: called exactly once per session, on the first
   * valid submission. */
  submit: (payload: unknown) => Promise<{ submissionId: string }>
}

export interface TerminalTool {
  tool: AgentTool<any>
  /** The first valid submission, once made. */
  readonly submission: { submissionId: string } | undefined
}

interface ValidationIssue {
  path: string
  message: string
}

const parameters = Type.Object({
  submission: Type.Any({ description: "The contract payload to submit" }),
})
interface TerminalParams {
  submission: unknown
}

export function createTerminalTool(options: TerminalToolOptions): TerminalTool {
  let submission: { submissionId: string } | undefined
  return {
    get submission() {
      return submission
    },
    tool: {
      name: options.name,
      description:
        `Submit the role's final typed output. The payload must satisfy the ` +
        `${options.schemaName}@${options.schemaVersion} contract. Invalid ` +
        `payloads return an error listing the schema issues; the session ` +
        `continues until the payload is valid or the session limits run out. ` +
        `Only the first valid submission is durable.`,
      label: `Submit ${options.schemaName}`,
      parameters,
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const p = params as TerminalParams
        if (submission !== undefined) {
          throw new TerminalToolError(
            `${options.name} already completed; only the first valid terminal submission is durable`,
          )
        }
        const result = validate(options.schemaName, options.schemaVersion, p.submission)
        if (!result.ok) {
          const details = result.error.details as { issues?: ValidationIssue[] } | undefined
          const issues = details?.issues
          const summary =
            issues !== undefined && issues.length > 0
              ? issues.map((issue) => `${issue.path || "/"} ${issue.message}`).join("; ")
              : result.error.message
          throw new TerminalToolError(`invalid terminal submission: ${summary}`)
        }
        const made = await options.submit(p.submission)
        submission = made
        return {
          content: [
            {
              type: "text",
              text: `submitted ${options.schemaName}@${options.schemaVersion} as ${made.submissionId}`,
            },
          ],
          details: { submissionId: made.submissionId },
          terminate: true,
        }
      },
    },
  }
}
