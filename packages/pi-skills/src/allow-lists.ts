/**
 * Per-session tool allow-lists from docs/research/pi-agent-catalog.md.
 *
 * `contract.json` names a tool group; this module maps the group to concrete
 * tool names and rejects forbidden tool classes. The SIH extension applies the
 * resolved list per session through `pi.setActiveTools` before the first turn
 * (the `applyActiveTools` seam here), and brokers re-check everything
 * server-side. A read-only or test skill therefore sees no write, shell,
 * direct-production, or credential tool, and the broker denies the same
 * request regardless of what a session asks.
 */
import type { StageName } from "@sih/contracts/transitions"

/** In-Worker tool names from the brokered tool catalog. */
export type ToolName =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "edit"
  | "write"
  | "patch_apply"
  | "local_build_test"
  | "docs_proxy"
  | "readonly_analyzer"
  | "artifact_draft"
  | "evidence_note"
  | "spawn_subagent"
  | "propose_artifact"
  | "propose_transition"
  | "request_gate_evaluation"
  | "request_applicability"
  | "request_test_run"
  | "execution_request"
  | "receipt_read"
  | "browser_drive"
  | "read_broker_query"
  | "experiment_proposal"
  | "submit_remediation_pr"

/**
 * The tool-group -> tool-name mapping. Groups stay narrow; brokers enforce
 * the stage table independently of whatever tools a session can see.
 */
export const TOOL_GROUPS: Readonly<
  Record<string, readonly ToolName[] | undefined>
> = {
  /** Diagnose participants, Judge, and Synthesizer. No open web; the docs
   * proxy supplies context only, never evidence. */
  "diagnose-read-only": [
    "read",
    "grep",
    "find",
    "ls",
    "docs_proxy",
    "evidence_note",
  ],
  /** Verify review roles: read-only over the pinned snapshot. */
  "review-read-only": [
    "read",
    "grep",
    "find",
    "ls",
    "docs_proxy",
    "readonly_analyzer",
    "evidence_note",
  ],
  /** Verify test layers: request pinned runs, read receipts, drive the
   * brokered browser (T10 only via its own group). */
  "test-run": [
    "read",
    "grep",
    "find",
    "ls",
    "execution_request",
    "receipt_read",
    "evidence_note",
  ],
  /** T10 additionally drives the broker-provisioned browser sandbox. */
  "test-run-browser": [
    "read",
    "grep",
    "find",
    "ls",
    "execution_request",
    "receipt_read",
    "browser_drive",
    "evidence_note",
  ],
  /** The Orchestrator: spawns subagents and proposes; never writes state. */
  orchestrator: [
    "spawn_subagent",
    "propose_artifact",
    "propose_transition",
    "request_gate_evaluation",
    "request_applicability",
    "request_test_run",
    "read_broker_query",
    "artifact_draft",
    "evidence_note",
  ],
  "evidence-gatherer": ["read_broker_query", "experiment_proposal"],
  /** Repair planner: reads and drafts; never edits candidate code. */
  "repair-planner": [
    "read",
    "grep",
    "find",
    "ls",
    "docs_proxy",
    "artifact_draft",
    "evidence_note",
    "read_broker_query",
  ],
  /** Repair implementer: its own copy-on-write worktree or scratch only. */
  "worktree-edit": [
    "read",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "patch_apply",
    "local_build_test",
    "docs_proxy",
    "read_broker_query",
    "submit_remediation_pr",
    "evidence_note",
  ],
}

/** Write tools: the candidate code path only, never other stages. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "patch_apply",
  "merge",
  "deploy",
])

/** Shell tools. Local build/test tools are separate and sandbox-scoped. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "shell",
  "exec",
  "run_command",
])

/** Direct-production tools: never reachable from any session. */
export const PRODUCTION_TOOLS: ReadonlySet<string> = new Set([
  "kubectl",
  "ssh",
  "cloud_cli",
  "arbitrary_http",
  "merge",
  "deploy",
  "request_rollback",
  "submit_typed_action",
  "production_shell",
])

/** Credential and secret tools. Test secrets are mounted by the broker into
 * the isolated test process only; the model never sees them. */
export const CREDENTIAL_TOOLS: ReadonlySet<string> = new Set([
  "get_credential",
  "read_secret",
  "list_secrets",
  "request_test_secret",
  "provider_key",
])

/** The open-web fetch tool. Diagnose has no open web; only `docs_proxy`. */
export const OPEN_WEB_TOOLS: ReadonlySet<string> = new Set(["web_fetch"])

export const FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  ...WRITE_TOOLS,
  ...SHELL_TOOLS,
  ...PRODUCTION_TOOLS,
  ...CREDENTIAL_TOOLS,
  ...OPEN_WEB_TOOLS,
])

/** Tool classes no tool group may ever carry: shell, direct production,
 * credential, and open web. Write tools are the one class that a group (the
 * repair implementer's worktree-edit) may carry. */
const NEVER_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...SHELL_TOOLS,
  ...PRODUCTION_TOOLS,
  ...CREDENTIAL_TOOLS,
  ...OPEN_WEB_TOOLS,
])

export interface ToolAllowListError {
  code: "UNKNOWN_TOOL_GROUP" | "FORBIDDEN_TOOL"
  message: string
}

/**
 * Resolve a contract's tool group to the concrete allow-list. Throws when the
 * group is unknown or the resolved list contains a tool class no group may
 * ever carry (a broken group is a build-time defect, never a silent
 * widening). Write tools are legal only in the worktree-edit group.
 */
export function resolveAllowList(toolGroup: string): readonly ToolName[] {
  const tools = TOOL_GROUPS[toolGroup]
  if (tools === undefined) {
    throw new Error(`unknown tool group ${JSON.stringify(toolGroup)}`)
  }
  for (const tool of tools) {
    if (NEVER_ALLOWED_TOOLS.has(tool)) {
      throw new Error(`tool group ${toolGroup} carries forbidden tool ${tool}`)
    }
  }
  return tools
}

/**
 * The SIH extension seam that mirrors `pi.setActiveTools`: the session may
 * only ever call these tools. Brokers remain the enforcement boundary.
 */
export function applyActiveTools(
  active: ReadonlySet<string>,
  tools: readonly string[]
): ReadonlySet<string> {
  const resolved = new Set<string>()
  for (const tool of tools) {
    if (active.has(tool)) {
      resolved.add(tool)
    }
  }
  return resolved
}

/** The read-only tool names every Diagnose Fusion role may see. */
export function diagnoseReadOnlyTools(): readonly ToolName[] {
  return resolveAllowList("diagnose-read-only")
}

/** True when a tool list is free of every forbidden tool class. */
export function hasForbiddenTool(tools: readonly string[]): string | null {
  for (const tool of tools) {
    if (FORBIDDEN_TOOLS.has(tool)) {
      return tool
    }
  }
  return null
}

/** The stage the skill contract names; orchestrator spans all six. */
export function stageAllows(
  stage: StageName,
  actionClass: string,
  stageWrites: Readonly<Record<string, readonly string[] | undefined>>
): boolean {
  const allowed = stageWrites[stage]
  if (allowed === undefined) {
    return false
  }
  return allowed.includes(actionClass)
}
