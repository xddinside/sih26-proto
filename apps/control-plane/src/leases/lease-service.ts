/**
 * Leases and one-use permits from docs/research/orchestrator-stages.md and
 * docs/research/authority-action-risk.md.
 *
 * The run lease is Control Plane-signed, bound to company, Incident, attempt,
 * stage, Authority Mode, Automation Policy version, and expiry. The Worker
 * renews it by heartbeat; brokers check server-side state, not the lease's
 * own claims. The release permit is short-lived, one-use, and bound to the
 * candidate hash and target.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { Clock } from "../clock.js"
import { addSeconds } from "../clock.js"
import type { Config } from "../config.js"
import { err, ok, ERR    } from "../result.js"
import type {DomainError, Result} from "../result.js";
import type { LeaseRow, PermitRow, Store } from "../store/store.js"

export interface RunLeaseIssue {
  incidentId: string
  runId: string
  attempt: number
  stage: string
  actorId: string
  actorKind: string
  authorityMode: string
  policyVersion: string
  toolClass: string
}

export interface IssuedLease {
  leaseId: string
  token: string
  expiresAt: string
}

export interface LeaseClaims {
  leaseId: string
  incidentId: string
  runId: string
  attempt: number
  stage: string
  actorId: string
  actorKind: string
  toolClass: string
}

export interface PermitIssue {
  kind: "release" | "approval"
  incidentId: string
  runId: string
  attempt: number
  candidateHash: string
  target: string
  actionDigest: string
}

export interface IssuedPermit {
  permitId: string
  token: string
  expiresAt: string
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export class LeaseService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly config: Config,
  ) {}

  async issueRunLease(input: RunLeaseIssue): Promise<IssuedLease> {
    const leaseId = `run-lease-${randomBytes(12).toString("hex")}`
    const token = randomBytes(32).toString("hex")
    const issuedAt = this.clock.nowIso()
    const expiresAt = addSeconds(issuedAt, this.config.leaseTtlSeconds)
    const lease: LeaseRow = {
      lease_id: leaseId,
      kind: "run",
      incident_id: input.incidentId,
      run_id: input.runId,
      attempt: input.attempt,
      stage: input.stage,
      actor_id: input.actorId,
      actor_kind: input.actorKind,
      authority_mode: input.authorityMode,
      policy_version: input.policyVersion,
      tool_class: input.toolClass,
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
      token_hash: tokenHash(token),
    }
    await this.store.insertLease(lease)
    return { leaseId, token, expiresAt }
  }

  async issueReleaseLease(incidentId: string, target: string): Promise<IssuedLease> {
    const leaseId = `release-lease-${randomBytes(12).toString("hex")}`
    const token = randomBytes(32).toString("hex")
    const issuedAt = this.clock.nowIso()
    const expiresAt = addSeconds(issuedAt, this.config.leaseTtlSeconds)
    const lease: LeaseRow = {
      lease_id: leaseId,
      kind: "release",
      incident_id: incidentId,
      run_id: null,
      attempt: null,
      stage: null,
      actor_id: "control-plane",
      actor_kind: "control-plane",
      authority_mode: "",
      policy_version: "",
      tool_class: "release",
      issued_at: issuedAt,
      expires_at: expiresAt,
      revoked_at: null,
      token_hash: tokenHash(token),
    }
    await this.store.insertLease(lease)
    return { leaseId, token, expiresAt }
  }

  async issuePermit(input: PermitIssue): Promise<IssuedPermit> {
    const permitId = `${input.kind}-permit-${randomBytes(12).toString("hex")}`
    const token = randomBytes(32).toString("hex")
    const issuedAt = this.clock.nowIso()
    const expiresAt = addSeconds(issuedAt, this.config.permitTtlSeconds)
    const permit: PermitRow = {
      permit_id: permitId,
      kind: input.kind,
      incident_id: input.incidentId,
      run_id: input.runId,
      attempt: input.attempt,
      candidate_hash: input.candidateHash,
      target: input.target,
      action_digest: input.actionDigest,
      issued_at: issuedAt,
      expires_at: expiresAt,
      consumed_at: null,
      revoked_at: null,
      token_hash: tokenHash(token),
    }
    await this.store.insertPermit(permit)
    return { permitId, token, expiresAt }
  }

  /**
   * Verify a lease against server-side state plus the caller's claims. This is
   * what brokers call: an expired, revoked, or claim-mismatched lease fails
   * closed.
   */
  async verifyRunLease(
    token: string,
    claims: LeaseClaims,
    runState: string | null,
  ): Promise<Result<LeaseRow, DomainError>> {
    const lease = await this.store.getLease(claims.leaseId)
    if (lease === null) {
      return err({ code: ERR.NOT_FOUND, message: "lease not found" })
    }
    if (lease.revoked_at !== null) {
      return err({ code: ERR.REVOKED_LEASE, message: "lease revoked" })
    }
    if (Date.parse(lease.expires_at) <= this.clock.now().getTime()) {
      return err({ code: ERR.EXPIRED_LEASE, message: "lease expired" })
    }
    if (!timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(lease.token_hash, "hex"))) {
      return err({ code: ERR.UNAUTHORIZED, message: "lease token mismatch" })
    }
    if (
      lease.incident_id !== claims.incidentId ||
      lease.run_id !== claims.runId ||
      lease.attempt !== claims.attempt ||
      lease.stage !== claims.stage ||
      lease.actor_id !== claims.actorId ||
      lease.actor_kind !== claims.actorKind ||
      lease.tool_class !== claims.toolClass
    ) {
      return err({ code: ERR.FORGED_STAGE, message: "lease claims do not match the server-side lease" })
    }
    if (runState !== null && runState !== "running") {
      return err({ code: ERR.STALE_LEASE, message: `run is ${runState}, not running` })
    }
    return ok(lease)
  }

  async heartbeat(leaseId: string, token: string): Promise<Result<true, DomainError>> {
    const lease = await this.store.getLease(leaseId)
    if (lease === null) {
      return err({ code: ERR.NOT_FOUND, message: "lease not found" })
    }
    if (lease.revoked_at !== null) {
      return err({ code: ERR.REVOKED_LEASE, message: "lease revoked" })
    }
    if (!timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(lease.token_hash, "hex"))) {
      return err({ code: ERR.UNAUTHORIZED, message: "lease token mismatch" })
    }
    const renewed = await this.store.renewLease(leaseId, addSeconds(this.clock.nowIso(), this.config.leaseTtlSeconds))
    if (!renewed) {
      return err({ code: ERR.EXPIRED_LEASE, message: "lease already expired" })
    }
    return ok(true)
  }

  async revokeRunLeases(incidentId: string, runId: string): Promise<void> {
    await this.store.revokeRunLeases(incidentId, runId)
  }

  /**
   * Consume a one-use permit. Reuse fails closed: the second consumer gets a
   * PERMIT_USED error.
   */
  async consumePermit(
    permitId: string,
    token: string,
    expected: { candidateHash: string; target: string; incidentId: string },
  ): Promise<Result<PermitRow, DomainError>> {
    const permit = await this.store.getPermit(permitId)
    if (permit === null) {
      return err({ code: ERR.NOT_FOUND, message: "permit not found" })
    }
    if (!timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(permit.token_hash, "hex"))) {
      return err({ code: ERR.UNAUTHORIZED, message: "permit token mismatch" })
    }
    if (permit.incident_id !== expected.incidentId) {
      return err({ code: ERR.PERMIT_MISMATCH, message: "permit is bound to a different Incident" })
    }
    if (permit.candidate_hash !== expected.candidateHash) {
      return err({ code: ERR.CANDIDATE_MISMATCH, message: "permit candidate hash does not match" })
    }
    if (permit.target !== expected.target) {
      return err({ code: ERR.PERMIT_MISMATCH, message: "permit target does not match" })
    }
    const consumed = await this.store.consumePermit(permitId, this.clock.nowIso())
    if (consumed === null) {
      return err({ code: ERR.PERMIT_USED, message: "permit already consumed, revoked, or expired" })
    }
    return ok(consumed)
  }
}
