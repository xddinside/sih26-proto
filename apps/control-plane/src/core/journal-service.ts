/**
 * Journal service: bridges the `@sih/contracts` journal reducer with the
 * PostgreSQL journal store. Replay is strict and idempotent: sequence is
 * contiguous per Incident, transition legality is enforced by the contracts
 * package, and a replayed idempotency key is a no-op that creates no
 * duplicate event.
 */
import {
  applyJournalCommand,
  reduceJournalEvents
  
} from "@sih/contracts/journal"
import type {JournalState} from "@sih/contracts/journal";
import type { IntegrityError } from "@sih/contracts/errors"
import type { JournalCommand, JournalEvent } from "@sih/contracts/types"

import type { DomainError } from "../result.js"
import { ERR } from "../result.js"
import type { Store } from "../store/store.js"

interface CacheEntry {
  state: JournalState
  events: JournalEvent[]
}

export class JournalService {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly store: Store) {}

  async load(incidentId: string): Promise<CacheEntry> {
    const cached = this.cache.get(incidentId)
    if (cached !== undefined) {
      return cached
    }
    const rows = await this.store.loadJournal(incidentId)
    const events = rows.map((row) => row.event)
    const reduced = reduceJournalEvents(events)
    if (!reduced.ok) {
      throw new JournalReplayError(reduced.error)
    }
    const entry: CacheEntry = { state: reduced.value, events }
    this.cache.set(incidentId, entry)
    return entry
  }

  async ensureLoaded(incidentId: string): Promise<void> {
    await this.load(incidentId)
  }

  events(incidentId: string): JournalEvent[] {
    return this.cache.get(incidentId)?.events ?? []
  }

  state(incidentId: string): JournalState | undefined {
    return this.cache.get(incidentId)?.state
  }

  /**
   * Apply one command to the Incident journal. Serializes per Incident.
   * Returns the sealed event, or null when the idempotency key was already
   * applied.
   */
  apply(incidentId: string, command: JournalCommand): Promise<ApplyResult> {
    const previous = this.chains.get(incidentId) ?? Promise.resolve()
    const next = previous.then(() => this.applyInner(incidentId, command))
    this.chains.set(
      incidentId,
      next.catch(() => undefined),
    )
    return next
  }

  private async applyInner(incidentId: string, command: JournalCommand): Promise<ApplyResult> {
    const entry = await this.load(incidentId)
    const applied = applyJournalCommand(entry.state, command)
    if (!applied.ok) {
      return { kind: "error", error: toDomainError(applied.error) }
    }
    const { state, event } = applied.value
    if (event === null) {
      return { kind: "duplicate" }
    }
    const persisted = await this.store.appendJournalEvent(incidentId, event)
    if (!persisted.ok) {
      return { kind: "error", error: persisted.error }
    }
    entry.state = state
    entry.events.push(event)
    return { kind: "applied", event, state }
  }

  /** Invalidate a cached incident (used on conflict recovery). */
  invalidate(incidentId: string): void {
    this.cache.delete(incidentId)
  }
}

export class JournalReplayError extends Error {
  constructor(public readonly integrity: IntegrityError) {
    super(`journal replay failed for incident: ${integrity.message}`)
  }
}

export type ApplyResult =
  | { kind: "applied"; event: JournalEvent; state: JournalState }
  | { kind: "duplicate" }
  | { kind: "error"; error: DomainError }

function toDomainError(integrity: IntegrityError): DomainError {
  const code = integrity.code === "ILLEGAL_TRANSITION" ? ERR.ILLEGAL_TRANSITION
    : integrity.code === "DUPLICATE_TRANSITION" ? ERR.DUPLICATE
    : integrity.code === "BAD_SEQUENCE" ? ERR.CONFLICT
    : ERR.MALFORMED_CONTRACT
  return { code, message: integrity.message }
}
