/**
 * Formatting and citation-label helpers for saved-truth rendering.
 *
 * Every rendered number or fact carries a citation binding to a saved row,
 * receipt, artifact, or the manifest. These helpers turn the machine source
 * into a short, human label so the binding is visible next to the value.
 */

/** Matches the contract's `sha256:<64 hex>` hash shape. */
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

/** True when the string is a well-formed prefixed SHA-256 hash. */
function isHashString(value: string): boolean {
  return HASH_PATTERN.test(value)
}

/** Where a rendered fact comes from. */
export type SourceKind = "journal" | "receipt" | "artifact" | "manifest" | "replay"

/** A citation binding attached to a rendered value. */
export interface Source {
  kind: SourceKind
  /** Short machine reference: sequence number, receipt id, or hash. */
  ref: string
  /** Optional schema id for artifact citations. */
  schemaId?: string
}

/** A rendered number or fact with its saved-source citation. */
export interface CitedValue {
  /** The rendered value, already formatted as a string. */
  text: string
  /** The citation binding for this value. */
  source: Source
}

/** Shorten a `sha256:` content hash for a compact citation. */
export function shortHash(hash: string): string {
  if (!isHashString(hash)) {
    return hash
  }
  return `${hash.slice(0, 7)}…${hash.slice(-6)}`
}

/** The full length of the hex portion of a `sha256:` hash. */
const SHA256_HEX = 64

/** Shorten an arbitrary hash-like string, preserving a readable prefix. */
export function abbreviate(ref: string, length = 10): string {
  if (ref.length <= length) {
    return ref
  }
  return `${ref.slice(0, length)}…`
}

/** Human label for a citation binding. */
export function sourceLabel(source: Source): string {
  switch (source.kind) {
    case "journal":
      return `journal #${source.ref}`
    case "receipt":
      return `receipt ${source.ref}`
    case "artifact":
      return `${source.schemaId ?? "artifact"} ${shortHash(source.ref)}`
    case "manifest":
      return "manifest"
    case "replay":
      return "journal replay"
  }
}

/** The short reference token of a citation binding. */
export function sourceRef(source: Source): string {
  if (source.kind === "artifact") {
    return shortHash(source.ref)
  }
  return source.ref
}

/** Format an RFC 3339 timestamp for display; falls back to the raw string. */
export function formatTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) {
    return timestamp
  }
  return new Date(parsed).toUTCString()
}

/** Format a saved numeric ratio with its recorded unit, never inventing one. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
}

/** Format a ratio value with its unit, e.g. "0.92" for a dimensionless ratio. */
export function formatRatio(value: number, unit: string | undefined): string {
  const body = formatNumber(value)
  if (unit === undefined || unit === "" || unit === "1") {
    return body
  }
  return `${body} ${unit}`
}

/** A hash string's displayed length after abbreviation. */
export const SHA256_DISPLAY_LENGTH = SHA256_HEX
