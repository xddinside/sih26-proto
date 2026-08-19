/**
 * Frozen Evidence Set loader for operator and automated rehearsals.
 *
 * A rehearsal reads one already-saved, content-addressed Evidence Set after
 * verifying the complete bundle. It never calls a signal adapter and never
 * rebuilds an Evidence Set from live rows. The selected revision is frozen in
 * memory before it is handed to the driver.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { contentHash } from "@sih/contracts/hashes"
import type { HashString } from "@sih/contracts/hashes"
import { validate } from "@sih/contracts/parse"
import { verifySavedBundle } from "@sih/contracts/saved-bundle"
import type {
  ArtifactEnvelope,
  EvidenceItem,
  EvidenceSet,
  IncidentBrief,
  IncidentTrigger,
} from "@sih/contracts/types"

import { SAVED_INCIDENT_1, SAVED_INCIDENT_2 } from "./constants.js"
import { listBundle, savedRunsRoot } from "./export.js"
import type { CaptureFacts, EvidenceIds } from "./payloads.js"

export interface FrozenRehearsalEvidence {
  scenario: 1 | 2
  sourceIncidentId: string
  trigger: IncidentTrigger
  resolvedTrigger: IncidentTrigger | null
  incidentBrief: IncidentBrief
  evidenceSet: EvidenceSet
  evidenceIds: EvidenceIds
  facts: CaptureFacts
  sourceArtifactHash: HashString
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function asHash(value: string): HashString {
  return value as HashString
}

function oneItem(items: readonly EvidenceItem[], kind: EvidenceItem["kind"]): EvidenceItem {
  const item = items.find((candidate) => candidate.kind === kind)
  if (item === undefined) throw new Error(`frozen Evidence Set is missing ${kind}`)
  return item
}

function metricItems(items: readonly EvidenceItem[]): EvidenceItem[] {
  return items.filter((candidate) => candidate.kind === "metric")
}

function snapshotNumber(item: EvidenceItem, key: string, fallback: number): number {
  const value = (item.snapshot as Record<string, unknown>)[key]
  return typeof value === "number" ? value : fallback
}

function factsFromEvidence(scenario: 1 | 2, evidence: EvidenceSet): CaptureFacts {
  const metrics = metricItems(evidence.items)
  const firing = metrics.find((item) => snapshotNumber(item, "value", 0) >= 0.2) ?? metrics[0]
  const baseline = metrics.find((item) => item !== firing && snapshotNumber(item, "value", 0) < 0.2) ?? metrics[1] ?? firing
  if (firing === undefined || baseline === undefined) throw new Error("frozen Evidence Set has no metric pair")
  const trace = oneItem(evidence.items, "trace")
  const log = oneItem(evidence.items, "log")
  const deployment = oneItem(evidence.items, "deployment-event")
  const flags = evidence.items.filter((item) => item.backend === "flagd")
  const failureFlag = flags.find((item) => (item.identity as Record<string, unknown>).flag_key === "paymentFailure")
  const unreachableFlag = flags.find((item) => (item.identity as Record<string, unknown>).flag_key === "paymentUnreachable")
  const logSnapshot = log.snapshot as Record<string, unknown>
  const traceIdentity = trace.identity as Record<string, unknown>
  const deploymentIdentity = deployment.identity as Record<string, unknown>
  const deploymentSnapshot = deployment.snapshot as Record<string, unknown>
  const firingIdentity = firing.identity as Record<string, unknown>
  const firingWindow = (firingIdentity.window ?? {}) as Record<string, unknown>

  return {
    seed: scenario === 1 ? "S1" : "S2",
    firingRatio: snapshotNumber(firing, "value", 1),
    firingCallsPerSecond: snapshotNumber(firing, "total_calls_per_second", 1),
    baselineRatio: snapshotNumber(baseline, "value", 0),
    baselineCallsPerSecond: snapshotNumber(baseline, "total_calls_per_second", 1),
    seededImageId: String((firing.joins as Record<string, unknown>).service_version ?? deploymentIdentity.after_version ?? "frozen-seeded"),
    baselineImageId: String((baseline.joins as Record<string, unknown>).service_version ?? deploymentIdentity.before_version ?? "frozen-baseline"),
    windowStart: String(firingWindow.starts_at ?? firing.observed_at),
    seedAppliedAt: String(deploymentIdentity.applied_at ?? deployment.observed_at),
    logLine: String(logSnapshot.msg ?? "frozen log snapshot"),
    traceId: typeof traceIdentity.trace_id === "string" ? traceIdentity.trace_id : null,
    spanId: typeof traceIdentity.span_id === "string" ? traceIdentity.span_id : null,
    paymentFailure: snapshotNumber(failureFlag ?? firing, "paymentFailure", 0),
    paymentUnreachable: Boolean((unreachableFlag?.snapshot as Record<string, unknown> | undefined)?.paymentUnreachable ?? false),
    seededT3: { passed: false, output: "frozen Evidence Set has no live T3 capture" },
    seedDiffHash: asHash(String(deploymentIdentity.diff_hash ?? deploymentSnapshot.diff_hash)),
  }
}

function evidenceIds(evidence: EvidenceSet): EvidenceIds {
  const byKind = (kind: EvidenceItem["kind"]): HashString => asHash(oneItem(evidence.items, kind).id)
  return {
    metricId: byKind("metric"),
    traceId: byKind("trace"),
    logId: byKind("log"),
    deploymentId: byKind("deployment-event"),
    flagFailureId: asHash(evidence.items.find((item) => (item.identity as Record<string, unknown>).flag_key === "paymentFailure")?.id ?? byKind("metric")),
    flagUnreachableId: asHash(evidence.items.find((item) => (item.identity as Record<string, unknown>).flag_key === "paymentUnreachable")?.id ?? byKind("metric")),
    codeLocationId: byKind("code-location"),
    baselineId: asHash(metricItems(evidence.items).at(-1)?.id ?? byKind("metric")),
    items: evidence.items,
  }
}

/** Load and freeze the immutable base Evidence Set for one saved scenario. */
export async function loadFrozenEvidenceSet(
  scenario: 1 | 2,
  options: { root?: string; evaluationTime?: string } = {},
): Promise<FrozenRehearsalEvidence> {
  const root = options.root ?? savedRunsRoot()
  const paths = await listBundle(root)
  const files = new Map<string, string>()
  for (const path of paths) files.set(path, await readFile(join(root, path), "utf8"))
  const verified = verifySavedBundle(
    { files },
    { evaluationTime: options.evaluationTime ?? new Date().toISOString() },
  )
  if (!verified.ok) {
    throw new Error(`saved Evidence Set bundle failed verification: ${verified.error.map((error) => error.message).join("; ")}`)
  }
  const sourceIncidentId = scenario === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
  const incident = verified.value.incidents.find((candidate) => candidate.incidentId === sourceIncidentId)
  if (incident === undefined) throw new Error(`saved bundle has no scenario ${scenario} incident`)
  const triggerEvent = incident.events.find((event) => event.type === "trigger_received")
  if (triggerEvent === undefined || triggerEvent.type !== "trigger_received") throw new Error(`scenario ${scenario} has no saved trigger`)
  const resolvedEvent = [...incident.events].reverse().find(
    (event) => event.type === "trigger_received" && event.trigger.state === "resolved",
  )

  const evidenceEntry = [...verified.value.artifacts.entries()].find(([, envelope]) =>
    envelope.incident_id === sourceIncidentId &&
    envelope.artifact_schema_id === "evidence-set" &&
    (envelope.payload as { revision_number?: number }).revision_number === 1,
  )
  if (evidenceEntry === undefined) throw new Error(`scenario ${scenario} has no immutable base Evidence Set`)
  const [sourceArtifactHash, envelope] = evidenceEntry
  const parsed = validate("evidence-set", "1.0", envelope.payload)
  if (!parsed.ok) throw new Error(`saved Evidence Set is malformed: ${parsed.error.message}`)
  const hash = contentHash(envelope.payload as never)
  if (!hash.ok || hash.value !== sourceArtifactHash) throw new Error(`saved Evidence Set hash does not match ${sourceArtifactHash}`)
  const evidence = deepFreeze(parsed.value as unknown as EvidenceSet)

  const briefEnvelope = [...verified.value.artifacts.values()].find((candidate) =>
    candidate.incident_id === sourceIncidentId && candidate.artifact_schema_id === "incident-brief",
  )
  if (briefEnvelope === undefined) throw new Error(`scenario ${scenario} has no saved Incident Brief`)
  const brief = deepFreeze(briefEnvelope.payload as unknown as IncidentBrief)
  const trigger = deepFreeze(JSON.parse(JSON.stringify(triggerEvent.trigger)) as IncidentTrigger)
  return deepFreeze({
    scenario,
    sourceIncidentId,
    trigger,
    resolvedTrigger: resolvedEvent?.type === "trigger_received"
      ? deepFreeze(JSON.parse(JSON.stringify(resolvedEvent.trigger)) as IncidentTrigger)
      : null,
    incidentBrief: brief,
    evidenceSet: evidence,
    evidenceIds: evidenceIds(evidence),
    facts: factsFromEvidence(scenario, evidence),
    sourceArtifactHash: asHash(sourceArtifactHash),
  })
}
