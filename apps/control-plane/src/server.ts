/**
 * HTTP server for the Control Plane: signed trigger intake, the Workspace read
 * APIs, the authorized artifact envelope, and the internal broker/Worker/
 * operator surface. The live event stream and typed command endpoint are
 * Solution Contract only and return 501 here.
 */
import { parseIncidentTrigger } from "@sih/contracts/parse"

import type { Runtime } from "./bootstrap.js"
import { isStaleSignature, verifyBody } from "./hmac.js"

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function errorBody(code: string, message: string, status: number): Response {
  return json(status, { error: { code, message } })
}

function readBody(request: Request): Promise<string> {
  return request.text()
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (header === null) return null
  const match = /^Bearer (.+)$/.exec(header)
  return match?.[1] ?? null
}

export function createServer(runtime: Runtime): { fetch: (request: Request) => Promise<Response> } {
  const { cp, config, clock } = runtime

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "GET" && (path === "/healthz" || path === "/")) {
      return new Response("ok", { status: 200 })
    }

    if (request.method === "POST" && path === "/v1/incident-triggers") {
      return handleTrigger(request)
    }

    if (request.method === "GET" && path === "/api/incidents") {
      const incidents = await listIncidents()
      return json(200, { incidents })
    }

    if (path.startsWith("/api/incidents/")) {
      return handleIncidentRead(request, path)
    }

    if (path.startsWith("/v1/internal/")) {
      return handleInternal(request, path)
    }

    return errorBody("NOT_FOUND", "not found", 404)
  }

  async function handleTrigger(request: Request): Promise<Response> {
    const timestamp = request.headers.get("x-sih-timestamp") ?? ""
    const nonce = request.headers.get("x-sih-nonce") ?? ""
    const signature = request.headers.get("x-sih-signature") ?? ""
    const body = await readBody(request)

    if (isStaleSignature(timestamp, clock.now(), config.clockSkewToleranceSeconds)) {
      return errorBody("UNAUTHORIZED", "stale signature timestamp", 401)
    }
    if (!verifyBody(config.hmacSecret, body, { timestamp, nonce, signature })) {
      return errorBody("UNAUTHORIZED", "invalid HMAC signature", 401)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return errorBody("MALFORMED_CONTRACT", "unparseable trigger JSON", 400)
    }
    const trigger = parseIncidentTrigger(parsed)
    if (!trigger.ok) {
      return errorBody(trigger.error.code, trigger.error.message, 400)
    }

    const result = await cp.handleTrigger(trigger.value)
    if (!result.ok) {
      return errorBody(result.error.code, result.error.message, 409)
    }
    return json(200, {
      status: "accepted",
      incident_id: result.value.incidentId,
      delivery_result: result.value.deliveryResult,
    })
  }

  async function listIncidents(): Promise<unknown[]> {
    const ids = await runtime.store.allIncidentIds()
    const rows: unknown[] = []
    for (const id of ids) {
      const projection = await cp.projection(id)
      if (projection !== null) {
        rows.push(projection)
      }
    }
    return rows
  }

  async function handleIncidentRead(request: Request, path: string): Promise<Response> {
    // /api/incidents/:id/events and /api/incidents/:id/commands are deferred.
    if (path.endsWith("/events")) {
      return errorBody("DEFERRED", "live event stream is Solution Contract only", 501)
    }
    if (path.endsWith("/commands") && request.method === "POST") {
      return errorBody("DEFERRED", "typed command endpoint is Solution Contract only", 501)
    }
    const parts = path.split("/").filter(Boolean)
    // ["api", "incidents", ":id"] or ["api", "incidents", ":id", "artifacts", ":hash"]
    const incidentId = parts[2]
    if (incidentId === undefined) {
      return errorBody("NOT_FOUND", "incident id required", 404)
    }
    if (parts[3] === "artifacts") {
      const hash = parts[4]
      if (hash === undefined) return errorBody("NOT_FOUND", "artifact hash required", 404)
      const envelope = await cp.artifacts.get(hash)
      if (!envelope.ok) {
        return errorBody(envelope.error.code, envelope.error.message, 404)
      }
      return json(200, {
        content_hash: envelope.value.content_hash,
        artifact_schema_id: envelope.value.artifact_schema_id,
        artifact_schema_version: envelope.value.artifact_schema_version,
        sealed_at: envelope.value.sealed_at,
        incident_id: envelope.value.incident_id,
        producer: envelope.value.producer,
        redaction: envelope.value.redaction,
        provenance: envelope.value.provenance,
        payload: envelope.value.payload,
      })
    }
    const projection = await cp.projection(incidentId)
    if (projection === null) {
      return errorBody("NOT_FOUND", "incident not found", 404)
    }
    const url = new URL(request.url)
    const attempt = url.searchParams.get("attempt")
    if (attempt !== null) {
      const run = (projection.runs as { attempt: number }[]).find((candidate) => String(candidate.attempt) === attempt)
      if (run === undefined) {
        return errorBody("NOT_FOUND", "attempt not found", 404)
      }
      return json(200, { incident: projection.incident, run, policy: projection.policy })
    }
    return json(200, projection)
  }

  async function handleInternal(request: Request, path: string): Promise<Response> {
    const body = await readBody(request).catch(() => "{}")
    let parsed: Record<string, unknown> = {}
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body)
      } catch {
        return errorBody("MALFORMED_CONTRACT", "unparseable internal request", 400)
      }
    }

    const name = path.slice("/v1/internal/".length)
    switch (name) {
      case "leases/verify": {
        const token = bearer(request) ?? (parsed.token as string) ?? ""
        const claims = parsed.claims as {
          leaseId: string; incidentId: string; runId: string; attempt: number
          stage: string; actorId: string; actorKind: string; toolClass: string
        }
        const result = await cp.verifyLease(token, {
          leaseId: claims.leaseId, incidentId: claims.incidentId, runId: claims.runId,
          attempt: claims.attempt, stage: claims.stage, actorId: claims.actorId,
          actorKind: claims.actorKind, toolClass: claims.toolClass,
        })
        if (!result.ok) return errorBody(result.error.code, result.error.message, 403)
        return json(200, { valid: true, run_state: result.value.runState })
      }
      case "leases/heartbeat": {
        const leaseId = parsed.lease_id as string
        const token = bearer(request) ?? (parsed.token as string) ?? ""
        const result = await cp.heartbeat(leaseId, token)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 403)
        return json(200, { renewed: true })
      }
      case "permits/consume": {
        const permitId = parsed.permit_id as string
        const token = bearer(request) ?? (parsed.token as string) ?? ""
        const result = await cp.consumePermit(permitId, token, {
          candidateHash: parsed.candidate_hash as string,
          target: parsed.target as string,
          incidentId: parsed.incident_id as string,
        })
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { consumed: true })
      }
      case "receipts": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.recordBrokerReceipt(
          parsed.incident_id as string,
          parsed.run_id as string | undefined,
          parsed.stage as string | undefined,
          parsed.receipt as never,
          parsed.actor_kind as "read-broker" | "action-broker",
        )
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { recorded: true })
      }
      case "model-use": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.recordModelUse(
          parsed.incident_id as string,
          parsed.run_id as string | undefined,
          parsed as never,
        )
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { recorded: true })
      }
      case "command": {
        const token = bearer(request) ?? (parsed.token as string) ?? ""
        const claims = parsed.claims as never
        const command = parsed.command as never
        const result = await cp.submitCommand(parsed.incident_id as string, token, claims, command)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { applied: true, sequence: (result.value.event as { sequence: number }).sequence })
      }
      case "seal": {
        const token = bearer(request) ?? (parsed.token as string) ?? ""
        const claims = parsed.claims as { incidentId: string; runId: string; stage: string; attempt: number; actorId: string; actorKind: string; toolClass: string }
        const verified = await cp.verifyLease(token, { leaseId: parsed.lease_id as string, incidentId: claims.incidentId, runId: claims.runId, attempt: claims.attempt, stage: claims.stage, actorId: claims.actorId, actorKind: claims.actorKind, toolClass: claims.toolClass })
        if (!verified.ok) return errorBody(verified.error.code, verified.error.message, 403)
        const seal = parsed.seal as { schema_id: string; schema_version: string; payload: unknown; producer?: never }
        const result = await cp.sealArtifact(claims.incidentId, claims.runId, {
          incidentId: claims.incidentId,
          runId: claims.runId,
          schemaId: seal.schema_id,
          schemaVersion: seal.schema_version,
          payload: seal.payload as never,
          producer: seal.producer,
        })
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { artifact_ref: result.value.artifactRef })
      }
      case "human": {
        if (!authorizeOperator(request, parsed)) return errorBody("UNAUTHORIZED", "operator token required", 401)
        const action = parsed.action as "pause" | "resume" | "cancel" | "close"
        const result = await cp.humanAction(parsed.incident_id as string, action, {
          runId: parsed.run_id as string | undefined,
          reason: parsed.reason as string | undefined,
        })
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { accepted: true })
      }
      case "approvals": {
        if (!authorizeOperator(request, parsed)) return errorBody("UNAUTHORIZED", "operator token required", 401)
        const result = await cp.recordApproval(parsed.incident_id as string, parsed.approval as never)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { recorded: true })
      }
      case "policy-decision": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.decideAction(
          parsed.incident_id as string,
          parsed.action as never,
          parsed.stage as string,
        )
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, result.value)
      }
      case "gates/hypothesis": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.evaluateHypothesis(parsed.incident_id as string, parsed.run_id as string, parsed.input as never)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { verdict: result.value.verdict, evaluation: result.value.evaluation })
      }
      case "gates/verification": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.requestVerificationVerdict(parsed.incident_id as string, parsed.run_id as string, parsed.input as never)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { verdict: result.value.verdict, reason: result.value.reason, artifact_ref: result.value.artifactRef })
      }
      case "gates/release": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.requestReleaseGate(parsed.incident_id as string, parsed.run_id as string, parsed.input as never)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { verdict: result.value.verdict, permit: result.value.permit })
      }
      case "gates/action": {
        if (!authorizeBroker(request, parsed)) return errorBody("UNAUTHORIZED", "broker token required", 401)
        const result = await cp.requestActionGate(parsed.incident_id as string, parsed.run_id as string, parsed.input as never)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { verdict: result.value.verdict, permit: result.value.permit })
      }
      case "confirm-window": {
        if (!authorizeOperator(request, parsed)) return errorBody("UNAUTHORIZED", "operator token required", 401)
        const result = await cp.confirmWindow(parsed.incident_id as string)
        if (!result.ok) return errorBody(result.error.code, result.error.message, 409)
        return json(200, { accepted: true })
      }
      case "replay": {
        if (!authorizeOperator(request, parsed)) return errorBody("UNAUTHORIZED", "operator token required", 401)
        const projection = await cp.projection(parsed.incident_id as string)
        if (projection === null) return errorBody("NOT_FOUND", "incident not found", 404)
        return json(200, projection)
      }
      default:
        return errorBody("NOT_FOUND", "internal route not found", 404)
    }
  }

  function authorizeBroker(request: Request, parsed: Record<string, unknown>): boolean {
    const token = bearer(request) ?? (parsed.token as string | undefined)
    return token === config.brokerToken
  }

  function authorizeOperator(request: Request, parsed: Record<string, unknown>): boolean {
    const token = bearer(request) ?? (parsed.token as string | undefined)
    return token === config.operatorToken
  }

  return { fetch: handle }
}


async function main(): Promise<void> {
  const { loadConfig } = await import("./config.js")
  const { bootstrap } = await import("./bootstrap.js")
  const config = loadConfig()
  const runtime = await bootstrap(config)
  const server = createServer(runtime)
  Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch: server.fetch,
  })
  console.log(`[control-plane] listening on :${config.port}`)
}

if (import.meta.main) {
  await main()
}
