/**
 * A small unified-diff parser for the recorded Remediation diff.
 *
 * The saved bundle records the diff text of the Remediation as a string with
 * a base-ref hash, but never records which files it touched. The parser
 * derives the changed-file list from the diff text itself so the Files tab
 * can present exactly what the diff records, and it fails closed: when the
 * diff text is empty, or when any content line cannot be attributed to a
 * file header and a hunk, the parser returns a named failure instead of an
 * invented path or line count.
 *
 * Supported shapes: `diff --git` headers (optionally with a `=>` rename
 * marker), `---`/`+++` path lines (including `/dev/null` for new and deleted
 * files), and `@@` hunk headers. Line rows carry their old/new line numbers
 * computed from the hunk counters, so the renderer never guesses a number.
 */
export type DiffLineType = "context" | "add" | "delete"

export interface DiffLine {
  type: DiffLineType
  /** Old-file line number, or null for an added line. */
  oldLine: number | null
  /** New-file line number, or null for a deleted line. */
  newLine: number | null
  /** The raw recorded line text, including the leading `+`/`-` marker. */
  text: string
}

export interface DiffHunk {
  /** The raw `@@` header, recorded verbatim. */
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  /** The path shown in the Files rail: the new path, or old for deletions. */
  path: string | null
  /** The recorded old-file path, `/dev/null` for a new file. */
  oldPath: string | null
  /** The recorded new-file path, `/dev/null` for a deleted file. */
  newPath: string | null
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface ParsedUnifiedDiff {
  files: DiffFile[]
  additions: number
  deletions: number
}

export type UnifiedDiffResult =
  | { ok: true; diff: ParsedUnifiedDiff }
  | { ok: false; reason: "absent" | "unparseable"; note: string }

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Strip a leading `a/` or `b/` path prefix from a `---`/`+++` line. */
function stripPrefix(line: string): string {
  return line.startsWith("a/") || line.startsWith("b/") ? line.slice(2) : line
}

/** Parse the old/new paths out of a `diff --git` header line. */
function pathsFromGitHeader(line: string): { oldPath: string | null; newPath: string | null } {
  const rest = line.slice("diff --git ".length).trim()
  const rename = rest.split(" => ")
  if (rename.length === 2) {
    return { oldPath: rename[0].replace(/^a\//, ""), newPath: rename[1].replace(/^b\//, "") }
  }
  const separator = rest.lastIndexOf(" b/")
  if (rest.startsWith("a/") && separator !== -1) {
    return { oldPath: rest.slice(2, separator), newPath: rest.slice(separator + 3) }
  }
  return { oldPath: rest.replace(/^a\//, ""), newPath: rest.replace(/^b\//, "") }
}

/**
 * Parse a recorded diff text into its changed files. Fails closed on absent
 * or unattributable content; see the module doc for the exact contract.
 */
export function parseUnifiedDiff(diffText: string): UnifiedDiffResult {
  if (diffText.trim() === "") {
    return { ok: false, reason: "absent", note: "the recorded diff text is empty" }
  }
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const closeHunk = () => {
    if (hunk !== null && current !== null) {
      current.hunks.push(hunk)
    }
    hunk = null
  }

  for (const raw of diffText.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw

    if (line.startsWith("diff --git ")) {
      closeHunk()
      const paths = pathsFromGitHeader(line)
      current = { path: null, oldPath: paths.oldPath, newPath: paths.newPath, additions: 0, deletions: 0, hunks: [] }
      files.push(current)
      continue
    }

    if (line.startsWith("@@ ")) {
      const match = HUNK_HEADER.exec(line)
      if (match === null) {
        return { ok: false, reason: "unparseable", note: `malformed hunk header ${JSON.stringify(line)}` }
      }
      if (current === null) {
        return { ok: false, reason: "unparseable", note: `hunk header appears before any file header: ${JSON.stringify(line)}` }
      }
      closeHunk()
      hunk = { header: line, lines: [] }
      oldLine = Number(match[1])
      newLine = Number(match[3])
      continue
    }

    if ((line.startsWith("--- ") || line.startsWith("+++ ")) && hunk === null && current !== null) {
      if (line.startsWith("--- ")) {
        current.oldPath = line === "--- /dev/null" ? "/dev/null" : stripPrefix(line.slice(4))
      } else {
        current.newPath = line === "+++ /dev/null" ? "/dev/null" : stripPrefix(line.slice(4))
      }
      continue
    }

    // Git metadata between file headers (rename markers, mode changes, blob
    // indexes) is accepted outside hunks; `rename from/to` also corrects the
    // recorded paths when the header omits them.
    if (hunk === null) {
      const renameFrom = /^rename from (.+)$/.exec(line)
      const renameTo = /^rename to (.+)$/.exec(line)
      if (renameFrom !== null && current !== null) {
        current.oldPath = renameFrom[1]
        continue
      }
      if (renameTo !== null && current !== null) {
        current.newPath = renameTo[1]
        continue
      }
      if (
        /^similarity index /.test(line) ||
        /^dissimilarity index /.test(line) ||
        /^new file mode /.test(line) ||
        /^deleted file mode /.test(line) ||
        /^old mode /.test(line) ||
        /^new mode /.test(line) ||
        /^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)
      ) {
        continue
      }
    }

    const kind = line.startsWith("-") ? "delete" : line.startsWith("+") ? "add" : line.startsWith(" ") ? "context" : null
    if (kind === null) {
      if (line === "\\ No newline at end of file") {
        continue
      }
      return {
        ok: false,
        reason: "unparseable",
        note: `line outside any file or hunk: ${JSON.stringify(line)}`,
      }
    }
    if (hunk === null || current === null) {
      return {
        ok: false,
        reason: "unparseable",
        note: `content line before any hunk: ${JSON.stringify(line)}`,
      }
    }
    const row: DiffLine =
      kind === "context"
        ? { type: "context", oldLine, newLine, text: line }
        : kind === "add"
          ? { type: "add", oldLine: null, newLine, text: line }
          : { type: "delete", oldLine, newLine: null, text: line }
    hunk.lines.push(row)
    if (kind === "add") {
      current.additions += 1
      newLine += 1
    } else if (kind === "delete") {
      current.deletions += 1
      oldLine += 1
    } else {
      oldLine += 1
      newLine += 1
    }
  }
  closeHunk()

  if (files.length === 0) {
    return { ok: false, reason: "unparseable", note: "the diff text records no file headers" }
  }
  for (const file of files) {
    file.path = file.newPath !== null && file.newPath !== "/dev/null" ? file.newPath : file.oldPath
  }
  return {
    ok: true,
    diff: {
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
  }
}