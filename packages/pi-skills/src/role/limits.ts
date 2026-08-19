/**
 * Finite defaults for a bounded Pi role session. The role cannot outspend
 * its turn budget, its tool budget, or its wall-clock budget.
 */
export interface RoleLimits {
  /** Model turns (streamed assistant responses), not tool calls. */
  maxModelTurns: number
  /** Non-terminal tool calls; the terminal submission is not counted. */
  maxNonTerminalToolCalls: number
  /** Wall-clock budget for the whole session. */
  maxDurationMs: number
}

export const DEFAULT_ROLE_LIMITS: RoleLimits = {
  maxModelTurns: 20,
  maxNonTerminalToolCalls: 32,
  maxDurationMs: 12 * 60_000,
}
