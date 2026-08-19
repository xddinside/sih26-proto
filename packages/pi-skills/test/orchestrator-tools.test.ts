import { describe, expect, test } from "bun:test"
import { FakeControlPlaneClient, ModelGateway, scriptedStreamingProvider } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import type {
  OrchestratorLifecycleState,
  OrchestratorWorkRequest,
  OrchestratorWorkResult,
} from "@sih/contracts/types"

import {
  ORCHESTRATOR_INSPECT_TOOL,
  ORCHESTRATOR_REQUEST_TOOL,
  createOrchestratorTools,
} from "../src/orchestrator/tools.js"
import { runOrchestratorRole } from "../src/agent/roles.js"
import type { AgentSessionKit } from "../src/agent/roles.js"
import { fixtureHash, makeLease } from "./helpers.js"

const state: OrchestratorLifecycleState = {
  incident_id: "inc-1",
  run_id: "run-1",
  attempt: 1,
  run_state: "running",
  current_stage: "diagnose",
  stages: [{ stage: "detect", status: "completed" }],
  admitted_work_ids: [],
  admitted_artifacts: [],
  budgets: {
    run_wall_clock_ms: 7_200_000,
    elapsed_ms: 100,
    remaining_ms: 7_199_900,
    reserved_model_turns: 0,
    reserved_non_terminal_tool_calls: 0,
    reserved_session_wall_clock_ms: 0,
    reserved_run_wall_clock_ms: 0,
  },
}

const request: OrchestratorWorkRequest = {
  request_id: "request-1",
  work_id: "diagnose-1",
  stage: "diagnose",
  attempt: 1,
  depends_on: [],
  budget: {
    model_turns: 20,
    non_terminal_tool_calls: 32,
    session_wall_clock_ms: 720_000,
    run_wall_clock_ms: 7_200_000,
  },
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content
  return content.find((part) => part.type === "text")?.text ?? ""
}

describe("Pi Orchestrator tools", () => {
  test("exposes only lifecycle inspection and work proposal tools", () => {
    const tools = createOrchestratorTools({
      inspectState: async () => state,
      requestWork: async () => ({ status: "admitted", request_id: "request-1", work_id: "diagnose-1", stage: "diagnose", admitted_artifacts: [], budgets: state.budgets }),
    })
    expect(tools.map((tool) => tool.name)).toEqual([
      ORCHESTRATOR_INSPECT_TOOL,
      ORCHESTRATOR_REQUEST_TOOL,
    ])
    expect(tools.map((tool) => tool.name)).not.toContain("stage_command")
    expect(tools.map((tool) => tool.name)).not.toContain("seal_artifact")
    expect(tools.map((tool) => tool.name)).not.toContain("mint_lease")
    expect(tools.map((tool) => tool.name)).not.toContain("complete_run")
  })

  test("returns a concise state projection without adding model authority", async () => {
    const tools = createOrchestratorTools({
      inspectState: async () => state,
      requestWork: async () => ({ status: "rejected", request_id: "request-1", work_id: "diagnose-1", code: "WRONG_STAGE", reason: "not current" }),
    })
    const inspect = tools.find((tool) => tool.name === ORCHESTRATOR_INSPECT_TOOL)
    expect(inspect).toBeDefined()
    const result = await inspect?.execute("call-1", {})
    expect(JSON.parse(textOf(result))).toEqual(state)
  })

  test("surfaces a deterministic Control Plane rejection", async () => {
    let received: OrchestratorWorkRequest | undefined
    const rejection: OrchestratorWorkResult = {
      status: "rejected",
      request_id: request.request_id,
      work_id: request.work_id,
      code: "BUDGET_EXCEEDED",
      reason: "the requested session is too large",
    }
    const tools = createOrchestratorTools({
      inspectState: async () => state,
      requestWork: async (value) => {
        received = value
        return rejection
      },
    })
    const requestTool = tools.find((tool) => tool.name === ORCHESTRATOR_REQUEST_TOOL)
    const result = await requestTool?.execute("call-2", request)
    expect(received).toEqual(request)
    expect(JSON.parse(textOf(result))).toEqual(rejection)
  })

  test("runs a bounded Pi session with only inspect/request tools", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const requestCalls: OrchestratorWorkRequest[] = []
    const service = {
      inspectState: async () => state,
      requestWork: async (proposal: OrchestratorWorkRequest): Promise<OrchestratorWorkResult> => {
        requestCalls.push(proposal)
        return {
          status: "rejected",
          request_id: proposal.request_id,
          work_id: proposal.work_id,
          code: "WRONG_STAGE",
          reason: "the Control Plane owns stage eligibility",
        }
      },
    }
    const report = {
      schema_version: "1.0",
      incident_id: "inc-test",
      run_id: "run-1",
      attempt: 1,
      stage_outcomes: { detect: "completed", diagnose: "completed", repair: "completed", verify: "completed" },
      assessments: [],
      reflections: ["the Control Plane retained lifecycle authority"],
      completed_at: new Date().toISOString(),
    }
    const gateway = new ModelGateway(
      cp,
      undefined,
      scriptedStreamingProvider({
        turns: {
          "orchestrator-run-1": [
            { kind: "tool-call", id: "inspect", name: ORCHESTRATOR_INSPECT_TOOL, args: {} },
            {
              kind: "tool-call",
              id: "request",
              name: ORCHESTRATOR_REQUEST_TOOL,
              args: request as unknown as Record<string, unknown>,
            },
            { kind: "tool-call", id: "terminal", name: "submit_orchestrator_report", args: { submission: report } },
          ],
        },
        honorSignal: true,
      }),
    )
    const sealed: string[] = []
    const kit: AgentSessionKit = {
      gateway,
      lease: makeLease("watch"),
      candidateHash: fixtureHash("candidate"),
      model: { provider: "opencode-go", id: "deepseek-v4-flash" },
      seal: {
        async seal(input) {
          const digest = contentHash({ schema_id: input.schemaId, payload: input.payload } as never)
          if (!digest.ok) throw new Error(digest.error.message)
          sealed.push(input.schemaId)
          return { content_hash: digest.value }
        },
      },
      orchestrator: service,
    }

    const result = await runOrchestratorRole(kit, {
      incidentId: "inc-test",
      runId: "run-1",
      attempt: 1,
      stageOutcomes: { detect: "completed", diagnose: "completed", repair: "completed", verify: "completed" },
      runContext: "bounded test run",
    })

    expect(result.status).toBe("succeeded")
    expect(result.payload?.incident_id).toBe("inc-test")
    expect(requestCalls).toHaveLength(1)
    expect(sealed).toEqual(["orchestrator-report", "agent-run-artifact"])
  })
})
