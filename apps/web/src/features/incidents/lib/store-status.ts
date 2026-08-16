/**
 * Saved-bundle integrity state mapping, from docs/build-handoff.md section 9
 * and the stable error vocabulary in `@sih/contracts/errors`.
 *
 * The replay adapter returns named `IntegrityError` values (or filesystem
 * load failures) instead of throwing. Each stable code maps to one rendered
 * state so the Workspace can show a truthful, stable page for corrupt, stale,
 * redacted, unknown, or missing data — never a half-rendered view.
 */
import type { IntegrityErrorCode } from "@sih/contracts/errors"

/** One loader failure: a contracts integrity error or a filesystem read error. */
export interface ReplayFailure {
  code?: string
  kind?: string
  message: string
  path?: string
}

/** The rendered integrity state a saved bundle can be in. */
export type IntegrityState =
  | "ok"
  | "missing-bundle"
  | "missing-artifact"
  | "corrupt-content"
  | "bad-sequence"
  | "illegal-transition"
  | "duplicate-transition"
  | "stale-schema"
  | "unknown-schema"
  | "stale-data"
  | "redaction-failure"
  | "invalid-path"
  | "malformed"
  | "unknown"

/** Copy for one rendered integrity state. */
export interface IntegrityStateCopy {
  /** Short, specific heading. */
  title: string
  /** One-line explanation of what failed, in plain language. */
  description: string
  /** A detail sentence the error list supplements, prose only. */
  detail: string
}

/** Priority order used when several failures are reported at once. */
const STATE_PRIORITY: readonly IntegrityState[] = [
  "missing-bundle",
  "corrupt-content",
  "bad-sequence",
  "illegal-transition",
  "duplicate-transition",
  "stale-data",
  "redaction-failure",
  "unknown-schema",
  "stale-schema",
  "missing-artifact",
  "malformed",
  "invalid-path",
  "unknown",
]

const CODE_TO_STATE: Readonly<Record<IntegrityErrorCode, IntegrityState>> = {
  MALFORMED_CONTRACT: "malformed",
  BAD_SEQUENCE: "bad-sequence",
  ILLEGAL_TRANSITION: "illegal-transition",
  DUPLICATE_TRANSITION: "duplicate-transition",
  STALE_SCHEMA: "stale-schema",
  UNKNOWN_SCHEMA: "unknown-schema",
  STALE_DATA: "stale-data",
  REDACTION_FAILURE: "redaction-failure",
  MISSING_ARTIFACT: "missing-artifact",
  CHANGED_CONTENT: "corrupt-content",
  INVALID_PATH: "invalid-path",
}

const COPY: Readonly<Record<IntegrityState, IntegrityStateCopy>> = {
  ok: {
    title: "Saved bundle verified",
    description: "The saved bundle passed every integrity check.",
    detail: "This state is not rendered as a page.",
  },
  "missing-bundle": {
    title: "Saved bundle unavailable",
    description: "The saved Demo Run bundle could not be read from disk.",
    detail:
      "The presentation reads a saved bundle only. Confirm the export directory exists and contains manifest.json.",
  },
  "missing-artifact": {
    title: "Artifact not in this saved bundle",
    description: "A referenced incident or artifact is absent from the saved bundle.",
    detail:
      "No data is fabricated to fill the gap. The referenced record simply is not part of this capture.",
  },
  "corrupt-content": {
    title: "Content does not match its hash",
    description: "A file or payload in the saved bundle failed its content-hash check.",
    detail:
      "The bundle was modified after capture, or a sealed payload no longer binds to its recorded hash.",
  },
  "bad-sequence": {
    title: "Journal sequence is broken",
    description: "The saved journal has a gap, duplicate, or a final sequence mismatch.",
    detail:
      "Replay orders events by journal sequence, never wall clock. A broken sequence stops replay rather than guessing order.",
  },
  "illegal-transition": {
    title: "Illegal journal transition",
    description: "A journal event records a state change that the fixed rules forbid.",
    detail:
      "The saved journal is the durable record. An illegal transition means the capture itself is inconsistent.",
  },
  "duplicate-transition": {
    title: "Duplicate journal transition",
    description: "A journal idempotency key or sequence appears more than once.",
    detail:
      "The append-only journal must be idempotent. A duplicate means the capture was double-written.",
  },
  "stale-schema": {
    title: "Unsupported schema version",
    description: "An artifact names a schema version this build does not understand.",
    detail:
      "Schema versions are pinned and shown. A version newer than the viewer's registry is flagged, never guessed at.",
  },
  "unknown-schema": {
    title: "Unknown schema",
    description: "An artifact names a schema this build does not recognize.",
    detail:
      "Unknown data is labeled unknown. The viewer never renders a value it cannot validate.",
  },
  "stale-data": {
    title: "Evidence has expired",
    description: "A saved evidence item is past its recorded fresh_until time.",
    detail:
      "Freshness is a recorded field, not bundle age. Expired items are marked, never treated as current.",
  },
  "redaction-failure": {
    title: "Redaction is broken",
    description: "A masked field does not resolve to the recorded redaction marker.",
    detail:
      "Redaction is structural. A field listed as masked must contain the literal mask, or the bundle fails.",
  },
  "invalid-path": {
    title: "Invalid saved-bundle path",
    description: "A file path in the saved bundle is not a valid POSIX relative path.",
    detail:
      "Saved bundle paths are validated exactly; an invalid path is rejected rather than followed.",
  },
  malformed: {
    title: "Malformed contract",
    description: "A file in the saved bundle is not valid strict JSON or fails its schema.",
    detail:
      "The saved bundle is a contract. A file that does not validate is a capture defect.",
  },
  unknown: {
    title: "Replay failed",
    description: "The saved bundle could not be replayed.",
    detail:
      "The failure did not map to a known integrity code; the raw error list follows.",
  },
}

/** An integrity error mapped to its rendered copy, with the code preserved. */
export interface MappedError {
  code: string
  state: IntegrityState
  copy: IntegrityStateCopy
  path?: string
  message: string
}

function stateOf(code: string | undefined, kind: string | undefined): IntegrityState {
  if (kind === "filesystem") {
    return "missing-bundle"
  }
  if (code === undefined) {
    return "unknown"
  }
  return CODE_TO_STATE[code as IntegrityErrorCode]
}

/**
 * Map a list of replay failures to a single dominant state plus the full,
 * per-error list. Each error keeps its stable code so the rendered page can
 * cite the contract's error vocabulary verbatim.
 */
export function mapReplayFailures(failures: readonly ReplayFailure[]): {
  state: IntegrityState
  copy: IntegrityStateCopy
  errors: MappedError[]
} {
  const errors = failures.map((failure) => {
    const state = stateOf(failure.code, failure.kind)
    return {
      code: failure.code ?? failure.kind ?? "UNKNOWN",
      state,
      copy: COPY[state],
      path: failure.path,
      message: failure.message,
    }
  })

  let dominant: IntegrityState = "unknown"
  for (const state of STATE_PRIORITY) {
    if (errors.some((error) => error.state === state)) {
      dominant = state
      break
    }
  }

  return { state: dominant, copy: COPY[dominant], errors }
}

/** The rendered copy for a known integrity state, with a safe fallback. */
export function copyForState(state: IntegrityState): IntegrityStateCopy {
  return COPY[state]
}
