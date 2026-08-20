/**
 * Change Review projection tests over the verified fixture bundle plus
 * focused tests for manifest-bound run selection and ambiguous manifests.
 */
import { describe, expect, test } from "bun:test"

import { loadReplayStoreFromDirectory } from "../../../lib/replay/load-saved-bundle-fs"
import type {
  ReplayArtifact,
  ReplayStore,
} from "../../../lib/replay/replay-store"
import type { ArtifactEnvelope } from "@sih/contracts/types"
import {
  changeWorkspaceView,
  deriveChangeState,
  resolveRunBinding,
} from "./change-workspace-projection"

const RUNS_URL = new URL("../../../../../../demo/saved-runs/", import.meta.url)
const EVALUATION_TIME = "2026-08-16T12:00:00Z"

async function fixtureStore(): Promise<ReplayStore> {
  const result = await loadReplayStoreFromDirectory(RUNS_URL, {
    evaluationTime: EVALUATION_TIME,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error("fixture bundle failed verification")
  }
  return result.value
}

describe("changeWorkspaceView over the fixture bundle", () => {
  test("incident 1: released and resolved change, honest source-host facts", async () => {
    const store = await fixtureStore()
    const view = changeWorkspaceView(
      store,
      "inc-demo-payment-1",
      EVALUATION_TIME
    )
    expect(view).not.toBeNull()
    if (view === null) return

    expect(view.incident.state).toBe("closed")
    expect(view.change?.state).toBe("Resolved")
    expect(view.change?.candidateHash).toBe(
      "sha256:8044de5e18a86e69e613419f79aa82da1ba382b78a64108413497165a9dc3709"
    )
    expect(view.change?.description).toContain("Restore the dropped negation")
    expect(view.change?.recoveryConsumed).toBe(true)
    expect(view.change?.hypothesisId).toBe("H1")
    expect(view.change?.citedItemIds.length).toBeGreaterThan(0)

    // The source-host receipt carries the complete PR diff.
    expect(view.diff.state).toBe("parsed")
    expect(view.diff.files).toHaveLength(1)
    expect(view.diff.additions).toBe(28)
    expect(view.diff.deletions).toBe(28)
    expect(view.diff.rawText).toContain(
      "cardTypeCheck(cardNumber) !== cardType"
    )
    expect(view.diff.note).toBeNull()

    // The issue #32 promotion is pinned by its sealed capture manifest.
    expect(view.run.runId).toBe("run-1")
    expect(view.run.binding).toBe("manifest")
    expect(view.run.attempt).toBe(1)
    expect(view.run.attemptLimit).toBe(3)
    expect(view.run.state).toBe("completed")
    expect(view.run.outcome).toBe("verified-remediation")
    expect(view.run.durationSeconds).not.toBeNull()
    expect(view.meta.provider).not.toBeNull()
    expect(view.meta.model).not.toBeNull()

    expect(view.reviewState.reviewsTotal).toBeGreaterThan(0)
    expect(view.reviewState.reviewsPassed).toBe(view.reviewState.reviewsTotal)
    expect(view.reviewState.failedIds).toEqual([])
    expect(view.reviewState.releaseGate?.verdict).toBe("pass")

    // Default record exposes the PR facts recorded by the source-host adapter.
    const sourceHost = view.records["source-host"]
    expect(view.defaultRecordId).toBe("source-host")
    expect(sourceHost.kind).toBe("Source-host record")
    expect(sourceHost.status).toBe("Verified")
    expect(
      sourceHost.facts.find((fact) => fact.label === "Repository")?.value
    ).toBe("xddinside/sih26-payment-demo")
    expect(
      sourceHost.facts.find((fact) => fact.label === "Head")
    ).toBeUndefined()
    expect(JSON.stringify(sourceHost.raw)).toContain(
      "github.com/xddinside/sih26-payment-demo/pull/4"
    )
    expect(view.sourceHost?.repository).toBe("xddinside/sih26-payment-demo")

    // Records registry: remediation, hypothesis, evidence, judge, synthesizer, gate, run, recovery.
    expect(view.records["remediation"]).toBeDefined()
    expect(view.records["hypothesis:H1"]).toBeDefined()
    expect(view.records["hypothesis-gate"]).toBeDefined()
    expect(view.records["judge"]).toBeDefined()
    expect(view.records["synthesizer"]).toBeDefined()
    expect(view.records["run"]).toBeDefined()
    expect(view.records["gate-release"]).toBeDefined()
    expect(view.records["recovery:point"]).toBeDefined()
    expect(view.records["diff-raw"]).toBeDefined()
    expect(view.records["file:0"]).toBeDefined()
    expect(view.records["check:R1"]).toBeDefined()
    expect(view.records["check:T1"]).toBeDefined()
    expect(view.records["policy"]).toBeDefined()
    expect(view.records["policy"].status).toBe("approval-required")
    expect(view.records["policy"].summary).toContain(
      "outside autonomous window"
    )
    expect(view.records["audit:index"]).toBeDefined()
    expect(view.records["audit:index"].summary).toContain("events")
    expect(view.records["audit:241"].kind).toBe("Audit event")
    expect(view.records["audit:242"].status).toBe("granted")
    expect(view.records["audit:243"].status).toBe("Human action")
    expect(view.checks.length).toBe(
      view.reviewState.reviewsTotal + view.reviewState.testsTotal
    )
    const evidenceIds = Object.keys(view.records).filter((id) =>
      id.startsWith("evidence:")
    )
    expect(evidenceIds.length).toBeGreaterThan(0)
    const participantIds = Object.keys(view.records).filter((id) =>
      id.startsWith("participant:")
    )
    expect(participantIds.length).toBeGreaterThan(0)

    // Navigator lists both saved Incidents with their latest outcomes.
    expect(view.navigator.map((row) => row.incidentId)).toEqual([
      "inc-demo-payment-1",
      "inc-demo-payment-2",
    ])
    expect(view.navigator[0].state).toBe("closed")
    expect(view.navigator[1].latestOutcome).toContain("verification-failed")
    expect(view.navigator[1].signalName).not.toBeNull()
  })

  test("incident 2: blocked change with failed reviews and no Release Gate", async () => {
    const store = await fixtureStore()
    const view = changeWorkspaceView(
      store,
      "inc-demo-payment-2",
      EVALUATION_TIME
    )
    expect(view).not.toBeNull()
    if (view === null) return

    expect(view.incident.state).toBe("open")
    expect(view.change?.state).toBe("Blocked")
    expect(view.change?.candidateHash).toBe(
      "sha256:9c8a2069c9137ba12eeafb6397467e577b54a015b9ed03334c8f0df0317f084f"
    )
    expect(view.change?.recoveryConsumed).toBe(false)
    expect(view.diff.state).toBe("parsed")
    expect(view.reviewState.testsTotal).toBe(0)
    expect(view.reviewState.releaseGate).toBeNull()
    expect(view.records["gate-release"]).toBeUndefined()
    expect(view.records["source-host"].status).toBe("Not recorded")
    expect(view.sourceHost).toBeNull()
    expect(view.records["source-host"].facts).toEqual([])
    expect(view.run.state).toBe("failed")
    expect(view.run.failureReason).toBe("verification-failed")
    expect(view.records["policy"].status).toBe("No action decision")
    expect(view.records["policy"].summary).toContain(
      "stopped before an execution-time policy decision"
    )
    expect(view.records["audit:index"]).toBeDefined()
  })

  test("unknown Incident projects to null", async () => {
    const store = await fixtureStore()
    expect(
      changeWorkspaceView(store, "inc-unknown", EVALUATION_TIME)
    ).toBeNull()
  })
})

describe("resolveRunBinding", () => {
  test("a capture manifest pins the run it names", () => {
    const store = minimalStore({
      manifestRuns: [
        { incident_id: "inc-x", run_id: "run-2", attempt: 2 },
        { incident_id: "inc-x", run_id: "run-2", attempt: 2 },
      ],
    })
    const binding = resolveRunBinding(store, "inc-x")
    expect(binding.kind).toBe("bound")
    if (binding.kind !== "bound") return
    expect(binding.runId).toBe("run-2")
    expect(binding.attempt).toBe(2)
    expect(binding.manifest).not.toBeNull()
    expect(binding.manifestSource?.kind).toBe("artifact")
  })

  test("an ambiguous manifest set is rejected with a named gap", () => {
    const store = minimalStore({
      manifestRuns: [
        { incident_id: "inc-x", run_id: "run-1", attempt: 1 },
        { incident_id: "inc-x", run_id: "run-2", attempt: 2 },
      ],
    })
    const binding = resolveRunBinding(store, "inc-x")
    expect(binding.kind).toBe("ambiguous")
    if (binding.kind === "ambiguous") {
      expect(binding.reason).toContain("disagree")
    }
  })

  test("without a manifest, the journal's progressed run is used", () => {
    const store = minimalStore({ manifestRuns: [] })
    const binding = resolveRunBinding(store, "inc-x")
    expect(binding.kind).toBe("bound")
    if (binding.kind !== "bound") return
    expect(binding.runId).toBe("run-1")
    expect(binding.manifest).toBeNull()
    expect(binding.attempt).toBe(1)
  })

  test("a run that never progressed is a gap", () => {
    const store = minimalStore({ manifestRuns: [], progressed: false })
    const binding = resolveRunBinding(store, "inc-x")
    expect(binding.kind).toBe("gap")
  })
})

describe("deriveChangeState", () => {
  const base = {
    hasRemediation: true,
    verificationVerdict: "pass" as string | null,
    releaseGate: { verdict: "pass" },
    releaseSucceeded: true,
    watchConfirmed: true,
    incidentClosed: true,
  }
  test("walks the full ladder", () => {
    expect(deriveChangeState({ ...base, hasRemediation: false })).toBe(
      "Not prepared"
    )
    expect(deriveChangeState({ ...base, verificationVerdict: null })).toBe(
      "Prepared"
    )
    expect(deriveChangeState({ ...base, verificationVerdict: "fail" })).toBe(
      "Blocked"
    )
    expect(
      deriveChangeState({ ...base, releaseGate: { verdict: "fail" } })
    ).toBe("Verified")
    expect(deriveChangeState({ ...base, releaseGate: null })).toBe("Verified")
    expect(deriveChangeState({ ...base, releaseSucceeded: false })).toBe(
      "Approved for Release"
    )
    expect(deriveChangeState({ ...base, watchConfirmed: false })).toBe(
      "Released"
    )
    expect(deriveChangeState(base)).toBe("Resolved")
    expect(deriveChangeState({ ...base, incidentClosed: false })).toBe(
      "Released"
    )
  })
})

// ---------------------------------------------------------------------------
// Synthetic store helpers
// ---------------------------------------------------------------------------

const runTransitionEvent = (
  from: RunState | null,
  to: RunState,
  runId: string,
  sequence: number
) =>
  ({
    to,
    from,
    type: "run_transition",
    actor: { id: "cp-1", kind: "control-plane" },
    run_id: runId,
    attempt: 1,
    sequence,
    incident_id: "inc-x",
    recorded_at: "2026-08-16T20:00:00.000Z",
    policy_version: "policy:v1",
    idempotency_key: `run-test-${sequence}`,
    expected_run_version: 1,
  }) as const

type RunState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "awaiting-human"
  | "interrupted"
  | "cancelled"

function minimalStore(options: {
  manifestRuns: { incident_id: string; run_id: string; attempt: number }[]
  progressed?: boolean
}): ReplayStore {
  const artifacts = new Map<string, ReplayArtifact>()
  let i = 0
  for (const run of options.manifestRuns) {
    const contentHash = `sha256:${String(i).padStart(64, "0")}`
    const artifact = {
      contentHash,
      path: `artifacts/sha256/${contentHash.slice(7)}.json`,
      envelope: {
        schema_version: "1.1",
        artifact_schema_id: "capture-manifest",
        artifact_schema_version: "1.1",
        content_hash: contentHash,
        sealed_at: "2026-08-16T20:20:41.690Z",
        incident_id: "inc-x",
        run_id: run.run_id,
        producer: { skill: "sih-capture", skill_version: "1.0" },
        redaction: { profile_id: "none", masked_fields: [] },
        provenance: [],
        payload: {
          schema_version: "1.1",
          manifest_id: `manifest-${i}`,
          incident_id: run.incident_id,
          run_id: run.run_id,
          attempt: run.attempt,
          mode: "full-capture",
          scenario: "test",
          provider_class: "real",
          provider: "test-provider",
          model: "test-model",
          reasoning: "medium",
          pi_agent_core_version: "1.0",
          pi_ai_version: "1.0",
          skill_tree_digest:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          tool_catalog_revision: "1",
          prompt_revision: "1",
          policy_revision: "1",
          perspectives: [],
          seeds: [],
          budgets: {
            model_turns: 1,
            non_terminal_tool_calls: 1,
            session_wall_clock_ms: 1,
            run_wall_clock_ms: 1,
          },
          schema_versions: {},
          role_records: [],
          manifest_digest:
            "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          sealed_at: "2026-08-16T20:20:41.690Z",
        } as unknown,
      } as unknown as ArtifactEnvelope,
    }
    artifacts.set(contentHash, artifact)
    i += 1
  }
  const events =
    options.progressed === false
      ? [runTransitionEvent(null, "queued", "run-1", 1)]
      : [
          runTransitionEvent(null, "queued", "run-1", 1),
          runTransitionEvent("queued", "running", "run-1", 2),
          runTransitionEvent("running", "completed", "run-1", 3),
        ]
  return {
    manifest: {
      format_version: "1.0",
      capture_time: "2026-08-16T20:20:41.690Z",
      incident_ids: [{ incident_id: "inc-x", final_sequence: events.length }],
      files: {},
    },
    incidents: [
      {
        incidentId: "inc-x",
        finalSequence: events.length,
        events: events,
        journalState: {
          incidentId: "inc-x",
          incidentVersion: 1,
          incidentState: null,
          detectorState: null,
          closureReason: undefined,
          attemptsUsed: 0,
          nextSequence: events.length + 1,
          runs: [],
          workRecords: [],
          sealedArtifacts: [],
          seenIdempotencyKeys: new Set<string>(),
        },
        artifactHashes: [...artifacts.keys()],
      },
    ],
    artifacts,
  }
}
