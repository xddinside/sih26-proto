/**
 * HMAC signing and verification for the demo trigger path
 * (docs/research/incident-intake.md: HMAC signature with timestamp and nonce
 * in the demo; mTLS in private installs). The signature covers the exact
 * request body bytes plus the timestamp and nonce, so a replay or a byte
 * change fails before any Incident Run starts.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

export interface SignedEnvelope {
  timestamp: string
  nonce: string
  signature: string
}

export function signBody(
  secret: string,
  body: string,
  timestamp: string,
  nonce: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex")
}

export function verifyBody(
  secret: string,
  body: string,
  envelope: SignedEnvelope,
): boolean {
  const expected = signBody(secret, body, envelope.timestamp, envelope.nonce)
  const expectedBytes = Buffer.from(expected, "hex")
  const receivedBytes = Buffer.from(envelope.signature, "hex")
  if (expectedBytes.length !== receivedBytes.length) {
    return false
  }
  return timingSafeEqual(expectedBytes, receivedBytes)
}

/** Reject timestamps too far from server time (a bounded late window). */
export function isStaleSignature(timestamp: string, now: Date, toleranceSeconds: number): boolean {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) {
    return true
  }
  return Math.abs(now.getTime() - time) > toleranceSeconds * 1000
}
