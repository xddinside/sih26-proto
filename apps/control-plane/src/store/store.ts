/**
 * PostgreSQL store: journal, delivery-key dedup, leases, permits, approvals,
 * policy versions, artifacts, and the derived incident index. The journal is
 * the source of truth; everything else is an index or an enforcement record.
 * All writes use single statements with unique constraints so replays and
 * retries stay idempotent at the database level.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"

import type { JournalEvent } from "@sih/contracts/types"

import type { Config } from "../config.js"
import { err, ok, ERR    } from "../result.js"
import type {DomainError, Result} from "../result.js";

export type Sql = ReturnType<typeof postgres>

type PgJson = Parameters<Sql["json"]>[0]
function toJson(value: unknown): PgJson {
  return value as PgJson
}

export interface JournalRow {
  incident_id: string
  sequence: number
  idempotency_key: string
  recorded_at: string
  event: JournalEvent
}

export interface LeaseRow {
  lease_id: string
  kind: "run" | "release"
  incident_id: string
  run_id: string | null
  attempt: number | null
  stage: string | null
  actor_id: string
  actor_kind: string
  authority_mode: string
  policy_version: string
  tool_class: string
  issued_at: string
  expires_at: string
  revoked_at: string | null
  token_hash: string
}

export interface PermitRow {
  permit_id: string
  kind: "release" | "approval"
  incident_id: string
  run_id: string | null
  attempt: number | null
  candidate_hash: string
  target: string
  action_digest: string
  issued_at: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  token_hash: string
}

export interface ApprovalRow {
  approval_id: string
  incident_id: string
  run_id: string | null
  action_digest: string
  approver_identity: string
  approval_system: string
  policy_version: string
  tzdb_version: string
  action_risk_class: "safe" | "guarded"
  expiry: string
  scope: Record<string, unknown> | null
  granted_at: string
  consumed_at: string | null
  revoked_at: string | null
}

export interface PolicyRow {
  version: string
  incident_id: string
  authority_mode: string
  automation_policy: string
  schedule: Record<string, unknown> | null
  emergency_override: boolean
  attempt_limit: number
  created_at: string
}

export interface ArtifactRow {
  content_hash: string
  schema_id: string
  schema_version: string
  incident_id: string
  run_id: string | null
  sealed_at: string
  bytes: Uint8Array
}

export interface IncidentIndexRow {
  incident_id: string
  incident_key: string
  state: string
  detector_state: string
  severity: string
  scope: Record<string, unknown>
  attempt_limit: number
  attempts_used: number
  version: number
  created_at: string
  updated_at: string
  closure_reason: string | null
  open_run_id: string | null
  related_incident_ids: string[]
}

function parseIso(value: unknown): string | null {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return null
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function parseJson(value: unknown): JsonValue | null {
  return value === null || value === undefined ? null : (value as JsonValue)
}

function timestampOf(row: { [key: string]: unknown }, key: string): string | null {
  const value = row[key]
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return null
}

/** Open the store and apply the schema. Call once at boot. */
export async function openStore(config: Config): Promise<Store> {
  const sql = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  })
  const initPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "init.sql")
  const initSql = readFileSync(initPath, "utf8")
  await sql.unsafe(initSql)
  return new Store(sql)
}

export class Store {
  readonly sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
  }

  async close(): Promise<void> {
    await this.sql.end()
  }

  /** Reset all data for tests. Never used by the running service. */
  async reset(): Promise<void> {
    await this.sql.unsafe("truncate journal, delivery_keys, leases, permits, approvals, policy, artifacts, incident_index")
  }

  // ------------------------------------------------------------------
  // Journal

  /**
   * Append one event to an Incident's journal. Returns `ok(true)` on append,
   * a `DUPLICATE` when the idempotency key already exists, and a `CONFLICT`
   * when the sequence slot is taken by a different key.
   */
  async appendJournalEvent(incidentId: string, event: JournalEvent): Promise<Result<true, DomainError>> {
    try {
      await this.sql`
        insert into journal (incident_id, sequence, idempotency_key, recorded_at, event)
        values (${incidentId}, ${event.sequence}, ${event.idempotency_key},
                ${event.recorded_at}, ${this.sql.json(event)})`
      return ok(true)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.includes("idempotency_key")) {
        return err({ code: ERR.DUPLICATE, message: `idempotency key ${event.idempotency_key} already applied` })
      }
      if (message.includes("journal_pkey")) {
        return err({
          code: ERR.CONFLICT,
          message: `sequence ${event.sequence} already taken for incident ${incidentId}`,
        })
      }
      throw cause
    }
  }

  async loadJournal(incidentId: string): Promise<JournalRow[]> {
    const rows = await this.sql`
      select incident_id, sequence, idempotency_key, recorded_at, event
      from journal where incident_id = ${incidentId} order by sequence asc`
    return rows.map((row) => ({
      incident_id: row.incident_id as string,
      sequence: row.sequence as number,
      idempotency_key: row.idempotency_key as string,
      recorded_at: timestampOf(row, "recorded_at") ?? "",
      event: row.event as JournalEvent,
    }))
  }

  async allIncidentIds(): Promise<string[]> {
    const rows = await this.sql`select distinct incident_id from journal order by incident_id asc`
    return rows.map((row) => row.incident_id as string)
  }

  async journalTail(incidentId: string, limit: number): Promise<JournalRow[]> {
    const rows = await this.sql`
      select incident_id, sequence, idempotency_key, recorded_at, event from journal
      where incident_id = ${incidentId} order by sequence desc limit ${limit}`
    return rows
      .map((row) => ({
        incident_id: row.incident_id as string,
        sequence: row.sequence as number,
        idempotency_key: row.idempotency_key as string,
        recorded_at: timestampOf(row, "recorded_at") ?? "",
        event: row.event as JournalEvent,
      }))
      .reverse()
  }

  // ------------------------------------------------------------------
  // Delivery-key dedup

  /** Claim a delivery key. False when it was already seen: the delivery is a no-op. */
  async claimDeliveryKey(deliveryKey: string, incidentId: string): Promise<boolean> {
    const result = await this.sql`
      insert into delivery_keys (delivery_key, incident_id, recorded_at)
      values (${deliveryKey}, ${incidentId}, now())
      on conflict (delivery_key) do nothing
      returning delivery_key`
    return result.length === 1
  }

  // ------------------------------------------------------------------
  // Leases

  async insertLease(lease: LeaseRow): Promise<void> {
    await this.sql`
      insert into leases (lease_id, kind, incident_id, run_id, attempt, stage,
        actor_id, actor_kind, authority_mode, policy_version, tool_class,
        issued_at, expires_at, revoked_at, token_hash)
      values (${lease.lease_id}, ${lease.kind}, ${lease.incident_id}, ${lease.run_id},
        ${lease.attempt}, ${lease.stage}, ${lease.actor_id}, ${lease.actor_kind},
        ${lease.authority_mode}, ${lease.policy_version}, ${lease.tool_class},
        ${lease.issued_at}, ${lease.expires_at}, ${lease.revoked_at}, ${lease.token_hash})`
  }

  async getLease(leaseId: string): Promise<LeaseRow | null> {
    const rows = await this.sql`
      select * from leases where lease_id = ${leaseId} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return leaseRow(row)
  }

  async renewLease(leaseId: string, expiresAt: string): Promise<boolean> {
    const rows = await this.sql`
      update leases set expires_at = ${expiresAt}
      where lease_id = ${leaseId} and revoked_at is null and expires_at > now()
      returning lease_id`
    return rows.length === 1
  }

  async revokeLease(leaseId: string): Promise<void> {
    await this.sql`
      update leases set revoked_at = now()
      where lease_id = ${leaseId} and revoked_at is null`
  }

  async revokeRunLeases(incidentId: string, runId: string): Promise<void> {
    await this.sql`
      update leases set revoked_at = now()
      where incident_id = ${incidentId} and run_id = ${runId} and revoked_at is null`
  }

  async revokeReleaseLeases(incidentId: string): Promise<void> {
    await this.sql`
      update leases set revoked_at = now()
      where incident_id = ${incidentId} and kind = 'release' and revoked_at is null`
  }

  async findRunLeases(incidentId: string, runId: string): Promise<LeaseRow[]> {
    const rows = await this.sql`
      select * from leases
      where incident_id = ${incidentId} and run_id = ${runId} and kind = 'run'
      order by issued_at asc`
    return rows.map(leaseRow)
  }

  async markExpiredLeases(nowIso: string): Promise<number> {
    const rows = await this.sql`
      update leases set revoked_at = ${nowIso}
      where revoked_at is null and expires_at <= ${nowIso}
      returning lease_id`
    return rows.length
  }

  // ------------------------------------------------------------------
  // Permits (one-use)

  async insertPermit(permit: PermitRow): Promise<void> {
    await this.sql`
      insert into permits (permit_id, kind, incident_id, run_id, attempt,
        candidate_hash, target, action_digest, issued_at, expires_at,
        consumed_at, revoked_at, token_hash)
      values (${permit.permit_id}, ${permit.kind}, ${permit.incident_id}, ${permit.run_id},
        ${permit.attempt}, ${permit.candidate_hash}, ${permit.target},
        ${permit.action_digest}, ${permit.issued_at}, ${permit.expires_at},
        ${permit.consumed_at}, ${permit.revoked_at}, ${permit.token_hash})`
  }

  async getPermit(permitId: string): Promise<PermitRow | null> {
    const rows = await this.sql`select * from permits where permit_id = ${permitId} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return permitRow(row)
  }

  /**
   * Consume a permit once, atomically. Returns the permit row on success and
   * null when the permit is already consumed, revoked, or expired.
   */
  async consumePermit(permitId: string, nowIso: string): Promise<PermitRow | null> {
    const rows = await this.sql`
      update permits set consumed_at = ${nowIso}
      where permit_id = ${permitId} and consumed_at is null and revoked_at is null
        and expires_at > ${nowIso}
      returning *`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return permitRow(row)
  }

  async revokePermits(incidentId: string, runId: string): Promise<void> {
    await this.sql`
      update permits set revoked_at = now()
      where incident_id = ${incidentId} and run_id = ${runId} and consumed_at is null
        and revoked_at is null`
  }

  // ------------------------------------------------------------------
  // Approvals

  async insertApproval(approval: ApprovalRow): Promise<void> {
    await this.sql`
      insert into approvals (approval_id, incident_id, run_id, action_digest,
        approver_identity, approval_system, policy_version, tzdb_version,
        action_risk_class, expiry, scope, granted_at, consumed_at, revoked_at)
      values (${approval.approval_id}, ${approval.incident_id}, ${approval.run_id},
        ${approval.action_digest}, ${approval.approver_identity},
        ${approval.approval_system}, ${approval.policy_version},
        ${approval.tzdb_version}, ${approval.action_risk_class}, ${approval.expiry},
        ${approval.scope === null ? null : this.sql.json(toJson(approval.scope))},
        ${approval.granted_at}, ${approval.consumed_at}, ${approval.revoked_at})`
  }

  async getApproval(approvalId: string): Promise<ApprovalRow | null> {
    const rows = await this.sql`
      select * from approvals where approval_id = ${approvalId} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return approvalRow(row)
  }

  async findApprovals(incidentId: string): Promise<ApprovalRow[]> {
    const rows = await this.sql`
      select * from approvals where incident_id = ${incidentId} order by granted_at asc`
    return rows.map(approvalRow)
  }

  /** Consume an approval once, atomically. */
  async consumeApproval(approvalId: string, nowIso: string): Promise<ApprovalRow | null> {
    const rows = await this.sql`
      update approvals set consumed_at = ${nowIso}
      where approval_id = ${approvalId} and consumed_at is null and revoked_at is null
        and expiry > ${nowIso}
      returning *`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return approvalRow(row)
  }

  async revokeApprovals(incidentId: string): Promise<void> {
    await this.sql`
      update approvals set revoked_at = now()
      where incident_id = ${incidentId} and consumed_at is null and revoked_at is null`
  }

  // ------------------------------------------------------------------
  // Policy versions

  async insertPolicy(policy: PolicyRow): Promise<void> {
    await this.sql`
      insert into policy (version, incident_id, authority_mode, automation_policy,
        schedule, emergency_override, attempt_limit, created_at)
      values (${policy.version}, ${policy.incident_id}, ${policy.authority_mode},
        ${policy.automation_policy},
        ${policy.schedule === null ? null : this.sql.json(toJson(policy.schedule))},
        ${policy.emergency_override}, ${policy.attempt_limit}, ${policy.created_at})`
  }

  async getPolicy(version: string): Promise<PolicyRow | null> {
    const rows = await this.sql`select * from policy where version = ${version} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return policyRow(row)
  }

  async latestPolicy(incidentId: string): Promise<PolicyRow | null> {
    const rows = await this.sql`
      select * from policy where incident_id = ${incidentId}
      order by created_at desc limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return policyRow(row)
  }

  // ------------------------------------------------------------------
  // Artifacts (content-addressed sealed envelopes)

  async putArtifact(artifact: ArtifactRow): Promise<Result<true, DomainError>> {
    const existing = await this.getArtifact(artifact.content_hash)
    if (existing !== null) {
      if (existing.bytes.length !== artifact.bytes.length) {
        return err({ code: ERR.CONFLICT, message: `hash collision on ${artifact.content_hash}` })
      }
      return ok(true)
    }
    await this.sql`
      insert into artifacts (content_hash, schema_id, schema_version, incident_id,
        run_id, sealed_at, bytes)
      values (${artifact.content_hash}, ${artifact.schema_id}, ${artifact.schema_version},
        ${artifact.incident_id}, ${artifact.run_id}, ${artifact.sealed_at},
        ${artifact.bytes})`
    return ok(true)
  }

  async getArtifact(contentHash: string): Promise<ArtifactRow | null> {
    const rows = await this.sql`
      select content_hash, schema_id, schema_version, incident_id, run_id, sealed_at, bytes
      from artifacts where content_hash = ${contentHash} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return artifactRow(row)
  }

  // ------------------------------------------------------------------
  // Derived incident index (projection cache; rebuilt from the journal)

  async upsertIncidentIndex(index: IncidentIndexRow): Promise<void> {
    await this.sql`
      insert into incident_index (incident_id, incident_key, state, detector_state,
        severity, scope, attempt_limit, attempts_used, version, created_at,
        updated_at, closure_reason, open_run_id, related_incident_ids)
      values (${index.incident_id}, ${index.incident_key}, ${index.state},
        ${index.detector_state}, ${index.severity}, ${this.sql.json(toJson(index.scope))},
        ${index.attempt_limit}, ${index.attempts_used}, ${index.version},
        ${index.created_at}, ${index.updated_at}, ${index.closure_reason},
        ${index.open_run_id}, ${this.sql.json(toJson(index.related_incident_ids))})
      on conflict (incident_id) do update set
        incident_key = excluded.incident_key, state = excluded.state,
        detector_state = excluded.detector_state, severity = excluded.severity,
        scope = excluded.scope, attempt_limit = excluded.attempt_limit,
        attempts_used = excluded.attempts_used, version = excluded.version,
        updated_at = excluded.updated_at, closure_reason = excluded.closure_reason,
        open_run_id = excluded.open_run_id,
        related_incident_ids = excluded.related_incident_ids`
  }

  async getIncidentIndex(incidentId: string): Promise<IncidentIndexRow | null> {
    const rows = await this.sql`
      select * from incident_index where incident_id = ${incidentId} limit 1`
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return incidentIndexRow(row)
  }

  async findIncidentByKey(incidentKey: string): Promise<IncidentIndexRow[]> {
    const rows = await this.sql`
      select * from incident_index where incident_key = ${incidentKey}
      order by updated_at desc`
    return rows.map(incidentIndexRow)
  }

  async listIncidentIndex(): Promise<IncidentIndexRow[]> {
    const rows = await this.sql`
      select * from incident_index order by updated_at desc`
    return rows.map(incidentIndexRow)
  }

  async deleteIncidentIndex(incidentId: string): Promise<void> {
    await this.sql`delete from incident_index where incident_id = ${incidentId}`
  }
}

function leaseRow(row: Record<string, unknown>): LeaseRow {
  return {
    lease_id: row.lease_id as string,
    kind: row.kind as "run" | "release",
    incident_id: row.incident_id as string,
    run_id: (row.run_id as string | null) ?? null,
    attempt: (row.attempt as number | null) ?? null,
    stage: (row.stage as string | null) ?? null,
    actor_id: row.actor_id as string,
    actor_kind: row.actor_kind as string,
    authority_mode: row.authority_mode as string,
    policy_version: row.policy_version as string,
    tool_class: row.tool_class as string,
    issued_at: timestampOf(row, "issued_at") ?? "",
    expires_at: timestampOf(row, "expires_at") ?? "",
    revoked_at: parseIso(row.revoked_at),
    token_hash: row.token_hash as string,
  }
}

function permitRow(row: Record<string, unknown>): PermitRow {
  return {
    permit_id: row.permit_id as string,
    kind: row.kind as "release" | "approval",
    incident_id: row.incident_id as string,
    run_id: (row.run_id as string | null) ?? null,
    attempt: (row.attempt as number | null) ?? null,
    candidate_hash: row.candidate_hash as string,
    target: row.target as string,
    action_digest: row.action_digest as string,
    issued_at: timestampOf(row, "issued_at") ?? "",
    expires_at: timestampOf(row, "expires_at") ?? "",
    consumed_at: parseIso(row.consumed_at),
    revoked_at: parseIso(row.revoked_at),
    token_hash: row.token_hash as string,
  }
}

function approvalRow(row: Record<string, unknown>): ApprovalRow {
  return {
    approval_id: row.approval_id as string,
    incident_id: row.incident_id as string,
    run_id: (row.run_id as string | null) ?? null,
    action_digest: row.action_digest as string,
    approver_identity: row.approver_identity as string,
    approval_system: row.approval_system as string,
    policy_version: row.policy_version as string,
    tzdb_version: row.tzdb_version as string,
    action_risk_class: row.action_risk_class as "safe" | "guarded",
    expiry: timestampOf(row, "expiry") ?? "",
    scope: parseJson(row.scope) as Record<string, unknown> | null,
    granted_at: timestampOf(row, "granted_at") ?? "",
    consumed_at: parseIso(row.consumed_at),
    revoked_at: parseIso(row.revoked_at),
  }
}

function policyRow(row: Record<string, unknown>): PolicyRow {
  return {
    version: row.version as string,
    incident_id: row.incident_id as string,
    authority_mode: row.authority_mode as string,
    automation_policy: row.automation_policy as string,
    schedule: parseJson(row.schedule) as Record<string, unknown> | null,
    emergency_override: Boolean(row.emergency_override),
    attempt_limit: row.attempt_limit as number,
    created_at: timestampOf(row, "created_at") ?? "",
  }
}

function artifactRow(row: Record<string, unknown>): ArtifactRow {
  return {
    content_hash: row.content_hash as string,
    schema_id: row.schema_id as string,
    schema_version: row.schema_version as string,
    incident_id: row.incident_id as string,
    run_id: (row.run_id as string | null) ?? null,
    sealed_at: timestampOf(row, "sealed_at") ?? "",
    bytes: row.bytes as Uint8Array,
  }
}

function incidentIndexRow(row: Record<string, unknown>): IncidentIndexRow {
  return {
    incident_id: row.incident_id as string,
    incident_key: row.incident_key as string,
    state: row.state as string,
    detector_state: row.detector_state as string,
    severity: row.severity as string,
    scope: parseJson(row.scope) as Record<string, unknown>,
    attempt_limit: row.attempt_limit as number,
    attempts_used: row.attempts_used as number,
    version: row.version as number,
    created_at: timestampOf(row, "created_at") ?? "",
    updated_at: timestampOf(row, "updated_at") ?? "",
    closure_reason: parseIso(row.closure_reason),
    open_run_id: (row.open_run_id as string | null) ?? null,
    related_incident_ids: (parseJson(row.related_incident_ids) as string[] | null) ?? [],
  }
}
