const reviewNames = [
  ["R1", "Correctness review"],
  ["R2", "Maintainability review"],
  ["R3", "Architecture review"],
  ["R4", "Security review"],
  ["R5", "Data integrity review"],
  ["R6", "Contract review"],
  ["R7", "Reliability review"],
  ["R8", "Recovery Point review"],
]

const testNames = [
  ["T1", "Format and lint", "biome 2.1.4"],
  ["T2", "Schema, type, and build", "bun 1.2.19"],
  ["T3", "Payment unit tests", "node --test 26.4.0"],
  ["T4", "Service integration", "docker compose 2.39.1"],
  ["T5", "Card validation properties", "fast-check 4.2.0"],
  ["T6", "Contract compatibility", "ajv 8.17.1"],
  ["T7", "Payment API integration", "hurl 6.1.1"],
  ["T8", "Checkout end-to-end", "playwright 1.54.2"],
  ["T9", "Dependency and secret scan", "trivy 0.64.1"],
  ["T10", "Performance smoke", "k6 0.55.0"],
  ["T11", "Candidate probe ring", "compose adapter"],
  ["T12", "Restore drill", "compose adapter"],
  ["T13", "Watch-plan rehearsal", "prometheus adapter"],
]

function checks(blocked) {
  const reviews = reviewNames.map(([id, name], index) => ({
    id,
    name,
    kind: "Review",
    result: blocked && id === "R1" ? "failed" : "passed",
    actor: `review-agent/${id.toLowerCase()}`,
    tool: "Pi agent",
    duration: `${38 + index * 7}s`,
    receipt: `review-${id.toLowerCase()}-a13f`,
    detail: blocked && id === "R1"
      ? "The Remediation made the Luhn validation branch reachable without preserving the invalid-card rejection."
      : `${name} found no blocking issue in candidate sha256:aa2e6b171010.`,
  }))
  const tests = testNames.map(([id, name, tool], index) => ({
    id,
    name,
    kind: "Test",
    result: blocked && id === "T5" ? "failed" : "passed",
    actor: `test-agent/${id.toLowerCase()}`,
    tool,
    duration: index < 3 ? `${12 + index * 9}s` : `${1 + (index % 4)}m ${8 + index * 3}s`,
    receipt: `receipt-${id.toLowerCase()}-${blocked ? "bb88" : "aa2e"}`,
    detail: blocked && id === "T5"
      ? "Counterexample: 4111111111111112 entered the accepted card branch. Expected rejection, received accepted."
      : `${name} completed against the sealed candidate with a deterministic pass receipt.`,
  }))
  return [...reviews, ...tests]
}

const verifiedEvidence = [
  { id: "E1", kind: "Metric", title: "Payment error ratio", observation: "1.00 over the two-minute trigger window", source: "Prometheus", observedAt: "16:17:11", query: "sum(rate(payment_errors_total[2m])) / sum(rate(payment_requests_total[2m]))", trust: "Backend" },
  { id: "E2", kind: "Trace", title: "Rejected Visa charge", observation: "validateCard returned cannot_process before provider dispatch", source: "Jaeger", observedAt: "16:17:19", query: "trace-payment-exemplar-1", trust: "Backend" },
  { id: "E3", kind: "Log", title: "Card validation failure", observation: "valid Visa and Mastercard values entered the rejection branch", source: "OpenSearch", observedAt: "16:17:24", query: "service.name:payment AND trace_id:trace-payment-exemplar-1", trust: "Backend" },
  { id: "E4", kind: "Code", title: "validateCard branch", observation: "The known-card condition was inverted at card.js:12", source: "Git", observedAt: "16:17:31", query: "src/payment/card.js@S1", trust: "Repository" },
]

const blockedEvidence = [
  ...verifiedEvidence,
  { id: "E5", kind: "Review", title: "R1 blocking finding", observation: "The proposed branch exposed invalid Luhn values", source: "Review report", observedAt: "16:25:42", query: "review-r1-a13f", trust: "Artifact" },
  { id: "E6", kind: "Test", title: "T5 counterexample", observation: "4111111111111112 was accepted instead of rejected", source: "fast-check", observedAt: "16:26:08", query: "receipt-t5-bb88", trust: "Receipt" },
]

const fusionCalls = [
  { id: "participant-a", role: "Participant", title: "Runtime path investigation", model: "opencode-go/deepseek-v4-flash", status: "completed", duration: "1m 18s", tokens: "9,842", tools: "7", output: "The rejection begins inside validateCard. The trace contains no outbound provider span, which opposes an upstream outage." },
  { id: "participant-b", role: "Participant", title: "Change and configuration investigation", model: "opencode-go/deepseek-v4-flash", status: "completed", duration: "1m 31s", tokens: "10,204", tools: "9", output: "Seed commit S1 inverted the known-card branch. Feature flags and deployment reachability do not explain the card-type split." },
  { id: "judge", role: "Judge", title: "Comparison", model: "opencode-go/deepseek-v4-flash", status: "completed", duration: "47s", tokens: "6,110", tools: "0", output: "Both participants identify the branch inversion. The provider-outage Hypothesis lacks a provider span. The flag Hypothesis conflicts with the unchanged flag snapshot." },
  { id: "synthesizer", role: "Synthesizer", title: "Ranked response", model: "opencode-go/deepseek-v4-flash", status: "completed", duration: "39s", tokens: "5,684", tools: "0", output: "Rank H1 first. Restore the known-card branch, retain Luhn rejection, and verify valid and invalid card families before Release." },
]

const gateFacts = [
  ["1", "Candidate matches the reviewed commit"],
  ["2", "Required reviews and tests passed"],
  ["3", "Target version and environment match"],
  ["4", "Required operator approval is valid"],
  ["5", "Rollout and Watch plans are frozen"],
  ["6", "Recovery Point covers changed surfaces"],
  ["7", "Recovery drill passed"],
  ["8", "Release inputs bind to one candidate"],
]

const files = [
  {
    id: "card",
    path: "src/payment/card.js",
    additions: 1,
    deletions: 1,
    diff: [
      { line: "10", type: "context", text: "export function validateCard(cardType, cardNumber) {" },
      { line: "11", type: "context", text: "  const knownCard = ['visa', 'mastercard'].includes(cardType)" },
      { line: "12", type: "minus", text: "-  if (knownCard) return cannotProcess()" },
      { line: "12", type: "plus", text: "+  if (!knownCard) return cannotProcess()" },
      { line: "13", type: "context", text: "  return passesLuhn(cardNumber) ? accepted() : invalidCard()" },
      { line: "14", type: "context", text: "}" },
    ],
  },
  {
    id: "test",
    path: "src/payment/card.unit.test.js",
    additions: 8,
    deletions: 0,
    diff: [
      { line: "34", type: "context", text: "describe('known card types', () => {" },
      { line: "35", type: "plus", text: "+  test('accepts a valid Visa card', () => {" },
      { line: "36", type: "plus", text: "+    expect(validateCard('visa', VALID_VISA)).toEqual(accepted())" },
      { line: "37", type: "plus", text: "+  })" },
      { line: "38", type: "plus", text: "+  test('rejects a Luhn-invalid Visa card', () => {" },
      { line: "39", type: "plus", text: "+    expect(validateCard('visa', INVALID_VISA)).toEqual(invalidCard())" },
      { line: "40", type: "plus", text: "+  })" },
      { line: "41", type: "context", text: "})" },
    ],
  },
]

function verifiedEvents() {
  return [
    { id: "trigger", time: "16:17:11", stage: "Detect", kind: "system", actor: "Incident Detector", title: "Incident opened", summary: "Payment error ratio crossed 0.20 and reached 1.00.", status: "complete", ref: "journal 1" },
    { id: "evidence", time: "16:17:31", stage: "Detect", kind: "tool", actor: "Orchestrator", title: "Evidence Set revision 1 sealed", summary: "Metric, trace, log, and code evidence joined around one failing request.", status: "complete", ref: "artifact evidence-set" },
    { id: "participant-a", time: "16:18:49", stage: "Diagnose", kind: "agent", actor: "Fusion participant A", title: "Runtime investigation completed", summary: "Proposed H1 and opposed the upstream-provider Hypothesis.", status: "complete", ref: "model use 24" },
    { id: "participant-b", time: "16:19:02", stage: "Diagnose", kind: "agent", actor: "Fusion participant B", title: "Change investigation completed", summary: "Connected seed commit S1 to the card-type failure split.", status: "complete", ref: "model use 25" },
    { id: "judge", time: "16:19:49", stage: "Diagnose", kind: "agent", actor: "Fusion Judge", title: "Participant outputs compared", summary: "Recorded agreement, contradictions, blind spots, and citation gaps.", status: "complete", ref: "artifact fusion-judge" },
    { id: "synthesizer", time: "16:20:28", stage: "Diagnose", kind: "agent", actor: "Fusion Synthesizer", title: "H1 ranked first", summary: "Recommended restoring the known-card branch and preserving Luhn rejection.", status: "complete", ref: "artifact fusion-synthesis" },
    { id: "hypothesis", time: "16:20:41", stage: "Diagnose", kind: "gate", actor: "Orchestrator", title: "Hypothesis Gate passed", summary: "H1 explained the Evidence Set and its prediction reproduced.", status: "complete", ref: "gate hypothesis" },
    { id: "change", time: "16:23:15", stage: "Repair", kind: "agent", actor: "Repair agent", title: "Remediation PR prepared", summary: "One production line changed and two regression tests were added.", status: "complete", ref: "candidate aa2e6b17" },
    { id: "verify", time: "16:27:04", stage: "Verify", kind: "tool", actor: "Test and review agents", title: "21 required checks passed", summary: "8 reviews and 13 tests bound to the sealed candidate.", status: "complete", ref: "verification report" },
    { id: "gate", time: "16:28:12", stage: "Release", kind: "gate", actor: "Control Plane", title: "Release Gate passed", summary: "All eight deterministic facts passed and the approval was consumed once.", status: "complete", ref: "gate release" },
    { id: "release", time: "16:29:44", stage: "Release", kind: "release", actor: "Action Broker", title: "Candidate released", summary: "Compose payment service moved from seeded-digest to candidate-digest.", status: "complete", ref: "receipt service-swap" },
    { id: "watch", time: "16:34:35", stage: "Watch", kind: "release", actor: "Watch controller", title: "Incident confirmed resolved", summary: "Error ratio stayed at 0.00 through stage 1, stage 2, and confirmation.", status: "complete", ref: "watch report confirmation" },
  ]
}

function blockedEvents() {
  return [
    ...verifiedEvents().slice(0, 8),
    { id: "review-failed", time: "16:25:42", stage: "Verify", kind: "agent", actor: "Correctness review agent", title: "R1 found a blocking validation gap", summary: "The candidate exposed invalid Luhn values in the known-card branch.", status: "failed", ref: "review R1" },
    { id: "test-failed", time: "16:26:08", stage: "Verify", kind: "tool", actor: "Property test agent", title: "T5 produced a counterexample", summary: "4111111111111112 was accepted instead of rejected.", status: "failed", ref: "receipt T5" },
    { id: "verify", time: "16:26:19", stage: "Verify", kind: "gate", actor: "Orchestrator", title: "Verification failed", summary: "Release stopped. No candidate entered production.", status: "failed", ref: "verification report" },
  ]
}

const common = {
  severity: "SEV-1",
  service: "payment",
  environment: "demo",
  attempt: "1 of 3",
  authority: "Repair",
  policy: "policy:ecaedc73d8f7",
  repository: "astronomy-shop/payment",
  baseBranch: "main",
  baseCommit: "S1 8ce2d11",
  fusion: {
    sharedTask: "Explain why valid card charges fail and identify a reversible Remediation.",
    agreement: "Both participants traced the failure to validateCard and cited the same code location.",
    ruledOut: "No provider span appeared. Feature flags and service reachability were unchanged.",
    openEvidence: "Preserve Luhn rejection while correcting the known-card branch.",
    calls: fusionCalls,
  },
  files,
}

export const runs = {
  verified: {
    ...common,
    key: "verified",
    shortId: "PAY-1842",
    runId: "run-1-a92d",
    state: "Closed",
    stateTone: "success",
    title: "Valid card charges rejected by payment service",
    lead: "The Remediation was released and the payment error ratio returned to 0.00.",
    impact: "100% of valid Visa and Mastercard charges failed for 17 minutes.",
    cause: "Seed commit S1 inverted the known-card branch in validateCard.",
    remediation: "Restore the known-card condition and add valid and invalid card regression tests.",
    production: "candidate-digest live",
    nextStep: "No action required",
    started: "16 Aug 2026, 16:17:11 UTC",
    ended: "16 Aug 2026, 16:34:35 UTC",
    duration: "17m 24s",
    captured: "16 Aug 2026, 16:35 UTC",
    candidate: "sha256:aa2e6b171010",
    branch: "wayfinder/pay-1842-card-validation",
    headCommit: "4d3cb72",
    pr: { number: "#118", state: "Merged", tone: "success", title: "Restore known-card validation branch", url: "github.com/astronomy-shop/payment/pull/118", reviews: "2 approved", mergedAt: "16:28:31", checks: "21/21 passed" },
    evidence: verifiedEvidence,
    checks: checks(false),
    events: verifiedEvents(),
    gate: { verdict: "Passed", approval: "demo-operator at 16:28:02", facts: gateFacts.map(([id, label]) => ({ id, label, result: "passed", evidence: id === "4" ? "approval-1" : `fact-${id}-evidence` })) },
    watch: {
      status: "Passed",
      before: "1.00",
      after: "0.00",
      stages: [
        { name: "Candidate ring", traffic: "0% production", duration: "3m", samples: "60/60", result: "passed" },
        { name: "Production", traffic: "100%", duration: "4m", samples: "80/80", result: "passed" },
        { name: "Confirmation", traffic: "100%", duration: "2m", samples: "40/40", result: "passed" },
      ],
      stopRules: ["error ratio > 0.20", "probe success < 95%", "missing data for 60s"],
    },
    recovery: { id: "rp:9a6a2399", status: "Ready", coverage: "code, candidate image, Compose service", drill: "T12 passed at 16:26:44", rollback: "Available, not triggered" },
  },
  blocked: {
    ...common,
    key: "blocked",
    shortId: "PAY-1843",
    runId: "run-1-bb88",
    state: "Open",
    stateTone: "danger",
    title: "Candidate exposed invalid card validation path",
    lead: "Verification stopped the candidate before Release. Production stayed unchanged.",
    impact: "The original payment failure remains active. The candidate caused no production impact.",
    cause: "The branch inversion explains the Incident, but the first Remediation missed the reachable Luhn guard.",
    remediation: "Revise the candidate so invalid known-card values remain rejected.",
    production: "seeded-digest unchanged",
    nextStep: "Start diagnosis attempt 2",
    started: "16 Aug 2026, 16:17:11 UTC",
    ended: "16 Aug 2026, 16:26:19 UTC",
    duration: "9m 08s",
    captured: "16 Aug 2026, 16:27 UTC",
    candidate: "sha256:bb8885230cf3",
    branch: "wayfinder/pay-1843-card-validation",
    headCommit: "2a91f04",
    pr: { number: "#119", state: "Open, blocked", tone: "danger", title: "Correct card-type validation", url: "github.com/astronomy-shop/payment/pull/119", reviews: "1 change requested", mergedAt: "Not merged", checks: "19/21 passed" },
    evidence: blockedEvidence,
    checks: checks(true),
    events: blockedEvents(),
    gate: { verdict: "Not reached", approval: "No approval requested", facts: gateFacts.map(([id, label]) => ({ id, label, result: "not-run", evidence: "No gate evaluation" })) },
    watch: { status: "Not reached", before: "1.00", after: "No production Watch", stages: [], stopRules: ["Release did not start"] },
    recovery: { id: "rp:49c23fc3", status: "Drafted", coverage: "code and candidate image", drill: "T12 passed in isolation", rollback: "Unavailable because nothing was released" },
  },
}

export function runFromQuery() {
  return new URLSearchParams(location.search).get("run") === "2" ? "blocked" : "verified"
}

export function toneFor(result) {
  if (["passed", "complete", "Merged", "Closed", "Ready"].includes(result)) return "success"
  if (["failed", "Open, blocked", "Open"].includes(result)) return "danger"
  return "neutral"
}
