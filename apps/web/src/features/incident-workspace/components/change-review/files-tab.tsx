import { IconCode, IconFileDescription } from "@tabler/icons-react"

import type { DiffHunk } from "../../lib/unified-diff"
import type {
  ChangedFileView,
  ChangeWorkspaceView,
} from "../../lib/change-workspace-projection"
import { RecordAnchor } from "./review-primitives"

function DiffRow({ row }: { row: DiffHunk["lines"][number] }) {
  const line = row.type === "add" ? row.newLine : row.oldLine
  return (
    <div className={`cr-code-line ${row.type}`}>
      <span>{line ?? ""}</span>
      <code>{row.text}</code>
    </div>
  )
}

function DiffHunkBlock({ hunk }: { hunk: DiffHunk }) {
  return (
    <div>
      <div className="cr-hunk-header">
        <code>{hunk.header}</code>
      </div>
      {hunk.lines.map((row, index) => (
        <DiffRow key={index} row={row} />
      ))}
    </div>
  )
}

function DiffViewer({
  view,
  file,
}: {
  view: ChangeWorkspaceView
  file: ChangedFileView
}) {
  const cited = view.change?.citedItemIds ?? []
  return (
    <article className="cr-diff">
      <header className="cr-diff-head">
        <h2>{file.path ?? "path unrecorded"}</h2>
        <span>
          <b>+{file.additions}</b> <i>−{file.deletions}</i>
        </span>
      </header>
      <div className="cr-code">
        {file.hunks.map((hunk, index) => (
          <DiffHunkBlock key={index} hunk={hunk} />
        ))}
      </div>
      <footer className="cr-citation">
        <span>
          <IconFileDescription aria-hidden="true" />
          Change-to-Hypothesis map
        </span>
        <strong>
          {view.change?.hypothesisId ?? "No hypothesis recorded"}
          {cited.length
            ? ` · ${cited.length} supporting evidence item${cited.length === 1 ? "" : "s"}`
            : ""}
        </strong>
      </footer>
    </article>
  )
}

export function FilesTab({
  view,
  selectedFileId,
}: {
  view: ChangeWorkspaceView
  selectedFileId: string | null
}) {
  if (view.diff.state !== "parsed" || view.diff.files.length === 0) {
    return (
      <section
        id="cr-panel-files"
        aria-label="Files changed"
        className="cr-panel"
      >
        <header className="cr-panel-head">
          <h2>Files changed</h2>
        </header>
        <div className="cr-panel-body cr-unavailable">
          <p>
            {view.diff.state === "absent"
              ? "The saved bundle records no diff text for this run."
              : (view.diff.note ??
                "The recorded diff could not be split by file.")}
          </p>
          {view.diff.rawText ? (
            <RecordAnchor
              incidentId={view.incident.incidentId}
              recordId="diff-raw"
              tab="files"
            >
              Open the raw diff record
            </RecordAnchor>
          ) : null}
        </div>
      </section>
    )
  }

  const selected =
    view.diff.files.find((file) => file.id === selectedFileId) ??
    view.diff.files[0]
  return (
    <section
      id="cr-panel-files"
      aria-label="Files changed"
      className="cr-diff-workspace"
    >
      <aside className="cr-file-list" aria-label="Changed files">
        <div>
          <p className="cr-eyebrow">Changed files</p>
          <strong>{view.diff.files.length} files</strong>
        </div>
        {view.diff.files.map((file) => (
          <RecordAnchor
            key={file.id}
            incidentId={view.incident.incidentId}
            recordId={file.id}
            tab="files"
            className={file.id === selected.id ? "active" : undefined}
          >
            <span>
              <IconCode aria-hidden="true" />
              <strong>{file.path ?? "path unrecorded"}</strong>
            </span>
            <small>
              <b>+{file.additions}</b> <i>−{file.deletions}</i>
            </small>
          </RecordAnchor>
        ))}
      </aside>
      <DiffViewer view={view} file={selected} />
    </section>
  )
}
