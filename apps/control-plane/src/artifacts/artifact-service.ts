/**
 * Artifact service: seal and retrieve content-addressed artifact envelopes.
 * Sealing validates registered schemas against the `@sih/contracts` registry,
 * computes the content hash of the redacted payload, and stores the envelope
 * exactly once. Retrieval recomputes the hash and fails on mismatch.
 */
import { createHash } from "node:crypto"

import { contentHash as computeContentHash } from "@sih/contracts/hashes"
import { classifySchema } from "@sih/contracts/schemas"
import { validate } from "@sih/contracts/parse"
import type { ArtifactEnvelope } from "@sih/contracts/types"

import { ERR, err, ok } from "../result.js"
import type { DomainError, Result } from "../result.js"
import type { Clock } from "../clock.js"
import type { Store } from "../store/store.js"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface Producer {
  skill?: string
  skill_version?: string
  tool?: string
  tool_version?: string
  tool_catalog_version?: string
}

export interface SealInput {
  incidentId: string
  runId: string | null
  schemaId: string
  schemaVersion: string
  payload: JsonValue
  producer?: Producer
  redaction?: { profile_id: string; masked_fields: string[] }
  provenance?: string[]
}

export interface SealedArtifact {
  artifactRef: { schema_id: string; schema_version: string; content_hash: string }
  envelope: ArtifactEnvelope
}

export class ArtifactService {
  constructor(private readonly store: Store, private readonly clock: Clock) {}

  async seal(input: SealInput): Promise<Result<SealedArtifact, DomainError>> {
    // Registered schemas must validate. An unknown schema name is a local
    // Control Plane schema (release record, recovery point, direct-action
    // record) not yet in the contracts registry; seal it without registry
    // validation and record the gap. A known name with an unsupported version
    // is rejected.
    const classification = classifySchema(input.schemaId, input.schemaVersion)
    if (classification.kind === "stale-schema") {
      return err({ code: ERR.MALFORMED_CONTRACT, message: `stale schema ${input.schemaId}@${input.schemaVersion}` })
    }
    if (classification.kind === "ok") {
      const parsed = validate(input.schemaId, input.schemaVersion, input.payload)
      if (!parsed.ok) {
        return err({ code: ERR.MALFORMED_CONTRACT, message: parsed.error.message })
      }
    }

    const hash = computeContentHash(input.payload)
    if (!hash.ok) {
      return err({ code: ERR.MALFORMED_CONTRACT, message: hash.error.message })
    }

    const producer = {
      skill: input.producer?.skill ?? undefined,
      skill_version: input.producer?.skill_version ?? undefined,
      tool: input.producer?.tool ?? undefined,
      tool_version: input.producer?.tool_version ?? undefined,
      tool_catalog_version: input.producer?.tool_catalog_version ?? undefined,
    }
    const envelope: ArtifactEnvelope = {
      schema_version: "1.0",
      artifact_schema_id: input.schemaId,
      artifact_schema_version: input.schemaVersion,
      content_hash: hash.value,
      sealed_at: this.clock.nowIso(),
      incident_id: input.incidentId,
      run_id: input.runId ?? undefined,
      producer,
      redaction: input.redaction ?? { profile_id: "none", masked_fields: [] },
      provenance: input.provenance ?? [],
      payload: input.payload,
    }

    const bytes = new TextEncoder().encode(JSON.stringify(envelope))
    const stored = await this.store.putArtifact({
      content_hash: hash.value,
      schema_id: input.schemaId,
      schema_version: input.schemaVersion,
      incident_id: input.incidentId,
      run_id: input.runId,
      sealed_at: envelope.sealed_at,
      bytes,
    })
    if (!stored.ok) {
      return stored
    }

    return ok({
      artifactRef: {
        schema_id: input.schemaId,
        schema_version: input.schemaVersion,
        content_hash: hash.value,
      },
      envelope,
    })
  }

  async get(contentHash: string): Promise<Result<ArtifactEnvelope, DomainError>> {
    const row = await this.store.getArtifact(contentHash)
    if (row === null) {
      return err({ code: ERR.NOT_FOUND, message: `artifact ${contentHash} not found` })
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(new TextDecoder().decode(row.bytes))
    } catch {
      return err({ code: ERR.MALFORMED_CONTRACT, message: "artifact envelope is not valid JSON" })
    }
    const typed = envelope as ArtifactEnvelope
    // Recompute the content hash of the payload and fail on mismatch.
    const recomputed = computeContentHash(typed.payload as JsonValue)
    if (!recomputed.ok || recomputed.value !== contentHash) {
      return err({
        code: ERR.HASH_MISMATCH,
        message: `artifact ${contentHash} content hash does not match its payload`,
      })
    }
    return ok(typed)
  }

  /** SHA-256 file-byte hash, distinct from content hash. */
  static byteHash(bytes: Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  }
}
