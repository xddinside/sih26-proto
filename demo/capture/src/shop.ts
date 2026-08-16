/**
 * Real-shop adapter for the capture: Prometheus queries, Docker state reads,
 * Alertmanager polling, and the gRPC probe/traffic drivers. Every recorded
 * metric row comes through here from a live query or a live probe run.
 *
 * All Docker calls use the `sg docker -c "..."` wrapper this machine
 * requires, exactly like apps/control-plane/scripts/db.sh.
 */
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { CANDIDATE_SERVICE_NAME, PORTS, PROBE_MASTERCARD, PROBE_VISA } from "./constants.js"

export function docker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sg", ["docker", "-c", `docker ${args.join(" ")}`], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let errOut = ""
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      errOut += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`docker ${args[0]} failed (${code}): ${errOut.trim()} | cmd: docker ${args.join(" ")}`))
        return
      }
      resolve(out)
    })
  })
}

/** Raw prometheus query via the HTTP API; returns {value, timestamp}. */
export async function prometheusInstant(query: string): Promise<{ value: number; at: string }> {
  const url = new URL(`http://127.0.0.1:${PORTS.prometheus}/api/v1/query`)
  url.searchParams.set("query", query)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`prometheus query failed: ${response.status} ${await response.text()}`)
  }
  const body = (await response.json()) as {
    status: string
    data: { resultType: string; result: Array<{ value: [number, string] }> }
  }
  if (body.status !== "success" || body.data.result.length === 0) {
    throw new Error(`prometheus query empty: ${query}`)
  }
  const [epoch, valueText] = body.data.result[0]?.value ?? [0, "0"]
  const value = Number(valueText)
  if (!Number.isFinite(value)) {
    throw new Error(`prometheus value not finite: ${valueText}`)
  }
  return { value, at: new Date(Number(epoch) * 1000).toISOString() }
}

/** Query with a bounded window via the HTTP range API; null when no data. */
export async function prometheusRange(
  query: string,
  startsAt: Date,
  endsAt: Date,
): Promise<{ value: number; at: string } | null> {
  const url = new URL(`http://127.0.0.1:${PORTS.prometheus}/api/v1/query`)
  url.searchParams.set("query", query)
  url.searchParams.set("time", String(Math.floor(endsAt.getTime() / 1000)))
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = (await response.json()) as {
    status: string
    data: { result: Array<{ value: [number, string] }> }
  }
  if (body.status !== "success" || body.data.result.length === 0) return null
  const [epoch, valueText] = body.data.result[0]?.value ?? [0, "0"]
  return { value: Number(valueText), at: new Date(Number(epoch) * 1000).toISOString() }
}

export const ERROR_RATIO_QUERY =
  '(sum(rate(traces_span_metrics_calls_total{service_name="payment",status_code="STATUS_CODE_ERROR"}[2m])) or vector(0)) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m])), 0.001)'

export const CANDIDATE_ERROR_RATIO_QUERY =
  `(sum(rate(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}",status_code="STATUS_CODE_ERROR"}[2m])) or vector(0)) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}"}[2m])), 0.001)`

export const CANDIDATE_CALLS_QUERY =
  `sum(traces_span_metrics_calls_total{service_name="${CANDIDATE_SERVICE_NAME}"})`

export const CALLS_QUERY =
  'sum(rate(traces_span_metrics_calls_total{service_name="payment"}[2m]))'

export const LATENCY_P95_QUERY =
  'histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="payment"}[2m])) by (le)) / 1000'

export const CANDIDATE_LATENCY_P95_QUERY =
  `histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${CANDIDATE_SERVICE_NAME}"}[2m])) by (le)) / 1000`

/** Live charge error ratio for the payment service (null when no data). */
export async function liveErrorRatio(): Promise<number | null> {
  const row = await prometheusRange(ERROR_RATIO_QUERY, new Date(Date.now() - 300_000), new Date())
  return row === null ? null : row.value
}

/** Candidate-cohort charge error ratio (null when no candidate data). */
export async function candidateErrorRatio(): Promise<number | null> {
  const row = await prometheusRange(CANDIDATE_ERROR_RATIO_QUERY, new Date(Date.now() - 300_000), new Date())
  return row === null ? null : row.value
}

/** Calls per second on the live payment service. */
export async function liveCallsPerSecond(): Promise<number | null> {
  const row = await prometheusRange(CALLS_QUERY, new Date(Date.now() - 300_000), new Date())
  return row === null ? null : row.value
}

/** Candidate-cohort span count in the last 30s. */
export async function candidateSpanCount(): Promise<number | null> {
  const row = await prometheusRange(CANDIDATE_CALLS_QUERY, new Date(Date.now() - 300_000), new Date())
  return row === null ? null : row.value
}

export async function latencyP95(cohort: "live" | "candidate"): Promise<number | null> {
  const row = await prometheusRange(
    cohort === "live" ? LATENCY_P95_QUERY : CANDIDATE_LATENCY_P95_QUERY,
    new Date(Date.now() - 300_000),
    new Date(),
  )
  return row === null ? null : row.value
}

/**
 * The real flagd evaluation for a flag key. flagd v0.16 serves OFREP over
 * gRPC only, so the demo's mounted flag file is the source of truth; the
 * payment service evaluates the same file through its OFREP client.
 */
export async function flagdValue(
  flagKey: string,
  demoRepo: string,
): Promise<{ key: string; value: unknown }> {
  const flagsFile = `${demoRepo}/src/flagd/demo.flagd.json`
  const body = JSON.parse(await readFile(flagsFile, "utf8")) as {
    flags?: Record<string, { defaultVariant?: string }>
  }
  const flag = body.flags?.[flagKey]
  return { key: flagKey, value: flag?.defaultVariant ?? null }
}

/** The running payment container's image id (the live service version). */
export async function paymentContainerImageId(container: string): Promise<string> {
  const out = await docker(["inspect", container, "--format", "{{.Image}}"])
  const id = out.trim()
  if (id.length === 0) {
    throw new Error(`docker inspect ${container} returned no image id`)
  }
  return id
}

export async function containerRunning(container: string): Promise<boolean> {
  try {
    const out = await docker(["inspect", container, "--format", "{{.State.Running}}"])
    return out.trim() === "true"
  } catch {
    return false
  }
}

/** The payment container's gRPC health: grpc-js-health-check SERVING flag. */
export async function paymentHealthcheck(container: string): Promise<boolean> {
  try {
    const out = await docker(["inspect", container, "--format", "{{.State.Health.Status}}"])
    return out.trim() === "healthy"
  } catch {
    return false
  }
}

/** Poll the firing/resolved AstronomyShopPaymentErrorRate alert. */
export interface LiveAlert {
  fingerprint: string
  status: "firing" | "resolved"
  startsAt: string
  endsAt: string | null
  labels: Record<string, string>
  annotations: Record<string, string>
}

/** The Alertmanager v2 wire shape (status is nested under `status.state`). */
interface AlertmanagerAlert {
  fingerprint?: string
  status?: { state?: string }
  startsAt?: string
  endsAt?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

export async function pollAlert(
  status: "firing" | "resolved",
  timeoutMs: number,
): Promise<LiveAlert | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORTS.alertmanager}/api/v2/alerts`)
      if (response.ok) {
        const alerts = (await response.json()) as AlertmanagerAlert[]
        const match = alerts.find(
          (alert) =>
            alert.status?.state === (status === "firing" ? "active" : "resolved") &&
            alert.labels?.detector_key === "payment-error-rate" &&
            alert.labels?.service_name === "payment",
        )
        if (match !== undefined) {
          return {
            fingerprint: match.fingerprint ?? "",
            status,
            startsAt: match.startsAt ?? "",
            endsAt: match.endsAt ?? null,
            labels: match.labels ?? {},
            annotations: match.annotations ?? {},
          }
        }
      }
    } catch {
      // Alertmanager not ready yet.
    }
    if (Date.now() > deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

/**
 * Wait until the payment-error-rate alert is no longer active in
 * Alertmanager (its resolved state disappears from the v2 API). Returns a
 * resolved LiveAlert built from the last observed firing alert.
 */
/** Whether the payment-error-rate alert is currently firing in Prometheus. */
export async function isAlertFiring(): Promise<boolean> {
  const response = await fetch(
    `http://127.0.0.1:${PORTS.prometheus}/api/v1/query?query=${encodeURIComponent(
      'ALERTS{alertname="AstronomyShopPaymentErrorRate"}',
    )}`,
  )
  if (!response.ok) return false
  const body = (await response.json()) as {
    data?: { result?: Array<{ metric?: { alertstate?: string } }> }
  }
  return (body.data?.result ?? []).some(
    (series) => series.metric?.alertstate === "firing",
  )
}

export async function waitForResolution(
  timeoutMs: number,
): Promise<LiveAlert | null> {
  const deadline = Date.now() + timeoutMs
  let lastFiring: LiveAlert | null = null
  let prometheusFiring = false
  const prometheusAlertFiring = async (): Promise<boolean> => {
    const response = await fetch(
      `http://127.0.0.1:${PORTS.prometheus}/api/v1/query?query=${encodeURIComponent(
        'ALERTS{alertname="AstronomyShopPaymentErrorRate"}',
      )}`,
    )
    if (!response.ok) return false
    const body = (await response.json()) as {
      data?: { result?: Array<{ metric?: { alertstate?: string } }> }
    }
    return (body.data?.result ?? []).some(
      (series) => series.metric?.alertstate === "firing",
    )
  }
  for (;;) {
    try {
      prometheusFiring = await prometheusAlertFiring()
      const response = await fetch(`http://127.0.0.1:${PORTS.alertmanager}/api/v2/alerts`)
      if (response.ok) {
        const alerts = (await response.json()) as AlertmanagerAlert[]
        const active = alerts.find(
          (alert) =>
            alert.status?.state === "active" &&
            alert.labels?.detector_key === "payment-error-rate" &&
            alert.labels?.service_name === "payment",
        )
        if (active !== undefined) {
          lastFiring = {
            fingerprint: active.fingerprint ?? "",
            status: "firing",
            startsAt: active.startsAt ?? "",
            endsAt: active.endsAt ?? null,
            labels: active.labels ?? {},
            annotations: active.annotations ?? {},
          }
        }
      }
    } catch {
      // Backends not ready yet.
    }
    if (Date.now() % 30_000 < 5_000) {
      console.log(
        `[shop] resolution poll: promFiring=${prometheusFiring} amActive=${lastFiring !== null} deadlineInMs=${deadline - Date.now()}`,
      )
    }
    if (!prometheusFiring && lastFiring !== null) {
      return { ...lastFiring, status: "resolved", endsAt: new Date().toISOString() }
    }
    if (Date.now() > deadline) {
      return null
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

/** Run the gRPC charge probe (scripts/probe.ts): N valid charges, assert ok. */
export interface ProbeOutcome {
  total: number
  ok: number
  err: number
  target: string
  card: string
  startedAt: string
  finishedAt: string
}

export async function runProbe(
  targetPort: number,
  count: number,
  card: string = PROBE_VISA,
): Promise<ProbeOutcome> {
  const script = join(import.meta.dir, "../scripts/probe.ts")
  const child = spawn("bun", [script, String(targetPort), String(count), card], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  let out = ""
  let errOut = ""
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString()
  })
  child.stderr.on("data", (chunk: Buffer) => {
    errOut += chunk.toString()
  })
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
  if (code !== 0) {
    throw new Error(`probe failed (${code}): ${errOut}`)
  }
  const parsed = JSON.parse(out.trim()) as ProbeOutcome
  return parsed
}

/** Start the continuous charge traffic driver; returns the child handle. */
export function startTrafficDriver(targetPort: number, rps: number, logFile: string) {
  const script = join(import.meta.dir, "../scripts/traffic.ts")
  const child = spawn("bun", [script, String(targetPort), String(rps), logFile], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  })
  return child
}

/** Read the driver's JSONL rows (ts, sent, ok, err). */
export async function driverRows(logFile: string): Promise<Array<{ ts: string; sent: number; ok: number; err: number }>> {
  try {
    const text = await readFile(logFile, "utf8")
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { ts: string; sent: number; ok: number; err: number })
  } catch {
    return []
  }
}

/** A windowed error-rate sample from the driver's real rows. */
export function driverErrorRate(
  rows: Array<{ ts: string; sent: number; ok: number; err: number }>,
  startsAt: Date,
  endsAt: Date,
): { value: number; sample_count: number } {
  const inWindow = rows.filter((row) => {
    const at = Date.parse(row.ts)
    return at >= startsAt.getTime() && at < endsAt.getTime()
  })
  if (inWindow.length === 0) {
    return { value: 0, sample_count: 0 }
  }
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  if (first === undefined || last === undefined) {
    return { value: 0, sample_count: 0 }
  }
  const calls = last.sent - first.sent
  return {
    value: calls <= 0 ? 0 : (last.err - first.err) / calls,
    sample_count: calls,
  }
}

/** A probe with the Mastercard fixture (T4 contract second leg). */
export function probeCards(): string[] {
  return [PROBE_VISA, PROBE_MASTERCARD]
}
