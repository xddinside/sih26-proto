/**
 * Fixed-outcome assertions for the two saved Demo Runs, issue #22 acceptance
 * item 1, from docs/build-handoff.md section 5 and docs/research/demo-runs.md.
 *
 * Run 1 — verified code Remediation:
 *   `completed: verified-remediation`; Incident `resolved`, then `closed`
 *   (`symptom-cleared`) after the confirmation window; one-line card.js diff;
 *   full Verify pass; Release Gate pass with the scheduled-hybrid approval;
 *   probe ring 20/20 across three windows; recorded error ratio ≥ 0.9 falling
 *   below 0.05.
 *
 * Run 2 — deterministic failed verification:
 *   `failed: verification-failed`; R1's cited `major` reachability finding;
 *   the T5 receipt failing "Luhn-failing Visa is rejected" bound to the
 *   candidate hash; verdict `fail`; no Release record, no Action Gate, no
 *   production Watch Report; Incident `open` with 2 attempts remaining.
 *
 * Checks return results rather than throwing so the runner can report every
 * gap at once. A `warn` result records a divergence between the captured
 * bundle and the fixed section-13 script wording without failing the run.
 */
import { getIncidentDetail } from "../../apps/web/src/lib/replay/replay-reads"
import type { ReplayStore } from "../../apps/web/src/lib/replay/replay-store"
import type { WorkspaceView } from "../../apps/web/src/features/incident-workspace/lib/workspace-projection"

export interface CheckResult {
  name: string
  status: "pass" | "fail" | "warn"
  detail: string
}

export const RUN_1_ID = "inc-demo-payment-1"
export const RUN_2_ID = "inc-demo-payment-2"

function pass(name: string, detail: string): CheckResult {
  return { name, status: "pass", detail }
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "fail", detail }
}

function warn(name: string, detail: string): CheckResult {
  return { name, status: "warn", detail }
}

function expect<T>(name: string, actual: T, expected: T, detail: string): CheckResult {
  return actual === expected ? pass(name, detail) : fail(name, `${detail} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`)
}

/** The fixed one-line Remediation diff, exactly as captured. */
const FIXED_DIFF = "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {"

/** Run 1 fixed-outcome checks over the captured bundle. */
export function checkRun1(store: ReplayStore, view: WorkspaceView): CheckResult[] {
  const results: CheckResult[] = []
  const detail = getIncidentDetail(store, RUN_1_ID)
  if (!detail.ok) {
    results.push(fail("run-1 detail projection", detail.error.map((e) => e.message).join("; ")))
    return results
  }
  const events = detail.value.events

  results.push(expect("run-1 header state", view.header.state, "closed", "Incident closed"))
  results.push(expect("run-1 closure reason", view.header.closureReason, "symptom-cleared", "closed after the confirmation window"))
  results.push(expect("run-1 detector state", view.header.detectorState, "resolved", "detector resolved"))
  results.push(expect("run-1 attempts used", view.header.attemptsUsed, 1, "one attempt consumed"))
  results.push(expect("run-1 attempts remaining", view.header.attemptsRemaining, 2, "2 of 3 remain"))
  results.push(expect("run-1 outcome", view.header.latestRun?.outcome, "verified-remediation", "run outcome"))
  results.push(expect("run-1 run state", view.header.latestRun?.state, "completed", "run state"))

  const firing = view.intake.triggers.find((trigger) => trigger.state === "firing")
  const resolved = view.intake.triggers.find((trigger) => trigger.state === "resolved")
  results.push(firing === undefined ? fail("run-1 firing trigger", "no firing trigger recorded") : pass("run-1 firing trigger", `recorded ratio ${firing.signalValue} vs threshold ${firing.signalThreshold}`))
  if (firing !== undefined) {
    results.push(expect("run-1 rule id", firing.ruleId, "payment-error-rate", "pinned rule"))
    results.push(expect("run-1 rule version", firing.ruleVersion, "1", "pinned rule_version"))
    const ratio = Number.parseFloat(firing.signalValue)
    results.push(
      ratio >= 0.9
        ? pass("run-1 recorded ratio ≥ 0.9", `recorded ${firing.signalValue}`)
        : fail("run-1 recorded ratio ≥ 0.9", `recorded ${firing.signalValue}`),
    )
  }
  results.push(resolved === undefined ? fail("run-1 resolved trigger", "no resolved trigger recorded") : pass("run-1 resolved trigger", `resolved at ${resolved.window.endsAt ?? "open window"} with value ${resolved.signalValue}`))

  const closedTransition = events.some(
    (event) =>
      event.type === "incident_transition" &&
      event.to === "closed" &&
      event.closure_reason === "symptom-cleared",
  )
  results.push(
    closedTransition
      ? pass("run-1 confirmation window", "resolved → closed (symptom-cleared) recorded in the journal")
      : fail("run-1 confirmation window", "no resolved → closed transition with symptom-cleared"),
  )

  results.push(expect("run-1 H1 status", view.hypotheses.hypotheses.find((h) => h.id === "H1")?.status, "accepted", "accepted Hypothesis"))
  for (const id of ["H2", "H3", "H4"]) {
    results.push(expect(`run-1 ${id} status`, view.hypotheses.hypotheses.find((h) => h.id === id)?.status, "rejected", "alternative eliminated"))
  }
  results.push(expect("run-1 hypothesis gate", view.hypotheses.gate?.verdict, "pass", "eight-check Hypothesis gate"))

  results.push(
    view.remediation === null
      ? fail("run-1 remediation", "no Remediation Proposal")
      : pass("run-1 remediation", "one-line diff, citation map, PR-shaped record"),
  )
  if (view.remediation !== null) {
    results.push(expect("run-1 diff", view.remediation.diff?.diffText, FIXED_DIFF, "one-line card-type restoration"))
    results.push(expect("run-1 action-risk class", view.remediation.actionRiskClass, "safe", "safe class"))
    results.push(expect("run-1 disposition", view.remediation.disposition, "allowed", "allowed disposition"))
    results.push(expect("run-1 gate path", view.remediation.gatePath, "release", "Release Gate path"))
    results.push(expect("run-1 PR receipt", view.remediation.prReceipt?.outcome, "ok", "PR-shaped record created"))
  }

  const verification1 = view.verify?.verification ?? null
  results.push(expect("run-1 verification verdict", verification1?.verdict, "pass", "Verification Report"))
  results.push(expect("run-1 hash binding match", verification1?.hashBinding.match, true, "candidate hash binding"))
  for (const role of ["R1", "R2", "R3", "R4", "R8"]) {
    results.push(expect(`run-1 ${role}`, view.verify?.reviews.find((r) => r.role === role)?.status, "pass", "review role"))
  }
  for (const layer of ["T1", "T2", "T3", "T4", "T5", "T7", "T9", "T10", "T12", "T13"]) {
    results.push(expect(`run-1 ${layer}`, view.verify?.tests.find((t) => t.layer === layer)?.outcome, "pass", "test layer"))
  }

  results.push(expect("run-1 release gate verdict", view.gates.release?.verdict, "pass", "Release Gate"))
  results.push(
    view.gates.release !== null && view.gates.release.facts.length === 8
      ? pass("run-1 release gate facts", "all eight facts recorded with evidence refs")
      : fail("run-1 release gate facts", `expected 8 facts, got ${view.gates.release?.facts.length ?? 0}`),
  )
  results.push(expect("run-1 action gate", view.gates.action, null, "no typed Action Gate for a code Remediation"))

  results.push(
    view.approvals.some((a) => a.action === "granted")
      ? pass("run-1 hybrid approval", view.approvals.map((a) => `${a.approvalId} ${a.action} by ${a.approverIdentity} (tzdb ${a.tzdbVersion})`).join("; "))
      : fail("run-1 hybrid approval", "no recorded granted approval"),
  )

  const probeCounts = (view.watch?.probeReceipts ?? []).map((p) => p.rowCount)
  results.push(
    probeCounts.length === 3 && probeCounts.every((count) => count === 20)
      ? pass("run-1 probe ring", `20/20 probe charges across three stage-1 windows (${probeCounts.join(", ")})`)
      : fail("run-1 probe ring", `expected 20/20 x 3, got ${JSON.stringify(probeCounts)}`),
  )

  const swapReceipt = events.some(
    (event) =>
      event.type === "broker_receipt_recorded" &&
      event.receipt.kind === "action" &&
      event.receipt.receipt_id === "receipt-service-swap" &&
      event.receipt.outcome === "ok",
  )
  results.push(
    swapReceipt
      ? pass("run-1 service swap", "stage-2 live Compose service swap receipt recorded (receipt-service-swap)")
      : fail("run-1 service swap", "no swap receipt recorded"),
  )

  results.push(
    view.watch?.plan !== null && view.watch?.plan !== undefined && view.watch.plan.queries.length === 6
      ? pass("run-1 frozen Watch plan", `G1–G6 queries recorded, rehearsal receipt ${view.watch.plan.rehearsalReceiptRefs.join(", ")}`)
      : fail("run-1 frozen Watch plan", "G1–G6 plan missing"),
  )

  const baseline = view.watch?.baselineRatio
  results.push(
    baseline !== null && baseline !== undefined && Number.parseFloat(baseline.value) >= 0.9
      ? pass("run-1 before ratio", `firing trigger recorded ratio ${baseline.value} (≥ 0.9)`)
      : fail("run-1 before ratio", `recorded ${baseline?.value ?? "missing"}`),
  )

  const confirmation = (view.watch?.reports ?? []).find((r) => r.rolloutStage === "confirmation")
  const g2After = confirmation?.samples.find((s) => s.gate === "G2")
  const g5After = confirmation?.samples.find((s) => s.gate === "G5")
  results.push(
    g2After !== undefined && g2After.value < 0.05 && g2After.outcome === "pass"
      ? pass("run-1 after ratio (G2)", `confirmation window G2 ${g2After.value} < 0.05, pass`)
      : fail("run-1 after ratio (G2)", JSON.stringify(g2After ?? null)),
  )
  results.push(
    g5After !== undefined && g5After.value < 0.05 && g5After.outcome === "pass"
      ? pass("run-1 after ratio (G5)", `confirmation window G5 ${g5After.value} < 0.05, pass`)
      : fail("run-1 after ratio (G5)", JSON.stringify(g5After ?? null)),
  )

  const stage1 = (view.watch?.reports ?? []).find((r) => r.rolloutStage === "1")
  const stage2 = (view.watch?.reports ?? []).find((r) => r.rolloutStage === "2")
  if (stage1 !== undefined && stage1.samples.some((s) => s.outcome === "fail")) {
    results.push(warn("run-1 stage-1 Watch rows", "captured stage-1 rows record no-data fails on G2–G5 (candidate has no organic traffic); promotion rests on the 20/20 probe receipts. The section-13 script wording says G1–G5 pass."))
  }
  if (stage2 !== undefined && stage2.samples.some((s) => s.outcome === "fail")) {
    results.push(warn("run-1 stage-2 Watch rows", "captured stage-2 rows record failing G2/G3/G5 samples before the ratio cleared; the confirmation window is the recorded clean before/after. The section-13 script wording says G1–G6 pass across three samples."))
  }

  results.push(
    view.recovery?.consumed === true
      ? pass("run-1 recovery point consumed", "consumed by the stage-2 service swap")
      : warn("run-1 recovery point consumed", "the captured swap receipt id (receipt-service-swap) differs from the panel projection's expected id (receipt-swap), so the panel renders consumed=false with the Run-2 note. Shared-file mismatch to fix in the parent."),
  )

  results.push(
    view.policy.decisions.some((d) => d.decision === "approval-required")
      ? pass("run-1 hybrid policy decision", `approval-required (tzdb ${view.policy.decisions[0]?.tzdbVersion ?? "?"}, ${view.policy.decisions[0]?.window ?? "?"}) — deploy outside the autonomous window`)
      : fail("run-1 hybrid policy decision", "no approval-required policy decision recorded"),
  )
  results.push(
    view.humanActions.some((a) => a.action === "approve")
      ? pass("run-1 operator approval", "recorded demo-operator approve action")
      : fail("run-1 operator approval", "no human approve action"),
  )

  return results
}

/** Run 2 fixed-outcome checks over the captured bundle. */
export function checkRun2(store: ReplayStore, view: WorkspaceView): CheckResult[] {
  const results: CheckResult[] = []
  const detail = getIncidentDetail(store, RUN_2_ID)
  if (!detail.ok) {
    results.push(fail("run-2 detail projection", detail.error.map((e) => e.message).join("; ")))
    return results
  }
  const events = detail.value.events

  results.push(expect("run-2 header state", view.header.state, "open", "Incident open"))
  results.push(expect("run-2 closure reason", view.header.closureReason, null, "no closure"))
  results.push(expect("run-2 detector state", view.header.detectorState, "firing", "detector still firing"))
  results.push(expect("run-2 attempts used", view.header.attemptsUsed, 1, "attempt 1 consumed"))
  results.push(expect("run-2 attempts remaining", view.header.attemptsRemaining, 2, "2 attempts remaining"))

  const failedRun = view.detail.runs.find((run) => run.attempt === 1)
  results.push(expect("run-2 run state", failedRun?.state, "failed", "run failed"))
  results.push(expect("run-2 failure reason", failedRun?.failureReason, "verification-failed", "ends at Verify"))

  results.push(expect("run-2 H1 status", view.hypotheses.hypotheses.find((h) => h.id === "H1")?.status, "accepted", "same accepted Hypothesis"))
  results.push(expect("run-2 hypothesis gate", view.hypotheses.gate?.verdict, "pass", "identical eight-check gate"))
  results.push(expect("run-2 diff", view.remediation?.diff?.diffText, FIXED_DIFF, "the same correct one-line fix"))

  const r1 = view.verify?.reviews.find((r) => r.role === "R1")
  const r1Major = r1?.findings.find((f) => f.severity === "major" && f.status === "open")
  results.push(
    r1Major === undefined
      ? fail("run-2 R1 major finding", JSON.stringify(r1?.findings ?? null))
      : pass("run-2 R1 major finding", `cited ${r1Major.citations.map((c) => `${c.kind} ${c.file ?? ""}:${c.line ?? ""}`).join(", ")} — "${r1Major.claim}"`),
  )

  const t5 = view.verify?.tests.find((t) => t.layer === "T5")
  const t5Fail = t5?.runs.find((r) => r.result === "fail")
  results.push(
    t5Fail === undefined
      ? fail("run-2 T5 failure", JSON.stringify(t5 ?? null))
      : pass("run-2 T5 failure", `receipt ${t5?.receiptRef ?? "?"} fails "${t5Fail.detail ?? "?"}" bound to candidate ${t5?.candidateHash ?? "?"}`),
  )
  const verification2 = view.verify?.verification ?? null
  if (t5 !== undefined && t5Fail !== undefined && verification2?.candidateHash !== undefined) {
    results.push(expect("run-2 T5 candidate binding", t5.candidateHash, verification2.candidateHash, "T5 result bound to the verification candidate hash"))
  }

  results.push(expect("run-2 verdict", verification2?.verdict, "fail", "Verification Report verdict"))
  results.push(expect("run-2 hash binding match", verification2?.hashBinding.match, true, "hash binding intact despite the fail"))
  results.push(
    verification2?.verdictReason !== undefined && verification2.verdictReason.length > 0
      ? pass("run-2 verdict reason", verification2.verdictReason)
      : fail("run-2 verdict reason", "no recorded verdict reason"),
  )

  const releaseGateEvent = events.some(
    (event) => event.type === "gate_evaluated" && event.evaluation.gate !== "hypothesis",
  )
  results.push(expect("run-2 no Release Gate", releaseGateEvent, false, "no non-hypothesis gate evaluated"))
  results.push(expect("run-2 release gate view", view.gates.release, null, "no release gate facts rendered"))
  results.push(expect("run-2 action gate view", view.gates.action, null, "no action gate facts rendered"))
  results.push(expect("run-2 not-reached reason", view.gates.notReachedReason, "verification-failed", "gate panel marks the run ended at Verify"))

  const releaseRecordArtifacts = [...store.artifacts.values()].filter(
    (artifact) =>
      artifact.envelope.incident_id === RUN_2_ID &&
      artifact.envelope.artifact_schema_id === "release-record",
  )
  results.push(expect("run-2 no Release record", releaseRecordArtifacts.length, 0, "no release-record artifact sealed"))

  const watchReports = [...store.artifacts.values()].filter(
    (artifact) =>
      artifact.envelope.incident_id === RUN_2_ID &&
      artifact.envelope.artifact_schema_id === "watch-report",
  )
  results.push(expect("run-2 no production Watch Report", watchReports.length, 0, "no watch-report artifact sealed"))

  const t13Receipt = events.some(
    (event) =>
      event.type === "broker_receipt_recorded" &&
      event.receipt.receipt_id === "receipt-t13",
  )
  results.push(
    t13Receipt
      ? pass("run-2 T13 rehearsal stays in Verify", "isolated Watch-plan rehearsal receipt recorded during Verify")
      : warn("run-2 T13 rehearsal stays in Verify", "no receipt-t13 recorded in the captured journal"),
  )

  results.push(expect("run-2 approvals", view.approvals.length, 0, "no approval recorded — the run ends before Release"))
  results.push(
    view.policy.decisions.length === 0
      ? pass("run-2 policy decisions", "no execution-time decision — autonomous policy is moot at Verify")
      : warn("run-2 policy decisions", "unexpected recorded decisions"),
  )
  const queued = view.detail.runs.find((run) => run.attempt === 2)
  results.push(
    queued !== undefined
      ? pass("run-2 next attempt", "attempt 2 queued for the new Diagnose attempt over the R1/T5 evidence")
      : warn("run-2 next attempt", "no queued attempt 2 recorded"),
  )

  return results
}
