/**
 * HTTP Control Plane proposals: the Worker calls the Control Plane's internal
 * routes for stage commands, sealing, and gate evaluations. Every durable
 * write goes through these routes; the Worker has no other path. In the Demo
 * Profile the local Control Plane process serves these routes; the smoke can
 * also drive the Control Plane in-process.
 *
 * Known demo-surface constraints (Solution Contract: proposal APIs):
 * - the gate routes require the demo broker token (the local prototype keeps
 *   broker-side tokens on the same host);
 * - lease acquisition and per-stage re-issuance run in-process in the demo
 *   (`ControlPlane.startRun` / `leaseService.issueRunLease`); the deployed
 *   Worker exchanges its projected token at a dedicated endpoint.
 */
import type {
  HypothesisGateInput,
  ApplicabilityInput,
  ApplicabilityResult,
  GateEvaluationResponse,
  VerificationInput,
  ControlPlaneProposals,
} from "./orchestrator.js"

export interface HttpProposalsOptions {
  baseUrl: string
  /** The run lease token plus claims, verified server-side on every call. */
  lease: {
    leaseId: string
    token: string
    claims: {
      incidentId: string
      runId: string
      attempt: number
      stage: string
      actorId: string
      actorKind: "orchestrator" | "control-plane"
      toolClass: string
    }
  }
  /** Demo broker token for the gate and policy-decision routes. */
  brokerToken: string
}

async function post(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token: string | undefined
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string }
    [key: string]: unknown
  }
  if (response.status >= 400) {
    throw new Error(parsed.error?.code ?? `control plane ${response.status}`)
  }
  return parsed
}

export class HttpControlPlaneProposals implements ControlPlaneProposals {
  constructor(private readonly options: HttpProposalsOptions) {}

  private get baseUrl(): string {
    return this.options.baseUrl
  }

  async sealArtifact(
    input: Parameters<ControlPlaneProposals["sealArtifact"]>[0]
  ): Promise<{
    artifact_ref: {
      schema_id: string
      schema_version: string
      content_hash: string
    }
  }> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/seal",
      {
        token: lease.token,
        lease_id: lease.leaseId,
        claims: lease.claims,
        seal: {
          schema_id: input.schemaId,
          schema_version: input.schemaVersion,
          payload: input.payload,
        },
      },
      undefined
    )
    return {
      artifact_ref: result.artifact_ref as {
        schema_id: string
        schema_version: string
        content_hash: string
      },
    }
  }

  async stageCommand(
    command: Parameters<ControlPlaneProposals["stageCommand"]>[0]
  ): Promise<void> {
    const { lease } = this.options
    await post(
      this.baseUrl,
      "/v1/internal/command",
      {
        token: lease.token,
        incident_id: lease.claims.incidentId,
        claims: lease.claims,
        command,
      },
      undefined
    )
  }

  async completeRun(
    outcome:
      "verified-remediation" | "symptom-cleared" | "diagnosis-only" | "handoff"
  ): Promise<void> {
    const { lease } = this.options
    await post(
      this.baseUrl,
      "/v1/internal/command",
      {
        token: lease.token,
        incident_id: lease.claims.incidentId,
        claims: lease.claims,
        command: { kind: "complete-run", outcome },
      },
      undefined
    )
  }

  async failRun(failureReason: string): Promise<void> {
    const { lease } = this.options
    await post(
      this.baseUrl,
      "/v1/internal/command",
      {
        token: lease.token,
        incident_id: lease.claims.incidentId,
        claims: lease.claims,
        command: { kind: "fail-run", failure_reason: failureReason },
      },
      undefined
    )
  }

  async requestHypothesisGate(
    input: HypothesisGateInput
  ): Promise<{ verdict: string; evaluation: unknown }> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/gates/hypothesis",
      {
        token: this.options.brokerToken,
        incident_id: lease.claims.incidentId,
        run_id: lease.claims.runId,
        input,
      },
      this.options.brokerToken
    )
    return { verdict: String(result.verdict), evaluation: result.evaluation }
  }

  /** Not exposed as its own route today; the verification route resolves
   * applicability and the verdict together. The demo drives the resolver
   * in-process; this client keeps the seam for the Solution Contract. */
  async resolveApplicability(
    _input: ApplicabilityInput
  ): Promise<ApplicabilityResult> {
    throw new Error(
      "applicability resolution has no dedicated internal route; the Control Plane computes it inside the verification verdict (demo: in-process resolver)"
    )
  }

  async requestVerificationVerdict(
    input: VerificationInput
  ): Promise<{
    verdict: string
    reason: string
    artifact_ref: {
      schema_id: string
      schema_version: string
      content_hash: string
    }
  }> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/gates/verification",
      {
        token: this.options.brokerToken,
        incident_id: lease.claims.incidentId,
        run_id: lease.claims.runId,
        input,
      },
      this.options.brokerToken
    )
    return {
      verdict: String(result.verdict),
      reason: String(result.reason),
      artifact_ref: result.artifact_ref as {
        schema_id: string
        schema_version: string
        content_hash: string
      },
    }
  }

  async requestReleaseGate(
    input: Record<string, unknown>
  ): Promise<GateEvaluationResponse> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/gates/release",
      {
        token: this.options.brokerToken,
        incident_id: lease.claims.incidentId,
        run_id: lease.claims.runId,
        input,
      },
      this.options.brokerToken
    )
    return {
      verdict: String(result.verdict),
      permit: (result.permit as GateEvaluationResponse["permit"]) ?? null,
    }
  }

  async requestActionGate(
    input: Record<string, unknown>
  ): Promise<GateEvaluationResponse> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/gates/action",
      {
        token: this.options.brokerToken,
        incident_id: lease.claims.incidentId,
        run_id: lease.claims.runId,
        input,
      },
      this.options.brokerToken
    )
    return {
      verdict: String(result.verdict),
      permit: (result.permit as GateEvaluationResponse["permit"]) ?? null,
    }
  }

  async policyDecision(
    action: {
      adapter: string
      action_class: string
      command: string
      category: string
      target: string
    },
    stage: string
  ): Promise<{ decision: string; reason: string; riskClass: string }> {
    const { lease } = this.options
    const result = await post(
      this.baseUrl,
      "/v1/internal/policy-decision",
      {
        token: this.options.brokerToken,
        incident_id: lease.claims.incidentId,
        action,
        stage,
      },
      this.options.brokerToken
    )
    return {
      decision: String(result.decision),
      reason: String(result.reason),
      riskClass: String(result.riskClass),
    }
  }
}
