/**
 * Settled capture constants for the two saved Demo Runs, from
 * docs/research/demo-runs.md and docs/research/release-recovery.md.
 *
 * Everything here is fixed input: run outcomes, gates, Watch measures, the
 * frozen Watch plan (G1-G6), probe ring math, Attempt Limit, revision cap,
 * and the Demo Profile identities. The capture driver reads these; it never
 * re-decides them.
 */
import type { Schedule } from "@sih/control-plane/src/core/policy.js"

export const PINNED_COMMIT = "2e05c45b85b985a691cc75082c234e8d6ac0b2e9"

export const TENANT_ID = "demo"
export const ENVIRONMENT = "demo"
export const SERVICE_NAME = "payment"
export const DETECTOR_KEY = "payment-error-rate"
export const RULE_ID = "payment-error-rate"
export const RULE_VERSION = "1"
export const RULE_ALERT_NAME = "AstronomyShopPaymentErrorRate"

/** Ports in the reduced Compose profile. */
export const PORTS = {
  livePayment: 50051,
  candidatePayment: 50052,
  prometheus: 9090,
  alertmanager: 9093,
  flagd: 8013,
  collector: 4317,
} as const

/** Image tags the capture builds from the seeded/candidate sources. */
export const IMAGES = {
  baseline: "payment:demo-baseline",
  seeded1: "payment:demo-seeded-1",
  seeded2: "payment:demo-seeded-2",
  candidate1: "payment:demo-candidate-1",
  candidate2: "payment:demo-candidate-2",
} as const

/** The candidate cohort identity in the reduced profile: the span_metrics
 * connector promotes service.name (not service.version), so the candidate
 * container runs as a distinct cohort name carrying the candidate digest as
 * its service.version resource attribute. */
export const CANDIDATE_SERVICE_NAME = "payment-candidate"

/** The fixed one-line diff both candidates share (restore the negation). */
export const DIFF_TEXT =
  "-  if (['visa', 'mastercard'].includes(cardType)) {\n+  if (!['visa', 'mastercard'].includes(cardType)) {"

/** Valid Visa used by the probe ring and the traffic driver. */
export const PROBE_VISA = "4432801561520454"
export const PROBE_MASTERCARD = "5555555555554444"
/** The invalid-Luhn Visa that exposes Run 2's missing guard. */
export const INVALID_LUHN_VISA = "4111111111111112"

/** Probe ring: 20 valid-card charges per stage-1 window, three windows. */
export const PROBES_PER_WINDOW = 20
export const STAGE1_WINDOWS = 3
export const WATCH_WINDOW_SECONDS = 30

/** Frozen Watch gates G1-G6 (demo-runs.md): limits and sample floors. */
export const WATCH_GATES = {
  G1: {
    signal: "deployment health",
    backend: "compose-adapter",
    query: "candidate or live container running; TCP/gRPC healthcheck SERVING; no crash loop",
    limit: 1,
    floor: 1,
  },
  G2: {
    signal: "payment error ratio",
    backend: "prometheus",
    query:
      'sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)',
    limit: 0.05,
    floor: 50,
  },
  G3: {
    signal: "payment latency p95",
    backend: "prometheus",
    query:
      'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_bucket{service_name="payment"}[2m])) by (le))',
    limit: 0.5,
    floor: 50,
  },
  G4: {
    signal: "telemetry arrival",
    backend: "prometheus",
    query: "span-metric counter increments for the watched cohort in the window; ruler freshness healthy",
    limit: 1,
    floor: 1,
  },
  G5: {
    signal: "Incident symptom",
    backend: "prometheus",
    query:
      "same query as G2 against the recorded pre-release baseline (captured ratio); must improve to < 0.05",
    limit: 0.05,
    floor: 50,
  },
  G6: {
    signal: "regression sentinels",
    backend: "compose-adapter",
    query:
      "no new error_type on payment spans beyond the baseline set; client (checkout-path driver) error rate < 0.05; frontend-proxy 5xx rate < 0.05 (no frontend-proxy in the reduced profile)",
    limit: 0.05,
    floor: 50,
  },
} as const

/** The recorded, unfired severe-regression stop rule. */
export const SEVERE_REGRESSION_STOP_RULE = {
  id: "severe-regression-stop-rule",
  condition:
    "crash loop or readiness loss, live error ratio above 0.5, a new security finding, or a business-invariant breach",
  action: "rollback" as const,
}

/** Policy drafts. Run 1 scheduled hybrid (window resolved at capture time so
 * the deploy lands outside the autonomous window); Run 2 autonomous always. */
export function hybridPolicyDraft(schedule: Schedule): {
  authority_mode: "repair"
  automation_policy: "scheduled-hybrid"
  schedule: Schedule
  emergency_override: boolean
  attempt_limit: number
} {
  return {
    authority_mode: "repair",
    automation_policy: "scheduled-hybrid",
    schedule,
    emergency_override: false,
    attempt_limit: 3,
  }
}

export const AUTONOMOUS_POLICY_DRAFT = {
  authority_mode: "repair" as const,
  automation_policy: "autonomous-always" as const,
  schedule: null,
  emergency_override: false,
  attempt_limit: 3,
}

/** The settled applicability inputs for the Code row. */
export const APPLICABILITY_TOOL_CATALOG: {
  version: string
  language: string
  fuzzHarnessAvailable: boolean
  stagingTargetExists: boolean
  serviceUserFacing: boolean
  pipelineHasE2E: boolean
  performanceSuiteExists: boolean
  performanceSensitivePaths: string[]
  ownershipMap: Record<string, string>
} = {
  version: "tool-catalog@1.0",
  language: "node",
  fuzzHarnessAvailable: false,
  stagingTargetExists: true,
  serviceUserFacing: true,
  pipelineHasE2E: true,
  performanceSuiteExists: false,
  performanceSensitivePaths: [],
  ownershipMap: {
    "src/payment/card.js": "src/payment/payment.regression.test.js",
  },
}

/** Pinned tool versions for the test layers, from demo-runs.md. */
export const TEST_TOOLS = {
  T1: { tool: "eslint", tool_version: "9.39.5", target: "src/payment", skill: "sih-test-static-analysis" },
  T2: { tool: "docker build", tool_version: "28.0.0", target: "payment production target (distroless)", skill: "sih-test-build" },
  T3: { tool: "node --test", tool_version: "26.4.0", target: "src/payment/card.unit.test.js", skill: "sih-test-unit" },
  T4: { tool: "grpc contract check", tool_version: "1.2", target: "payment charge contract (valid 2039 Visa accepted)", skill: "sih-test-contract" },
  T5: { tool: "node --test", tool_version: "26.4.0", target: "src/payment/payment.regression.test.js", skill: "sih-test-regression" },
  T7: { tool: "osv-scanner + gitleaks", tool_version: "2.0.1", target: "payment image", skill: "sih-test-security-scan" },
  T9: { tool: "compose candidate deploy + probe", tool_version: "1.0", target: "candidate payment container (isolated env)", skill: "sih-test-isolated-env" },
  T10: { tool: "playwright", tool_version: "1.54", target: "storefront checkout (reduced profile: charge-path driver)", skill: "sih-test-browser" },
  T12: { tool: "compose restore drill", tool_version: "1.0", target: "isolated candidate environment", skill: "sih-test-fault-recovery" },
  T13: { tool: "watch-plan rehearsal", tool_version: "1.0", target: "frozen Watch queries (G1-G6)", skill: "sih-test-watch-rehearsal" },
} as const

export const REVIEW_ROLES = {
  R1: { skill: "sih-review-correctness", reviewer: "reviewer-r1" },
  R2: { skill: "sih-review-causal-fit", reviewer: "reviewer-r2" },
  R3: { skill: "sih-review-code-quality", reviewer: "reviewer-r3" },
  R4: { skill: "sih-review-security", reviewer: "reviewer-r4" },
  R8: { skill: "sih-review-recovery-point", reviewer: "reviewer-r8" },
} as const

/** Fixed receipt ids (deterministic; the journal records them verbatim). */
export const RECEIPT_IDS = {
  metric: "receipt-rb-metric",
  flagFailure: "receipt-rb-flag-failure",
  flagUnreachable: "receipt-rb-flag-unreachable",
  trace: "receipt-rb-trace",
  log: "receipt-rb-log",
  grep: "receipt-rb-grep",
  baseline: "receipt-rb-baseline",
  seededT3: "receipt-t3-seeded-prediction",
  pr: "receipt-pr",
  ci: "receipt-ci",
  targetVersion: "receipt-target-version",
  deployCandidate: "receipt-candidate-deploy",
  swap: "receipt-service-swap",
  probe1: "receipt-probe-w1",
  probe2: "receipt-probe-w2",
  probe3: "receipt-probe-w3",
  t1: "receipt-t1",
  t2: "receipt-t2",
  t3: "receipt-t3",
  t4: "receipt-t4",
  t5: "receipt-t5",
  t7: "receipt-t7",
  t9: "receipt-t9",
  t10: "receipt-t10",
  t12: "receipt-t12",
  t13: "receipt-t13",
} as const

export const TZDB_VERSION = "2026a"

/** Candidate schedule zones: the capture picks the first whose mon-fri 09-18
 * window excludes the capture instant, so the hybrid deploy lands outside the
 * autonomous window deterministically (the recorded zone is real IANA data). */
export const HYBRID_ZONE_CANDIDATES = [
  "Pacific/Kiritimati",
  "Pacific/Chatham",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Apia",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Midway",
  "Pacific/Pago_Pago",
] as const

export function hybridWindows(): Schedule["windows"] {
  return [
    {
      start_weekday: "mon",
      start_time: "09:00",
      end_weekday: "fri",
      end_time: "18:00",
    },
  ]
}

/** The saved-run presentation ids (settled in incident-workspace.md). */
export const SAVED_INCIDENT_1 = "inc-demo-payment-1"
export const SAVED_INCIDENT_2 = "inc-demo-payment-2"

export const SAVED_RUNS_ROOT = "demo/saved-runs"
