/**
 * Presentation selection and freeze (issue #31), end to end, offline: a
 * synthetic but fully schema-valid real full-capture bundle is built from
 * scratch (all required Demo Profile roles, receipt, model-use records, and a
 * v1.2 capture manifest), copied into a redirected append-only dev store, and
 * selected through `presentFromStore`.
 *
 * These prove:
 * - three consecutive eligible runs per scenario select and assemble a
 *   verified presentation bundle and record selection provenance back into
 *   the append-only dev store.
 * - a fixture bundle (manifest provider_class fixture) is rejected even when
 *   its record fields and bundle otherwise verify.
 * - a sealed manifest missing a required succeeded role is rejected.
 * - an unexpected terminal outcome never becomes a selection.
 * - finalization never deletes or rewrites the retained dev-store runs.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { contentHash, sha256Hex } from "@sih/contracts/hashes"
import { verifySavedBundle } from "@sih/contracts/saved-bundle"

import { SAVED_INCIDENT_1, SAVED_INCIDENT_2 } from "../src/constants.js"
import { presentFromStore } from "../src/presentation.js"
import {
  appendCaptureRecord,
  listCaptureRecords,
  listSelectionRecords,
  manifestConfigDigestOf,
  selectPresentationStreak,
} from "../src/dev-store.js"
import type { StoredCaptureRecord } from "../src/dev-store.js"
import type { CaptureManifest } from "@sih/contracts/types"

const EVAL = "2026-08-21T00:00:00Z"

function contentHashOf(payload: unknown): string {
  const result = contentHash(payload as never)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

function envelope(schemaId: string, payload: unknown): Record<string, unknown> {
  return {
    schema_version: "1.0",
    artifact_schema_id: schemaId,
    artifact_schema_version: "1.0",
    content_hash: contentHashOf(payload),
    sealed_at: "2026-08-18T00:00:00Z",
    incident_id: "",
    run_id: "run-1",
    producer: { skill: "pi-agent-core", skill_version: "0.79.4", tool: "capture-terminal", tool_version: "1.0" },
    payload,
  }
}

function putArtifact(files: Map<string, string>, incidentId: string, schemaId: string, payload: unknown, artifactSchemaVersion = "1.0"): string {
  const hash = contentHashOf(payload)
  const wrapped = { ...envelope(schemaId, payload), incident_id: incidentId }
  files.set(`artifacts/sha256/${hash.slice("sha256:".length)}.json`, JSON.stringify({ ...wrapped, artifact_schema_version: artifactSchemaVersion }))
  return hash
}

const HYPOTHESIS = (incidentId: string, id: string) => ({
  schema_version: "1.0",
  id,
  incident_id: incidentId,
  incident_run_id: "run-1",
  attempt: 1,
  round: 1,
  causal_claim: {
    trigger: "payment error ratio above 0.2",
    defect: "card-type gate inverted",
    propagation: [],
    failure: "charges rejected",
  },
  affected_scope: {
    service_names: ["payment"],
    deployment_environment_names: ["demo"],
    versions: ["seeded"],
    window: { starts_at: "2026-08-18T00:00:00Z", ends_at: null },
  },
  predicted_observations: [
    { id: "obs-1", statement: "card-type restore lowers the error ratio", registered_at: "2026-08-18T00:01:00Z" },
  ],
  evidence: { supporting: [], opposing: [], unexplained: [] },
  alternatives: [],
  proposed_tests: [
    {
      id: "test-card-type",
      procedure: "node --test card.unit.test.js",
      bounds: "candidate worktree only",
      permissions: [],
      expected: { this_hypothesis: "pass" },
    },
  ],
  status: "accepted",
})

const TERMINAL_ARTIFACTS: Array<{ role: string; agent: string; schemaId: string; payload: (incidentId: string) => Record<string, unknown> }> = [
  {
    role: "participant",
    agent: "p-1",
    schemaId: "fusion-participant-output",
    payload: (incidentId) => ({
      schema_version: "1.0",
      participant_id: "p-1",
      revision_id: `sha256:${"1".repeat(64)}`,
      hypotheses: [HYPOTHESIS(incidentId, "hyp-1")],
      stated_objections: [],
      completed_at: "2026-08-18T00:01:00Z",
    }),
  },
  {
    role: "participant",
    agent: "p-2",
    schemaId: "fusion-participant-output",
    payload: (incidentId) => ({
      schema_version: "1.0",
      participant_id: "p-2",
      revision_id: `sha256:${"1".repeat(64)}`,
      hypotheses: [HYPOTHESIS(incidentId, "hyp-2")],
      stated_objections: [],
      completed_at: "2026-08-18T00:01:00Z",
    }),
  },
  {
    role: "judge",
    agent: "j-1",
    schemaId: "fusion-judge-output",
    payload: (incidentId) => ({
      schema_version: "1.0",
      judge_id: `j-1-${incidentId}`,
      revision_id: `sha256:${"1".repeat(64)}`,
      agreements: [{ statement: `card-type gate is the trigger (${incidentId})`, hypothesis_ids: ["hyp-1", "hyp-2"], cited_item_ids: [] }],
      contradictions: [],
      blind_spots: [],
      unique_findings: [],
      citation_audit: [
        { participant_id: "p-1", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
        { participant_id: "p-2", uncited_claims: 0, invalid_citations: 0, missing_item_citations: 0 },
      ],
      completed_at: "2026-08-18T00:02:00Z",
    }),
  },
  {
    role: "synthesizer",
    agent: "s-1",
    schemaId: "fusion-synthesizer-output",
    payload: (incidentId) => ({
      schema_version: "1.0",
      synthesizer_id: "s-1",
      revision_id: `sha256:${"1".repeat(64)}`,
      ranked_hypotheses: [{ rank: 1, hypothesis: HYPOTHESIS(incidentId, "hyp-1") }],
      contradictions: [],
      gaps: [],
      next_actions: [
        {
          procedure: "apply the card-type restoration",
          bounds: "candidate worktree",
          permissions: [],
          discriminates: ["hyp-1"],
        },
      ],
      fusion_meta: {
        participant_ids: ["p-1", "p-2"],
        judge_id: "j-1",
        synthesizer_id: "s-1",
        revision_id: `sha256:${"1".repeat(64)}`,
        started_at: "2026-08-18T00:00:00Z",
        completed_at: "2026-08-18T00:03:00Z",
      },
      completed_at: "2026-08-18T00:03:00Z",
    }),
  },
  {
    role: "planner",
    agent: "planner-1",
    schemaId: "remediation-draft",
    payload: (incidentId) => ({
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      remediation_class: "code",
      action_risk_class: "safe",
      gate_path: "release",
      disposition: "allowed",
      change_description: "restore the card-type gate",
      citations: [],
      test_plan: ["node --test card.unit.test.js"],
      changed_surfaces: ["src/payment/card.js"],
      typed_action_plan: { adapter: "git", action_class: "commit", command: "apply diff" },
      completed_at: "2026-08-18T00:04:00Z",
    }),
  },
  {
    role: "implementer",
    agent: "implementer-1",
    schemaId: "implemented-diff",
    payload: (incidentId) => ({
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      base_ref: "main",
      diff_text: "--- a/src/payment/card.js\n+++ b/src/payment/card.js\n@@ -1 +1 @@\n-cardType >= 0\n+cardType > 0",
      diff_hash: `sha256:${"5".repeat(64)}`,
      changed_files: ["src/payment/card.js"],
      completed_at: "2026-08-18T00:05:00Z",
    }),
  },
  {
    role: "review",
    agent: "reviewer-R1",
    schemaId: "review-report",
    payload: (incidentId) => ({
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: `sha256:${"5".repeat(64)}`,
      role: "R1",
      reviewer: "reviewer-R1",
      revision: 1,
      input_refs: [],
      findings: [
        { id: "f-1", severity: "info", claim: "restores the card-type gate", citations: [{ kind: "file-line", file: "src/payment/card.js", line: 1 }], status: "open" },
      ],
      status: "pass",
      sealed_at: "2026-08-18T00:06:00Z",
    }),
  },
  {
    role: "test",
    agent: "tester-T1",
    schemaId: "test-report",
    payload: (incidentId) => ({
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      candidate_hash: `sha256:${"5".repeat(64)}`,
      layer: "T1",
      tool: "eslint",
      tool_version: "1.0",
      target: "src/payment/card.js",
      receipt_ref: "receipt-t1",
      runs: [{ run_hash: `sha256:${"5".repeat(64)}`, result: "pass", at: "2026-08-18T00:07:00Z" }],
      outcome: "pass",
      flaky: false,
      coverage_checked: false,
      sealed_at: "2026-08-18T00:07:00Z",
    }),
  },
  {
    role: "orchestrator",
    agent: "orchestrator-1",
    schemaId: "orchestrator-report",
    payload: (incidentId) => ({
      schema_version: "1.0",
      incident_id: incidentId,
      run_id: "run-1",
      attempt: 1,
      stage_outcomes: { detect: "completed", diagnose: "completed", repair: "completed", verify: "completed" },
      assessments: ["every role submitted contract-valid work"],
      reflections: ["Control Plane gates owned the outcome"],
      completed_at: "2026-08-18T00:08:00Z",
    }),
  },
]

function manifestPayload(incidentId: string, roleHashes: Map<string, string>): Record<string, unknown> {
  const roleRecords = TERMINAL_ARTIFACTS.map((entry, index) => ({
    role: entry.role,
    agent_id: entry.agent,
    status: "succeeded",
    submission_id: roleHashes.get(`${entry.role}-${index}`),
    artifact_ref: roleHashes.get(`${entry.role}-${index}`),
    model_use_agent_ids: [entry.agent],
  }))
  const payload: Record<string, unknown> = {
    schema_version: "1.2",
    manifest_id: `capture-manifest:${incidentId}:run-1`,
    incident_id: incidentId,
    run_id: "run-1",
    attempt: 1,
    mode: "full-capture",
    scenario: incidentId === SAVED_INCIDENT_1 ? "S1" : "S2",
    provider_class: "real",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "high",
    pi_agent_core_version: "0.79.4",
    pi_ai_version: "0.79.4",
    skill_tree_digest: `sha256:${"2".repeat(64)}`,
    tool_catalog_revision: "tool-catalog@1.0",
    prompt_revision: "prompts@1.0",
    policy_revision: "policy-v1",
    perspectives: [
      { participant_id: "p-1", perspective: "code-level defect hunt", order: 1 },
      { participant_id: "p-2", perspective: "system-level causation", order: 2 },
    ],
    seeds: [{ id: incidentId === SAVED_INCIDENT_1 ? "S1" : "S2", digest: `sha256:${"3".repeat(64)}` }],
    budgets: {
      model_turns: 20,
      non_terminal_tool_calls: 32,
      session_wall_clock_ms: 720_000,
      run_wall_clock_ms: 7_200_000,
      attempt_limit: 3,
    },
    schema_versions: { "capture-manifest": "1.2" },
    role_records: roleRecords,
    sealed_at: "2026-08-18T00:09:00Z",
  }
  return { ...payload, manifest_digest: contentHashOf(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "manifest_digest"))) }
}

function trigger(incidentId: string): Record<string, unknown> {
  return {
    schema_version: "1.0",
    trigger_id: `trig-${incidentId}`,
    delivery_key: `sha256:${"0".repeat(64)}`,
    incident_key: `sha256:${"1".repeat(64)}`,
    received_at: "2026-08-18T00:00:00Z",
    detector: { source: "prometheus-alertmanager", connection_id: "astronomy-shop-local", rule_id: "payment-error-rate", rule_version: "1" },
    state: "firing",
    severity: "critical",
    scope: { tenant_id: "demo", deployment_environment_name: "demo", service_name: "payment" },
    window: { starts_at: "2026-08-18T00:00:00Z", ends_at: null, lookback_seconds: 120 },
    signal_summary: { name: "payment error ratio", value: 0.92, unit: "1", threshold: 0.2 },
    evidence_refs: [],
  }
}

function testReceipt(incidentId: string): Record<string, unknown> {
  return {
    kind: "test",
    receipt_id: "receipt-t1",
    idempotency_key: "receipt-t1-1",
    lease_id: "lease-t1",
    stage: "verify",
    candidate_hash: `sha256:${"5".repeat(64)}`,
    layer: "T1",
    tool: "eslint",
    tool_version: "1.0",
    target: "src/payment/card.js",
    runs: [{ run_hash: `sha256:${"5".repeat(64)}`, result: "pass", at: "2026-08-18T00:07:00Z" }],
    outcome: "pass",
    flaky: false,
  }
}

function buildBundle(incidentId: string): Map<string, string> {
  const files = new Map<string, string>()
  const common = {
    actor: { id: "cp-1", kind: "control-plane" },
    policy_version: "policy-v1",
    recorded_at: "2026-08-18T00:00:00Z",
  }
  const roleHashes = new Map<string, string>()
  TERMINAL_ARTIFACTS.forEach((entry, index) => {
    roleHashes.set(`${entry.role}-${index}`, putArtifact(files, incidentId, entry.schemaId, entry.payload(incidentId)))
  })
  const manifest = manifestPayload(incidentId, roleHashes)
  putArtifact(files, incidentId, "capture-manifest", manifest, "1.2")

  const events: Array<Record<string, unknown>> = [
    { type: "trigger_received", sequence: 1, idempotency_key: "trig-1", incident_id: incidentId, trigger: trigger(incidentId), delivery_result: "incident-created", ...common },
    { type: "incident_transition", sequence: 2, idempotency_key: "inc-t-1", incident_id: incidentId, from: null, to: "open", expected_version: 0, ...common },
    { type: "run_transition", sequence: 3, idempotency_key: "run-t-1", incident_id: incidentId, run_id: "run-1", attempt: 1, from: null, to: "queued", expected_run_version: 0, ...common },
    { type: "run_transition", sequence: 4, idempotency_key: "run-t-2", incident_id: incidentId, run_id: "run-1", attempt: 1, from: "queued", to: "running", expected_run_version: 1, ...common },
  ]
  let sequence = 5
  TERMINAL_ARTIFACTS.forEach((entry, index) => {
    const hash = roleHashes.get(`${entry.role}-${index}`) ?? ""
    events.push({
      type: "artifact_sealed",
      sequence,
      idempotency_key: `art-${entry.role}-${index}`,
      incident_id: incidentId,
      run_id: "run-1",
      artifact_ref: { schema_id: entry.schemaId, schema_version: "1.0", content_hash: hash },
      ...common,
    })
    sequence += 1
    events.push({
      type: "model_use",
      sequence,
      idempotency_key: `mu-${entry.agent}`,
      incident_id: incidentId,
      parent_agent_id: "orchestrator-1",
      agent_id: entry.agent,
      model: "opencode/deepseek-v4-flash",
      token_use: { prompt_tokens: 10, completion_tokens: 10 },
      tool_calls: [],
      ...common,
    })
    sequence += 1
  })
  events.push({
    type: "broker_receipt_recorded",
    sequence,
    idempotency_key: "receipt-t1-1",
    incident_id: incidentId,
    run_id: "run-1",
    receipt: testReceipt(incidentId),
    ...common,
  })

  files.set(`incidents/${incidentId}/journal.jsonl`, events.map((event) => `${JSON.stringify(event)}\n`).join(""))
  const fileEntries: Record<string, { sha256: string; size: number }> = {}
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path) ?? ""
    fileEntries[path] = { sha256: `sha256:${sha256Hex(bytes)}`, size: new TextEncoder().encode(bytes).byteLength }
  }
  files.set(
    "manifest.json",
    JSON.stringify({
      format_version: "1.0",
      capture_time: EVAL,
      incident_ids: [{ incident_id: incidentId, final_sequence: sequence }],
      files: fileEntries,
    }, null, 2),
  )
  return files
}

function recordFor(run: 1 | 2, capturedAt: string, runPath: string, digest: string): StoredCaptureRecord {
  const incidentId = run === 1 ? SAVED_INCIDENT_1 : SAVED_INCIDENT_2
  return {
    version: 1,
    run,
    scenario: run === 1 ? "S1" : "S2",
    agents: "real",
    mode: "full-capture",
    provider: "opencode",
    model: "deepseek-v4-flash",
    reasoning: "high",
    capturedAt,
    savedId: incidentId,
    incidentId,
    finalSequence: 23,
    finalRunState: run === 1 ? "completed" : "failed",
    outcome: run === 1 ? "verified-remediation" : null,
    candidateHash: null,
    manifestSealed: true,
    manifestDigest: `sha256:${String(run).repeat(64)}`,
    agentRunArtifacts: 24,
    configDigest: digest,
    runPath,
    status: "completed",
    failureReason: run === 2 ? "verification-failed" : null,
  }
}

describe("presentation selection and freeze (issue #31)", () => {
  let tempRoot: string
  let outRoot: string
  let digest1: string
  let digest2: string
  let bundle1: Map<string, string>
  let bundle2: Map<string, string>

  async function freshStore(): Promise<void> {
    tempRoot = await mkdtemp(join(tmpdir(), "sih-presentation-"))
    outRoot = join(tempRoot, "saved-runs")
    process.env.SIH_DEV_STORE_ROOT = tempRoot
  }

  function captureManifestHash(bundle: Map<string, string>): string {
    for (const [, bytes] of bundle) {
      const envelope = JSON.parse(bytes) as { artifact_schema_id?: string; content_hash?: string }
      if (envelope.artifact_schema_id === "capture-manifest") {
        return envelope.content_hash as string
      }
    }
    throw new Error("no capture manifest in bundle")
  }

  async function writeBundle(bundle: Map<string, string>, dir: string): Promise<void> {
    for (const [relative, bytes] of bundle) {
      const target = join(tempRoot, dir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes, "utf8")
    }
  }

  async function manifestDigest(bundle: Map<string, string>): Promise<string> {
    const envelope = JSON.parse(bundle.get(`artifacts/sha256/${captureManifestHash(bundle).slice("sha256:".length)}.json`) ?? "{}") as { payload: CaptureManifest }
    return manifestConfigDigestOf(envelope.payload)
  }

  beforeAll(async () => {
    bundle1 = buildBundle(SAVED_INCIDENT_1)
    bundle2 = buildBundle(SAVED_INCIDENT_2)
    const verified1 = verifySavedBundle({ files: bundle1 }, { evaluationTime: EVAL })
    const verified2 = verifySavedBundle({ files: bundle2 }, { evaluationTime: EVAL })
    if (!verified1.ok || !verified2.ok) {
      throw new Error([
        "RUN1:", ...(verified1.ok ? [] : verified1.error.map((error) => `${error.code}: ${error.message}`)),
        "RUN2:", ...(verified2.ok ? [] : verified2.error.map((error) => `${error.code}: ${error.message}`)),
      ].join("\n"))
    }
    digest1 = await manifestDigest(bundle1)
    digest2 = await manifestDigest(bundle2)
  })

  test("three consecutive eligible runs per scenario select, assemble, and record provenance", async () => {
    await freshStore()
    await writeBundle(bundle1, "runs/run-1-bundle")
    await writeBundle(bundle2, "runs/run-2-bundle")
    for (let index = 0; index < 3; index += 1) {
      await appendCaptureRecord(recordFor(1, `2026-08-19T10:0${index}:00.000Z`, "runs/run-1-bundle", digest1))
      await appendCaptureRecord(recordFor(2, `2026-08-19T10:0${index + 3}:00.000Z`, "runs/run-2-bundle", digest2))
    }
    const selection = selectPresentationStreak(await listCaptureRecords())
    expect(selection).not.toBeNull()
    expect(selection?.records).toHaveLength(2)
    expect(selection?.records.map((record) => record.run)).toEqual([1, 2])

    const result = await presentFromStore(outRoot)
    expect(result).not.toBeNull()
    expect(result?.incidentIds).toEqual([SAVED_INCIDENT_1, SAVED_INCIDENT_2])

    // The presentation bundle verifies offline with no provider access.
    const saved = await readBundleDir(outRoot)
    const verified = verifySavedBundle({ files: saved }, new Date().toISOString())
    expect(verified.ok).toBe(true)

    // Selection provenance was appended back into the append-only store.
    const selections = await listSelectionRecords()
    expect(selections).toHaveLength(1)
    expect(selections[0]?.records).toHaveLength(2)
    expect(new Set(selections[0]?.records.map((record) => record.run))).toEqual(new Set([1, 2]))
  })

  test("a fixture bundle is rejected even when its record and bundle otherwise verify", async () => {
    // Rewrite the manifest's provider_class to fixture; the bundle still
    // verifies (fixture full captures are valid development fixtures), but
    // presentation finalization must refuse it.
    await freshStore()
    await writeBundle(bundle1, "runs/run-1-fixture")
    await writeBundle(bundle2, "runs/run-2-bundle")
    const files = new Map(bundle1)
    const manifestHash = captureManifestHash(files)
    const manifestPath = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`
    const envelope = JSON.parse(files.get(manifestPath)!) as { payload: Record<string, unknown> }
    envelope.payload = { ...envelope.payload, provider_class: "fixture" }
    files.set(manifestPath, JSON.stringify(envelope))
    await writeBundle(files, "runs/run-1-fixture")

    for (let index = 0; index < 3; index += 1) {
      await appendCaptureRecord(recordFor(1, `2026-08-19T10:0${index}:00.000Z`, "runs/run-1-fixture", digest1))
      await appendCaptureRecord(recordFor(2, `2026-08-19T10:0${index + 3}:00.000Z`, "runs/run-2-bundle", digest2))
    }
    await expect(presentFromStore(outRoot)).rejects.toThrow(/not a real full capture|fixture/)
    // The rejected selection recorded no provenance.
    expect(await listSelectionRecords()).toHaveLength(0)
  })

  test("a sealed manifest missing a required succeeded role is rejected", async () => {
    await freshStore()
    await writeBundle(bundle1, "runs/run-1-bundle")
    const files = new Map(bundle2)
    const manifestHash = captureManifestHash(files)
    const manifestPath = `artifacts/sha256/${manifestHash.slice("sha256:".length)}.json`
    const envelope = JSON.parse(files.get(manifestPath)!) as { payload: { role_records: Array<{ role: string }> } }
    envelope.payload.role_records = envelope.payload.role_records.filter((record) => record.role !== "judge")
    files.set(manifestPath, JSON.stringify(envelope))
    await writeBundle(files, "runs/run-2-no-judge")

    for (let index = 0; index < 3; index += 1) {
      await appendCaptureRecord(recordFor(1, `2026-08-19T10:0${index}:00.000Z`, "runs/run-1-bundle", digest1))
      await appendCaptureRecord(recordFor(2, `2026-08-19T10:0${index + 3}:00.000Z`, "runs/run-2-no-judge", digest2))
    }
    await expect(presentFromStore(outRoot)).rejects.toThrow(/missing required succeeded roles: judge/)
    expect(await listSelectionRecords()).toHaveLength(0)
  })

  test("finalization never deletes or rewrites the retained dev-store runs", async () => {
    await freshStore()
    await writeBundle(bundle1, "runs/run-1-bundle")
    await writeBundle(bundle2, "runs/run-2-bundle")
    for (let index = 0; index < 3; index += 1) {
      await appendCaptureRecord(recordFor(1, `2026-08-19T10:0${index}:00.000Z`, "runs/run-1-bundle", digest1))
      await appendCaptureRecord(recordFor(2, `2026-08-19T10:0${index + 3}:00.000Z`, "runs/run-2-bundle", digest2))
    }
    const before = await readBundleDir(join(tempRoot, "runs/run-1-bundle"))
    const result = await presentFromStore(outRoot)
    expect(result).not.toBeNull()
    const after = await readBundleDir(join(tempRoot, "runs/run-1-bundle"))
    expect(after).toEqual(before)
  })
})

async function readBundleDir(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), relative)
      } else {
        files.set(relative, await readFile(join(current, entry.name), "utf8"))
      }
    }
  }
  await walk(dir, "")
  return files
}
