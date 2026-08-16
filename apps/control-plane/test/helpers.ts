/**
 * Test helper: open the Control Plane against a local PostgreSQL and reset
 * tables between tests. Requires a running PostgreSQL (see scripts/db.sh).
 */
import { bootstrap } from "../src/bootstrap.js"
import { loadConfig } from "../src/config.js"
import { fixedClock } from "../src/clock.js"
import type { Runtime } from "../src/bootstrap.js"

const TEST_DATABASE_URL =
  process.env.SIH_TEST_DATABASE_URL ??
  process.env.SIH_DATABASE_URL ??
  "postgres://sih:sih@127.0.0.1:5433/sih_control_plane"

export function testConfig(dbName = "state") {
  const base =
    process.env.SIH_TEST_DATABASE_URL ??
    process.env.SIH_DATABASE_URL ??
    `postgres://sih:sih@127.0.0.1:5433/sih_test_${dbName}`
  const config = loadConfig({
    SIH_DATABASE_URL: base,
    SIH_HMAC_SECRET: "test-hmac-secret",
    SIH_BROKER_TOKEN: "test-broker-token",
    SIH_OPERATOR_TOKEN: "test-operator-token",
  })
  return config
}

export async function newTestRuntime(dbName = "state"): Promise<Runtime> {
  const config = testConfig(dbName)
  const runtime = await bootstrap(config, fixedClock("2026-08-15T15:00:00Z"))
  await runtime.store.reset()
  return runtime
}

export async function closeRuntime(runtime: Runtime): Promise<void> {
  await runtime.store.close()
}
