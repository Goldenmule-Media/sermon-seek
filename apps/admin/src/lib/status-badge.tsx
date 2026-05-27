import type { IngestionRequestStatus } from "./api"

const statusClasses: Record<IngestionRequestStatus, string> = {
  received: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-800",
  awaiting_approval: "bg-amber-100 text-amber-800",
  approved: "bg-muted text-muted-foreground",
  denied: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  complete: "bg-green-100 text-green-800",
}

const statusLabels: Record<IngestionRequestStatus, string> = {
  received: "received",
  running: "running",
  awaiting_approval: "awaiting approval",
  approved: "approved",
  denied: "denied",
  failed: "failed",
  complete: "complete",
}

export function StatusBadge({ status }: { status: IngestionRequestStatus }) {
  const cls = statusClasses[status] ?? "bg-muted text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {statusLabels[status] ?? status}
    </span>
  )
}
