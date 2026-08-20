/**
 * Pure search-state helpers for the Change Review workspace.
 *
 * The route state is plain query parameters (never TanStack router search),
 * so the Change Review components render with `renderToStaticMarkup` in
 * tests without any router context. Navigation is plain anchors built by
 * `workspaceHref`; browser back/forward and URL sharing work at the browser
 * level.
 *
 *   ?view=review|full   which workspace surface to show (default review)
 *   ?tab=summary|files  which Change Review tab is active (default summary)
 *   ?record=<recordId>  which record the inspector should open (default none)
 *
 * `parseWorkspaceSearch` is the route's `validateSearch`: it accepts the raw
 * query object and returns an all-optional state, so links to the route never
 * need to pass `search` and existing navigation keeps working.
 */

export type WorkspaceView = "review" | "full"
export type ChangeReviewTab = "summary" | "files"

export interface WorkspaceSearchState {
  view: WorkspaceView
  tab: ChangeReviewTab
  record: string
}

/** The all-optional search param shape the route exposes. */
export type WorkspaceSearchInput = Partial<WorkspaceSearchState>

export const DEFAULT_VIEW: WorkspaceView = "review"
export const DEFAULT_TAB: ChangeReviewTab = "summary"
export const DEFAULT_RECORD = ""

const isView = (value: unknown): value is WorkspaceView => value === "review" || value === "full"
const isTab = (value: unknown): value is ChangeReviewTab => value === "summary" || value === "files"

/**
 * Parse the raw route query object into a complete, valid search state.
 * Unknown or malformed values fall back to the defaults; the `record`
 * parameter is accepted verbatim and validated against the record registry
 * by the caller.
 */
export function parseWorkspaceSearch(search: Record<string, unknown>): WorkspaceSearchInput {
  const view = isView(search.view) ? search.view : DEFAULT_VIEW
  const tab = isTab(search.tab) ? search.tab : DEFAULT_TAB
  const record = typeof search.record === "string" ? search.record : DEFAULT_RECORD
  return { view, tab, record }
}

/**
 * Build the href for one Incident in the workspace, omitting default values
 * so URLs stay short: `/incidents/inc-demo-payment-1`, or
 * `/incidents/inc-demo-payment-1?tab=files` etc.
 */
export function workspaceHref(
  incidentId: string,
  state: Partial<WorkspaceSearchState> = {},
): string {
  const params = new URLSearchParams()
  if (state.view !== undefined && state.view !== DEFAULT_VIEW) {
    params.set("view", state.view)
  }
  if (state.tab !== undefined && state.tab !== DEFAULT_TAB) {
    params.set("tab", state.tab)
  }
  if (state.record !== undefined && state.record !== "") {
    params.set("record", state.record)
  }
  const query = params.toString()
  return query === "" ? `/incidents/${incidentId}` : `/incidents/${incidentId}?${query}`
}

/**
 * Resolve the `record` search parameter against the registry of records the
 * projection built. Unknown ids fall back to the default record so the
 * inspector always opens on something real.
 */
export function resolveRecordId(
  available: ReadonlySet<string>,
  recordParam: string | undefined,
  defaultRecordId: string,
): string {
  if (recordParam !== undefined && recordParam !== "" && available.has(recordParam)) {
    return recordParam
  }
  return defaultRecordId
}