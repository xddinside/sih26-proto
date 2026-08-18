/**
 * Credential hygiene for role sessions. Nothing in a session's transcript,
 * journal, error message, or record may carry the provider key or an
 * authorization header. This helper scrubs both from any text before it
 * leaves the session.
 */
const AUTHORIZATION_PATTERN = /authorization:\s*(?:bearer\s+)?[^\s,;]+/gi
const BEARER_PATTERN = /bearer\s+[^\s,;]+/gi

/** Replace every known secret and provider authorization header in `text`. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length > 0) {
      out = out.split(secret).join("[REDACTED]")
    }
  }
  return out
    .replace(AUTHORIZATION_PATTERN, "authorization: [REDACTED]")
    .replace(BEARER_PATTERN, "bearer [REDACTED]")
}

/** True when none of the secrets appears in `text`. */
export function containsNoSecrets(text: string, secrets: readonly string[]): boolean {
  return !secrets.some((secret) => secret.length > 0 && text.includes(secret))
}
