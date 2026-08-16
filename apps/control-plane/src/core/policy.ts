/**
 * Policy Service: Authority Modes, Automation Policies, the fixed action-risk
 * table, schedule windows, approvals, and the deterministic seven-check
 * decision order from docs/research/authority-action-risk.md.
 *
 * The evaluation is a pure function of (action, target, stage, mode, policy
 * version, tzdb version, clock, evidence state, approval state). The same
 * inputs give the same verdict every time. Later checks re-verify earlier
 * facts: brokers re-evaluate policy at execution time.
 */
import { createHash } from "node:crypto"

import type { Clock } from "../clock.js"
import type { ApprovalRow, PolicyRow } from "../store/store.js"

export type AuthorityMode = "observe" | "prepare" | "repair" | "emergency"
export type AutomationPolicy = "review-always" | "autonomous-always" | "scheduled-hybrid"
export type ActionRiskClass = "safe" | "guarded" | "barred"
export type GatePath = "release" | "action"

export interface ScheduleWindow {
  start_weekday: Weekday
  start_time: string
  end_weekday: Weekday
  end_time: string
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"

export interface Schedule {
  iana_zone: string
  windows: ScheduleWindow[]
}

export interface PolicyDraft {
  authority_mode: AuthorityMode
  automation_policy: AutomationPolicy
  schedule: Schedule | null
  emergency_override: boolean
  attempt_limit: number
}

export interface PolicyVersion {
  version: string
  authorityMode: AuthorityMode
  automationPolicy: AutomationPolicy
  schedule: Schedule | null
  emergencyOverride: boolean
  attemptLimit: number
}

export interface RiskTableEntry {
  category: ActionCategory
  defaultClass: ActionRiskClass
  condition?: string
}

/** The fixed action taxonomy from authority-action-risk.md. */
export type ActionCategory =
  | "code"
  | "configuration"
  | "feature-flags"
  | "deployment"
  | "restart"
  | "scaling"
  | "traffic"
  | "infrastructure"
  | "database-data"
  | "credentials"
  | "security-containment"
  | "messages-payments"
  | "destructive"

export interface TypedAction {
  category: ActionCategory
  action_class: string
  adapter: string
  command: string
  target: string
}

export const RISK_TABLE: ReadonlyMap<ActionCategory, RiskTableEntry> = new Map<
  ActionCategory,
  RiskTableEntry
>([
  ["code", { category: "code", defaultClass: "safe", condition: "propose/prepare safe; merge and deploy follow the Release Gate" }],
  ["configuration", { category: "configuration", defaultClass: "safe", condition: "guarded without a tested Recovery Point" }],
  ["feature-flags", { category: "feature-flags", defaultClass: "guarded", condition: "disable safe; enable or widen guarded" }],
  ["deployment", { category: "deployment", defaultClass: "safe", condition: "staged release safe; all-at-once guarded" }],
  ["restart", { category: "restart", defaultClass: "safe" }],
  ["scaling", { category: "scaling", defaultClass: "safe", condition: "scale-down below the redundancy floor guarded" }],
  ["traffic", { category: "traffic", defaultClass: "safe", condition: "prior routes recorded" }],
  ["infrastructure", { category: "infrastructure", defaultClass: "guarded", condition: "safe only with provider state identifiers and a saved plan; destroying an unbacked resource barred" }],
  ["database-data", { category: "database-data", defaultClass: "guarded", condition: "read safe; destructive migration, mutating backfill, delete rows barred" }],
  ["credentials", { category: "credentials", defaultClass: "guarded", condition: "issue safe; rotate/revoke guarded" }],
  ["security-containment", { category: "security-containment", defaultClass: "safe" }],
  ["messages-payments", { category: "messages-payments", defaultClass: "barred" }],
  ["destructive", { category: "destructive", defaultClass: "barred" }],
])

/** The fixed barred-action list; the product never executes these. */
export const BARRED_ACTIONS: ReadonlySet<string> = new Set([
  "delete-data",
  "destroy-unbacked-resource",
  "send-external-message",
  "refund-payment",
  "widen-access",
  "purge-queue",
  "drop-table",
  "force-delete",
  "delete-rows",
  "mutating-backfill",
])

/** Adapter declarations may tighten a class; they never loosen it. */
export function resolveActionRiskClass(
  action: TypedAction,
  overrides: ReadonlyMap<string, ActionRiskClass> = new Map(),
): ActionRiskClass {
  const tableClass = RISK_TABLE.get(action.category)?.defaultClass ?? "guarded"
  const key = `${action.adapter}:${action.action_class}`
  const tightened = overrides.get(key)
  if (tightened !== undefined) {
    const order: ActionRiskClass[] = ["safe", "guarded", "barred"]
    return order.indexOf(tightened) > order.indexOf(tableClass) ? tightened : tableClass
  }
  if (isBarredAction(action)) {
    return "barred"
  }
  return tableClass
}

/** True when a typed action matches the fixed barred list. */
export function isBarredAction(action: TypedAction): boolean {
  const lower = action.command.toLowerCase()
  for (const barred of BARRED_ACTIONS) {
    if (action.action_class === barred || lower.includes(barred.replace(/-/g, " "))) {
      return true
    }
  }
  return false
}

export type PolicyDecision =
  | "autonomous"
  | "approval-required"
  | "denied"
  | "needs-human"

export interface PolicyDecisionResult {
  decision: PolicyDecision
  reason: string
  policy_version: string
  tzdb_version: string
  evaluated_at: string
  evaluated_local_time: string
  window: Schedule | null
  action_risk_class: ActionRiskClass
}

export interface PolicyDecisionContext {
  action: TypedAction
  stage: string
  riskClass: ActionRiskClass
  policy: PolicyVersion
  tzdbVersion: string
  clock: Clock
  approval: ApprovalRow | null
  clockSkewToleranceSeconds: number
  emergencyAllowListMembership: boolean
}

const WEEKDAY_ORDER: ReadonlyMap<Weekday, number> = new Map([
  ["mon", 0],
  ["tue", 1],
  ["wed", 2],
  ["thu", 3],
  ["fri", 4],
  ["sat", 5],
  ["sun", 6],
])

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

interface WallTime {
  weekday: number
  minutes: number
}

/** Civil time in an IANA zone via Intl, deterministic per tzdb data. */
export function wallTimeInZone(instantIso: string, zone: string): WallTime | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(instantIso))
    const map = new Map(parts.map((part) => [part.type, part.value]))
    const weekdayText = map.get("weekday")?.toLowerCase().slice(0, 3)
    const weekday = weekdayText !== undefined ? WEEKDAY_ORDER.get(weekdayText as Weekday) : undefined
    const hour = Number(map.get("hour") ?? 0)
    const minute = Number(map.get("minute") ?? 0)
    if (weekday === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null
    }
    return { weekday, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

/** Whether a wall time exists in the zone (skipped-hour detection). */
export function wallTimeExistsInZone(weekday: number, minutes: number, zone: string): boolean {
  // Probe a bounded set of UTC instants; the skipped hour of a spring-forward
  // transition has no instant mapping to it.
  const day = new Date(Date.UTC(2024, 0, 1, 12, 0, 0))
  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 1) {
    for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
      const probe = new Date(day.getTime() + (offsetHours * 60 + dayOffset * 24 * 60) * 60 * 1000)
      const wall = wallTimeInZone(probe.toISOString(), zone)
      if (wall !== null && wall.weekday === weekday && wall.minutes === minutes) {
        return true
      }
    }
  }
  return false
}

/** True when the instant falls inside a closed-open weekly window. */
export function insideWindow(instantIso: string, window: ScheduleWindow, zone: string): boolean {
  const wall = wallTimeInZone(instantIso, zone)
  if (wall === null) {
    return false
  }
  const start = {
    weekday: WEEKDAY_ORDER.get(window.start_weekday) ?? 0,
    minutes: timeToMinutes(window.start_time),
  }
  const end = {
    weekday: WEEKDAY_ORDER.get(window.end_weekday) ?? 0,
    minutes: timeToMinutes(window.end_time),
  }
  const position = wall.weekday * 24 * 60 + wall.minutes
  const startPosition = start.weekday * 24 * 60 + start.minutes
  let endPosition = end.weekday * 24 * 60 + end.minutes
  if (endPosition <= startPosition) {
    endPosition += 7 * 24 * 60
  }
  if (position < startPosition) {
    return false
  }
  if (position >= endPosition) {
    return false
  }
  return true
}

/** Whether any window contains the instant, and the reason when it does not. */
export function scheduleVerdict(
  instantIso: string,
  schedule: Schedule,
): { autonomous: boolean; reason: string } {
  for (const window of schedule.windows) {
    if (!wallTimeExistsInZone(WEEKDAY_ORDER.get(window.start_weekday) ?? 0, timeToMinutes(window.start_time), schedule.iana_zone)) {
      return { autonomous: false, reason: "dst-skipped-hour" }
    }
    if (insideWindow(instantIso, window, schedule.iana_zone)) {
      return { autonomous: true, reason: "inside-window" }
    }
  }
  return { autonomous: false, reason: "outside-window" }
}

export function validateZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format()
    return true
  } catch {
    return false
  }
}

/**
 * Compute a content-addressed policy version: the canonical policy payload
 * hashed under a domain separator. Policies are versioned; every journal
 * event names the version in force.
 */
export function policyVersionFor(draft: PolicyDraft, incidentId: string): string {
  const canonical = JSON.stringify({
    domain: "sih.policy",
    version: 1,
    incident_id: incidentId,
    authority_mode: draft.authority_mode,
    automation_policy: draft.automation_policy,
    schedule: draft.schedule ?? null,
    emergency_override: draft.emergency_override,
    attempt_limit: draft.attempt_limit,
  })
  return `policy:sha256:${createHash("sha256").update(canonical).digest("hex")}`
}

export interface ModeVerbCheck {
  verb: "read" | "propose" | "prepare" | "merge-deploy" | "direct-action" | "rollback" | "new-code"
}

/** The fixed Mode ceiling from authority-action-risk.md. */
export function modePermits(mode: AuthorityMode, verb: ModeVerbCheck["verb"]): boolean {
  switch (verb) {
    case "read":
      return true
    case "propose":
      return mode === "prepare" || mode === "repair"
    case "prepare":
      return mode === "prepare" || mode === "repair"
    case "merge-deploy":
      return mode === "repair"
    case "direct-action":
      return mode === "repair" || mode === "emergency"
    case "rollback":
      return mode === "repair" || mode === "emergency"
    case "new-code":
      return mode === "prepare" || mode === "repair"
  }
}

function approvalIsValid(approval: ApprovalRow | null, now: Date, policyVersion: string): boolean {
  if (approval === null) {
    return false
  }
  if (approval.consumed_at !== null || approval.revoked_at !== null) {
    return false
  }
  if (Date.parse(approval.expiry) <= now.getTime()) {
    return false
  }
  if (approval.policy_version !== policyVersion) {
    return false
  }
  return true
}

/**
 * The deterministic seven-check decision, in the fixed order:
 * barred list -> Mode ceiling -> Automation Policy -> approval record ->
 * (gate) -> (broker checks). The gate and broker checks run after this
 * function in their own owners.
 */
export function decidePolicyAction(context: PolicyDecisionContext): PolicyDecisionResult {
  const { action, policy, tzdbVersion, clock } = context
  const nowIso = clock.nowIso()
  const wall = wallTimeInZone(nowIso, policy.schedule?.iana_zone ?? "UTC")
  const evaluatedLocalTime = wall === null ? nowIso : nowIso

  const base: Omit<PolicyDecisionResult, "decision" | "reason"> = {
    policy_version: policy.version,
    tzdb_version: tzdbVersion,
    evaluated_at: nowIso,
    evaluated_local_time: evaluatedLocalTime,
    window: policy.schedule,
    action_risk_class: context.riskClass,
  }

  // 1. Barred: the product never executes it, under every mode and policy.
  if (context.riskClass === "barred") {
    return {
      ...base,
      decision: "denied",
      reason: `barred action class; the product never executes ${action.category}/${action.action_class}`,
    }
  }

  // 2. Authority Mode ceiling.
  const verb: ModeVerbCheck["verb"] =
    context.stage === "release" && action.category === "code" ? "merge-deploy"
    : context.stage === "repair" ? "prepare"
    : "direct-action"
  if (!modePermits(policy.authorityMode, verb)) {
    return {
      ...base,
      decision: "denied",
      reason: `authority mode ${policy.authorityMode} does not permit ${verb} for ${action.category}`,
    }
  }

  // Emergency Mode runs only named allow-list actions.
  if (policy.authorityMode === "emergency" && !context.emergencyAllowListMembership) {
    return {
      ...base,
      decision: "denied",
      reason: "emergency mode permits named allow-list actions only",
    }
  }

  // 3. Action-risk class beats the Automation Policy: guarded always needs
  //    a recorded human approval in every policy and mode.
  if (context.riskClass === "guarded" && !approvalIsValid(context.approval, clock.now(), policy.version)) {
    return {
      ...base,
      decision: "approval-required",
      reason: "guarded action requires a fresh, unexpired, scope-matching recorded approval",
    }
  }

  // 4. Automation Policy: when a human approves.
  if (policy.automationPolicy === "review-always") {
    if (context.riskClass === "safe" && context.stage === "release" && !policy.emergencyOverride) {
      return {
        ...base,
        decision: "approval-required",
        reason: "human-review policy: release actions wait for a recorded approval",
      }
    }
    return {
      ...base,
      decision: context.riskClass === "safe" ? "autonomous" : "approval-required",
      reason: "human-review policy",
    }
  }

  if (policy.automationPolicy === "autonomous-always") {
    if (context.riskClass === "safe") {
      return { ...base, decision: "autonomous", reason: "autonomous policy permits safe actions" }
    }
    return approvalIsValid(context.approval, clock.now(), policy.version)
      ? { ...base, decision: "autonomous", reason: "guarded action with a valid approval" }
      : { ...base, decision: "approval-required", reason: "guarded action without a valid approval" }
  }

  // scheduled-hybrid: evaluated at execution time.
  if (policy.schedule === null) {
    return { ...base, decision: "needs-human", reason: "hybrid policy without a schedule" }
  }
  const verdict = scheduleVerdict(nowIso, policy.schedule)
  if (context.riskClass === "guarded") {
    return approvalIsValid(context.approval, clock.now(), policy.version)
      ? { ...base, decision: "autonomous", reason: `guarded action with a valid approval (${verdict.reason})` }
      : { ...base, decision: "approval-required", reason: "guarded action without a valid approval" }
  }
  if (verdict.autonomous) {
    return { ...base, decision: "autonomous", reason: "inside autonomous window" }
  }
  return {
    ...base,
    decision: approvalIsValid(context.approval, clock.now(), policy.version)
      ? "autonomous"
      : "approval-required",
    reason: approvalIsValid(context.approval, clock.now(), policy.version)
      ? "outside window but a valid approval exists"
      : `outside autonomous window (${verdict.reason}); a recorded approval lets it proceed`,
  }
}

export function toPolicyVersion(row: PolicyRow): PolicyVersion {
  return {
    version: row.version,
    authorityMode: row.authority_mode as AuthorityMode,
    automationPolicy: row.automation_policy as AutomationPolicy,
    schedule: row.schedule as Schedule | null,
    emergencyOverride: row.emergency_override,
    attemptLimit: row.attempt_limit,
  }
}
