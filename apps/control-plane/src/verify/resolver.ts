/**
 * The deterministic applicability resolver from docs/research/review-verification.md.
 *
 * check_set = f(remediation_class, declared_surfaces, diff, action_risk_class,
 *               policy_version, tool_catalog)
 *
 * Each check lands in exactly one bucket: required, conditional, or not
 * applicable. No agent may add, remove, or re-bucket a check. An unknown
 * class or an ownership map that cannot resolve the changed files returns
 * `needs-human`, never a default.
 */
import { ERR, err, ok } from "../result.js"
import type { DomainError, Result } from "../result.js"

export type RemediationClass =
  | "code"
  | "configuration"
  | "feature-flags"
  | "deployment"
  | "restart-scale-traffic"
  | "infrastructure"
  | "database-data"
  | "credentials"
  | "emergency-rollback"

const ALL_REVIEWS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"] as const
const ALL_TESTS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"] as const
export type ReviewCode = (typeof ALL_REVIEWS)[number]
export type TestCode = (typeof ALL_TESTS)[number]
export type CheckCode = ReviewCode | TestCode

type Cell = "required" | "conditional" | "not-applicable" | "standing"

/** The fixed matrix from review-verification.md. Columns: R1..R9, T1..T13. */
const MATRIX: ReadonlyMap<RemediationClass, readonly Cell[]> = new Map([
  ["code", ["required", "required", "required", "required", "conditional", "conditional", "conditional", "required", "conditional", "required", "required", "required", "required", "required", "conditional", "required", "conditional", "conditional", "conditional", "conditional", "conditional", "conditional"]],
  ["configuration", ["required", "required", "not-applicable", "required", "not-applicable", "not-applicable", "conditional", "required", "conditional", "not-applicable", "required", "not-applicable", "required", "conditional", "not-applicable", "conditional", "not-applicable", "conditional", "not-applicable", "not-applicable", "conditional", "required"]],
  ["feature-flags", ["required", "required", "not-applicable", "required", "not-applicable", "not-applicable", "not-applicable", "required", "conditional", "not-applicable", "required", "not-applicable", "required", "conditional", "not-applicable", "not-applicable", "not-applicable", "conditional", "not-applicable", "not-applicable", "conditional", "required"]],
  ["deployment", ["required", "required", "not-applicable", "required", "conditional", "conditional", "conditional", "required", "required", "required", "required", "required", "conditional", "required", "not-applicable", "required", "conditional", "required", "conditional", "conditional", "conditional", "required"]],
  ["restart-scale-traffic", ["required", "required", "not-applicable", "conditional", "not-applicable", "not-applicable", "not-applicable", "required", "conditional", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "conditional", "not-applicable", "not-applicable", "conditional", "required"]],
  ["infrastructure", ["required", "required", "not-applicable", "required", "not-applicable", "not-applicable", "required", "required", "conditional", "not-applicable", "required", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "conditional", "not-applicable", "conditional", "not-applicable", "not-applicable", "conditional", "required"]],
  ["database-data", ["required", "required", "conditional", "required", "not-applicable", "required", "conditional", "required", "conditional", "not-applicable", "not-applicable", "not-applicable", "conditional", "conditional", "not-applicable", "not-applicable", "required", "required", "not-applicable", "conditional", "conditional", "required"]],
  ["credentials", ["required", "required", "not-applicable", "required", "not-applicable", "not-applicable", "conditional", "required", "conditional", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "conditional", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "conditional", "required"]],
  ["emergency-rollback", ["not-applicable", "standing", "not-applicable", "standing", "not-applicable", "not-applicable", "not-applicable", "standing", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "conditional", "required"]],
])

const ALL_CODES: readonly CheckCode[] = [...ALL_REVIEWS, ...ALL_TESTS]

export interface DiffPaths {
  changed_files: string[]
  deleted_files: string[]
}

export interface ToolCatalog {
  version: string
  language: string
  fuzzHarnessAvailable: boolean
  stagingTargetExists: boolean
  serviceUserFacing: boolean
  pipelineHasE2E: boolean
  performanceSuiteExists: boolean
  performanceSensitivePaths: string[]
  ownershipMap: Record<string, string>
}

export interface ResolverInput {
  remediationClass: RemediationClass
  declaredSurfaces: string[]
  diff: DiffPaths
  actionRiskClass: "safe" | "guarded" | "barred"
  policyVersion: string
  toolCatalog: ToolCatalog
  recoveryPointSurfaces: string[]
  watchPlanExists: boolean
}

export interface ResolverResult {
  required: CheckCode[]
  conditional: CheckCode[]
  triggered: Record<string, string>
  not_applicable: CheckCode[]
  /** Per-check reason, for every check not required. */
  check_reasons: Record<string, string>
  resolver_version: string
  /** The ownership-map resolution for T5: the selected suite key. */
  t5_selection: string | null
  needs_human: boolean
  needs_human_reason: string | null
}

export const RESOLVER_VERSION = "applicability-resolver@1.0"

const DEPENDENCY_PATHS = [
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
  "pnpm-lock.yaml", "bun.lock", "go.mod", "go.sum", "Cargo.toml", "Cargo.lock",
  "requirements.txt", "pyproject.toml", "Gemfile", "Gemfile.lock",
]
const MIGRATION_PATHS = ["migrations/", ".sql", "schema.prisma", "alembic/"]
const INFRA_PATHS = ["kubernetes/", "k8s/", "helm/", ".tf", "terraform", "docker-compose", "compose.yaml", "compose.yml", "manifests/"]
const OBSERVABILITY_PATHS = ["logging", "metrics", "alerting", "runbook", "prometheus", "grafana", "alertmanager"]
const PARSING_PATHS = ["parser", "serializer", "validator", "validation", "boundary", "encoding", "decoding"]
const USER_FACING_PATHS = ["ui/", "frontend", ".html", "templates/", "static/", "routes/"]

function matchesAny(path: string, patterns: string[]): boolean {
  const lower = path.toLowerCase()
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()))
}

function cellAt(className: RemediationClass, code: CheckCode): Cell {
  const row = MATRIX.get(className)
  if (row === undefined) {
    return "not-applicable"
  }
  const index = ALL_CODES.indexOf(code)
  const cell = row[index]
  return cell ?? "not-applicable"
}

function triggerCheck(code: CheckCode, input: ResolverInput): { fired: boolean; reason: string; needsHuman?: boolean } {
  const paths = input.diff.changed_files.concat(input.diff.deleted_files)
  const declared = input.declaredSurfaces.map((surface) => surface.toLowerCase())
  const hasSurface = (name: string) => declared.includes(name)

  switch (code) {
    case "R5":
      return paths.some((path) => matchesAny(path, DEPENDENCY_PATHS)) || hasSurface("dependencies")
        ? { fired: true, reason: "dependency-manifest diff" }
        : { fired: false, reason: "no dependency-manifest diff" }
    case "R6":
      return hasSurface("data") || paths.some((path) => matchesAny(path, MIGRATION_PATHS))
        ? { fired: true, reason: "data surface declared or migration/schema path changed" }
        : { fired: false, reason: "no data surface and no migration/schema path" }
    case "R7":
      return hasSurface("infrastructure") || paths.some((path) => matchesAny(path, INFRA_PATHS))
        ? { fired: true, reason: "manifest or policy path changed" }
        : { fired: false, reason: "no manifest or policy path in the change set" }
    case "R9":
      return hasSurface("observability") || paths.some((path) => matchesAny(path, OBSERVABILITY_PATHS))
        ? { fired: true, reason: "logging, metrics, alerting, or runbook config touched" }
        : { fired: false, reason: "no observability config touched; Watch queries unchanged" }
    case "T6":
      return paths.some((path) => matchesAny(path, PARSING_PATHS)) && input.toolCatalog.fuzzHarnessAvailable
        ? { fired: true, reason: "parsing/validation/boundary logic touched and a harness exists" }
        : { fired: false, reason: input.toolCatalog.fuzzHarnessAvailable
            ? "no parsing/validation/boundary logic in the diff"
            : "no property or fuzz harness for the language in the demo tool catalog" }
    case "T7": {
      const row = MATRIX.get(input.remediationClass)
      const required = row !== undefined && cellAt(input.remediationClass, "T7") === "required"
      if (required) {
        return { fired: true, reason: "T7 required for this class" }
      }
      const risk = paths.some((path) =>
        matchesAny(path, ["secret", "credential", "identity", ".env", "policy", "manifest", "config"]),
      ) || hasSurface("security")
      return risk
        ? { fired: true, reason: "the changed artifact can carry secret, identity, or exposure risk" }
        : { fired: false, reason: "no secret, identity, or exposure risk in the change set" }
    }
    case "T8":
      return triggerCheck("R6", input).fired
        ? { fired: true, reason: "data surface declared or migration/schema path changed" }
        : { fired: false, reason: "no data surface" }
    case "T9":
      return ["deployment", "database-data", "infrastructure"].includes(input.remediationClass) ||
        input.toolCatalog.stagingTargetExists
        ? { fired: true, reason: "class requires an isolated environment, or a candidate target exists" }
        : { fired: false, reason: "no candidate target for the company" }
    case "T10":
      return paths.some((path) => matchesAny(path, USER_FACING_PATHS)) ||
        (input.toolCatalog.serviceUserFacing && input.toolCatalog.pipelineHasE2E)
        ? { fired: true, reason: "the diff touches a user-facing path" }
        : { fired: false, reason: "no user-facing path touched" }
    case "T11":
      return paths.some((path) => input.toolCatalog.performanceSensitivePaths.some((hot) => path.includes(hot))) ||
        input.toolCatalog.performanceSuiteExists
        ? { fired: true, reason: "a performance-sensitive path is touched" }
        : { fired: false, reason: "no performance-sensitive path declared" }
    case "T12":
      return input.recoveryPointSurfaces.some((surface) =>
        /restart|rollback|rotation|toggle|reroute/i.test(surface),
      )
        ? { fired: true, reason: "the Recovery Point names a restart, rollback, rotation, toggle, or reroute action" }
        : { fired: false, reason: "the Recovery Point names no drillable action" }
    case "T13":
      return input.remediationClass === "code"
        ? input.watchPlanExists && input.toolCatalog.stagingTargetExists
          ? { fired: true, reason: "the candidate carries a Watch plan and a rehearsable environment" }
          : { fired: false, reason: "no rehearsable environment for the Watch plan" }
        : { fired: true, reason: "required for every class that ends in an execution gate with a Watch plan" }
    case "T4":
      return ["code", "configuration", "feature-flags"].includes(input.remediationClass)
        ? { fired: true, reason: "contract checks always run for this class" }
        : { fired: false, reason: "no contract suite covers the changed surface" }
    case "T5": {
      const changed = paths.filter((path) => !path.startsWith("test"))
      const suites = new Set<string>()
      for (const path of changed) {
        const suite = input.toolCatalog.ownershipMap[path]
        if (suite !== undefined) {
          suites.add(suite)
        }
      }
      if (suites.size === 0) {
        return { fired: true, reason: "ownership map cannot resolve the changed files: needs-human", needsHuman: true }
      }
      return { fired: true, reason: `scoped regression suites: ${[...suites].join(", ")}` }
    }
    default:
      return { fired: false, reason: "not triggered" }
  }
}

/**
 * Resolve the exact check set for a sealed Remediation Proposal. Pure and
 * deterministic; a re-resolution with the same inputs yields the same set.
 */
export function resolveApplicability(input: ResolverInput): Result<ResolverResult, DomainError> {
  const row = MATRIX.get(input.remediationClass)
  if (row === undefined) {
    return err({
      code: ERR.NEEDS_HUMAN,
      message: `unknown remediation class ${input.remediationClass}: needs-human, never a default`,
    })
  }

  const required: CheckCode[] = []
  const conditional: CheckCode[] = []
  const notApplicable: CheckCode[] = []
  const triggered: Record<string, string> = {}
  const reasons: Record<string, string> = {}
  let needsHuman = false
  let needsHumanReason: string | null = null
  let t5Selection: string | null = null

  for (const code of ALL_CODES) {
    const cell = cellAt(input.remediationClass, code)
    if (cell === "required" || cell === "standing") {
      required.push(code)
      if (cell === "standing") {
        reasons[code] = "standing artifact, re-checked deterministically at the gate; no fresh model review"
        triggered[code] = reasons[code] ?? ""
      }
      continue
    }
    if (cell === "not-applicable") {
      notApplicable.push(code)
      reasons[code] = `not-applicable for class ${input.remediationClass}`
      continue
    }
    conditional.push(code)
    const verdict = triggerCheck(code, input)
    reasons[code] = verdict.reason
    if (verdict.fired) {
      triggered[code] = verdict.reason
      if (code === "T5") {
        t5Selection = verdict.reason
      }
    }
    const needsHumanOnTrigger = (verdict as { needsHuman?: boolean }).needsHuman === true
    if (needsHumanOnTrigger && !needsHuman) {
      needsHuman = true
      needsHumanReason = `ownership map cannot resolve the changed files (${verdict.reason})`
    }
  }

  if (input.actionRiskClass === "barred") {
    return err({ code: ERR.BARRED_ACTION, message: "barred action never reaches Verify" })
  }

  return ok({
    required,
    conditional,
    triggered,
    not_applicable: notApplicable,
    check_reasons: reasons,
    resolver_version: RESOLVER_VERSION,
    t5_selection: t5Selection,
    needs_human: needsHuman,
    needs_human_reason: needsHumanReason,
  })
}
