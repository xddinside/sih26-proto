/**
 * Fusion prompts, adapted from the live Fusion Agent Harness
 * (`packages/coding-agent/src/core/fusion/prompts.ts`, inspected read-only).
 *
 * SIH deltas, per docs/research/pi-agent-catalog.md and docs/agents/fusion.md:
 * - Participant Outputs are machine-checked structured Hypothesis candidates,
 *   not free text; every causal claim cites Evidence Set item ids from the
 *   pinned revision R_n only.
 * - No open-web fetch during Diagnose. The allow-listed documentation proxy
 *   supplies context only, never evidence; a causal claim cannot cite a web
 *   page.
 * - The Judge additionally emits a per-participant citation audit. It still
 *   does not pick a winner and emits no confidence score.
 * - The Synthesizer returns the durable ranked-Hypothesis result; its output
 *   alone becomes later stage input.
 */
import type { EvidenceItem, IncidentBrief } from "@sih/contracts/types"

/** The terminal tool each role calls to submit its schema-valid payload. The
 * model must call the tool with the JSON object as its `submission` argument;
 * printing the JSON as plain text never submits it. Named once here so the
 * prompts and the registered tool names can never drift apart. */
export const TERMINAL_TOOL_NAMES = {
  participant: "submit_hypotheses",
  judge: "submit_judgment",
  synthesizer: "submit_synthesis",
  planner: "submit_remediation",
  implementer: "submit_implemented_diff",
  reviewer: "submit_review",
  tester: "submit_test_report",
  orchestrator: "submit_orchestrator_report",
} as const

const submitVia = (tool: string) =>
  `Call the ${tool} tool with the JSON object as its submission argument; the tool call is your final output.`

export const PARTICIPANT_SYSTEM_PROMPT = [
  "You are a participant model in the SIH Diagnose stage Fusion Diagnosis round.",
  "You receive the same Shared Starting Context as the other participants: one diagnosis task, one Context Brief, and the Evidence Set revision id R_n.",
  "Investigate independently and give your best independent causal analysis of the Incident.",
  `Your output is a single JSON object matching the Fusion Participant Output v1 schema: schema_version, participant_id, revision_id, hypotheses (each with a causal_claim whose propagation edges cite Evidence Set item ids), stated_objections, and completed_at.`,
  submitVia(TERMINAL_TOOL_NAMES.participant),
  "Cite Evidence Set item ids from revision R_n only. A citation outside R_n is invalid. You cannot create evidence items; only broker receipts become items.",
  "The documentation proxy supplies context only, never evidence. A causal claim cannot cite a web page.",
  "You cannot claim to have changed files. You cannot write files, edit files, or run shell commands.",
].join("\n")

export const JUDGE_SYSTEM_PROMPT = [
  "You are the Judge Model in the SIH Diagnose stage Fusion Diagnosis round.",
  "You receive the task, the Context Brief, the Evidence Set revision id, and every Participant Output. You never see participant tool traces.",
  "Evaluate the participant outputs. Extract agreements, contradictions, blind spots, and uniquely useful contributions.",
  "Emit a citation audit per participant: counts of uncited claims, invalid citations, and citations to items missing from revision R_n.",
  `Your output is a single JSON object matching the Fusion Judge Output v1 schema: schema_version, judge_id, revision_id, agreements, contradictions, blind_spots, unique_findings, citation_audit, completed_at.`,
  submitVia(TERMINAL_TOOL_NAMES.judge),
  "Do not pick a winner. Do not emit a confidence score. Produce concise analysis for the Synthesizer, not a final user answer.",
  "The documentation proxy supplies context only, never evidence.",
].join("\n")

export const SYNTHESIZER_SYSTEM_PROMPT = [
  "You are the Synthesizer Model in the SIH Diagnose stage Fusion Diagnosis round.",
  "Use the Judge Model analysis and the participant outputs to produce one structured result.",
  `Your output is a single JSON object matching the Fusion Synthesizer Output v1 schema: schema_version, synthesizer_id, revision_id, ranked_hypotheses, contradictions, gaps, next_actions, fusion_meta, completed_at.`,
  submitVia(TERMINAL_TOOL_NAMES.synthesizer),
  "ranked_hypotheses orders the best-evidenced Hypotheses first; each carries its citations and proposed tests.",
  "next_actions name bounded evidence-gathering actions with procedure, bounds, permissions, and which Hypotheses each action discriminates. You only propose actions; the Orchestrator approves and runs them through the brokers.",
  "Do not mention scratchpads, hidden deliberation, or internal run mechanics.",
].join("\n")

export const BRIEF_SYSTEM_PROMPT = [
  "You assemble a Fusion Context Brief for the SIH Diagnose stage.",
  "The Orchestrator builds the brief deterministically from sealed artifacts; a brief model is an optional policy choice and you are not invoked by the Demo Profile.",
  "Capture only conversation-derived alignment another model cannot reliably rediscover from the evidence: operator decisions, rationale, preferences, assumptions, constraints, and unresolved tensions. Mark binding decisions with a Brief Authority Level.",
  "Do not summarize the repository or rewrite obvious facts from the task. Use concise markdown. Omit empty sections.",
].join("\n")

/** A deterministic brief from sealed artifacts plus operator decisions: no
 * raw transcript, per the SIH Context Brief rule. */
export function buildDeterministicBrief(
  incidentBrief: IncidentBrief,
  operatorDecisions: readonly {
    level: "binding" | "preference" | "assumption"
    text: string
  }[]
): string {
  const sections: string[] = [
    "# Fusion Context Brief",
    "",
    "## Binding incident facts (sealed Incident Brief v1)",
    `- Symptom: ${incidentBrief.symptom}`,
    `- Severity: ${incidentBrief.severity}`,
    `- Scope: tenant ${incidentBrief.scope.tenant_id}, environment ${incidentBrief.scope.deployment_environment_name}, service ${incidentBrief.scope.service_name}`,
    `- Policy version in force: ${incidentBrief.policy_version}`,
    incidentBrief.known_limits === undefined
      ? ""
      : `- Known limits: ${incidentBrief.known_limits}`,
    incidentBrief.service_topology === undefined
      ? ""
      : `- Service topology: ${incidentBrief.service_topology}`,
    "",
  ]
  if (operatorDecisions.length > 0) {
    sections.push("## Operator decisions")
    for (const decision of operatorDecisions) {
      sections.push(`- [${decision.level}] ${decision.text}`)
    }
    sections.push("")
  }
  return sections.filter((line) => line !== "").join("\n")
}

/** A compact citation manifest of the pinned Evidence Set items: each item's
 * id, kind, and the identity fields a model needs to cite it and to form
 * joined causal chains. Deterministic; built from the sealed items only. */
export function evidenceManifest(items: readonly EvidenceItem[] | undefined): string {
  if (items === undefined || items.length === 0) {
    return ""
  }
  const lines = ["## Evidence Set items (revision pinned)", ""]
  for (const item of items) {
    const identity = Object.entries(item.identity ?? {})
      .map(([key, value]) => {
        const rendered =
          typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)
        return `${key}=${rendered}`
      })
      .join(" ")
    const content =
      typeof item.snapshot === "object" && item.snapshot !== null
        ? JSON.stringify(item.snapshot)
        : String(item.snapshot ?? "")
    lines.push(`- item_id: ${item.id}`)
    lines.push(`  kind: ${item.kind}`)
    lines.push(`  identity: ${identity}`)
    lines.push(`  content: ${content}`)
    lines.push("")
  }
  return lines.join("\n")
}

export function createParticipantPrompt(
  task: string,
  brief: string | undefined,
  revisionId: string,
  items?: readonly EvidenceItem[]
): string {
  return [
    "# Shared Starting Context",
    "",
    ...(brief === undefined ? [] : ["## Fusion Context Brief", brief, ""]),
    `## Evidence Set revision id\n${revisionId}`,
    "",
    ...(evidenceManifest(items) === "" ? [] : [evidenceManifest(items)]),
    "## Fusion Task",
    task,
    "",
    `Submit the Fusion Participant Output v1 object by calling ${TERMINAL_TOOL_NAMES.participant}.`,
  ].join("\n")
}

export function createJudgePrompt(
  task: string,
  brief: string | undefined,
  revisionId: string,
  participantOutputs: readonly { participantId: string; output: string }[],
  items?: readonly EvidenceItem[]
): string {
  return [
    ...(brief === undefined ? [] : ["# Fusion Context Brief", brief, ""]),
    "# Fusion Task",
    task,
    "",
    `# Evidence Set revision id\n${revisionId}`,
    "",
    ...(evidenceManifest(items) === "" ? [] : [evidenceManifest(items)]),
    "# Participant Outputs",
    participantOutputs
      .map(
        (entry, index) =>
          `## Participant ${index + 1}: ${entry.participantId}\n\n${entry.output}`
      )
      .join("\n\n"),
    "",
    `Analyze the participant outputs for the Synthesizer, then call ${TERMINAL_TOOL_NAMES.judge} with the Fusion Judge Output v1 object.`,
  ].join("\n")
}

export function createSynthesizerPrompt(
  task: string,
  brief: string | undefined,
  revisionId: string,
  participantOutputs: readonly { participantId: string; output: string }[],
  judgeAnalysis: string,
  items?: readonly EvidenceItem[]
): string {
  return [
    ...(brief === undefined ? [] : ["# Fusion Context Brief", brief, ""]),
    "# Fusion Task",
    task,
    "",
    `# Evidence Set revision id\n${revisionId}`,
    "",
    ...(evidenceManifest(items) === "" ? [] : [evidenceManifest(items)]),
    "# Judge Analysis",
    judgeAnalysis,
    "",
    "# Participant Outputs",
    participantOutputs
      .map(
        (entry, index) =>
          `## Participant ${index + 1}: ${entry.participantId}\n\n${entry.output}`
      )
      .join("\n\n"),
    "",
    `Write the final structured synthesized result and call ${TERMINAL_TOOL_NAMES.synthesizer} with the Fusion Synthesizer Output v1 object.`,
  ].join("\n")
}

export const REVIEW_SYSTEM_PROMPT = [
  "You are one specialist reviewer in the SIH Verify stage.",
  "You receive the candidate diff, its changed files, the accepted Hypothesis, and the Evidence Set revision id; you never see peer reports.",
  "Every finding must cite a file and line in the diff, a deterministic check output reference, an Evidence Set item id, or a named Recovery Point gap. A blocker or major finding without citations is incomplete and reruns.",
  `Your output is a single JSON object matching the Review Report v1 schema: schema_version, incident_id, run_id, attempt, candidate_hash, role, reviewer, revision, input_refs, findings, status, sealed_at.`,
  submitVia(TERMINAL_TOOL_NAMES.reviewer),
  "You cannot edit code, plans, or reports. Read-only investigation only.",
].join("\n")

export const TEST_SYSTEM_PROMPT = [
  "You are one specialist test subagent in the SIH Verify stage.",
  "You receive the candidate diff, its changed files, and the recorded test-run receipts; you never see peer reports.",
  `Your output is a single JSON object matching the Test Report v1 schema: schema_version, incident_id, run_id, attempt, candidate_hash, layer, tool, tool_version, target, receipt_ref, runs, outcome, flaky, coverage_checked, sealed_at.`,
  submitVia(TERMINAL_TOOL_NAMES.tester),
  "The outcome must match the recorded receipt runs; you cannot fabricate a pass or a failure.",
  "You cannot edit code, plans, or reports. Read-only investigation only.",
].join("\n")

export const REPAIR_PLANNER_SYSTEM_PROMPT = [
  "You are the repair planner in the SIH Repair stage.",
  "You receive the accepted Hypothesis, the incident context, the Recovery Point, and the changed-surface policy. You propose the remediation; the Orchestrator and the Control Plane decide.",
  "Your output is a single JSON object matching the Remediation Draft v1 schema: schema_version, incident_id, run_id, attempt, remediation_class, action_risk_class, gate_path, disposition, change_description, citations, test_plan, changed_surfaces, typed_action_plan, completed_at.",
  "remediation_class is one of: code, configuration, feature-flags, deployment, restart-scale-traffic, infrastructure, database-data, credentials, emergency-rollback.",
  "action_risk_class is one of: safe, guarded, barred.",
  "gate_path is one of: release, action.",
  "disposition is one of: allowed, approval-required, prohibited, observe-only.",
  submitVia(TERMINAL_TOOL_NAMES.planner),
  "You cannot change files, merge, deploy, or execute production actions.",
].join("\n")

export const REPAIR_IMPLEMENTER_SYSTEM_PROMPT = [
  "You are the repair implementer in the SIH Repair stage.",
  "You work only inside your private copy-on-write worktree. You apply the approved remediation to the changed files there; you never merge, deploy, or touch production.",
  "Your output is a single JSON object matching the Implemented Diff v1 schema: schema_version, incident_id, run_id, attempt, base_ref, diff_text, diff_hash, changed_files, completed_at.",
  "Before submitting, call worktree_diff and copy its output into your submission verbatim: diff_text is the exact unified diff the tool returns, and diff_hash is the exact hash the tool returns. Never summarize, reformat, or hand-write either value.",
  submitVia(TERMINAL_TOOL_NAMES.implementer),
].join("\n")

export const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are the Pi Orchestrator role in the SIH run.",
  "You receive the deterministic stage outcomes and the sealed artifact digests for the whole run. In a scheduler session, use only the typed lifecycle inspection and work-request tools to propose the current eligible bounded unit; in a final-report session, propose nothing beyond your report. The Control Plane owns every decision.",
  "Your output is a single JSON object matching the Orchestrator Report v1 schema: schema_version, incident_id, run_id, attempt, stage_outcomes, assessments, reflections, completed_at.",
  "stage_outcomes is an object with exactly the four keys detect, diagnose, repair, verify, each mapping to a short outcome summary string.",
  "assessments and reflections are arrays of one-sentence strings.",
  "completed_at is an ISO-8601 timestamp string.",
  "The object must contain exactly these fields and nothing else.",
  submitVia(TERMINAL_TOOL_NAMES.orchestrator),
].join("\n")

export function createReviewPrompt(options: {
  role: string
  candidateHash: string
  hypothesis: string
  /** The accepted Remediation (serialized Remediation Draft), when sealed. */
  acceptedRemediation?: string
  /** The accepted Recovery Point hash the reviewer can cite (R8). */
  recoveryPointHash: string
  revisionId: string
  diffText: string
  changedFiles: readonly string[]
  checkHints?: readonly string[]
  inputRefs?: readonly string[]
}): string {
  return [
    "# Review Task",
    `Review role ${options.role} against the candidate ${options.candidateHash}.`,
    "",
    `## Accepted Hypothesis\n${options.hypothesis}`,
    ...(options.acceptedRemediation === undefined
      ? []
      : ["", "## Accepted Remediation", options.acceptedRemediation]),
    `## Recovery Point\n${options.recoveryPointHash}`,
    `## Evidence Set revision id\n${options.revisionId}`,
    "",
    "## Candidate diff",
    options.diffText,
    "",
    `## Changed files\n${options.changedFiles.join("\n")}`,
    ...(options.checkHints === undefined || options.checkHints.length === 0
      ? []
      : ["", "## Checks for this role", ...options.checkHints]),
    ...(options.inputRefs === undefined || options.inputRefs.length === 0
      ? []
      : ["", "## Input references", ...options.inputRefs]),
    "",
    `Return your final review by calling ${TERMINAL_TOOL_NAMES.reviewer} with the Review Report v1 object.`,
  ].join("\n")
}

export function createTestPrompt(options: {
  layer: string
  candidateHash: string
  diffText: string
  changedFiles: readonly string[]
  runsSummary: string
  target: string
}): string {
  return [
    "# Test Task",
    `Assemble the Test Report v1 for layer ${options.layer} against the candidate ${options.candidateHash}.`,
    "",
    "## Candidate diff",
    options.diffText,
    "",
    `## Changed files\n${options.changedFiles.join("\n")}`,
    "",
    "## Recorded test runs",
    options.runsSummary,
    "",
    `Return your final report by calling ${TERMINAL_TOOL_NAMES.tester} with the Test Report v1 object.`,
  ].join("\n")
}
