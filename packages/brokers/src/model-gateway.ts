/**
 * Model Gateway: routes model calls to the provider and records model use.
 * The gateway holds provider keys; no credential, key, or model budget
 * bypass ever leaves it. The Demo Profile removes token and cost caps, but
 * model-use records still bind the Incident, Run, and agent identities.
 */
import type { ControlPlaneClient, LeaseRef, ModelRequest } from "./types.js"

export class ModelGatewayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

export interface ModelProvider {
  complete(model: string, prompt: string): Promise<{ text: string; promptTokens: number; completionTokens: number }>
}

/** A deterministic local provider stub for the demo (no real model). */
export const stubProvider: ModelProvider = {
  async complete(model, prompt) {
    return {
      text: `[stub:${model}] echo of ${prompt.length} chars`,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: 8,
    }
  },
}

export class ModelGateway {
  constructor(
    private readonly cp: ControlPlaneClient,
    private readonly provider: ModelProvider = stubProvider,
  ) {}

  async complete(lease: LeaseRef, request: ModelRequest): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const verified = await this.cp.verifyLease(lease)
    if (!verified.valid) {
      throw new ModelGatewayError("STALE_LEASE", verified.error ?? "lease verification failed")
    }

    const result = await this.provider.complete(request.model, request.prompt)

    await this.cp.recordModelUse(lease.incidentId, lease.runId, {
      parent_agent_id: request.parentAgentId,
      agent_id: request.agentId,
      agent_role: request.agentRole,
      model: request.model,
      token_use: { prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens },
      tool_calls: [],
      idempotency_key: request.idempotencyKey,
    })

    return result
  }
}
