/**
 * Broker package barrel. Brokers are callers; only the Control Plane writes
 * durable state. Each broker checks server-side lease state and records a
 * receipt binding the Incident, Run, stage, actor, target, and candidate
 * hash.
 */
export { ReadBroker, ReadBrokerError } from "./read-broker.js"
export { ActionBroker, ActionBrokerError } from "./action-broker.js"
export {
  ModelGateway,
  ModelGatewayError,
  stubProvider,
  piAiStreamingProvider,
  scriptedStreamingProvider,
} from "./model-gateway.js"
export type {
  ModelProvider,
  GatewayStreamRequest,
  GatewayStreamingProvider,
  ScriptedTurn,
  ScriptedStreamingOptions,
} from "./model-gateway.js"
export { HttpControlPlaneClient, FakeControlPlaneClient, contentHashOf } from "./cp-client.js"
export type { ControlPlaneClient, LeaseRef, ReadRequest, ReadResult, ActionRequest, ModelRequest, BrokerOutcome } from "./types.js"
export { readReceipt, actionReceipt, ciReceipt, testReceipt } from "./receipts.js"
