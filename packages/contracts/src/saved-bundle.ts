/**
 * Saved bundle verification, from docs/research/incident-workspace.md.
 *
 * The verifier is a pure function over an in-memory map of POSIX path to exact
 * bytes. It parses the manifest, journals, and artifact envelopes using the
 * registry, verifies exact byte hashes, content hashes, path/hash agreement,
 * sequence, legal state transitions, redaction metadata, freshness, and
 * artifact references. It never repairs, sorts into legality, fills gaps, or
 * invents artifacts, and it never uses Pi JSONL or model transcripts as
 * evidence.
 */
import type { JsonValue } from "./result.js";
import { err, ok, type Result } from "./result.js";
import { integrityError, type IntegrityError } from "./errors.js";
import { parseJsonTextStrict } from "./canonical.js";
import { contentHash, evidenceItemId, sha256Bytes } from "./hashes.js";
import {
  parseArtifactEnvelope,
  parseJournalLines,
  parseSavedBundleManifest,
  validate,
} from "./parse.js";
import { verifyRedaction } from "./redaction.js";
import { checkFreshness } from "./freshness.js";
import { normalizeSavedPath, validatePaths } from "./paths.js";
import { reduceJournalEvents, verifyJournalSequence } from "./journal.js";
import { classifySchema } from "./schemas/registry.js";
import { TERMINAL_SCHEMA_BY_ROLE } from "./schemas/agent.js";
import type { AgentRoleName } from "./schemas/agent.js";
import type { AgentRunArtifactWire } from "./schemas/agent-run.js";
import type { ArtifactEnvelope } from "./schemas/artifact-envelope.js";
import type { JournalEvent } from "./schemas/journal-event.js";
import type { SavedBundleManifest } from "./schemas/saved-bundle-manifest.js";
import type { EvidenceSet } from "./schemas/evidence.js";
import type { EvidenceHashInput } from "./schemas/hash-inputs.js";
import type { TestReport, VerificationReport } from "./schemas/reports.js";
import type { CaptureManifest } from "./schemas/agent.js";

/** An in-memory saved bundle: POSIX path to exact file bytes. */
export interface SavedFiles {
  files: ReadonlyMap<string, string>;
}

/** Verification options. `evaluationTime` is the explicit freshness clock. */
export interface VerifyOptions {
  evaluationTime: string;
}

/** Per-Incident verification summary. */
export interface IncidentVerification {
  incidentId: string;
  finalSequence: number;
  events: JournalEvent[];
}

/** A successful verification report. */
export interface VerifiedBundle {
  manifest: SavedBundleManifest;
  incidents: IncidentVerification[];
  artifacts: Map<string, ArtifactEnvelope>;
}

const MANIFEST_PATH = "manifest.json";
const JOURNAL_PATH_PATTERN = /^incidents\/([^/]+)\/journal\.jsonl$/;
const ARTIFACT_PATH_PATTERN = /^artifacts\/sha256\/([0-9a-f]{64})\.json$/;
const UTF8 = new TextEncoder();

interface ArtifactReferenceContext {
  readonly contentHash: string;
  readonly schemaId: string | undefined;
  readonly schemaVersion: string | undefined;
  readonly incidentId: string;
  readonly runId: string | undefined;
  readonly sequence: number;
  readonly journalPath: string;
  readonly source: "artifact-sealed" | "stage" | "gate-fact";
}

function scopedReferenceKey(
  incidentId: string,
  runId: string | undefined,
  reference: string,
): string {
  return `${incidentId}\u0000${runId ?? ""}\u0000${reference}`;
}

function incidentRunKey(incidentId: string, runId: string | undefined): string {
  return `${incidentId}\u0000${runId ?? ""}`;
}

function utf8Size(value: string): number {
  return UTF8.encode(value).byteLength;
}

function readFile(files: SavedFiles, path: string): string | undefined {
  return files.files.get(path);
}

/**
 * Verify a saved bundle. Returns `ok` with the verification report when the
 * bundle is valid, or `err` with every integrity error found. Checks are
 * independent where possible so a caller can render every gap at once.
 */
export function verifySavedBundle(
  files: SavedFiles,
  options: VerifyOptions,
): Result<VerifiedBundle, IntegrityError[]> {
  const errors: IntegrityError[] = [];

  const manifestText = readFile(files, MANIFEST_PATH);
  if (manifestText === undefined) {
    return err([integrityError("MISSING_ARTIFACT", "manifest.json is missing", MANIFEST_PATH)]);
  }

  const manifestJson = parseJsonTextStrict(manifestText);
  if (!manifestJson.ok) {
    return err([
      integrityError("MALFORMED_CONTRACT", `manifest.json is not strict JSON: ${manifestJson.error.message}`, MANIFEST_PATH),
    ]);
  }

  const manifestResult = parseSavedBundleManifest(manifestJson.value);
  if (!manifestResult.ok) {
    return err([manifestResult.error]);
  }
  const manifest = manifestResult.value;

  // Path integrity: every input path and every manifest key must be a valid
  // POSIX relative path with no duplicates after normalization.
  const inputPaths = [...files.files.keys()];
  const inputPathCheck = validatePaths(inputPaths);
  if (!inputPathCheck.ok) {
    errors.push(inputPathCheck.error);
  }
  const manifestPaths = Object.keys(manifest.files);
  const manifestPathCheck = validatePaths(manifestPaths);
  if (!manifestPathCheck.ok) {
    errors.push(manifestPathCheck.error);
  }

  // File set agreement: every input file is listed, every listed file exists.
  // manifest.json is exempt: it lists every other file but never itself.
  const listed = new Set(manifestPaths);
  for (const path of inputPaths) {
    const normalized = normalizeSavedPath(path);
    if (normalized.ok && normalized.value !== MANIFEST_PATH && !listed.has(normalized.value)) {
      errors.push(
        integrityError("MALFORMED_CONTRACT", `file ${JSON.stringify(path)} is not listed in the manifest`, path),
      );
    }
  }

  // Byte-hash verification of every listed file.
  const presentListed = new Map<string, string>();
  for (const [path, entry] of Object.entries(manifest.files)) {
    const bytes = readFile(files, path);
    if (bytes === undefined) {
      errors.push(integrityError("MISSING_ARTIFACT", `listed file is missing`, path));
      continue;
    }
    presentListed.set(path, bytes);
    const digest = sha256Bytes(UTF8.encode(bytes));
    if (digest !== entry.sha256.slice("sha256:".length)) {
      errors.push(integrityError("CHANGED_CONTENT", "file bytes do not match manifest hash", path));
    }
    if (utf8Size(bytes) !== entry.size) {
      errors.push(integrityError("CHANGED_CONTENT", "file size does not match manifest size", path));
    }
  }

  // Incident journals.
  const incidents: IncidentVerification[] = [];
  const incidentIds = new Set<string>();
  const artifactReferences: ArtifactReferenceContext[] = [];
  const recordedReceiptKeys = new Set<string>();
  const journalSealedKeys = new Set<string>();
  for (const entry of manifest.incident_ids) {
    incidentIds.add(entry.incident_id);
    const journalPath = `incidents/${entry.incident_id}/journal.jsonl`;
    const journalText = presentListed.get(journalPath);
    if (journalText === undefined) {
      errors.push(
        integrityError("MISSING_ARTIFACT", "incident journal is missing", journalPath),
      );
      continue;
    }
    const parsed = parseJournalLines(journalText);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    const events = parsed.value;
    const sequence = verifyJournalSequence(events);
    if (!sequence.ok) {
      errors.push(sequence.error);
      continue;
    }
    const last = events[events.length - 1];
    if (last === undefined || last.sequence !== entry.final_sequence) {
      errors.push(
        integrityError(
          "BAD_SEQUENCE",
          `journal final sequence ${last?.sequence ?? 0} does not match manifest final sequence ${entry.final_sequence}`,
          journalPath,
        ),
      );
      continue;
    }
    const reduced = reduceJournalEvents(events);
    if (!reduced.ok) {
      errors.push({ ...reduced.error, path: reduced.error.path ?? journalPath });
      continue;
    }
    if (reduced.value.incidentId !== entry.incident_id) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          `journal Incident ${String(reduced.value.incidentId)} does not match manifest Incident ${entry.incident_id}`,
          journalPath,
        ),
      );
      continue;
    }

    const sealedArtifacts = new Set<string>();
    const recordedReceipts = new Set<string>();
    const recordedApprovals = new Set<string>();
    for (const event of events) {
      const runId = "run_id" in event ? event.run_id : undefined;
      if (event.type === "gate_evaluated" && event.evaluation.gate !== "hypothesis") {
        for (const fact of event.evaluation.facts) {
          for (const reference of fact.evidence_refs) {
            const scopedKey = scopedReferenceKey(entry.incident_id, runId, reference.ref);
            const resolved =
              reference.kind === "artifact"
                ? sealedArtifacts.has(scopedKey)
                : reference.kind === "receipt"
                  ? recordedReceipts.has(scopedKey)
                  : recordedApprovals.has(scopedKey);
            if (!resolved) {
              errors.push(
                integrityError(
                  "MISSING_ARTIFACT",
                  `${event.evaluation.gate} gate fact ${fact.fact} references ${reference.kind} ${JSON.stringify(reference.ref)} that was not recorded earlier in the same Incident Run`,
                  journalPath,
                  {
                    sequence: event.sequence,
                    incident_id: entry.incident_id,
                    run_id: runId ?? null,
                    reference_kind: reference.kind,
                    reference: reference.ref,
                  },
                ),
              );
            }
            if (reference.kind === "artifact") {
              artifactReferences.push({
                contentHash: reference.ref,
                schemaId: undefined,
                schemaVersion: undefined,
                incidentId: entry.incident_id,
                runId,
                sequence: event.sequence,
                journalPath,
                source: "gate-fact",
              });
            }
          }
        }
      }
      if (event.type === "artifact_sealed") {
        artifactReferences.push({
          contentHash: event.artifact_ref.content_hash,
          schemaId: event.artifact_ref.schema_id,
          schemaVersion: event.artifact_ref.schema_version,
          incidentId: entry.incident_id,
          runId,
          sequence: event.sequence,
          journalPath,
          source: "artifact-sealed",
        });
        sealedArtifacts.add(
          scopedReferenceKey(entry.incident_id, runId, event.artifact_ref.content_hash),
        );
        journalSealedKeys.add(
          scopedReferenceKey(entry.incident_id, runId, event.artifact_ref.content_hash),
        );
      }
      if (event.type === "stage_transition" && event.artifact_ref !== undefined) {
        artifactReferences.push({
          contentHash: event.artifact_ref.content_hash,
          schemaId: event.artifact_ref.schema_id,
          schemaVersion: event.artifact_ref.schema_version,
          incidentId: entry.incident_id,
          runId: event.run_id,
          sequence: event.sequence,
          journalPath,
          source: "stage",
        });
      }
      if (event.type === "broker_receipt_recorded") {
        const receiptKey = scopedReferenceKey(
          entry.incident_id,
          runId,
          event.receipt.receipt_id,
        );
        recordedReceipts.add(receiptKey);
        recordedReceiptKeys.add(receiptKey);
      }
      if (event.type === "approval_recorded") {
        recordedApprovals.add(
          scopedReferenceKey(entry.incident_id, runId, event.approval.approval_id),
        );
      }
    }
    incidents.push({
      incidentId: entry.incident_id,
      finalSequence: entry.final_sequence,
      events,
    });
  }

  // No journal file may exist for an incident the manifest does not list.
  for (const path of inputPaths) {
    const match = JOURNAL_PATH_PATTERN.exec(path);
    if (match !== null && match[1] !== undefined && !incidentIds.has(match[1])) {
      errors.push(
        integrityError("MALFORMED_CONTRACT", "journal for an unlisted incident", path),
      );
    }
  }

  // Artifact envelopes.
  const artifacts = new Map<string, ArtifactEnvelope>();
  for (const [path, bytes] of presentListed) {
    const match = ARTIFACT_PATH_PATTERN.exec(path);
    if (match === null) {
      continue;
    }
    const fileNameHash = match[1];
    const envelopeJson = parseJsonTextStrict(bytes);
    if (!envelopeJson.ok) {
      errors.push(
        integrityError("MALFORMED_CONTRACT", `artifact envelope is not strict JSON: ${envelopeJson.error.message}`, path),
      );
      continue;
    }
    const envelope = parseArtifactEnvelope(envelopeJson.value);
    if (!envelope.ok) {
      errors.push(envelope.error);
      continue;
    }
    const value = envelope.value;
    if (
      fileNameHash !== undefined &&
      `sha256:${fileNameHash}` !== value.content_hash
    ) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "artifact path does not match the envelope payload content hash",
          path,
        ),
      );
    }
    const classification = classifySchema(
      value.artifact_schema_id,
      value.artifact_schema_version,
    );
    if (classification.kind === "unknown-schema") {
      errors.push(
        integrityError(
          "UNKNOWN_SCHEMA",
          `unknown artifact schema ${JSON.stringify(value.artifact_schema_id)}`,
          path,
          { schema: value.artifact_schema_id, version: value.artifact_schema_version },
        ),
      );
      continue;
    }
    if (classification.kind === "stale-schema") {
      errors.push(
        integrityError(
          "STALE_SCHEMA",
          `unsupported version ${JSON.stringify(value.artifact_schema_version)} for ${JSON.stringify(value.artifact_schema_id)}`,
          path,
          { schema: value.artifact_schema_id, version: value.artifact_schema_version },
        ),
      );
      continue;
    }
    const payload = value.payload as JsonValue;
    const expectedHash = contentHash(payload);
    if (!expectedHash.ok) {
      errors.push(
        integrityError("MALFORMED_CONTRACT", `cannot canonicalize payload: ${expectedHash.error.message}`, path),
      );
      continue;
    }
    if (expectedHash.value !== value.content_hash) {
      errors.push(
        integrityError("CHANGED_CONTENT", "envelope content_hash does not match its payload", path),
      );
    }
    const payloadCheck = validate(value.artifact_schema_id, value.artifact_schema_version, payload);
    if (!payloadCheck.ok) {
      errors.push(payloadCheck.error);
    }
    if (value.redaction !== undefined) {
      const redaction = verifyRedaction(payload, value.redaction);
      if (!redaction.ok) {
        errors.push(redaction.error);
      }
    }
    if (value.artifact_schema_id === "evidence-set") {
      const evidence = payload as unknown as EvidenceSet;
      if (
        evidence.item_ids.length !== evidence.items.length ||
        evidence.item_ids.some((id, index) => id !== evidence.items[index]?.id)
      ) {
        errors.push(
          integrityError(
            "CHANGED_CONTENT",
            "Evidence Set item_ids do not match its ordered items",
            path,
          ),
        );
      }
      for (const item of evidence.items) {
        const itemContent = contentHash(item.snapshot as JsonValue);
        if (!itemContent.ok || itemContent.value !== item.content_hash) {
          errors.push(
            integrityError(
              "CHANGED_CONTENT",
              `evidence item ${item.id} content_hash does not match its snapshot`,
              path,
            ),
          );
        }
        const idInput: EvidenceHashInput = {
          schema_version: "1.0",
          kind: item.kind,
          identity: item.identity,
          content: item.snapshot as JsonValue,
        };
        const recomputedId = evidenceItemId(idInput);
        if (!recomputedId.ok || recomputedId.value !== item.id) {
          errors.push(
            integrityError(
              "CHANGED_CONTENT",
              `evidence item ${item.id} does not match its kind, identity, and snapshot`,
              path,
            ),
          );
        }
        const itemRedaction = verifyRedaction(
          item as unknown as JsonValue,
          item.redaction,
        );
        if (!itemRedaction.ok) {
          errors.push({ ...itemRedaction.error, path });
        }
        const fresh = checkFreshness(
          [{ id: item.id, fresh_until: item.fresh_until ?? null }],
          options.evaluationTime,
        );
        if (!fresh.ok) {
          errors.push(fresh.error);
        }
      }
    }
    artifacts.set(value.content_hash, value);
  }

  // Every journal reference resolves to an envelope in the same Incident and
  // Run. Keeping the source event context prevents a valid hash from another
  // Run from satisfying the reference.
  for (const reference of artifactReferences) {
    const artifact = artifacts.get(reference.contentHash);
    if (artifact === undefined) {
      errors.push(
        integrityError(
          "MISSING_ARTIFACT",
          "journal references an absent artifact",
          reference.journalPath,
          {
            content_hash: reference.contentHash,
            sequence: reference.sequence,
            source: reference.source,
          },
        ),
      );
      continue;
    }
    if (
      reference.schemaId !== undefined &&
      (artifact.artifact_schema_id !== reference.schemaId ||
        artifact.artifact_schema_version !== reference.schemaVersion)
    ) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "journal artifact reference schema does not match its envelope",
          reference.journalPath,
          {
            referenced_schema: reference.schemaId,
            referenced_version: reference.schemaVersion ?? null,
            envelope_schema: artifact.artifact_schema_id,
            envelope_version: artifact.artifact_schema_version,
            sequence: reference.sequence,
          },
        ),
      );
    }
    if (
      artifact.incident_id !== reference.incidentId ||
      (artifact.run_id ?? undefined) !== reference.runId
    ) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "journal artifact reference Incident or Run does not match its envelope",
          reference.journalPath,
          {
            content_hash: reference.contentHash,
            sequence: reference.sequence,
            referenced_incident_id: reference.incidentId,
            referenced_run_id: reference.runId ?? null,
            envelope_incident_id: artifact.incident_id,
            envelope_run_id: artifact.run_id ?? null,
          },
        ),
      );
    }
  }

  // Test and Verification Reports may only cite receipts recorded for their
  // own Incident Run.
  for (const [contentHashValue, artifact] of artifacts) {
    const receiptRefs: string[] = [];
    if (artifact.artifact_schema_id === "test-report") {
      // SAFETY: validate() parsed this payload against test-report@1.0 above.
      const report = artifact.payload as unknown as TestReport;
      receiptRefs.push(report.receipt_ref);
    }
    if (artifact.artifact_schema_id === "verification-report") {
      // SAFETY: validate() parsed this payload against verification-report@1.0 above.
      const report = artifact.payload as unknown as VerificationReport;
      receiptRefs.push(...report.tests.map((test) => test.receipt_ref));
    }
    for (const receiptRef of receiptRefs) {
      const receiptKey = scopedReferenceKey(
        artifact.incident_id,
        artifact.run_id,
        receiptRef,
      );
      if (!recordedReceiptKeys.has(receiptKey)) {
        errors.push(
          integrityError(
            "MISSING_ARTIFACT",
            `report references receipt ${JSON.stringify(receiptRef)} that was not recorded for its Incident Run`,
            contentHashValue,
            {
              incident_id: artifact.incident_id,
              run_id: artifact.run_id ?? null,
              receipt_ref: receiptRef,
            },
          ),
        );
      }
    }
  }

  // Capture manifests bind a run to its provider, model, skill and tool
  // revisions, budgets, and every role session that ran. When a bundle
  // carries one, every claim it makes must be independently verifiable:
  // the digest self-check, the role record artifact linkage, the role record
  // model-use linkage, and the real-provider requirement.
  const manifestByRun = new Map<string, CaptureManifest>();
  const manifestRunRefs = new Map<string, string>();
  const modelUseAgentIds = new Map<string, Set<string>>();
  const modelUseByAgent = new Map<string, Array<{ incidentId: string; runId: string | undefined; toolCallIds: Set<string> }>>();
  for (const incident of incidents) {
    const agentIds = new Set<string>();
    for (const event of incident.events) {
      if (event.type === "model_use") {
        agentIds.add(event.agent_id);
        const entry = { incidentId: incident.incidentId, runId: event.run_id, toolCallIds: new Set<string>() };
        for (const call of event.tool_calls) {
          entry.toolCallIds.add(call.tool_call_id);
        }
        const perAgent = modelUseByAgent.get(event.agent_id) ?? [];
        perAgent.push(entry);
        modelUseByAgent.set(event.agent_id, perAgent);
      }
    }
    modelUseAgentIds.set(incident.incidentId, agentIds);
  }
  for (const [contentHashValue, artifact] of artifacts) {
    if (artifact.artifact_schema_id !== "capture-manifest") {
      continue;
    }
    // SAFETY: validate() parsed this payload against a registered capture-manifest version above.
    const manifest = artifact.payload as unknown as CaptureManifest;
    manifestByRun.set(
      incidentRunKey(artifact.incident_id, artifact.run_id),
      manifest,
    );
    if (artifact.incident_id !== manifest.incident_id ||
        (artifact.run_id ?? undefined) !== manifest.run_id) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "capture manifest Incident or Run does not match its envelope",
          contentHashValue,
          {
            manifest_incident_id: manifest.incident_id,
            manifest_run_id: manifest.run_id,
            envelope_incident_id: artifact.incident_id,
            envelope_run_id: artifact.run_id ?? null,
          },
        ),
      );
    }
    const selfCheck = contentHash(stripKey(manifest as unknown as JsonValue, "manifest_digest"));
    if (!selfCheck.ok || selfCheck.value !== manifest.manifest_digest) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "capture manifest manifest_digest does not match its payload",
          contentHashValue,
          {
            expected: selfCheck.ok ? selfCheck.value : null,
            actual: manifest.manifest_digest,
          },
        ),
      );
    }
    if (manifest.provider_class === "fixture" && manifest.mode === "full-capture") {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "capture manifest provider_class fixture is not presentation-acceptable",
          contentHashValue,
          { provider_class: manifest.provider_class },
        ),
      );
    }
    for (const record of manifest.role_records) {
      const expectedSchema = TERMINAL_SCHEMA_BY_ROLE[record.role];
      if (record.artifact_ref !== undefined) {
        const linked = artifacts.get(record.artifact_ref);
        if (linked === undefined) {
          errors.push(
            integrityError(
              "MISSING_ARTIFACT",
              `capture manifest role ${record.role} references an absent artifact`,
              contentHashValue,
              { role: record.role, artifact_ref: record.artifact_ref },
            ),
          );
        } else {
          if (
            linked.incident_id !== manifest.incident_id ||
            (linked.run_id ?? undefined) !== manifest.run_id
          ) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} artifact Incident or Run does not match the manifest`,
                contentHashValue,
                {
                  role: record.role,
                  artifact_ref: record.artifact_ref,
                  artifact_incident_id: linked.incident_id,
                  artifact_run_id: linked.run_id ?? null,
                },
              ),
            );
          }
          if (linked.artifact_schema_id !== expectedSchema) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} artifact schema does not match the role`,
                contentHashValue,
                {
                  role: record.role,
                  expected_schema: expectedSchema,
                  actual_schema: linked.artifact_schema_id,
                },
              ),
            );
          }
        }
      } else if (record.status === "succeeded") {
        errors.push(
          integrityError(
            "MISSING_ARTIFACT",
            `capture manifest role ${record.role} succeeded without a sealed artifact`,
            contentHashValue,
            { role: record.role, status: record.status },
          ),
        );
      }
      if (record.run_artifact_ref !== undefined) {
        const runLinked = artifacts.get(record.run_artifact_ref);
        if (runLinked === undefined) {
          errors.push(
            integrityError(
              "MISSING_ARTIFACT",
              `capture manifest role ${record.role} references an absent agent-run artifact`,
              contentHashValue,
              { role: record.role, run_artifact_ref: record.run_artifact_ref },
            ),
          );
        } else {
          const runPayload = runLinked.payload as unknown as AgentRunArtifactWire;
          if (runLinked.artifact_schema_id !== "agent-run-artifact") {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact schema is not agent-run-artifact`,
                contentHashValue,
                {
                  role: record.role,
                  run_artifact_ref: record.run_artifact_ref,
                  actual_schema: runLinked.artifact_schema_id,
                },
              ),
            );
          }
          if (
            runLinked.incident_id !== manifest.incident_id ||
            (runLinked.run_id ?? undefined) !== manifest.run_id
          ) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact Incident or Run does not match the manifest`,
                contentHashValue,
                {
                  role: record.role,
                  run_artifact_ref: record.run_artifact_ref,
                  artifact_incident_id: runLinked.incident_id,
                  artifact_run_id: runLinked.run_id ?? null,
                },
              ),
            );
          }
          if (runPayload.phase !== record.role) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact phase does not match the role`,
                contentHashValue,
                {
                  role: record.role,
                  expected_phase: record.role,
                  actual_phase: runPayload.phase,
                },
              ),
            );
          }
          if (runPayload.agent_id !== record.agent_id) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact agent does not match the record`,
                contentHashValue,
                {
                  role: record.role,
                  expected_agent: record.agent_id,
                  actual_agent: runPayload.agent_id,
                },
              ),
            );
          }
          if (runPayload.status !== record.status) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact status does not match the record`,
                contentHashValue,
                {
                  role: record.role,
                  record_status: record.status,
                  artifact_status: runPayload.status,
                },
              ),
            );
          }
          if (
            record.artifact_ref !== undefined &&
            runPayload.calls.some((call) => call.submission_ref !== null && call.submission_ref !== record.artifact_ref)
          ) {
            errors.push(
              integrityError(
                "MALFORMED_CONTRACT",
                `capture manifest role ${record.role} run artifact submission does not match the record artifact`,
                contentHashValue,
                {
                  role: record.role,
                  artifact_ref: record.artifact_ref,
                },
              ),
            );
          }
          manifestRunRefs.set(
            scopedReferenceKey(manifest.incident_id, manifest.run_id, record.run_artifact_ref),
            record.role,
          );
        }
      }
      const recordedAgentIds = modelUseAgentIds.get(manifest.incident_id);
      for (const agentId of record.model_use_agent_ids) {
        if (recordedAgentIds === undefined || !recordedAgentIds.has(agentId)) {
          errors.push(
            integrityError(
              "MISSING_ARTIFACT",
              `capture manifest role ${record.role} model-use agent ${JSON.stringify(agentId)} has no model_use journal record`,
              contentHashValue,
              { role: record.role, agent_id: agentId },
            ),
          );
        }
      }
    }
  }

  // Agent Run Artifacts persist one role session honestly: stable call
  // identity and order, settled statuses, the sealed terminal result, tool
  // activity linked to journal model-use records, and run-level metrics that
  // aggregate the calls without becoming an alternate source of lifecycle
  // truth. Every failed or aborted attempt is sealed and verified the same
  // way; a bundle that carries a capture manifest must bind every run
  // artifact to its role record and provider class.
  for (const [contentHashValue, artifact] of artifacts) {
    if (artifact.artifact_schema_id !== "agent-run-artifact") {
      continue;
    }
    // SAFETY: validate() parsed this payload against agent-run-artifact@1.0 above.
    const run = artifact.payload as unknown as AgentRunArtifactWire;
    const calls = run.calls;
    if (calls.some((call, index) => call.order !== index)) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "agent run artifact call order is not contiguous from zero",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    const callIds = calls.map((call) => call.call_id);
    if (new Set(callIds).size !== callIds.length) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "agent run artifact call identities are not unique",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    for (const call of calls) {
      if (call.status === "pending" || call.status === "running") {
        errors.push(
          integrityError(
            "MALFORMED_CONTRACT",
            `agent run artifact call ${call.call_id} is not settled`,
            contentHashValue,
            { run_artifact_id: run.run_artifact_id, call_id: call.call_id, status: call.status },
          ),
        );
      }
    }
    const finalCall = calls[calls.length - 1];
    if (finalCall !== undefined && run.status !== finalCall.status) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "agent run artifact status does not match its final call",
          contentHashValue,
          {
            run_artifact_id: run.run_artifact_id,
            artifact_status: run.status,
            call_status: finalCall.status,
          },
        ),
      );
    }
    const submissions = calls.filter((call) => call.submission_ref !== null);
    if (run.status === "succeeded") {
      if (submissions.length !== 1 || submissions[0]?.status !== "succeeded") {
        errors.push(
          integrityError(
            "MALFORMED_CONTRACT",
            "a succeeded agent run artifact needs exactly one succeeded call with a submission",
            contentHashValue,
            { run_artifact_id: run.run_artifact_id, status: run.status },
          ),
        );
      }
    } else if (submissions.length > 0) {
      errors.push(
        integrityError(
          "MALFORMED_CONTRACT",
          "a failed or aborted agent run artifact cannot carry a submission",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id, status: run.status },
        ),
      );
    }
    const expectedTerminalSchema = TERMINAL_SCHEMA_BY_ROLE[run.phase as AgentRoleName];
    for (const call of submissions) {
      const submissionRef = call.submission_ref;
      if (submissionRef === null) {
        continue;
      }
      const linked = artifacts.get(submissionRef);
      if (linked === undefined) {
        errors.push(
          integrityError(
            "MISSING_ARTIFACT",
            `agent run artifact call ${call.call_id} references an absent terminal artifact`,
            contentHashValue,
            { run_artifact_id: run.run_artifact_id, submission_ref: submissionRef },
          ),
        );
        continue;
      }
      if (
        linked.incident_id !== artifact.incident_id ||
        (linked.run_id ?? undefined) !== artifact.run_id
      ) {
        errors.push(
          integrityError(
            "MALFORMED_CONTRACT",
            "agent run artifact submission Incident or Run does not match its envelope",
            contentHashValue,
            {
              run_artifact_id: run.run_artifact_id,
              submission_incident_id: linked.incident_id,
              submission_run_id: linked.run_id ?? null,
            },
          ),
        );
      }
      if (linked.artifact_schema_id !== expectedTerminalSchema) {
        errors.push(
          integrityError(
            "MALFORMED_CONTRACT",
            "agent run artifact submission schema does not match the role phase",
            contentHashValue,
            {
              run_artifact_id: run.run_artifact_id,
              phase: run.phase,
              expected_schema: expectedTerminalSchema ?? null,
              actual_schema: linked.artifact_schema_id,
            },
          ),
        );
      }
      if (
        !journalSealedKeys.has(
          scopedReferenceKey(artifact.incident_id, artifact.run_id, submissionRef),
        )
      ) {
        errors.push(
          integrityError(
            "MISSING_ARTIFACT",
            "agent run artifact submission was not sealed in the same Incident Run",
            contentHashValue,
            { run_artifact_id: run.run_artifact_id, submission_ref: submissionRef },
          ),
        );
      }
    }
    // A session that never reached the provider (a resolution or setup
    // failure before the first turn) has no model_use records to link;
    // only sessions that actually inferred must be traceable to the journal.
    const hasInference = calls.some(
      (call) => call.turns > 0 || call.tool_activity.length > 0,
    );
    const agentUses = hasInference
      ? modelUseByAgent
          .get(run.agent_id)
          ?.filter(
            (use) =>
              use.incidentId === artifact.incident_id &&
              (use.runId ?? undefined) === artifact.run_id,
          ) ?? []
      : [];
    if (agentUses.length === 0 && hasInference) {
      errors.push(
        integrityError(
          "MISSING_ARTIFACT",
          `agent run artifact agent ${run.agent_id} has no model_use journal record in its Incident Run`,
          contentHashValue,
          { run_artifact_id: run.run_artifact_id, agent_id: run.agent_id },
        ),
      );
    }
    const toolCallIds = new Set<string>();
    for (const use of agentUses) {
      for (const id of use.toolCallIds) {
        toolCallIds.add(id);
      }
    }
    for (const call of calls) {
      for (const activity of call.tool_activity) {
        if (agentUses.length > 0 && !toolCallIds.has(activity.tool_call_id)) {
          errors.push(
            integrityError(
              "MISSING_ARTIFACT",
              `agent run artifact tool call ${activity.tool_call_id} has no model_use journal record`,
              contentHashValue,
              {
                run_artifact_id: run.run_artifact_id,
                call_id: call.call_id,
                tool_call_id: activity.tool_call_id,
              },
            ),
          );
        }
      }
    }
    const sumOf = (pick: (call: AgentRunArtifactWire["calls"][number]) => number): number =>
      calls.reduce((total, call) => total + pick(call), 0);
    if (
      run.metrics.duration_ms !==
      sumOf((call) => Date.parse(call.completed_at) - Date.parse(call.started_at))
    ) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact duration_ms does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (run.metrics.prompt_tokens !== sumOf((call) => call.token_use.prompt_tokens)) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact prompt_tokens does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (run.metrics.completion_tokens !== sumOf((call) => call.token_use.completion_tokens)) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact completion_tokens does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (run.metrics.total_tokens !== sumOf((call) => call.token_use.total_tokens)) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact total_tokens does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (run.metrics.tool_call_count !== sumOf((call) => call.tool_activity.length)) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact tool_call_count does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (
      run.metrics.retry_delay_ms !==
      sumOf((call) => call.retry_delay_ms ?? 0)
    ) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact retry_delay_ms does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    if (
      run.metrics.rate_limit_delay_ms !==
      sumOf((call) => call.rate_limit_delay_ms ?? 0)
    ) {
      errors.push(
        integrityError(
          "CHANGED_CONTENT",
          "agent run artifact rate_limit_delay_ms does not match its calls",
          contentHashValue,
          { run_artifact_id: run.run_artifact_id },
        ),
      );
    }
    const manifest = manifestByRun.get(
      incidentRunKey(artifact.incident_id, artifact.run_id),
    );
    if (manifest !== undefined) {
      if (run.provider_class !== manifest.provider_class) {
        errors.push(
          integrityError(
            "MALFORMED_CONTRACT",
            "agent run artifact provider_class does not match the capture manifest",
            contentHashValue,
            {
              run_artifact_id: run.run_artifact_id,
              artifact_provider_class: run.provider_class,
              manifest_provider_class: manifest.provider_class,
            },
          ),
        );
      }
      if (
        !manifestRunRefs.has(
          scopedReferenceKey(artifact.incident_id, artifact.run_id, contentHashValue),
        )
      ) {
        errors.push(
          integrityError(
            "MISSING_ARTIFACT",
            "agent run artifact is not referenced by any capture manifest role record",
            contentHashValue,
            { run_artifact_id: run.run_artifact_id },
          ),
        );
      }
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }
  return ok({ manifest, incidents, artifacts });
}

/** The payload with one top-level key removed, for digest self-checks. */
function stripKey(value: JsonValue, key: string): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const { [key]: _removed, ...rest } = value as Record<string, JsonValue>;
  return rest;
}
