/**
 * Presentation constants for the saved-replay Incident Workspace.
 *
 * `DEMO_EVALUATION_TIME` is the explicit freshness clock the replay adapter
 * uses for every `fresh_until` check. It equals the fixture bundle's capture
 * time, so the demo is deterministic and the adapter never reads the live
 * clock (docs/research/incident-workspace.md "Timestamps are real").
 */
export const DEMO_EVALUATION_TIME = "2026-08-16T12:00:00Z" as const
