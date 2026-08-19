/**
 * Network-free streaming provider used by automated rehearsals.
 *
 * It drives the same Pi role loops as a real Gateway call, including
 * worktree/test/orchestrator tools, but derives each terminal submission from
 * the role's bounded prompt and deterministic receipts. No API key or live
 * signal is involved.
 */
import { scriptedStreamingProvider } from "@sih/brokers"
import type { GatewayStreamRequest, GatewayStreamingProvider, ScriptedTurn } from "@sih/brokers"
import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import type { Hypothesis, OrchestratorWorkBudget, ReviewReport, TestReport } from "@sih/contracts/types"

import { buildUnifiedDiff } from "../../../packages/pi-skills/src/agent/roles.js"
import { structuredProvider } from "./payloads.js"
import type { EvidenceIds } from "./payloads.js"

interface DeterministicProviderOptions {
  incidentId: string
  runId: string
  revisionId: HashString
  hypotheses: { h1: Hypothesis; h2: Hypothesis; h3: Hypothesis; h4: Hypothesis }
  evidenceIds: EvidenceIds
  seed: "S1" | "S2"
  requestBudget: OrchestratorWorkBudget
}

function now(): string {
  return new Date().toISOString()
}

function hash(value: string): HashString {
  return value as HashString
}

function hashTokens(text: string): HashString[] {
  return [...new Set(text.match(/sha256:[0-9a-f]{64}/g) ?? [])].map(hash)
}

function messageTexts(request: GatewayStreamRequest): string[] {
  const texts: string[] = []
  for (const message of request.context.messages as unknown[]) {
    if (typeof message !== "object" || message === null) continue
    const content = (message as { content?: unknown }).content
    if (typeof content === "string") texts.push(content)
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
        texts.push((part as { text: string }).text)
      }
    }
  }
  return texts
}

function promptText(request: GatewayStreamRequest): string {
  return [request.context.systemPrompt, ...messageTexts(request)].join("\n")
}

function terminal(name: string, payload: unknown): ScriptedTurn {
  return { kind: "tool-call", id: `${name}-call`, name, args: { submission: payload as Record<string, unknown> } }
}

function candidateHash(text: string, fallback: HashString): HashString {
  return hash(text.match(/candidate (sha256:[0-9a-f]{64})/i)?.[1] ?? fallback)
}

function currentStage(text: string): "detect" | "diagnose" | "repair" | "verify" | "release" | "watch" {
  return (text.match(/"current_stage"\s*:\s*"(detect|diagnose|repair|verify|release|watch)"/)?.[1] ?? "detect") as ReturnType<typeof currentStage>
}

function admittedWorkIds(text: string): string[] {
  const body = text.match(/"admitted_work_ids"\s*:\s*\[([^\]]*)\]/)?.[1] ?? ""
  return [...body.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) => match[1] ?? "")
}

function incidentAndRun(options: DeterministicProviderOptions) {
  return { incident_id: options.incidentId, run_id: options.runId, attempt: 1 }
}

function stageOutcomes(text: string, seed: "S1" | "S2") {
  const value = (stage: "detect" | "diagnose" | "repair" | "verify", fallback: string): string =>
    text.match(new RegExp(`- ${stage}: ([^\\n]+)`))?.[1]?.trim() ?? fallback
  return {
    detect: value("detect", "pending"),
    diagnose: value("diagnose", "pending"),
    repair: value("repair", "pending"),
    verify: value("verify", seed === "S1" ? "completed" : "failed"),
  }
}

function plannerPayload(request: GatewayStreamRequest, options: DeterministicProviderOptions): Record<string, unknown> {
  const cited = hashTokens(promptText(request))
  return {
    schema_version: "1.0",
    ...incidentAndRun(options),
    remediation_class: "code",
    action_risk_class: "safe",
    gate_path: "release",
    disposition: "allowed",
    change_description: "restore the card-type guard in src/payment/card.js",
    citations: [{ change: "card-type guard", hypothesis_id: "H1", cited_item_ids: cited.length > 0 ? cited.slice(0, 5) : [options.evidenceIds.codeLocationId] }],
    test_plan: ["node --test src/payment/card.unit.test.js", "node --test src/payment/payment.regression.test.js"],
    changed_surfaces: ["src/payment/card.js"],
    typed_action_plan: { adapter: "compose-release", action_class: "merge-deploy", command: "swap" },
    completed_at: now(),
  }
}

function parseBaseRef(text: string): string {
  return text.match(/## Base ref\s+([^\n]+)/)?.[1]?.trim() ?? "base-ref"
}

function implementerPayload(
  request: GatewayStreamRequest,
  options: DeterministicProviderOptions,
  base: string,
  current: string,
): Record<string, unknown> {
  const baseRef = parseBaseRef(promptText(request))
  const diffText = buildUnifiedDiff({
    baseRef,
    base: new Map([["src/payment/card.js", base]]),
    current: new Map([["src/payment/card.js", current]]),
  })
  const digest = contentHash({ base_ref: baseRef, diff: diffText } as never)
  if (!digest.ok) throw new Error(digest.error.message)
  return {
    schema_version: "1.0",
    ...incidentAndRun(options),
    base_ref: baseRef,
    diff_text: diffText,
    diff_hash: digest.value,
    changed_files: ["src/payment/card.js"],
    completed_at: now(),
  }
}

function reviewPayload(request: GatewayStreamRequest, options: DeterministicProviderOptions): ReviewReport {
  const text = promptText(request)
  const role = (text.match(/Review role (R[0-9]+)/)?.[1] ?? "R1") as ReviewReport["role"]
  const candidate = candidateHash(text, options.revisionId)
  const refs = hashTokens(text)
  return {
    schema_version: "1.0",
    ...incidentAndRun(options),
    candidate_hash: candidate,
    role,
    reviewer: `real-reviewer-${role}`,
    revision: 1,
    input_refs: refs.length > 0 ? refs.slice(0, 3) : [options.revisionId],
    findings: [{
      id: `${role.toLowerCase()}-deterministic-f1`,
      severity: "info",
      claim: "the bounded deterministic rehearsal found no additional defect",
      citations: [{ kind: "file-line", file: "src/payment/card.js", line: 12, ref: candidate }],
      status: "open",
    }],
    status: "pass",
    sealed_at: now(),
  }
}

function testPayload(
  request: GatewayStreamRequest,
  options: DeterministicProviderOptions,
  receipt: Record<string, unknown>,
): TestReport {
  const text = promptText(request)
  const layer = (text.match(/layer (T[0-9]+)/)?.[1] ?? "T1") as TestReport["layer"]
  const candidate = candidateHash(text, options.revisionId)
  return {
    schema_version: "1.0",
    ...incidentAndRun(options),
    candidate_hash: candidate,
    layer,
    tool: String(receipt.tool),
    tool_version: String(receipt.tool_version),
    target: String(receipt.target),
    receipt_ref: String(receipt.receipt_ref),
    runs: receipt.runs as TestReport["runs"],
    outcome: receipt.outcome as TestReport["outcome"],
    flaky: false,
    coverage_checked: true,
    sealed_at: now(),
  }
}

/** Build a deterministic provider that still uses real Pi role sessions. */
export function deterministicStreamingProvider(
  options: DeterministicProviderOptions,
): GatewayStreamingProvider {
  const fusion = structuredProvider(
    options.incidentId,
    options.runId,
    options.revisionId,
    options.hypotheses,
  )
  const worktreeBases = new Map<string, string>()
  const worktreeCurrents = new Map<string, string>()

  return scriptedStreamingProvider({
    respond: async (request, turnIndex): Promise<ScriptedTurn> => {
      const text = promptText(request)
      if (request.agentRole === "participant" || request.agentRole === "judge" || request.agentRole === "synthesizer") {
        const model = request.agentRole === "participant"
          ? (request.agentId.includes("p-2") ? "stub-participant-2" : "stub-participant-1")
          : request.agentRole === "judge" ? "stub-judge" : "stub-synthesizer"
        const completed = await fusion.complete(model, text)
        return terminal(
          request.agentRole === "participant" ? "submit_hypotheses" : request.agentRole === "judge" ? "submit_judgment" : "submit_synthesis",
          JSON.parse(completed.text),
        )
      }
      if (request.agentRole === "repair-agent" && request.agentId.includes("planner")) {
        return terminal("submit_remediation", plannerPayload(request, options))
      }
      if (request.agentRole === "repair-agent" && request.agentId.includes("implementer")) {
        if (turnIndex === 0) return { kind: "tool-call", id: "worktree-read", name: "worktree_read", args: { path: "src/payment/card.js" } }
        const texts = messageTexts(request)
        if (turnIndex === 1) {
          const base = texts.at(-1) ?? ""
          const current = base.replace(
            'if (cardTypeCheck(cardNumber) === cardType && cardType === "VISA")',
            'if (cardTypeCheck(cardNumber) !== cardType || cardType !== "VISA")',
          )
          worktreeBases.set(request.agentId, base)
          worktreeCurrents.set(request.agentId, current)
          return { kind: "tool-call", id: "worktree-write", name: "worktree_write", args: { path: "src/payment/card.js", content: current } }
        }
        if (turnIndex === 2) return { kind: "tool-call", id: "worktree-diff", name: "worktree_diff", args: {} }
        return terminal("submit_implemented_diff", implementerPayload(
          request,
          options,
          worktreeBases.get(request.agentId) ?? "",
          worktreeCurrents.get(request.agentId) ?? "",
        ))
      }
      if (request.agentRole === "reviewer") return terminal("submit_review", reviewPayload(request, options))
      if (request.agentRole === "test-agent") {
        if (turnIndex === 0) return { kind: "tool-call", id: "assigned-test", name: "run_assigned_test", args: {} }
        const receiptText = messageTexts(request).find((value) => value.includes('"receipt_ref"'))
        const receipt = receiptText === undefined ? {} : JSON.parse(receiptText) as Record<string, unknown>
        return terminal("submit_test_report", testPayload(request, options, receipt))
      }
      if (request.agentRole === "orchestrator") {
        if (turnIndex === 0) return { kind: "tool-call", id: "inspect-state", name: "inspect_orchestrator_state", args: {} }
        if (request.agentId.includes("final-report")) {
          return terminal("submit_orchestrator_report", {
            schema_version: "1.0",
            ...incidentAndRun(options),
            stage_outcomes: stageOutcomes(text, options.seed),
            assessments: ["deterministic provider replayed the frozen Evidence Set"],
            reflections: ["Control Plane gates owned the lifecycle outcome"],
            completed_at: now(),
          })
        }
        if (turnIndex === 1) return {
          kind: "tool-call",
          id: "request-work",
          name: "request_orchestrator_work",
          args: {
            request_id: `rehearsal-${options.runId}-${request.agentId}-work`,
            work_id: `rehearsal-${options.runId}-${request.agentId}-work`,
            stage: currentStage(text),
            attempt: 1,
            depends_on: currentStage(text) === "detect" ? [] : admittedWorkIds(text).slice(-1),
            budget: options.requestBudget,
          },
        }
        return terminal("submit_orchestrator_report", {
          schema_version: "1.0",
          ...incidentAndRun(options),
          stage_outcomes: stageOutcomes(text, options.seed),
          assessments: ["deterministic provider replayed the frozen Evidence Set"],
          reflections: ["Control Plane gates owned the lifecycle outcome"],
          completed_at: now(),
        })
      }
      return { kind: "text", text: "deterministic provider has no script for this role" }
    },
    honorSignal: true,
  })
}
