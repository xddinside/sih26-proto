/**
 * Static Solution Contract content for the Incident Workspace panels.
 *
 * Everything here is fixed documentation from the settled reports, never
 * replayed data: the recorded-policy registry (mapping a saved run's pinned
 * `policy_version` strings to their settled meaning), the action-risk table,
 * the Demo Profile cap defaults, the full nine-role/thirteen-layer review and
 * test catalog, and the rollback panel text. Panel rows that come from the
 * saved journal or sealed artifacts instead live in
 * `lib/workspace-projection.ts`.
 */

/** One recorded policy version pinned in the saved bundles. */
export interface RecordedPolicy {
  /** The `policy_version` string carried by every journal event. */
  version: string
  /** The recorded Authority Mode for the run. */
  authorityMode: string
  /** The recorded Automation Policy for the run. */
  automationPolicy: string
  /** The tzdb version recorded with policy decisions. */
  tzdbVersion: string | null
}

/**
 * The policy versions pinned in the two saved Demo Runs, per
 * docs/research/demo-runs.md: Repair Mode for both; Run 1 scheduled hybrid,
 * Run 2 autonomous at all times. The journal records the version string; this
 * registry states what that pinned version means.
 */
export const RECORDED_POLICIES: Readonly<Record<string, RecordedPolicy>> = {
  "policy-hybrid-v1": {
    version: "policy-hybrid-v1",
    authorityMode: "Repair",
    automationPolicy: "scheduled hybrid",
    tzdbVersion: "2026a",
  },
  "policy-autonomous-v1": {
    version: "policy-autonomous-v1",
    authorityMode: "Repair",
    automationPolicy: "autonomous at all times",
    tzdbVersion: null,
  },
}

/** The settled Attempt Limit for the Demo Profile, per demo-runs.md. */
export const ATTEMPT_LIMIT = 3

/** The four Authority Mode dial positions, fixed by authority-action-risk.md. */
export const AUTHORITY_MODES = ["Observe", "Prepare", "Repair", "Emergency"] as const

/** The three Automation Policy dial positions. */
export const AUTOMATION_POLICIES = [
  "review at all times",
  "autonomous at all times",
  "scheduled hybrid",
] as const

/** One action-risk table row from authority-action-risk.md. */
export interface RiskTableRow {
  category: string
  actions: string
  defaultClass: string
  rollbackHonesty: string
}

/** The fixed action-risk table, rendered read-only in the policy panel. */
export const RISK_TABLE: readonly RiskTableRow[] = [
  {
    category: "Code",
    actions: "Patch, Remediation PR, merge",
    defaultClass: "safe to propose and prepare; merge and deploy follow the Release Gate",
    rollbackHonesty: "Git revert undoes source, not deployment; the Release record's Recovery Point covers the rest",
  },
  {
    category: "Configuration",
    actions: "Helm values, runtime config, environment variables",
    defaultClass: "safe with a tested Recovery Point, else guarded",
    rollbackHonesty: "Prior values must be recorded in the Recovery Point",
  },
  {
    category: "Feature flags",
    actions: "Disable a flag, enable a flag, change rollout percentage",
    defaultClass: "disable: safe; enable or widen: guarded",
    rollbackHonesty: "Flag off restores behavior only if code and config match the recorded prior state",
  },
  {
    category: "Deployments",
    actions: "Staged release of a pinned artifact",
    defaultClass: "safe with a canary or preview ring and tested Recovery Point; all-at-once production release: guarded",
    rollbackHonesty: "Prior artifact digest and Deployment revision; pod templates roll back, not every surface",
  },
  {
    category: "Restarts",
    actions: "Restart a Deployment, restart a workload",
    defaultClass: "safe",
    rollbackHonesty: "Reversible but briefly disruptive; bounded to once per attempt by default",
  },
  {
    category: "Scaling",
    actions: "Scale up, scale down",
    defaultClass: "scale up: safe; scale down below the redundancy floor: guarded",
    rollbackHonesty: "Prior replica counts in the Recovery Point",
  },
  {
    category: "Traffic",
    actions: "Reroute, drain, blue-green switch, shrink a canary stage",
    defaultClass: "safe with prior routes recorded",
    rollbackHonesty: "Routes restore from the saved route table",
  },
  {
    category: "Infrastructure",
    actions: "Apply a plan, change a provider resource",
    defaultClass: "safe only with provider state identifiers and a saved plan; creating or removing long-lived resources: guarded; destroying an unbacked resource: barred",
    rollbackHonesty: "State helps; some resources are one-way when destroyed",
  },
  {
    category: "Database and data",
    actions: "Run a migration, backfill, read-only query",
    defaultClass: "read: safe; migration with a tested down path and restore drill: guarded; destructive migration, mutating backfill, delete rows: barred",
    rollbackHonesty: "A downgrade is only safe when the drill proved it; deleted data without a valid backup does not come back",
  },
  {
    category: "Credentials",
    actions: "Issue a short-lived scoped credential, rotate, revoke",
    defaultClass: "issue: safe; rotate: guarded; revoke: guarded; a named, pre-identified credential may be pre-approved into the Emergency allow-list",
    rollbackHonesty: "A revoked or rotated credential is dead; issuing a new one is a new action, not an undo",
  },
  {
    category: "Security containment",
    actions: "Quarantine a workload, isolate a namespace, block a route",
    defaultClass: "safe",
    rollbackHonesty: "Reverses by removing the quarantine",
  },
  {
    category: "Messages and payments",
    actions: "Send a message, publish data, refund or complete a payment",
    defaultClass: "barred",
    rollbackHonesty: "External effects last; rollback cannot un-send, un-refund, or un-publish",
  },
  {
    category: "Destructive operations",
    actions: "Delete resources, force-delete pods, purge a queue, drop a table",
    defaultClass: "barred",
    rollbackHonesty: "No recovery without a verified backup and restore drill, and even then barred for autonomous use",
  },
]

/** Demo Profile budget fields, per authority-action-risk.md and demo-runs.md. */
export interface CapField {
  field: string
  setting: string
}

/** Caps the Demo Profile removes. */
export const DEMO_CAPS_REMOVED: readonly CapField[] = [
  { field: "Fusion-round cap", setting: "removed (no round budget)" },
  { field: "Evidence-gathering-action cap", setting: "removed" },
  { field: "Broker-action cap", setting: "removed" },
  { field: "Wall-time cap", setting: "removed (no 30-minute attempt limit)" },
  { field: "Model-token cap", setting: "removed" },
  { field: "Model-cost cap", setting: "removed" },
]

/** Controls that stay in force in the Demo Profile. */
export const DEMO_CAPS_KEPT: readonly CapField[] = [
  { field: "Attempt Limit", setting: "3 evidence-led attempts per Incident" },
  { field: "Revision cap", setting: "2 Repair-to-Verify revisions" },
  { field: "Worker restart cap", setting: "2" },
  { field: "Hypothesis gate", setting: "eight deterministic checks" },
  { field: "Release Gate and Action Gate", setting: "non-optional" },
  { field: "Approvals", setting: "recorded, expiring, one-use" },
  { field: "Leases", setting: "run and release leases" },
  { field: "Host limits", setting: "CPU, memory, process, filesystem, network" },
  { field: "Operator cancel", setting: "revokes lease, permits, approvals" },
  { field: "Cleanup", setting: "Worker teardown on terminal state" },
]

/** One review role row for the static catalog panel. */
export interface ReviewRoleRow {
  code: string
  role: string
  purpose: string
  demoBuilt: boolean
}

/** The full nine review roles from review-verification.md. */
export const REVIEW_CATALOG: readonly ReviewRoleRow[] = [
  { code: "R1", role: "Change correctness", purpose: "The change does what the proposal claims and nothing more; no unrelated or unreported edits", demoBuilt: true },
  { code: "R2", role: "Causal fit", purpose: "Every change maps to the accepted Hypothesis's causal chain through the citation map", demoBuilt: true },
  { code: "R3", role: "Code quality", purpose: "Readability, maintainability, complexity, concurrency, error handling, test coverage of the new code", demoBuilt: true },
  { code: "R4", role: "Security / threat review", purpose: "Threat modeling on the changed surface; manual review complements scanners", demoBuilt: true },
  { code: "R5", role: "Dependency / supply-chain", purpose: "New, removed, or changed dependencies and lockfiles: vulnerabilities, license fit, provenance", demoBuilt: false },
  { code: "R6", role: "Data / migration safety", purpose: "Migration direction, lock and batching behavior, backfill safety, destructive clauses, rollback path", demoBuilt: false },
  { code: "R7", role: "Infrastructure / policy", purpose: "Manifests, IaC state, network policy, RBAC, IAM, quota changes, resource lifecycle", demoBuilt: false },
  { code: "R8", role: "Rollback / Recovery Point review", purpose: "The Recovery Point covers every changed surface and names exact rollback commands with preconditions and timeouts", demoBuilt: true },
  { code: "R9", role: "Operations / observability", purpose: "Logging, metrics, alerting, runbook and Watch-plan fit", demoBuilt: false },
]

/** One test layer row for the static catalog panel. */
export interface TestLayerRow {
  code: string
  layer: string
  purpose: string
  demoBuilt: boolean
}

/** The full thirteen test layers from review-verification.md. */
export const TEST_CATALOG: readonly TestLayerRow[] = [
  { code: "T1", layer: "Static analysis", purpose: "Language linters, complexity and anti-pattern rules on the diff and its blast radius", demoBuilt: true },
  { code: "T2", layer: "Schema / lint / build", purpose: "Type check and build of the changed packages and the deployable artifact", demoBuilt: true },
  { code: "T3", layer: "Unit", purpose: "Unit tests of the changed packages in the Worker's disposable sandbox", demoBuilt: true },
  { code: "T4", layer: "Integration / contract", purpose: "Contract tests between the changed service and its declared dependencies", demoBuilt: true },
  { code: "T5", layer: "Regression", purpose: "Scoped regression suite selected by the ownership map", demoBuilt: true },
  { code: "T6", layer: "Property / fuzz", purpose: "Property-based or fuzz runs over parsing, validation, serialization, or boundary code", demoBuilt: false },
  { code: "T7", layer: "Security scanning", purpose: "Pinned secret, dependency-vulnerability, and SAST scanners", demoBuilt: true },
  { code: "T8", layer: "Migration tests", purpose: "Migration up and down on a copy of the schema, plus a backup-restore drill", demoBuilt: false },
  { code: "T9", layer: "Isolated environment tests", purpose: "Deploy the candidate with representative traffic; prove it starts, serves, and behaves", demoBuilt: true },
  { code: "T10", layer: "E2E / browser checks", purpose: "End-to-end checks, including real browser automation, over the user-facing paths", demoBuilt: true },
  { code: "T11", layer: "Load / performance", purpose: "Latency, throughput, or saturation checks on performance-sensitive paths", demoBuilt: false },
  { code: "T12", layer: "Fault / recovery", purpose: "Recovery drills: restart, rollback, flag toggle, rotation, or reroute, rehearsed", demoBuilt: true },
  { code: "T13", layer: "Watch-plan rehearsal", purpose: "Execute the frozen Watch plan's queries, limits, and stop rules against a non-production environment", demoBuilt: true },
]

/** The pitch-only rollback panel text, from release-recovery.md. */
export const ROLLBACK_PANEL = {
  scopeLabel: "Proposed product scope — Solution Contract only; not demonstrated by either saved run",
  intro:
    "Automatic rollback on severe regression is fixed in the Solution Contract (docs/research/release-recovery.md) and is unchanged. Neither saved run contains a rollback: Run 1 never approaches the recorded severe-regression stop rule, and Run 2 ends at Verify before any deployment, so no credible post-release-only regression exists for either run to demonstrate.",
  sequence: [
    "Severe regression detected: freezes promotion and new releases to the target",
    "Stores the triggering Signals and gate result",
    "Verifies the target still matches the failed release",
    "Runs the Recovery Point's pre-approved rollback through the Action Broker",
    "Watches the restored version against recovery gates",
    "Keeps the Incident open and records whether rollback restored service",
    "Pages a human on rollback failure, unclear recovery evidence, or an irreversible effect",
  ],
  allowListTitle: "Emergency allow-list (named, per-service, operator-approved)",
  allowList: [
    "roll back to the Recovery Point of the named release",
    "disable a named feature flag",
    "restart a named Deployment, once per attempt",
    "scale a named Deployment down to no less than the company-set floor, or up to no more than twice its current size",
    "reroute traffic away from the named failing service to its pre-approved fallback",
    "revoke one named, pre-identified credential",
    "apply the pre-approved network quarantine to a named workload",
  ],
  honesty:
    "Rollback restores service; it does not reverse every effect. A leaked secret, a sent email, a completed payment, or deleted data without a valid backup does not come back, and no roll-forward runs after a severe regression without full review. The failed candidate can never be promoted again.",
}

/** Telemetry backend link templates for the deep-links panel. */
export const BACKEND_LABELS: Readonly<Record<string, string>> = {
  prometheus: "Prometheus",
  jaeger: "Jaeger",
  opensearch: "Grafana / OpenSearch",
  git: "Git",
  ci: "CI",
  flagd: "flagd",
}

/**
 * The settled meaning of each Release Gate fact id, from
 * docs/research/release-recovery.md. The journal records the fact id and its
 * result and evidence refs; this table documents what the id means.
 */
export const RELEASE_GATE_FACT_LABELS: Readonly<Record<string, string>> = {
  "1": "The Remediation and artifact match the reviewed commit",
  "2": "Required CI, security, code, regression, and end-to-end checks passed",
  "3": "The target still runs the version named by the release request",
  "4": "The action fits the active Authority Mode and Automation Policy",
  "5": "The rollout and Watch plans are frozen, complete, and rehearsed",
  "6": "A tested Recovery Point covers every changed surface",
  "7": "No irreversible or barred action appears in the change set",
  "8": "The company pipeline's branch, environment, change-management, and approval rules passed",
}

/**
 * The settled meaning of each Action Gate fact id, from
 * docs/research/authority-action-risk.md.
 */
export const ACTION_GATE_FACT_LABELS: Readonly<Record<string, string>> = {
  "1": "The typed command matches an approved adapter and action class",
  "2": "The target still runs the expected version",
  "3": "The action fits the active Authority Mode and Automation Policy",
  "4": "A tested Recovery Point covers every changed surface, or the uncovered surface has human approval",
  "5": "The stop and Watch conditions are fixed and deterministic",
  "6": "No barred action appears in the change set",
}

/** The settled meaning of each Hypothesis gate check id. */
export const HYPOTHESIS_CHECK_LABELS: Readonly<Record<string, string>> = {
  "cited-coverage": "Every critical item in the trigger window is cited",
  "causal-edge-support": "Causal edges are supported by joined items",
  "contradiction-handling": "No unresolved contradiction of equal or higher trust",
  "alternative-elimination": "Every material alternative is eliminated",
  "reproducible-test": "A pre-registered discriminating test or counterfactual holds",
  "scope-match": "The Hypothesis covers the observed scope, nothing more",
  "freshness": "All supporting items are fresh at evaluation time",
  "telemetry-coverage": "Measured values carry a verified coverage record",
}
