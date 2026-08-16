/**
 * Control Plane configuration from the environment. Demo Profile defaults:
 * the same machines as the Solution Contract, minus the research, action,
 * time, token, and cost caps; the Attempt Limit, gates, approvals, leases,
 * cancel, and host limits stay.
 */
export interface Config {
  port: number
  databaseUrl: string
  artifactDir: string
  hmacSecret: string
  brokerToken: string
  operatorToken: string
  tzdbVersion: string
  attemptLimitDefault: number
  revisionCap: number
  workerRestartCap: number
  approvalTtlSeconds: number
  leaseTtlSeconds: number
  permitTtlSeconds: number
  confirmationWindowSeconds: number
  clockSkewToleranceSeconds: number
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.CP_PORT ?? env.PORT ?? 8080),
    databaseUrl:
      env.SIH_DATABASE_URL ??
      "postgres://sih:sih@127.0.0.1:5433/sih_control_plane",
    artifactDir: env.SIH_ARTIFACT_DIR ?? ".siih/artifacts",
    hmacSecret: env.SIH_HMAC_SECRET ?? "demo-hmac-secret",
    brokerToken: env.SIH_BROKER_TOKEN ?? "demo-broker-token",
    operatorToken: env.SIH_OPERATOR_TOKEN ?? "demo-operator-token",
    tzdbVersion: env.SIH_TZDB_VERSION ?? "2025b",
    attemptLimitDefault: Number(env.SIH_ATTEMPT_LIMIT ?? 3),
    revisionCap: Number(env.SIH_REVISION_CAP ?? 2),
    workerRestartCap: Number(env.SIH_WORKER_RESTART_CAP ?? 2),
    approvalTtlSeconds: Number(env.SIH_APPROVAL_TTL_SECONDS ?? 1800),
    leaseTtlSeconds: Number(env.SIH_LEASE_TTL_SECONDS ?? 300),
    permitTtlSeconds: Number(env.SIH_PERMIT_TTL_SECONDS ?? 300),
    confirmationWindowSeconds: Number(env.SIH_CONFIRMATION_WINDOW_SECONDS ?? 600),
    clockSkewToleranceSeconds: Number(env.SIH_CLOCK_SKEW_SECONDS ?? 120),
  }
}
