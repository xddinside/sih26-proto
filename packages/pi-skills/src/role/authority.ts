/**
 * Tool authority for a Pi role session: the effective callable-tool set is
 * the intersection of the role's tools, the stage's tools, the policy's
 * tools, and the active lease's tools. Missing or inconsistent authorization
 * defaults to no authority: any undefined or empty input list yields an
 * empty effective set.
 */
export interface ToolAuthority {
  /** The tools the role itself declares. */
  roleTools?: readonly string[]
  /** The tools the stage allows. */
  stageTools?: readonly string[]
  /** The tools the policy allows. */
  policyTools?: readonly string[]
  /** The tools the active lease grants. */
  leaseTools?: readonly string[]
}

/**
 * The intersection of every supplied list. `undefined` or `[]` anywhere
 * means no authority at all, never a widening.
 */
export function effectiveToolSet(authority: ToolAuthority): ReadonlySet<string> {
  const sources: readonly (readonly string[] | undefined)[] = [
    authority.roleTools,
    authority.stageTools,
    authority.policyTools,
    authority.leaseTools,
  ]
  for (const source of sources) {
    if (source === undefined || source.length === 0) {
      return new Set()
    }
  }
  const first = sources[0] as readonly string[]
  const out = new Set(first)
  for (const source of sources.slice(1)) {
    const allowed = source as readonly string[]
    for (const name of out) {
      if (!allowed.includes(name)) {
        out.delete(name)
      }
    }
  }
  return out
}
