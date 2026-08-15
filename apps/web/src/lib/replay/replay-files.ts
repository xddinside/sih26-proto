/**
 * Saved-bundle input and verification vocabulary for the replay adapter, from
 * docs/build-handoff.md section 9 and docs/research/incident-workspace.md.
 *
 * A saved bundle is the settled static layout the Incident Workspace replays:
 * `manifest.json`, `incidents/<incident-id>/journal.jsonl`, and
 * content-addressed `artifacts/sha256/<sha256-hex>.json` envelopes. The
 * adapter treats a bundle as an in-memory map of POSIX relative path to exact
 * UTF-8 file text. The server-only loader in `load-saved-bundle-fs.ts` is the
 * only module allowed to touch the filesystem.
 */

/** An in-memory saved bundle: POSIX relative path to exact UTF-8 file text. */
export type SavedFileMap = ReadonlyMap<string, string>

/**
 * Replay verification options. `evaluationTime` is the explicit freshness
 * clock: the adapter never reads the live clock, so replay is deterministic
 * for a fixed bundle and evaluation time.
 */
export interface ReplayOptions {
  /** RFC 3339 timestamp used for every `fresh_until` freshness check. */
  evaluationTime: string
}
