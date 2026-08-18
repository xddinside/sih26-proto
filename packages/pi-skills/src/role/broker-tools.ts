/**
 * The brokered read tool a Pi role calls. Every invocation carries the run
 * lease and records a receipt binding the Incident, Run, stage, actor, and
 * candidate hash. A rejected call throws before any data moves and before
 * any receipt exists, so a refused read causes no durable mutation and no
 * fabricated receipt.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type } from "@earendil-works/pi-ai"
import type { ReadBroker, LeaseRef  } from "@sih/brokers"

export interface BrokerReadToolOptions {
  broker: ReadBroker
  lease: LeaseRef
  /** The candidate hash every read binds to. */
  candidateHash: string
  name?: string
}

const parameters = Type.Object({
  backend: Type.String({ description: "The read backend, e.g. prometheus, flagd, or git" }),
  connection_id: Type.String({ description: "The backend connection to query" }),
  query: Type.String({ description: "The bounded query text" }),
})
interface ReadParams {
  backend: string
  connection_id: string
  query: string
}

export function createReadTool(options: BrokerReadToolOptions): AgentTool<any> {
  return {
    name: options.name ?? "read_broker_query",
    description:
      "Run a bounded, lease-scoped query through the Read Broker. " +
      "The result is returned with its content hash and receipt id; " +
      "a refused read returns an error result without any durable effect.",
    label: "Brokered read",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const p = params as ReadParams
      const { result, receiptId } = await options.broker.read(
        options.lease,
        {
          backend: p.backend,
          connection_id: p.connection_id,
          query: p.query,
        },
        options.candidateHash,
      )
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              outcome: result.outcome,
              row_count: result.row_count,
              content_hash: result.content_hash,
              data: result.data,
            }),
          },
        ],
        details: {
          receiptId,
          outcome: result.outcome,
          content_hash: result.content_hash,
          row_count: result.row_count,
        },
      }
    },
  }
}
