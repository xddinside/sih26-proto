/**
 * Section shell: a labeled panel with an accessible heading, used across the
 * list, detail, and artifact routes.
 */
import { cn } from "@workspace/ui/lib/utils"

export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} aria-labelledby={id === undefined ? undefined : `${id}-title`} className={cn("border border-border bg-card", className)}>
      <header className="border-b border-border px-4 py-3">
        <h2 id={id === undefined ? undefined : `${id}-title`} className="font-heading text-sm font-semibold tracking-wide uppercase">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/** A definition list row: label on the left, value(s) on the right. */
export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 border-b border-border/60 py-2 text-sm last:border-b-0 max-sm:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
