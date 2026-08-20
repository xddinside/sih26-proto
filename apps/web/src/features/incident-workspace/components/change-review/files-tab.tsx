/**
 * The Files tab: the changed-file rail and the diff viewer.
 *
 * When the recorded diff parses, the rail lists every file and the viewer
 * shows the selected file's hunks with line numbers taken from the hunk
 * counters. When the diff fails closed, the tab presents the named gap with
 * the raw recorded text kept inspectable.
 */
import type { DiffHunk } from "../../lib/unified-diff"
import type { ChangeWorkspaceView, ChangedFileView  } from "../../lib/change-workspace-projection"
import { RecordAnchor, shortRef } from "./review-primitives"

/** One diff line row: line numbers and the recorded text. */
function DiffRow({ row }: { row: DiffHunk["lines"][number] }) {
  const tone =
    row.type === "add"
      ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
      : row.type === "delete"
        ? "bg-destructive/10 text-destructive"
        : "text-foreground"
  return (
    <div className={`grid grid-cols-[3.5rem_3.5rem_1fr] text-xs leading-5 ${tone}`}>
      <span className="pr-2 text-right font-mono text-[10px] text-muted-foreground select-none">
        {row.type === "delete" ? row.oldLine ?? "" : ""}
      </span>
      <span className="pr-2 text-right font-mono text-[10px] text-muted-foreground select-none">
        {row.type === "add" ? row.newLine ?? "" : ""}
      </span>
      <code className="whitespace-pre-wrap break-words px-2">{row.text}</code>
    </div>
  )
}

/** One hunk: its header and lines. */
function DiffHunkBlock({ hunk }: { hunk: DiffHunk }) {
  return (
    <div>
      <div className="border-y border-border/60 bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {hunk.header}
      </div>
      {hunk.lines.map((row, index) => (
        <DiffRow key={index} row={row} />
      ))}
    </div>
  )
}

/** The diff viewer for one file, with the Change-to-Hypothesis map footer. */
export function DiffViewer({ view, file }: { view: ChangeWorkspaceView; file: ChangedFileView }) {
  const change = view.change
  const cited = change?.citedItemIds ?? []
  return (
    <article className="min-w-0 border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 truncate font-heading text-sm font-semibold tracking-wide uppercase">
          {file.path ?? "path unrecorded"}
        </h2>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          <span className="text-emerald-700 dark:text-emerald-300">+{file.additions}</span>{" "}
          <span className="text-destructive">−{file.deletions}</span>
        </span>
      </header>
      <div className="overflow-x-auto">
        {file.hunks.map((hunk, index) => (
          <DiffHunkBlock key={index} hunk={hunk} />
        ))}
      </div>
      <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>Change-to-Hypothesis map</span>
        {change?.hypothesisId !== null && change?.hypothesisId !== undefined ? (
          <RecordAnchor incidentId={view.incident.incidentId} recordId={`hypothesis:${change.hypothesisId}`} tab="files">
            {change.hypothesisId}
          </RecordAnchor>
        ) : (
          <span>no hypothesis recorded</span>
        )}
        {cited.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[11px]">{cited.join(", ")}</span>
          </>
        ) : null}
      </footer>
    </article>
  )
}

/** The Files tab body; the selected file comes from the inspector record id. */
export function FilesTab({
  view,
  selectedFileId,
}: {
  view: ChangeWorkspaceView
  selectedFileId: string | null
}) {
  if (view.diff.state !== "parsed" || view.diff.files.length === 0) {
    return (
      <section id="cr-panel-files" aria-label="Files changed" className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-semibold tracking-wide uppercase">Files changed</h2>
        </header>
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {view.diff.state === "absent"
              ? "The saved bundle records no diff text for this run."
              : view.diff.note ?? "The recorded diff could not be split by file."}
          </p>
          {view.diff.rawText !== null ? (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                The raw recorded text is kept inspectable:{" "}
                <RecordAnchor incidentId={view.incident.incidentId} recordId="diff-raw" tab="files">
                  open the diff record
                </RecordAnchor>
                .
              </p>
              <pre className="mt-3 max-h-72 overflow-auto border border-border bg-muted/40 p-3 text-xs leading-5">
                <code className="whitespace-pre-wrap break-words">{view.diff.rawText}</code>
              </pre>
            </>
          ) : null}
        </div>
      </section>
    )
  }

  const files = view.diff.files
  const selected = files.find((file) => file.id === selectedFileId) ?? files[0]
  return (
    <section id="cr-panel-files" aria-label="Files changed" className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside aria-label="Changed files" className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Changed files</p>
          <strong className="text-sm">
            {files.length} file{files.length === 1 ? "" : "s"}
          </strong>
        </div>
        <div>
          {files.map((file) => (
            <RecordAnchor
              key={file.id}
              incidentId={view.incident.incidentId}
              recordId={file.id}
              tab="files"
              className={`flex w-full items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-sm last:border-b-0 ${
                file.id === selected.id ? "bg-muted/70" : ""
              }`}
            >
              <span className="min-w-0 truncate font-medium">{file.path ?? "path unrecorded"}</span>
              <span className="shrink-0 font-mono text-xs">
                <span className="text-emerald-700 dark:text-emerald-300">+{file.additions}</span>{" "}
                <span className="text-destructive">−{file.deletions}</span>
              </span>
            </RecordAnchor>
          ))}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          base {shortRef(view.change?.baseRef ?? null)}
        </p>
      </aside>
      <DiffViewer view={view} file={selected} />
    </section>
  )
}