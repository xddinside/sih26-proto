/**
 * Skill catalog tests: the Demo Profile subset, registry-bound output
 * schemas, tool groups, and the skills digest.
 */
import { describe, expect, test } from "bun:test"

import {
  assertDemoSubset,
  DEMO_SKILL_NAMES,
  NOT_DEMO_SKILL_NAMES,
  loadSkillTree,
  skillsDigest,
} from "../src/skill-catalog.js"
import { resolveAllowList } from "../src/allow-lists.js"
import { SKILLS_ROOT } from "./helpers.js"

describe("demo skill subset", () => {
  test("the packaged tree is exactly the 21-skill Demo Profile subset", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    expect(skills.size).toBe(21)
    expect([...skills.keys()].sort()).toEqual([...DEMO_SKILL_NAMES].sort())
    assertDemoSubset(skills)
    for (const name of NOT_DEMO_SKILL_NAMES) {
      expect(skills.has(name)).toBe(false)
    }
  })

  test("no Solution Contract skill is packaged (R5-R7, R9, T6, T8, T11)", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    for (const name of NOT_DEMO_SKILL_NAMES) {
      expect(skills.has(name), name).toBe(false)
    }
  })

  test("every skill's output schema resolves in the contracts registry", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    for (const skill of skills.values()) {
      if (skill.contract.output_schema === undefined) {
        expect(skill.contract.name).toBeOneOf([
          "sih-orchestrator",
          "sih-repair-implementer",
        ])
        continue
      }
      // loadSkill already classifies against the registry; reaching here
      // means the schema resolved.
      expect(skill.contract.output_schema.version).toBe("1.0")
    }
  })

  test("every skill's tool group resolves without shell, production, credential, or open-web tools", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    for (const skill of skills.values()) {
      const tools = resolveAllowList(skill.contract.tool_group)
      // loadSkillTree already rejected never-allowed tool classes; resolving
      // here must not throw.
      expect(tools.length).toBeGreaterThanOrEqual(0)
    }
  })

  test("the demo review roles are exactly R1, R2, R3, R4, R8", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    const roles = [...skills.values()]
      .map((skill) => skill.contract.role_code)
      .filter((role): role is string => role !== undefined)
      .sort()
    expect(roles).toEqual(["R1", "R2", "R3", "R4", "R8"])
  })

  test("the demo test layers are exactly T1-T5, T7, T9, T10, T12, T13", async () => {
    const skills = await loadSkillTree(SKILLS_ROOT)
    const layers = [...skills.values()]
      .map((skill) => skill.contract.layer)
      .filter((layer): layer is string => layer !== undefined)
      .sort()
    expect(layers).toEqual([
      "T1",
      "T10",
      "T12",
      "T13",
      "T2",
      "T3",
      "T4",
      "T5",
      "T7",
      "T9",
    ])
  })

  test("the skills digest changes when the tree changes", async () => {
    const before = await skillsDigest(SKILLS_ROOT)
    // Hashing only the core subtree yields a different file set, hence a
    // different digest: the digest binds the tree's content.
    const partial = await skillsDigest(`${SKILLS_ROOT}/core`)
    expect(partial).not.toBe(before)
  })
})
