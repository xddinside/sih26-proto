/**
 * The explicit, versioned schema registry.
 *
 * Every wire schema this package ships is registered here by name and version.
 * Most artifact schemas are at `1.0`; the Orchestrator-aware journal and
 * capture manifest are at `1.1` with their `1.0` readers retained. A name absent from the registry is
 * `UNKNOWN_SCHEMA`; a known name with an unsupported version is
 * `STALE_SCHEMA`. This registry is deliberately explicit: adding a schema is
 * a code change, not a runtime extension.
 */
import type { JsonValue } from "../result.js";

import {
  captureManifestSchema,
  captureManifestSchemaV1,
  implementedDiffSchema,
  orchestratorReportSchema,
  remediationDraftSchema,
} from "./agent.js";
import { agentRunArtifactSchema } from "./agent-run.js";
import { artifactEnvelopeSchema } from "./artifact-envelope.js";
import { brokerReceiptSchema } from "./broker-receipt.js";
import { evidenceItemSchema, evidenceSetSchema } from "./evidence.js";
import { gateEvaluationSchema } from "./gate-evaluation.js";
import {
  fusionJudgeOutputSchema,
  fusionParticipantOutputSchema,
  fusionRunArtifactSchema,
  fusionSynthesizerOutputSchema,
} from "./fusion.js";
import {
  candidateHashInputSchema,
  deliveryKeyInputSchema,
  evidenceHashInputSchema,
  incidentKeyInputSchema,
} from "./hash-inputs.js";
import { hypothesisSchema } from "./hypothesis.js";
import { incidentRunSchema, incidentSchema, stageRecordSchema } from "./incident.js";
import { incidentTriggerSchema } from "./incident-trigger.js";
import { journalEventSchema, journalEventSchemaV1 } from "./journal-event.js";
import {
  diagnosisReportSchema,
  incidentBriefSchema,
  incidentReportSchema,
  remediationProposalSchema,
  reviewReportSchema,
  testReportSchema,
  verificationReportSchema,
  watchReportSchema,
} from "./reports.js";
import { directActionRecordSchema, recoveryPointSchema, releaseRecordSchema } from "./release-records.js";
import { savedBundleManifestSchema } from "./saved-bundle-manifest.js";
import { rolloutWatchPlanSchema } from "./rollout-watch-plan.js";
import {
  orchestratorLifecycleStateSchema,
  orchestratorWorkRequestSchema,
  orchestratorWorkResultSchema,
} from "../orchestrator.js";

export {
  orchestratorLifecycleStateSchema,
  orchestratorWorkRequestSchema,
  orchestratorWorkResultSchema,
} from "../orchestrator.js";

/**
 * A JSON Schema Draft 2020-12 document. Root schemas carry an `$id`; embedded
 * subschemas are anonymous and carry only the `$schema` keyword.
 */
export interface JsonSchema {
  readonly $id?: string;
  readonly [keyword: string]: unknown;
}

const versionMap = (schema: JsonSchema) => ({ "1.0": schema }) as const;

/** Every supported schema, keyed by its stable name and version. */
export const SCHEMA_REGISTRY = {
  "incident-trigger": versionMap(incidentTriggerSchema),
  "evidence-item": versionMap(evidenceItemSchema),
  "evidence-set": versionMap(evidenceSetSchema),
  hypothesis: versionMap(hypothesisSchema),
  incident: versionMap(incidentSchema),
  "incident-run": versionMap(incidentRunSchema),
  "stage-record": versionMap(stageRecordSchema),
  "journal-event": { "1.0": journalEventSchemaV1, "1.1": journalEventSchema },
  "artifact-envelope": versionMap(artifactEnvelopeSchema),
  "saved-bundle-manifest": versionMap(savedBundleManifestSchema),
  "broker-receipt": versionMap(brokerReceiptSchema),
  "gate-evaluation": versionMap(gateEvaluationSchema),
  "fusion-participant-output": versionMap(fusionParticipantOutputSchema),
  "fusion-judge-output": versionMap(fusionJudgeOutputSchema),
  "fusion-synthesizer-output": versionMap(fusionSynthesizerOutputSchema),
  "fusion-run-artifact": versionMap(fusionRunArtifactSchema),
  "incident-brief": versionMap(incidentBriefSchema),
  "diagnosis-report": versionMap(diagnosisReportSchema),
  "remediation-proposal": versionMap(remediationProposalSchema),
  "review-report": versionMap(reviewReportSchema),
  "test-report": versionMap(testReportSchema),
  "verification-report": versionMap(verificationReportSchema),
  "watch-report": versionMap(watchReportSchema),
  "rollout-watch-plan": versionMap(rolloutWatchPlanSchema),
  "release-record": versionMap(releaseRecordSchema),
  "direct-action-record": versionMap(directActionRecordSchema),
  "recovery-point": versionMap(recoveryPointSchema),
  "incident-report": versionMap(incidentReportSchema),
  "candidate-hash-input": versionMap(candidateHashInputSchema),
  "evidence-hash-input": versionMap(evidenceHashInputSchema),
  "incident-key-input": versionMap(incidentKeyInputSchema),
  "delivery-key-input": versionMap(deliveryKeyInputSchema),
  "remediation-draft": versionMap(remediationDraftSchema),
  "implemented-diff": versionMap(implementedDiffSchema),
  "orchestrator-report": versionMap(orchestratorReportSchema),
  "capture-manifest": { "1.0": captureManifestSchemaV1, "1.1": captureManifestSchema },
  "agent-run-artifact": versionMap(agentRunArtifactSchema),
  "orchestrator-work-request": versionMap(orchestratorWorkRequestSchema),
  "orchestrator-lifecycle": versionMap(orchestratorLifecycleStateSchema),
  "orchestrator-work-result": versionMap(orchestratorWorkResultSchema),
} as const;

/** The names of every registered schema. */
export type SchemaName = keyof typeof SCHEMA_REGISTRY;

/** The supported schema version string. */
export type SchemaVersion = "1.0" | "1.1";

/** Outcome of classifying a schema name/version pair. */
export type SchemaClassification =
  | { kind: "ok"; name: SchemaName; version: SchemaVersion; schema: JsonSchema }
  | { kind: "unknown-schema"; name: string }
  | { kind: "stale-schema"; name: string; version: string };

/**
 * Classify a schema name and version against the registry. Unknown names and
 * known names with unsupported versions are explicit, stable outcomes.
 */
export function classifySchema(
  name: string,
  version: string,
): SchemaClassification {
  const byName = (
    SCHEMA_REGISTRY as Record<string, Record<string, JsonSchema> | undefined>
  )[name];
  if (byName === undefined) {
    return { kind: "unknown-schema", name };
  }
  const schema = byName[version];
  if (schema === undefined) {
    return { kind: "stale-schema", name, version };
  }
  return {
    kind: "ok",
    name: name as SchemaName,
    version: version as SchemaVersion,
    schema,
  };
}

/** The `$id` used to register a schema with Ajv. */
export function schemaId(name: SchemaName, version: SchemaVersion): string {
  const schema = (SCHEMA_REGISTRY[name] as Record<string, JsonSchema>)[version];
  return schema?.$id ?? `${name}@${version}`;
}

/** A stable, synthetic registration key for a schema name/version pair. */
export function schemaKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/** Every registered schema document, in registry order. */
export function allSchemas(): JsonSchema[] {
  return Object.values(SCHEMA_REGISTRY).flatMap((versions) =>
    Object.values(versions as Record<string, JsonSchema>),
  );
}

/** A parsed-and-validated payload whose exact schema is not statically known. */
export type SchemaPayload = JsonValue;
