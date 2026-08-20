import { IconDownload } from "@tabler/icons-react"

export function DownloadButton({
  data,
  fileName,
}: {
  data: unknown
  fileName: string
}) {
  return (
    <button
      className="cr-button cr-icon-button"
      type="button"
      aria-label="Export Incident Run as JSON"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          })
        )
        const link = document.createElement("a")
        link.href = url
        link.download = fileName
        link.click()
        URL.revokeObjectURL(url)
      }}
    >
      <IconDownload size={17} stroke={1.75} aria-hidden="true" />
    </button>
  )
}
