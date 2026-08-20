import { IconCopy } from "@tabler/icons-react"
import { useState } from "react"

export function CopyButton({
  value,
  label,
  className = "cr-button",
}: {
  value: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
    >
      <IconCopy aria-hidden="true" />
      {copied ? "Copied" : label}
    </button>
  )
}
