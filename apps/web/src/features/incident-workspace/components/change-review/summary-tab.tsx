/**
 * The Summary tab: Change summary card, Review state card, and the Files
 * changed preview. Every value comes from the projection; unparseable diffs
 * fail closed into a named gap with the raw text kept inspectable.
 */
import { StatePill } from "../../../incidents/components/badge"
import { SourceChip, RecordAnchor, shortRef  } from "./review-primitives"
import type { ChangeWorkspaceView } from "../../lib/change-workspace-projection"

function StateRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 border-b border-border/60 py-2 text-sm last:border-b-0 max-sm:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone: "positive" | "negative" | "warning" | "info" | "neutral" }) {
  return (
    <div className="flex items-start gap-3 border border-border bg-card px-4 py-3">
      <span
        aria-hidden="true"
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] leading-none ${
          tone === "positive"
            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            : tone === "negative"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : tone === "warning"
                ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-border bg-muted text-muted-foreground"
        }`}
      >
        {tone === "positive" ? "✓" : tone === "negative" ? "✗" : tone === "warning" ? "!" : "–"}
      </span>
      <span className="min-w-0">
        <strong className="block font-semibold">{value}</strong>
        <small className="block text-xs leading-relaxed text-muted-foreground">{label}</small>
      </span>
    </div>
  )
}

function reviewStatLabel(view: ChangeWorkspaceView): string {
  const failed = view.reviewState.failedIds
  if (failed.length === 0) {
    return "Correctness and recovery approved"
  }
  return `${failed.join(", ")} did not pass`
}

function gateStatLabel(view: ChangeWorkspaceView): string | null {
  const gate = view.reviewState.releaseGate
  if (gate === null) {
    return null
  }
  return gate.verdict === "pass" ? "Release approved against recorded evidence" : `verdict ${gate.verdict}`
}

/** The Change summary card. */
export function ChangeSummaryCard({ view }: { view: ChangeWorkspaceView }) {
  const change = view.change
  if (change === null) {
    return (
      <section aria-labelledby="cr-summary-title" className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 id="cr-summary-title" className="font-heading text-sm font-semibold tracking-wide uppercase">
            Change summary
          </h2>
        </header>
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            The saved bundle records no Remediation for run {view.run.runId}. The Change Review has nothing to summarize.
          </p>
        </div>
      </section>
    )
  }
  const diffSummary =
    view.diff.state === "parsed"
      ? `${view.diff.files.length} file${view.diff.files.length === 1 ? "" : "s"} · +${view.diff.additions} −${view.diff.deletions}`
      : view.diff.state === "absent"
        ? "no recorded diff"
        : "diff could not be split by file"
  return (
    <section aria-labelledby="cr-summary-title" className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="cr-summary-title" className="font-heading text-sm font-semibold tracking-wide uppercase">
          Change summary
        </h2>
        <StatePill tone="info">change {change.state}</StatePill>
      </header>
      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed">{change.description ?? "no recorded change description"}</p>
        <dl className="mt-3">
          <StateRow label="Accepted Hypothesis">
            {change.hypothesisId === null ? (
              <span className="text-muted-foreground">none recorded</span>
            ) : (
              <RecordAnchor incidentId={view.incident.incidentId} recordId={`hypothesis:${change.hypothesisId}`}>
                {change.hypothesisId}
                {change.citationChange !== null ? ` · ${change.citationChange}` : ""}
              </RecordAnchor>
            )}
          </StateRow>
          <StateRow label="Candidate">
            <code className="break-all font-mono text-xs">{change.candidateHash ?? "unrecorded"}</code>
            {change.artifactSource !== null ? (
              <span className="ml-1.5">
                <SourceChip source={change.artifactSource} label="candidate" />
              </span>
            ) : null}
          </StateRow>
          <StateRow label="Base ref">
            <code className="break-all font-mono text-xs">{change.baseRef ?? "unrecorded"}</code>
          </StateRow>
          <StateRow label="Changed files">
            <RecordAnchor incidentId={view.incident.incidentId} recordId="diff-raw" tab="files">
              {diffSummary}
            </RecordAnchor>
          </StateRow>
          <StateRow label="Blast radius">
            {change.services.length === 0 && change.environments.length === 0
              ? "unrecorded"
              : `${change.services.join(", ")} service${change.services.length === 1 ? "" : "s"} · ${change.environments.join(", ")} environment${change.environments.length === 1 ? "" : "s"}`}
          </StateRow>
          <StateRow label="Recovery">
            <RecordAnchor incidentId={view.incident.incidentId} recordId="recovery:point">
              <code className="break-all font-mono text-xs">{shortRef(change.recoveryPointId)}</code>
              <span className="text-muted-foreground"> · {change.recoveryConsumed ? "consumed" : "not consumed"}</span>
            </RecordAnchor>
          </StateRow>
          {change.testPlan.length > 0 ? (
            <StateRow label="Test plan">
              <span className="font-mono text-xs">{change.testPlan.join(", ")}</span>
            </StateRow>
          ) : null}
        </dl>
      </div>
    </section>
  )
}

/** The Review state card. */
export function ReviewStateCard({ view }: { view: ChangeWorkspaceView }) {
  const gate = view.reviewState.releaseGate
  const gateLabel = gateStatLabel(view)
  return (
    <section aria-labelledby="cr-review-title" className="border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 id="cr-review-title" className="font-heading text-sm font-semibold tracking-wide uppercase">
          Review state
        </h2>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Stat
          value={`${view.reviewState.reviewsPassed} of ${view.reviewState.reviewsTotal} reviews`}
          label={reviewStatLabel(view)}
          tone={view.reviewState.failedIds.length === 0 ? "positive" : "negative"}
        />
        <Stat
          value={`${view.reviewState.testsPassed} of ${view.reviewState.testsTotal} tests`}
          label={view.reviewState.testsPassed === view.reviewState.testsTotal ? "All recorded checks complete" : "Some recorded checks did not pass"}
          tone={view.reviewState.testsPassed === view.reviewState.testsTotal ? "positive" : "negative"}
        />
        <Stat
          value={gate === null ? "Release Gate not reached" : `Release Gate ${gate.verdict}`}
          label={gateLabel ?? "The run ended before the Release Gate."}
          tone={gate === null ? "neutral" : gate.verdict === "pass" ? "positive" : gate.verdict === "fail" ? "negative" : "warning"}
        />
      </div>
    </section>
  )
}

/** The Files changed preview rows, each opening its record in the Files tab. */
function FilePreviewRow({
  view,
  id,
  path,
  additions,
  deletions,
}: {
  view: ChangeWorkspaceView
  id: string
  path: string | null
  additions: number
  deletions: number
}) {
  return (
    <RecordAnchor
      incidentId={view.incident.incidentId}
      recordId={id}
      tab="files"
      className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-sm last:border-b-0"
    >
      <span className="min-w-0 truncate font-medium">{path ?? "path unrecorded"}</span>
      <span className="shrink-0 font-mono text-xs">
        <span className="text-emerald-700 dark:text-emerald-300">+{additions}</span>{" "}
        <span className="text-destructive">−{deletions}</span>
      </span>
    </RecordAnchor>
  )
}

/** The Files changed preview section on the Summary tab. */
export function FilesPreview({ view }: { view: ChangeWorkspaceView }) {
  const files = view.diff.files
  return (
    <section aria-labelledby="cr-files-title" className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="cr-files-title" className="font-heading text-sm font-semibold tracking-wide uppercase">
          Files changed
        </h2>
        <a
          href={`/incidents/${view.incident.incidentId}?tab=files`}
          className="text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Review diff
        </a>
      </header>
      {view.diff.state === "parsed" && files.length > 0 ? (
        <div>
          {files.map((file) => (
            <FilePreviewRow
              key={file.id}
              view={view}
              id={file.id}
              path={file.path}
              additions={file.additions}
              deletions={file.deletions}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground">{view.diff.note ?? "no diff recorded"}</p>
          {view.diff.rawText !== null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              <RecordAnchor incidentId={view.incident.incidentId} recordId="diff-raw">
                Inspect the raw recorded diff
              </RecordAnchor>
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

/** The Summary tab body. */
export function SummaryTab({ view }: { view: ChangeWorkspaceView }) {
  return (
    <section id="cr-panel-summary" aria-label="Summary" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChangeSummaryCard view={view} />
        <ReviewStateCard view={view} />
      </div>
      <FilesPreview view={view} />
    </section>
  )
}