/**
 * Small read-only badges and pills for saved-truth rendering.
 *
 * Every state, severity, and outcome is conveyed by text plus shape, never by
 * color alone (docs/research/incident-workspace.md "Accessibility").
 */
import { cn } from "@workspace/ui/lib/utils"

function pill(base: string) {
  return cn(
    "inline-flex items-center gap-1 rounded-none border px-2 py-0.5 text-xs font-medium tracking-wide uppercase whitespace-nowrap",
    base,
  )
}

/** A status/state badge: neutral surface with a border. */
export function StatePill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "positive" | "negative" | "warning" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "border-border bg-muted text-muted-foreground",
    positive: "border-border bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    negative: "border-destructive/40 bg-destructive/10 text-destructive",
    warning: "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    info: "border-sky-500/40 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  }
  return <span className={pill(tones[tone])}>{children}</span>
}

/** The standing "Saved Demo Run" badge with its capture time. */
export function SavedBadge({ captureTime, className }: { captureTime: string; className?: string }) {
  return (
    <span
      className={pill("border-primary/30 bg-primary/5 text-primary dark:bg-primary/10")}
      data-slot="saved-badge"
    >
      <span aria-hidden="true">▤</span>
      Saved Demo Run
      <span className="font-normal normal-case tracking-normal text-muted-foreground">
        captured {captureTime}
      </span>
      {className !== undefined ? <span className={className} /> : null}
    </span>
  )
}

/** A severity label, text-only so it never relies on color. */
export function SeverityPill({ severity }: { severity: string | null }) {
  if (severity === null) {
    return <StatePill tone="neutral">severity unrecorded</StatePill>
  }
  const tone = severity === "critical" || severity === "high" ? "negative" : severity === "medium" ? "warning" : "info"
  return <StatePill tone={tone}>severity {severity}</StatePill>
}
