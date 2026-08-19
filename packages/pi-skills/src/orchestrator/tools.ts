/**
 * The only model-facing tools owned by the Pi Orchestrator role.
 *
 * Both tools are deliberately read/proposal-only. The service implementation
 * is supplied by the Worker and normally forwards to the Control Plane; the
 * tool surface has no operation for changing stages, writing artifacts,
 * minting leases or permits, mutating budgets, or deciding terminal state.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type {
  OrchestratorLifecycleState,
  OrchestratorWorkRequest,
  OrchestratorWorkResult,
} from "@sih/contracts/types"
import { ORCHESTRATOR_STAGES } from "@sih/contracts/types"

export const ORCHESTRATOR_INSPECT_TOOL = "inspect_orchestrator_state"
export const ORCHESTRATOR_REQUEST_TOOL = "request_orchestrator_work"

export interface OrchestratorToolService {
  inspectState(): Promise<OrchestratorLifecycleState>
  requestWork(request: OrchestratorWorkRequest): Promise<OrchestratorWorkResult>
  revokeDependentWork?: () => Promise<void>
}

const inspectParameters = Type.Object({})

const requestParameters = Type.Object({
  request_id: Type.String({ minLength: 1, description: "Stable idempotency key for this work proposal" }),
  work_id: Type.String({ minLength: 1, description: "Stable identity of the proposed bounded work unit" }),
  stage: Type.Union([
    Type.Literal("detect"),
    Type.Literal("diagnose"),
    Type.Literal("repair"),
    Type.Literal("verify"),
    Type.Literal("release"),
    Type.Literal("watch"),
  ]),
  attempt: Type.Integer({ minimum: 1 }),
  depends_on: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  budget: Type.Object({
    model_turns: Type.Integer({ minimum: 1 }),
    non_terminal_tool_calls: Type.Integer({ minimum: 1 }),
    session_wall_clock_ms: Type.Integer({ minimum: 1 }),
    run_wall_clock_ms: Type.Integer({ minimum: 1 }),
  }),
})

function textResult(text: string, details: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  }
}

/** Create the Orchestrator's narrow typed tool set. */
export function createOrchestratorTools(
  service: OrchestratorToolService,
): AgentTool<any>[] {
  const inspect: AgentTool<any> = {
    name: ORCHESTRATOR_INSPECT_TOOL,
    description:
      "Inspect the concise Control Plane lifecycle projection: current stage, admitted sealed artifacts, admitted work ids, and remaining bounded run budget. It never returns scratchpads or hidden reasoning.",
    label: "Inspect lifecycle state",
    parameters: inspectParameters,
    executionMode: "sequential",
    async execute() {
      const state = await service.inspectState()
      return textResult(JSON.stringify(state), state)
    },
  }

  const request: AgentTool<any> = {
    name: ORCHESTRATOR_REQUEST_TOOL,
    description:
      "Request one bounded unit of work from the Control Plane after declaring its stage, dependencies, and budgets. The Control Plane may reject it; this tool cannot transition stages or alter durable state directly.",
    label: "Request eligible work",
    parameters: requestParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const proposal = params as OrchestratorWorkRequest
      const result = await service.requestWork(proposal)
      return textResult(JSON.stringify(result), result)
    },
  }

  return [inspect, request]
}

/** Defensive helper used by adapters before forwarding untrusted tool args. */
export function isOrchestratorWorkRequest(value: unknown): value is OrchestratorWorkRequest {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<OrchestratorWorkRequest>
  const budget = candidate.budget
  return typeof candidate.request_id === "string" && candidate.request_id.length > 0 &&
    typeof candidate.work_id === "string" && candidate.work_id.length > 0 &&
    typeof candidate.stage === "string" && ORCHESTRATOR_STAGES.includes(candidate.stage as OrchestratorWorkRequest["stage"]) &&
    typeof candidate.attempt === "number" && Number.isInteger(candidate.attempt) && candidate.attempt > 0 &&
    Array.isArray(candidate.depends_on) && candidate.depends_on.every((dependency) => typeof dependency === "string" && dependency.length > 0) &&
    typeof budget === "object" && budget !== null &&
    Number.isInteger(budget.model_turns) && budget.model_turns > 0 &&
    Number.isInteger(budget.non_terminal_tool_calls) && budget.non_terminal_tool_calls > 0 &&
    Number.isInteger(budget.session_wall_clock_ms) && budget.session_wall_clock_ms > 0 &&
    Number.isInteger(budget.run_wall_clock_ms) && budget.run_wall_clock_ms > 0
}
