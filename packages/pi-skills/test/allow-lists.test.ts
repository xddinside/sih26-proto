/**
 * Allow-list and isolation tests from docs/research/pi-agent-catalog.md
 * acceptance checks: a read-only or test skill's session has no write,
 * shell, direct-production, or credential tools; the broker denies the same
 * request regardless; subagents cannot reach forbidden tools or create
 * nested Workers; peer outputs never enter a session.
 */
import { describe, expect, test } from "bun:test"

import { ActionBroker, FakeControlPlaneClient, ReadBroker } from "@sih/brokers"

import {
  CREDENTIAL_TOOLS,
  FORBIDDEN_TOOLS,
  OPEN_WEB_TOOLS,
  PRODUCTION_TOOLS,
  SHELL_TOOLS,
  WRITE_TOOLS,
  diagnoseReadOnlyTools,
  hasForbiddenTool,
  resolveAllowList,
} from "../src/allow-lists.js"
import { loadSkillTree } from "../src/skill-catalog.js"
import { composeSystemPrompt, extractJson } from "../src/session.js"
import { SKILLS_ROOT, makeLease } from "./helpers.js"

describe("tool allow-lists", () => {
  test("read-only and test skills see no write, shell, production, or credential tools", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    const readOrTest = [
      "diagnose-read-only",
      "review-read-only",
      "test-run",
      "test-run-browser",
      "repair-planner",
    ]
    for (const skill of skills.values()) {
      if (!readOrTest.includes(skill.contract.tool_group)) {
        continue
      }
      const tools = resolveAllowList(skill.contract.tool_group)
      expect(hasForbiddenTool(tools), skill.contract.name).toBeNull()
      for (const tool of tools) {
        expect(WRITE_TOOLS.has(tool), `${skill.contract.name}:${tool}`).toBe(
          false
        )
        expect(SHELL_TOOLS.has(tool), `${skill.contract.name}:${tool}`).toBe(
          false
        )
        expect(
          PRODUCTION_TOOLS.has(tool),
          `${skill.contract.name}:${tool}`
        ).toBe(false)
        expect(
          CREDENTIAL_TOOLS.has(tool),
          `${skill.contract.name}:${tool}`
        ).toBe(false)
      }
    }
  })

  test("Diagnose participants get the docs proxy but no open-web tool", async () => {
    const tools = diagnoseReadOnlyTools()
    expect(tools).toContain("docs_proxy")
    for (const tool of tools) {
      expect(OPEN_WEB_TOOLS.has(tool)).toBe(false)
    }
    expect(tools).not.toContain("web_fetch")
  })

  test("only the worktree-edit group (repair implementer) carries write tools", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    for (const skill of skills.values()) {
      const tools = resolveAllowList(skill.contract.tool_group)
      const writes = tools.filter((tool) => WRITE_TOOLS.has(tool))
      if (skill.contract.tool_group === "worktree-edit") {
        expect(writes).toContain("edit")
        expect(writes).toContain("patch_apply")
      } else {
        expect(writes, skill.contract.name).toEqual([])
      }
    }
  })

  test("the orchestrator group carries spawn_subagent and proposal tools only", () => {
    const tools = resolveAllowList("orchestrator")
    expect(tools).toContain("spawn_subagent")
    expect(tools).toContain("propose_artifact")
    expect(tools).toContain("propose_transition")
    expect(tools).toContain("request_gate_evaluation")
    expect(tools).toContain("request_applicability")
    for (const tool of tools) {
      expect(FORBIDDEN_TOOLS.has(tool)).toBe(false)
    }
  })

  test("a broken tool group fails closed at load time", () => {
    expect(() => resolveAllowList("not-a-group")).toThrow("unknown tool group")
  })
})

describe("server-side broker denial (the broker is the boundary)", () => {
  async function errorCode(
    promise: Promise<unknown>
  ): Promise<string | undefined> {
    try {
      await promise
      return undefined
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  test("a forged stage write is rejected by the Action Broker", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const broker = new ActionBroker(cp)
    const lease = makeLease("diagnose")
    expect(
      await errorCode(
        broker.execute(lease, {
          action: {
            adapter: "local-git",
            action_class: "submit_remediation_pr",
            command: "create-pr",
          },
          target: { service_name: "payment", expected_version: "v1" },
          candidateHash: `sha256:${"a".repeat(64)}`,
          actionDigest: `sha256:${"b".repeat(64)}`,
        })
      )
    ).toBe("FORGED_STAGE")
  })

  test("a stale or unknown lease fails the Read Broker before any data moves", async () => {
    const cp = new FakeControlPlaneClient()
    const broker = new ReadBroker(cp)
    expect(
      await errorCode(
        broker.read(
          makeLease("detect", "lease-unknown"),
          {
            backend: "prometheus",
            connection_id: "astronomy-shop-local",
            query: "up",
          },
          `sha256:${"0".repeat(64)}`
        )
      )
    ).toBe("STALE_LEASE")
  })

  test("a release-stage action without a permit is rejected", async () => {
    const cp = new FakeControlPlaneClient()
    cp.leases.add("lease-test-1")
    const broker = new ActionBroker(cp)
    expect(
      await errorCode(
        broker.execute(makeLease("release"), {
          action: {
            adapter: "compose-release",
            action_class: "submit_typed_action",
            command: "swap",
          },
          target: { service_name: "payment", expected_version: "v1" },
          candidateHash: `sha256:${"a".repeat(64)}`,
          actionDigest: `sha256:${"b".repeat(64)}`,
        })
      )
    ).toBe("MISSING_PERMIT")
  })
})

describe("session isolation", () => {
  test("the composed system prompt carries the skill contract and no peer outputs", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    const skill = skills.get("sih-fusion-participant")
    expect(skill).toBeDefined()
    const prompt = composeSystemPrompt({
      skill: skill!,
      allowList: diagnoseReadOnlyTools(),
      stage: "diagnose",
      guardrails: [],
    })
    expect(prompt).toContain("sih-fusion-participant")
    expect(prompt).toContain("Pi built-in tools are disabled")
    for (const tool of [
      "edit",
      "bash",
      "kubectl",
      "read_secret",
      "web_fetch",
    ]) {
      expect(prompt).not.toContain(` ${tool}`)
    }
  })

  test("extractJson pulls a JSON object out of fenced model text", () => {
    const text = 'Here is the result:\n```json\n{"a": 1}\n```\nHope that helps.'
    expect(extractJson(text)).toBe('{"a": 1}')
    expect(extractJson("no json here")).toBeNull()
    expect(extractJson('prefix {"b": 2} suffix')).toBe('{"b": 2}')
  })
})
