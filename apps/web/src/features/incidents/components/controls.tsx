/**
 * Saved-run controls: rendered disabled, unable to submit, with an explicit
 * "saved run" reason. Live controls are Solution Contract only and never built
 * here (docs/build-handoff.md section 9).
 */
import { Button } from "@workspace/ui/components/button"

/**
 * A control button rendered disabled because the view is a saved replay. The
 * disabled attribute prevents submission; the described-by note explains why.
 */
export function DisabledControl({
  children,
  reasonId,
}: {
  children: React.ReactNode
  reasonId: string
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled aria-describedby={reasonId}>
      {children}
    </Button>
  )
}

/** A row of saved-run controls with the standing read-only reason. */
export function SavedControls({ reasonId, controls }: { reasonId: string; controls: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {controls.map((control) => (
        <DisabledControl key={control} reasonId={reasonId}>
          {control}
        </DisabledControl>
      ))}
      <span id={reasonId} className="text-xs text-muted-foreground">
        saved run — read-only; live controls are Solution Contract only
      </span>
    </div>
  )
}
