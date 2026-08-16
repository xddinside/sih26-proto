/**
 * Deterministic skill-tree writer: regenerates the SKILL.md frontmatter,
 * contract.json, schema-ref.json, and references for the 21 Demo Profile
 * skills from the catalog tables in docs/research/pi-agent-catalog.md and
 * docs/build-handoff.md section 10. Run: `bun run scripts/write-skills.ts`.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const ROOT = new URL("../", import.meta.url).pathname

interface SkillSpec {
  name: string
  group: "core" | "reviews" | "tests"
  description: string
  stage: string
  toolGroup: string
  access: string
  independence: string
  roleCode?: string
  layer?: string
  outputSchema?: { name: string; version: string }
  contract: string[]
  references: string[]
}

const REGISTRY = "@sih/contracts"

const coreAccess =
  "Read: broker reads only. Write: none beyond Worker scratch. Network: Control Plane and broker endpoints only. No secrets; no direct production access, credentials, or actions."
const diagnoseAccess =
  "Read: Read Broker metric/trace/log/code queries only. Network: none beyond the allow-listed docs proxy (context only, never evidence). No writes, no shell, no open web; no direct production access, credentials, or actions."
const reviewAccess =
  "Read: pinned read snapshot (read, grep, find, ls), pinned read-only analyzers, and the allow-listed docs proxy (context only, never evidence). No project writes, no shell; no direct production access, credentials, or actions."
const testAccess =
  "Request pinned runs through the broker and read receipts and test output only. The model session receives no secret; where a test needs one, the broker mounts a masked, stage-bound value only into the isolated test process. No project writes and no shell beyond the isolated sandbox; no direct production access, credentials, or actions."

const skills: SkillSpec[] = [
  {
    name: "sih-orchestrator",
    group: "core",
    description:
      "Invoked once at Worker start to drive every stage of one Incident attempt: Detect, Diagnose (Fusion rounds), Repair, Verify, Release, and Watch. The Orchestrator proposes everything and decides nothing that policy owns; it is never a reviewer, Judge, or Synthesizer.",
    stage: "all",
    toolGroup: "orchestrator",
    access: coreAccess,
    independence:
      "Is the Orchestrator; never a reviewer, Judge, or Synthesizer; never merges, deploys, or executes a production action; never holds credentials.",
    contract: [
      "Startup inputs: run lease, journal checkpoint, sealed artifacts by hash, pinned read snapshot, Evidence Set revision id, skills/tool catalog digests, budgets, Model Gateway configuration.",
      "Allowed decisions: choose the subagent graph within policy bounds (participants >= 2; exactly the review roles and test layers the applicability resolver marks required or triggered; at most one repair implementer per candidate revision), choose subagent models from the allowed set, choose which Read Broker queries to run within stage limits, choose evidence-gathering actions from the Synthesizer's next_actions, propose artifact content, request gate evaluations and stage transitions, run bounded candidate revisions, cancel children, retry model calls.",
      "Forbidden decisions: write state or seal artifacts outside the proposal API; mint Evidence Set items; skip, reorder, or re-bucket stages, checks, or gates; issue or consume approvals or permits; run a barred or unapproved guarded action; compute the action-risk class, candidate hash, verdict function, or consolidation; merge, deploy, or execute any production action except through the Action Broker; hold company, cloud, source-control, or cluster credentials; review its own work; pick a fusion winner; feed model confidence into any gate.",
      "Failure: crash -> Worker restart cap 2 then unstable-worker; gate needs-human -> Run parks; resume continues from the gate.",
    ],
    references: [
      "docs/research/orchestrator-stages.md fixes the stage contracts.",
      "docs/research/pi-agent-catalog.md fixes the trust split and forbidden decisions.",
    ],
  },
  {
    name: "sih-fusion-participant",
    group: "core",
    description:
      "Invoked every Diagnose round, two or more in parallel (exactly 2 in the Demo Profile). Each participant receives the same diagnosis task, Context Brief, and Evidence Set revision id, investigates independently, and returns one machine-checked Fusion Participant Output.",
    stage: "diagnose",
    toolGroup: "diagnose-read-only",
    access: diagnoseAccess,
    independence:
      "Parallel, isolated scratch, no peer visibility, cannot communicate; citations must reference revision R_n only.",
    outputSchema: { name: "fusion-participant-output", version: "1.0" },
    contract: [
      "Inputs: task, brief, revision id, cited Evidence Set subset.",
      "Output: structured Hypothesis candidates with causal claims citing item ids, predicted observations, proposed tests, and stated objections.",
      "A failed participant does not invalidate the round if at least two well-formed outputs remain; otherwise the round is invalid and reruns (counting against the round cap where one is configured).",
      "A causal claim cannot cite a web page; the docs proxy is context, never evidence.",
    ],
    references: [
      "The output validates against fusion-participant-output@1.0 in the contracts registry.",
      "Round validity rule: docs/research/pi-agent-catalog.md (SIH changes the live harness's abort-on-any-failed-participant rule).",
    ],
  },
  {
    name: "sih-fusion-judge",
    group: "core",
    description:
      "Invoked once per Diagnose round after all participants complete. Compares Participant Outputs for agreement, contradictions, blind spots, and unique findings; emits a citation audit; never picks a winner and never emits confidence.",
    stage: "diagnose",
    toolGroup: "diagnose-read-only",
    access: diagnoseAccess,
    independence:
      "Sees participant outputs only, never participant tool traces; may query the same read-only evidence.",
    outputSchema: { name: "fusion-judge-output", version: "1.0" },
    contract: [
      "Inputs: task, brief, revision id, all Participant Outputs (never tool traces).",
      "Output: agreements, contradictions, blind_spots, unique_findings, citation_audit; no winner field, no confidence.",
      "Malformed output reruns once; a second failure invalidates the round.",
    ],
    references: [
      "The output validates against fusion-judge-output@1.0 in the contracts registry.",
      '"Do not pick a winner": live harness JUDGE_SYSTEM_PROMPT, kept unchanged.',
    ],
  },
  {
    name: "sih-fusion-synthesizer",
    group: "core",
    description:
      "Invoked once per Diagnose round after the Judge completes. Returns ranked Hypotheses, contradictions, gaps, and next evidence-gathering actions. Its output alone is the durable stage input; participant and Judge traces stay excluded from later model context.",
    stage: "diagnose",
    toolGroup: "diagnose-read-only",
    access: diagnoseAccess,
    independence:
      "Sees Judge analysis and participant outputs; its output alone is durable stage input.",
    outputSchema: { name: "fusion-synthesizer-output", version: "1.0" },
    contract: [
      "Inputs: task, brief, revision id, Participant Outputs, Judge analysis.",
      "Output: ranked_hypotheses, contradictions, gaps, next_actions, fusion_meta.",
      "Malformed output reruns once; a second failure ends the round needs-human or consumes the round cap.",
    ],
    references: [
      "The output validates against fusion-synthesizer-output@1.0 in the contracts registry.",
    ],
  },
  {
    name: "sih-repair-planner",
    group: "core",
    description:
      "Invoked once per attempt after the accepted Hypothesis and Remediation disposition are recorded. Turns the accepted Hypothesis into a Remediation Proposal draft with the change-to-Hypothesis citation map, Recovery Point draft, blast radius, test plan, and declared action and changed surfaces.",
    stage: "repair",
    toolGroup: "repair-planner",
    access:
      "Read: broker reads. Write: scratch only. Network: Control Plane and broker endpoints plus the allow-listed docs proxy. No direct production access, credentials, or actions.",
    independence:
      "Never reviews or tests its own plan; one planner per attempt; the authoring subagent never reviews.",
    outputSchema: { name: "remediation-proposal", version: "1.0" },
    contract: [
      "Inputs: accepted Hypothesis, Remediation disposition, the risk table and adapter declarations, Authority Mode and policy versions, code snapshot, Recovery Point draft inputs, service catalog.",
      "Proposes the action and surfaces; the Control Plane computes the deterministic action-risk class from the sealed proposal and adapter declarations only after the proposal exists.",
      "Failure: bounded internal revisions; each journal submission is a new candidate hash; no proposal -> failed: no-remediation.",
    ],
    references: [
      "The draft seals as remediation-proposal@1.0 in the contracts registry.",
    ],
  },
  {
    name: "sih-repair-implementer",
    group: "core",
    description:
      "Invoked once per candidate revision after the planner's draft. Produces the candidate diff or typed action plan in its own private copy-on-write worktree or scratch; the Orchestrator integrates it into the sole integration worktree, which alone can become an artifact.",
    stage: "repair",
    toolGroup: "worktree-edit",
    access:
      "Write: own worktree or scratch only. Network: allow-list proxy for dependencies. No secrets; no direct production access, credentials, or actions; no merge, no deploy.",
    independence:
      "The implementer never reviews its own candidate; a new revision may use a fresh implementer.",
    contract: [
      "Inputs: the planner's draft, the causal citation map, the base snapshot.",
      "Allowed tools: edit, write, patch_apply, local build/test in the private worktree; PR or typed-plan submission only through the Action Broker.",
      "Build or test failure during drafting loops locally; a barred or prohibited surface never reaches execution.",
    ],
    references: [
      "Candidate hash: sha256 over the full change set, computed by deterministic contract code; the model cannot change it.",
    ],
  },
  {
    name: "sih-review-correctness",
    group: "reviews",
    description:
      "R1 Change correctness review: the change does what the proposal claims and nothing more; no unrelated or unreported edits; the typed action plan matches the adapter's declared surface. Invoked for every class except Emergency.",
    stage: "verify",
    toolGroup: "review-read-only",
    access: reviewAccess,
    independence:
      "One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.",
    roleCode: "R1",
    outputSchema: { name: "review-report", version: "1.0" },
    contract: [
      "Inputs: candidate diff or typed action plan, base snapshot, accepted Hypothesis, citation map, disposition, service catalog, policy version, pinned Evidence Set subset, Recovery Point draft.",
      "Every finding cites a file and line, a check output ref, an item id, or a named Recovery Point gap. An uncited blocker or major finding reruns the role once, then needs-human.",
      "Scope: the candidate's own diff plus declared surfaces; a defect just outside the diff needs a cited reachability argument.",
      "A candidate may not add or widen a suppression for its own finding; that change is itself a blocker.",
    ],
    references: [
      "The report seals as review-report@1.0 with role R1 in the contracts registry.",
    ],
  },
  {
    name: "sih-review-causal-fit",
    group: "reviews",
    description:
      "R2 Causal fit review: every change maps to the accepted Hypothesis's causal chain through the citation map; no change cites nothing; no part of the causal chain is left uncovered. Invoked for all classes except Emergency.",
    stage: "verify",
    toolGroup: "review-read-only",
    access: reviewAccess,
    independence:
      "One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.",
    roleCode: "R2",
    outputSchema: { name: "review-report", version: "1.0" },
    contract: [
      "Classifying a proposed change's surfaces and citing the Hypothesis for R2 is agent work; the citation map is sealed proposal input.",
      "An unrelated change that cites nothing is a major finding; a causal-chain edge the proposal leaves uncovered is a gap, not an assumed pass.",
    ],
    references: [
      "The report seals as review-report@1.0 with role R2 in the contracts registry.",
    ],
  },
  {
    name: "sih-review-code-quality",
    group: "reviews",
    description:
      "R3 Code quality review: readability, maintainability, complexity, concurrency, error handling, and test coverage of the new code. Required for the Code class; conditional for Database migration code.",
    stage: "verify",
    toolGroup: "review-read-only",
    access: reviewAccess,
    independence:
      "One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.",
    roleCode: "R3",
    outputSchema: { name: "review-report", version: "1.0" },
    contract: [
      "Severity scale is fixed and machine-checked: blocker, major, minor, info.",
      "An uncited minor or info note stays non-blocking and is marked uncited.",
    ],
    references: [
      "The report seals as review-report@1.0 with role R3 in the contracts registry.",
    ],
  },
  {
    name: "sih-review-security",
    group: "reviews",
    description:
      "R4 Security/threat review: threat modeling on the changed surface — injection, authentication, authorization, secret handling, exposure widening, injection through the new code path. Manual review complements scanners; scanners alone never satisfy R4.",
    stage: "verify",
    toolGroup: "review-read-only",
    access: reviewAccess,
    independence:
      "One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.",
    roleCode: "R4",
    outputSchema: { name: "review-report", version: "1.0" },
    contract: [
      "A secret in the diff is a blocker and triggers the credential-exposure path: human decision, no autonomous remediation.",
      "Suppression changes for the candidate's own findings are blockers and go through human review.",
    ],
    references: [
      "The report seals as review-report@1.0 with role R4 in the contracts registry.",
    ],
  },
  {
    name: "sih-review-recovery-point",
    group: "reviews",
    description:
      "R8 Rollback/Recovery Point review: the Recovery Point covers every changed surface, names exact rollback commands in order with preconditions and timeouts, and its validation result is current. Required for every class except Emergency.",
    stage: "verify",
    toolGroup: "review-read-only",
    access: reviewAccess,
    independence:
      "One subagent per role with its own scratch; no peer reports before consolidation; the authoring subagent never reviews.",
    roleCode: "R8",
    outputSchema: { name: "review-report", version: "1.0" },
    contract: [
      "An uncovered changed surface is a named Recovery Point gap; it blocks unless the gap carries human approval.",
    ],
    references: [
      "The report seals as review-report@1.0 with role R8 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-static-analysis",
    group: "tests",
    description:
      "T1 Static analysis: maps the diff to the pinned catalog linter entry, requests the run through the broker, and checks the findings list against the receipt. Required for Code; pipeline-consumed for Deployment.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; the authoring subagent never tests its own change.",
    layer: "T1",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "The report cites the receipt; it never asserts a result the receipt does not contain.",
      "Outcome is copied from the receipt; a model cannot reinterpret a failed run as passing.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T1 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-build",
    group: "tests",
    description:
      "T2 Schema/lint/build: selects the build target and validation command from the pinned catalog, requests the run, and verifies the artifact digest against the receipt. Required for Code.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; dependent layers run in dependency order (build before unit).",
    layer: "T2",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "The artifact digest in the receipt binds the built candidate to the candidate hash.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T2 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-unit",
    group: "tests",
    description:
      "T3 Unit: maps changed packages to unit targets from the pinned catalog, requests the run through the broker or the CI runner, and checks the per-test summary against the receipt. Required for Code.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; runs after the build layer; parallel test classes share no mutable fixtures.",
    layer: "T3",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "A test that mutates shared state is a defective test and its result does not count.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T3 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-contract",
    group: "tests",
    description:
      "T4 Integration/contract: maps declared dependencies to contract checks against the isolated candidate environment, requests the run, and checks the contract receipts. Required for Code.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; the candidate instance and the stable instance stay separate.",
    layer: "T4",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "Contract receipts are broker receipts; a model may cite them, never create them.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T4 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-regression",
    group: "tests",
    description:
      "Scoped T5 Regression: confirms the resolver's ownership-map selection matches the receipt and never re-scopes the suite. Required for Code. The failing case in Demo Run 2 is fixed seed data, so the outcome stays deterministic regardless of review wording.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; scoped selection comes from the ownership map, never from the model.",
    layer: "T5",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "The report target must equal the ownership-map selection the resolver returned; a mismatch is a scoping violation, never a silent re-scope.",
      "If the ownership map cannot resolve the changed files, the resolver returns needs-human; the layer never runs everything or nothing.",
      "Outcome is copied verbatim from the receipt; a failed run stays failed in the report.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T5 in the contracts registry.",
      "Determinism property: docs/research/demo-runs.md — the T5 failure receipt names the failing case and the candidate hash; R1's wording cannot change it.",
    ],
  },
  {
    name: "sih-test-security-scan",
    group: "tests",
    description:
      "T7 Security scanning: requests the applicable pinned scanners (secret, dependency-vulnerability, SAST) with recorded tool and database versions; a scanner that does not apply is recorded not-applicable and is not run. Scanners never replace R4.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; scanners run through the pinned catalog only.",
    layer: "T7",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "Tool and database versions are recorded in the report; the receipt owns the findings list.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T7 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-isolated-env",
    group: "tests",
    description:
      "T9 Isolated environment: requests a candidate deploy with representative traffic through the broker and checks the start/serve receipts. Triggered when the class requires an isolated environment or a candidate target exists (always in the Demo Profile).",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; browser and test environments stay non-production.",
    layer: "T9",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "The candidate instance and the stable instance stay separate; receipts prove start and serve, never production health.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T9 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-browser",
    group: "tests",
    description:
      "T10 E2E/browser: drives the broker-provisioned browser sandbox over the user-facing paths the change touches and returns Playwright-style run receipts. A triggered T10 whose browser environment is unavailable returns needs-human, never a skip.",
    stage: "verify",
    toolGroup: "test-run-browser",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; the Worker never runs a browser against production.",
    layer: "T10",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "The browser runs in the broker-provisioned isolated sandbox only.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T10 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-fault-recovery",
    group: "tests",
    description:
      "T12 Fault/recovery: maps the changed surface to the restart/rollback/toggle/rotation/reroute drill, requests it on the isolated environment, and checks the drill receipts. Triggered when the changed surface or Recovery Point names such an action.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; drills run on the isolated environment only.",
    layer: "T12",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: [
      "Drill receipts are broker receipts; the report never asserts a recovery result the receipt does not contain.",
    ],
    references: [
      "The report seals as test-report@1.0 with layer T12 in the contracts registry.",
    ],
  },
  {
    name: "sih-test-watch-rehearsal",
    group: "tests",
    description:
      "T13 Watch-plan rehearsal: executes the frozen Watch plan's queries, limits, and stop rules against a non-production environment to prove they run, return data with the expected labels, and are reachable. It validates operability, never production health. Required for every class ending in an execution gate with a Watch plan.",
    stage: "verify",
    toolGroup: "test-run",
    access: testAccess,
    independence:
      "One subagent per layer with its own scratch; a release never proceeds on an unrehearsed plan.",
    layer: "T13",
    outputSchema: { name: "test-report", version: "1.0" },
    contract: ["Rehearsal receipts per query; absence never counts as a pass."],
    references: [
      "The report seals as test-report@1.0 with layer T13 in the contracts registry.",
    ],
  },
]

function frontmatter(skill: SkillSpec): string {
  const metadata = [
    `sih.stage: ${skill.stage}`,
    `sih.tool-group: ${skill.toolGroup}`,
    `sih.access: ${skill.access}`,
    `sih.independence: ${skill.independence}`,
    `sih.scope: demo`,
    `sih.version: 1.0`,
    ...(skill.roleCode === undefined
      ? []
      : [`sih.role-code: ${skill.roleCode}`]),
    ...(skill.layer === undefined ? [] : [`sih.layer: ${skill.layer}`]),
  ]
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    "metadata:",
    ...metadata.map((line) => `  ${line}`),
    "---",
  ].join("\n")
}

async function main(): Promise<void> {
  for (const skill of skills) {
    const dir = join(ROOT, skill.group, skill.name)
    await mkdir(join(dir, "schemas"), { recursive: true })
    await mkdir(join(dir, "references"), { recursive: true })

    const contractBody = [
      `# ${skill.name}`,
      "",
      skill.description,
      "",
      "## Role contract",
      "",
      ...skill.contract.map((line) => `- ${line}`),
      "",
      "## Tool group",
      "",
      `\`${skill.toolGroup}\` — resolved by the SIH extension with \`pi.setActiveTools\` before the session's first turn; brokers re-check everything server-side.`,
      "",
    ].join("\n")
    await writeFile(
      join(dir, "SKILL.md"),
      `${frontmatter(skill)}\n\n${contractBody}`
    )

    const contract = {
      name: skill.name,
      version: "1.0",
      stage: skill.stage,
      tool_group: skill.toolGroup,
      access: skill.access,
      independence: skill.independence,
      scope: "demo",
      ...(skill.roleCode === undefined ? {} : { role_code: skill.roleCode }),
      ...(skill.layer === undefined ? {} : { layer: skill.layer }),
      ...(skill.outputSchema === undefined
        ? {}
        : { output_schema: skill.outputSchema }),
      retry: {
        malformed: "rerun-once-then-needs-human",
        timeout: "rerun-once-then-needs-human",
      },
      demo_subset: true,
    }
    await writeFile(
      join(dir, "contract.json"),
      `${JSON.stringify(contract, null, 2)}\n`
    )

    const schemaRef = {
      ...(skill.outputSchema === undefined
        ? {
            note: "No registry output schema: this skill's output is a stage proposal or a candidate diff, sealed by the Control Plane.",
          }
        : {
            registry: REGISTRY,
            name: skill.outputSchema.name,
            version: skill.outputSchema.version,
          }),
    }
    await writeFile(
      join(dir, "schemas", "schema-ref.json"),
      `${JSON.stringify(schemaRef, null, 2)}\n`
    )

    const referencesBody = [
      `# ${skill.name}: binding references`,
      "",
      ...skill.references.map((line) => `- ${line}`),
      "",
    ].join("\n")
    await writeFile(join(dir, "references", "contract.md"), referencesBody)
  }
  console.log(`wrote ${skills.length} skill directories`)
}

await main()
