/**
 * The Compose release adapter contract: declared reads, write classes,
 * idempotency, and credential needs, with a local-only per-system table.
 *
 * The adapter is the Demo Profile stand-in for a company deployment system.
 * It never hands a credential to a Worker; it executes the two-step probe ring
 * (stage 1 candidate with probe traffic, stage 2 live swap) itself, records
 * idempotency keys, and checks the expected target version before mutating.
 */
export type WriteClass =
  | "submit_remediation_pr"
  | "submit_typed_action"
  | "request_isolated_ci"
  | "request_rollback"
  | "request_browser_session"
  | "request_test_secret"

export interface AdapterContract {
  adapter: string
  /** Declared read operations (selectors + the backend they read). */
  reads: { selector: string; backend: string }[]
  /** Declared write classes and whether the adapter approves each for
   * unattended use. */
  writes: { action_class: WriteClass; approved: boolean; risk_class: "safe" | "guarded" | "barred" }[]
  /** Idempotency: the key space and first-result semantics. */
  idempotency: { key_fields: string[]; stores_first_result: boolean }
  /** Credential needs: scoped execution identities only; none leave the
   * adapter. */
  credentials: { kind: string; scope: string; never_issued_to_worker: true }
}

/** The local-only per-system table. Each entry is a local stub; the table
 * declares the contract without any production integration. */
export const COMPOSE_RELEASE_CONTRACT: AdapterContract[] = [
  {
    adapter: "compose-release",
    reads: [
      { selector: "compose.service.version", backend: "docker-compose" },
      { selector: "compose.project.file", backend: "local-fs" },
    ],
    writes: [
      { action_class: "submit_remediation_pr", approved: false, risk_class: "guarded" },
      { action_class: "submit_typed_action", approved: true, risk_class: "safe" },
      { action_class: "request_rollback", approved: true, risk_class: "guarded" },
    ],
    idempotency: {
      key_fields: ["incident_id", "run_id", "candidate_hash", "target", "stage"],
      stores_first_result: true,
    },
    credentials: { kind: "local-docker", scope: "demo network only", never_issued_to_worker: true },
  },
  {
    adapter: "local-git",
    reads: [
      { selector: "repo.commit", backend: "local-git" },
      { selector: "repo.diff", backend: "local-git" },
    ],
    writes: [{ action_class: "submit_remediation_pr", approved: true, risk_class: "safe" }],
    idempotency: {
      key_fields: ["incident_id", "run_id", "candidate_hash", "branch"],
      stores_first_result: true,
    },
    credentials: { kind: "none", scope: "local bare repo", never_issued_to_worker: true },
  },
  {
    adapter: "local-ci",
    reads: [],
    writes: [{ action_class: "request_isolated_ci", approved: true, risk_class: "safe" }],
    idempotency: {
      key_fields: ["incident_id", "run_id", "candidate_hash", "pipeline_run_id"],
      stores_first_result: true,
    },
    credentials: { kind: "none", scope: "isolated worktree", never_issued_to_worker: true },
  },
  {
    adapter: "browser-session",
    reads: [],
    writes: [{ action_class: "request_browser_session", approved: true, risk_class: "safe" }],
    idempotency: {
      key_fields: ["incident_id", "run_id", "stage"],
      stores_first_result: true,
    },
    credentials: { kind: "none", scope: "candidate instance", never_issued_to_worker: true },
  },
]

export function findContract(adapter: string): AdapterContract | undefined {
  return COMPOSE_RELEASE_CONTRACT.find((entry) => entry.adapter === adapter)
}

export function isWriteApproved(adapter: string, actionClass: WriteClass): boolean {
  return findContract(adapter)?.writes.some((write) => write.action_class === actionClass && write.approved) ?? false
}
