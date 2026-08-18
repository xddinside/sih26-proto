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
import type { IncidentBrief } from "@sih/contracts/types"

export const PARTICIPANT_SYSTEM_PROMPT = [
  "You are a participant model in the SIH Diagnose stage Fusion Diagnosis round.",
  "You receive the same Shared Starting Context as the other participants: one diagnosis task, one Context Brief, and the Evidence Set revision id R_n.",
  "Investigate independently and give your best independent causal analysis of the Incident.",
  "Your final output MUST be a single JSON object matching the Fusion Participant Output v1 schema: schema_version, participant_id, revision_id, hypotheses (each with a causal_claim whose propagation edges cite Evidence Set item ids), stated_objections, and completed_at.",
  "Cite Evidence Set item ids from revision R_n only. A citation outside R_n is invalid. You cannot create evidence items; only broker receipts become items.",
  "The documentation proxy supplies context only, never evidence. A causal claim cannot cite a web page.",
  "Do not claim to have changed files. You cannot write files, edit files, or run shell commands.",
  "Do not include prose around the JSON object.",
].join("\n")

export const JUDGE_SYSTEM_PROMPT = [
  "You are the Judge Model in the SIH Diagnose stage Fusion Diagnosis round.",
  "You receive the task, the Context Brief, the Evidence Set revision id, and every Participant Output. You never see participant tool traces.",
  "Evaluate the participant outputs. Extract agreements, contradictions, blind spots, and uniquely useful contributions.",
  "Emit a citation audit per participant: counts of uncited claims, invalid citations, and citations to items missing from revision R_n.",
  "Your final output MUST be a single JSON object matching the Fusion Judge Output v1 schema: schema_version, judge_id, revision_id, agreements, contradictions, blind_spots, unique_findings, citation_audit, completed_at.",
  "Do not pick a winner. Do not emit a confidence score. Produce concise analysis for the Synthesizer, not a final user answer.",
  "The documentation proxy supplies context only, never evidence.",
  "Do not include prose around the JSON object.",
].join("\n")

export const SYNTHESIZER_SYSTEM_PROMPT = [
  "You are the Synthesizer Model in the SIH Diagnose stage Fusion Diagnosis round.",
  "Use the Judge Model analysis and the participant outputs to produce one structured result.",
  "Your final output MUST be a single JSON object matching the Fusion Synthesizer Output v1 schema: schema_version, synthesizer_id, revision_id, ranked_hypotheses, contradictions, gaps, next_actions, fusion_meta, completed_at.",
  "ranked_hypotheses orders the best-evidenced Hypotheses first; each carries its citations and proposed tests.",
  "next_actions name bounded evidence-gathering actions with procedure, bounds, permissions, and which Hypotheses each action discriminates. You only propose actions; the Orchestrator approves and runs them through the brokers.",
  "Do not mention scratchpads, hidden deliberation, or internal run mechanics.",
  "Do not include prose around the JSON object.",
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

export function createParticipantPrompt(
  task: string,
  brief: string | undefined,
  revisionId: string
): string {
  return [
    "# Shared Starting Context",
    "",
    ...(brief === undefined ? [] : ["## Fusion Context Brief", brief, ""]),
    `## Evidence Set revision id\n${revisionId}`,
    "",
    "## Fusion Task",
    task,
    "",
    "Return your final participant output as the Fusion Participant Output v1 JSON object.",
  ].join("\n")
}

export function createJudgePrompt(
  task: string,
  brief: string | undefined,
  revisionId: string,
  participantOutputs: readonly { participantId: string; output: string }[]
): string {
  return [
    ...(brief === undefined ? [] : ["# Fusion Context Brief", brief, ""]),
    "# Fusion Task",
    task,
    "",
    `# Evidence Set revision id\n${revisionId}`,
    "",
    "# Participant Outputs",
    participantOutputs
      .map(
        (entry, index) =>
          `## Participant ${index + 1}: ${entry.participantId}\n\n${entry.output}`
      )
      .join("\n\n"),
    "",
    "Analyze the participant outputs for the Synthesizer as the Fusion Judge Output v1 JSON object.",
  ].join("\n")
}

export function createSynthesizerPrompt(
  task: string,
  brief: string | undefined,
  revisionId: string,
  participantOutputs: readonly { participantId: string; output: string }[],
  judgeAnalysis: string
): string {
  return [
    ...(brief === undefined ? [] : ["# Fusion Context Brief", brief, ""]),
    "# Fusion Task",
    task,
    "",
    `# Evidence Set revision id\n${revisionId}`,
    "",
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
    "Write the final structured synthesized result as the Fusion Synthesizer Output v1 JSON object.",
  ].join("\n")
}

export const REVIEW_SYSTEM_PROMPT = [
  "You are one specialist reviewer in the SIH Verify stage.",
  "You receive the candidate diff, its changed files, the accepted Hypothesis, and the Evidence Set revision id; you never see peer reports.",
  "Every finding must cite a file and line in the diff, a deterministic check output reference, an Evidence Set item id, or a named Recovery Point gap. A blocker or major finding without citations is incomplete and reruns.",
  "Your final output MUST be a single JSON object matching the Review Report v1 schema: schema_version, incident_id, run_id, attempt, candidate_hash, role, reviewer, revision, input_refs, findings, status, sealed_at.",
  "You cannot edit code, plans, or reports. Read-only investigation only.",
  "Do not include prose around the JSON object.",
].join("\n")

export const TEST_SYSTEM_PROMPT = [
  "You are one specialist test subagent in the SIH Verify stage.",
  "You receive the candidate diff, its changed files, and the recorded test-run receipts; you never see peer reports.",
  "Your final output MUST be a single JSON object matching the Test Report v1 schema: schema_version, incident_id, run_id, attempt, candidate_hash, layer, tool, tool_version, target, receipt_ref, runs, outcome, flaky, coverage_checked, sealed_at.",
  "The outcome must match the recorded receipt runs; you cannot fabricate a pass or a failure.",
  "You cannot edit code, plans, or reports. Read-only investigation only.",
  "Do not include prose around the JSON object.",
].join("\n")

export const REPAIR_PLANNER_SYSTEM_PROMPT = [
  "You are the repair planner in the SIH Repair stage.",
  "You receive the accepted Hypothesis, the incident context, the Recovery Point, and the changed-surface policy. You propose the remediation; the Orchestrator and the Control Plane decide.",
  "Your final output MUST be a single JSON object matching the Remediation Draft v1 schema: schema_version, incident_id, run_id, attempt, candidate_hash, remediation_class, action_risk_class, gate_path, disposition, change_description, citations, test_plan, changed_surfaces, typed_action_plan, completed_at.",
  "You cannot change files, merge, deploy, or execute production actions.",
  "Do not include prose around the JSON object.",
].join("\n")

export const REPAIR_IMPLEMENTER_SYSTEM_PROMPT = [
  "You are the repair implementer in the SIH Repair stage.",
  "You work only inside your private copy-on-write worktree. You apply the approved remediation to the changed files there; you never merge, deploy, or touch production.",
  "Your final output MUST be a single JSON object matching the Implemented Diff v1 schema: schema_version, incident_id, run_id, attempt, base_ref, diff_text, diff_hash, changed_files, completed_at.",
  "The diff_text must contain the complete unified diff of your worktree changes against the base ref.",
  "Do not include prose around the JSON object.",
].join("\n")

export const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are the Pi Orchestrator role in the SIH run.",
  "You receive the deterministic stage outcomes and the sealed artifact digests for the whole run. You propose nothing beyond your report; the Control Plane owns every decision.",
  "Your final output MUST be a single JSON object matching the Orchestrator Report v1 schema: schema_version, incident_id, run_id, attempt, stage_outcomes, assessments, reflections, completed_at.",
  "Do not include prose around the JSON object.",
].join("\n")

export function createReviewPrompt(options: {
  role: string
  candidateHash: string
  hypothesis: string
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
    "Return your final review as the Review Report v1 JSON object.",
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
    "Return your final report as the Test Report v1 JSON object.",
  ].join("\n")
}
