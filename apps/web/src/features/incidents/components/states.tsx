/**
 * Loading, empty, and error state components for the saved-replay routes.
 *
 * Loading shows a skeleton with replay progress ("replaying journal entry
 * N/M"); empty and error states label the gap rather than hiding it, per
 * docs/research/incident-workspace.md "States".
 */
import type { IntegrityStateCopy, MappedError } from "../lib/store-status"

/** A skeleton block that respects reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-none bg-muted motion-reduce:animate-none ${className ?? "h-4 w-full"}`}
    />
  )
}

/** Replay-progress loading state. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label={label}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="space-y-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}

/** Empty-state text for a list or a sub-panel. */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="border border-dashed border-border px-4 py-8 text-center" role="status">
      <p className="font-heading text-sm font-semibold tracking-wide uppercase">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/** Full-page integrity error state with the mapped contract error codes. */
export function ErrorState({
  state,
  copy,
  errors,
}: {
  state: string
  copy: IntegrityStateCopy
  errors: MappedError[]
}) {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-8" role="alert" aria-live="assertive">
      <div className="border border-destructive/40 bg-card px-4 py-6">
        <h1 className="font-heading text-lg font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed">{copy.description}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.detail}</p>
        <p className="mt-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          integrity state: {state}
        </p>
        <ul className="mt-2 space-y-1.5">
          {errors.map((error, index) => (
            <li key={`${error.code}-${index}`} className="border-l-2 border-destructive/40 pl-3 text-sm">
              <code className="font-mono text-xs text-destructive">{error.code}</code>
              {error.path !== undefined ? (
                <span className="ml-2 font-mono text-xs text-muted-foreground">{error.path}</span>
              ) : null}
              <p className="mt-0.5 text-muted-foreground">{error.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
