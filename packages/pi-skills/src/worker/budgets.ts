/**
 * Budgets from docs/research/pi-agent-catalog.md and
 * docs/build-handoff.md §4. The Demo Profile removes only the Fusion-round,
 * evidence-gathering-action, broker-action, wall-time, token, and cost caps;
 * the Attempt Limit, revision cap, Worker restart cap, both gates, approvals,
 * leases, cancel, cleanup, and host limits stay.
 */
export interface Budgets {
  wallTimeMs: number | null
  tokenCap: number | null
  costCapUsd: number | null
  fusionRoundCap: number | null
  evidenceActionCap: number | null
  brokerActionCap: number | null
  subagentCap: number | null
  revisionCap: number
  attemptLimit: number
  workerRestartCap: number
}

/** Production defaults (operator-configurable). */
export const PRODUCTION_BUDGETS: Budgets = {
  wallTimeMs: 30 * 60 * 1000,
  tokenCap: 2_000_000,
  costCapUsd: 25,
  fusionRoundCap: 3,
  evidenceActionCap: 20,
  brokerActionCap: 100,
  subagentCap: 16,
  revisionCap: 2,
  attemptLimit: 3,
  workerRestartCap: 2,
}

/** Demo Profile: no research, action, time, token, or cost caps; the
 * Attempt Limit, revision cap, restart cap, gates, approvals, and host
 * limits stay enforced. */
export const DEMO_BUDGETS: Budgets = {
  wallTimeMs: null,
  tokenCap: null,
  costCapUsd: null,
  fusionRoundCap: null,
  evidenceActionCap: null,
  brokerActionCap: null,
  subagentCap: null,
  revisionCap: 2,
  attemptLimit: 3,
  workerRestartCap: 2,
}

export type BudgetMetric =
  | "wall-time"
  | "tokens"
  | "cost"
  | "fusion-round"
  | "evidence-action"
  | "broker-action"
  | "subagent"
  | "revision"

export interface BudgetResult {
  allowed: boolean
  metric: BudgetMetric
  used: number
  cap: number | null
}

/**
 * Tracks per-attempt budgets. A `null` cap means the Demo Profile removed it
 * (never enforced); the remaining caps always fail closed.
 */
export class BudgetTracker {
  private readonly used = new Map<BudgetMetric, number>()

  constructor(
    private readonly budgets: Budgets,
    private readonly startedAt: number = Date.now()
  ) {}

  consume(metric: BudgetMetric, amount = 1): BudgetResult {
    const cap = this.capOf(metric)
    const used = (this.used.get(metric) ?? 0) + amount
    this.used.set(metric, used)
    return { allowed: cap === null || used <= cap, metric, used, cap }
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  private capOf(metric: BudgetMetric): number | null {
    switch (metric) {
      case "wall-time":
        return this.budgets.wallTimeMs
      case "tokens":
        return this.budgets.tokenCap
      case "cost":
        return this.budgets.costCapUsd
      case "fusion-round":
        return this.budgets.fusionRoundCap
      case "evidence-action":
        return this.budgets.evidenceActionCap
      case "broker-action":
        return this.budgets.brokerActionCap
      case "subagent":
        return this.budgets.subagentCap
      case "revision":
        return this.budgets.revisionCap
    }
  }
}
