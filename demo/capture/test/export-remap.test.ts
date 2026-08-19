import { describe, expect, test } from "bun:test"

import { contentHash } from "@sih/contracts/hashes"
import type { ArtifactEnvelope, JournalEvent } from "@sih/contracts/types"

import { assembleIncident } from "../src/export.js"

const CAPTURED_INCIDENT = "inc-captured"
const SAVED_INCIDENT = "inc-demo-payment-1"
const RUN_ID = "run-1"
const SEALED_AT = "2026-08-19T00:00:00.000Z"

function hash(value: unknown): string {
  const result = contentHash(value as never)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function withoutManifestDigest(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...payload }
  delete copy.manifest_digest
  return copy
}

function envelope(
  schemaId: string,
  schemaVersion: string,
  payload: Record<string, unknown>
): ArtifactEnvelope {
  return {
    schema_version: "1.0",
    artifact_schema_id: schemaId,
    artifact_schema_version: schemaVersion,
    content_hash: hash(payload),
    sealed_at: SEALED_AT,
    incident_id: CAPTURED_INCIDENT,
    run_id: RUN_ID,
    producer: { skill: "test", skill_version: "1.0" },
    payload: payload as never,
  }
}

function sealedEvent(
  sequence: number,
  envelopeValue: ArtifactEnvelope
): JournalEvent {
  return {
    type: "artifact_sealed",
    actor: { id: "cp-test", kind: "control-plane" },
    run_id: RUN_ID,
    sequence,
    incident_id: CAPTURED_INCIDENT,
    recorded_at: SEALED_AT,
    artifact_ref: {
      schema_id: envelopeValue.artifact_schema_id,
      schema_version: envelopeValue.artifact_schema_version,
      content_hash: envelopeValue.content_hash,
    },
    policy_version: "policy:test",
    idempotency_key: `artifact:${sequence}`,
  } as JournalEvent
}

describe("captured artifact reference remapping", () => {
  test("updates manifest and agent-run references and recomputes the manifest digest", async () => {
    const terminal = envelope("orchestrator-report", "1.0", {
      incident_id: CAPTURED_INCIDENT,
      value: "terminal result",
    })
    const agentRun = envelope("agent-run-artifact", "1.0", {
      incident_id: CAPTURED_INCIDENT,
      calls: [{ submission_ref: terminal.content_hash }],
    })
    const manifestWithoutDigest: Record<string, unknown> = {
      schema_version: "1.1",
      incident_id: CAPTURED_INCIDENT,
      role_records: [
        {
          role: "orchestrator",
          agent_id: "agent-orchestrator",
          status: "succeeded",
          submission_id: terminal.content_hash,
          artifact_ref: terminal.content_hash,
          run_artifact_ref: agentRun.content_hash,
          model_use_agent_ids: [],
        },
      ],
    }
    const manifest = envelope("capture-manifest", "1.1", {
      ...manifestWithoutDigest,
      manifest_digest: hash(manifestWithoutDigest),
    })

    const sourceEnvelopes = new Map([
      [terminal.content_hash, terminal],
      [agentRun.content_hash, agentRun],
      [manifest.content_hash, manifest],
    ])
    const events = [
      sealedEvent(1, terminal),
      sealedEvent(2, agentRun),
      sealedEvent(3, manifest),
    ]

    const assembled = await assembleIncident(
      { capturedIncidentId: CAPTURED_INCIDENT, savedId: SAVED_INCIDENT },
      { [CAPTURED_INCIDENT]: SAVED_INCIDENT },
      {
        loadEvents: () => events,
        loadEnvelope: async (contentHashValue) => {
          const value = sourceEnvelopes.get(contentHashValue)
          if (value === undefined)
            throw new Error(`missing fixture envelope ${contentHashValue}`)
          return value
        },
      }
    )

    const artifacts = [...assembled.artifactFiles.values()].map(
      (bytes) => JSON.parse(bytes) as ArtifactEnvelope
    )
    const remappedTerminal = artifacts.find(
      (value) => value.artifact_schema_id === "orchestrator-report"
    )
    const remappedAgentRun = artifacts.find(
      (value) => value.artifact_schema_id === "agent-run-artifact"
    )
    const remappedManifest = artifacts.find(
      (value) => value.artifact_schema_id === "capture-manifest"
    )
    expect(remappedTerminal).toBeDefined()
    expect(remappedAgentRun).toBeDefined()
    expect(remappedManifest).toBeDefined()
    if (remappedTerminal === undefined || remappedAgentRun === undefined || remappedManifest === undefined) {
      throw new Error("assembled fixture is missing a required artifact")
    }

    const terminalHash = remappedTerminal.content_hash
    const agentRunHash = remappedAgentRun.content_hash
    const manifestPayload = remappedManifest.payload as Record<string, any>
    expect(terminalHash).not.toBe(terminal.content_hash)
    expect(agentRunHash).not.toBe(agentRun.content_hash)
    expect(manifestPayload.incident_id).toBe(SAVED_INCIDENT)
    expect(manifestPayload.role_records[0].artifact_ref).toBe(terminalHash)
    expect(manifestPayload.role_records[0].submission_id).toBe(terminalHash)
    expect(manifestPayload.role_records[0].run_artifact_ref).toBe(agentRunHash)
    expect(manifestPayload.manifest_digest).toBe(
      hash(withoutManifestDigest(manifestPayload))
    )
    expect(remappedManifest.content_hash).toBe(hash(manifestPayload))

    const agentRunPayload = remappedAgentRun.payload as {
      calls: Array<{ submission_ref: string }>
    }
    expect(agentRunPayload.calls[0]?.submission_ref).toBe(terminalHash)
  })
})
