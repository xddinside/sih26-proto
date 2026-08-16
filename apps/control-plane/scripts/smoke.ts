/**
 * Live smoke: start the Control Plane, POST a signed sample IncidentTrigger,
 * confirm 200 + a journal entry, replay the journal, and query the read APIs.
 * Uses a sample trigger with the same shape as the intake-normalizer stand-in.
 */
import { createHmac } from "node:crypto"

import { deliveryKey, incidentKey } from "@sih/contracts/hashes"

import { bootstrap } from "../src/bootstrap.js"
import { loadConfig } from "../src/config.js"
import { signBody } from "../src/hmac.js"

const config = loadConfig()
const runtime = await bootstrap(config)
const server = (await import("../src/server.js")).createServer(runtime)

Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: server.fetch })

const base = `http://127.0.0.1:${config.port}`
const trigger = {
  schema_version: "1.0",
  trigger_id: "trig-smoke-1",
  delivery_key: "sha256:" + "a".repeat(64),
  incident_key: "sha256:" + "b".repeat(64),
  received_at: new Date().toISOString(),
  detector: {
    source: "prometheus-alertmanager",
    connection_id: "astronomy-shop-local",
    rule_id: "payment-error-rate",
    rule_version: "git:smoke",
  },
  state: "firing",
  severity: "critical",
  scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
  window: { starts_at: new Date().toISOString(), ends_at: null, lookback_seconds: 120 },
  signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
  evidence_refs: [],
} as const

const body = JSON.stringify(trigger)
const timestamp = new Date().toISOString()
const nonce = cryptoRandomUUID()
const signature = signBody(config.hmacSecret, body, timestamp, nonce)

const post = await fetch(`${base}/v1/incident-triggers`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sih-timestamp": timestamp,
    "x-sih-nonce": nonce,
    "x-sih-signature": signature,
  },
  body,
})
console.log(`[smoke] POST /v1/incident-triggers -> ${post.status} ${await post.text()}`)

// Re-deliver the same delivery_key: must be a dedup no-op.
const againTimestamp = new Date().toISOString()
const againNonce = cryptoRandomUUID()
const again = await fetch(`${base}/v1/incident-triggers`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sih-timestamp": againTimestamp,
    "x-sih-nonce": againNonce,
    "x-sih-signature": signBody(config.hmacSecret, body, againTimestamp, againNonce),
  },
  body,
})
console.log(`[smoke] duplicate POST -> ${again.status} ${await again.text()}`)

const list = await fetch(`${base}/api/incidents`)
console.log(`[smoke] GET /api/incidents -> ${list.status}`)
const listBody = (await list.json()) as { incidents: { incident: { incident_id: string } }[] }
console.log(`[smoke] incidents: ${listBody.incidents.map((entry) => entry.incident.incident_id).join(", ")}`)

for (const entry of listBody.incidents) {
  const id = entry.incident.incident_id
  const detail = await fetch(`${base}/api/incidents/${id}`)
  console.log(`[smoke] GET /api/incidents/${id} -> ${detail.status}`)
  const detailBody = (await detail.json()) as { events: unknown[] }
  console.log(`[smoke]   journal events replayed: ${detailBody.events.length}`)
}

await runtime.store.close()
console.log("[smoke] done")
process.exit(0)

function cryptoRandomUUID(): string {
  return createHmac("sha256", "x").update(Math.random().toString()).digest("hex").slice(0, 32)
}
