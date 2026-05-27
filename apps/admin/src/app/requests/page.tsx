import { fetchAdminRequests } from "@/lib/api"
import type { IngestionRequestStatus } from "@/lib/api"
import { StatusBadge } from "@/lib/status-badge"
import Link from "next/link"

const ALL_STATUSES: IngestionRequestStatus[] = [
  "received",
  "running",
  "awaiting_approval",
  "approved",
  "denied",
  "failed",
  "complete",
]

const PAGE_LIMIT = 20

interface Props {
  searchParams: Promise<{ status?: string; user_id?: string; offset?: string }>
}

export default async function RequestsPage({ searchParams }: Props) {
  const params = await searchParams
  const status =
    params.status && ALL_STATUSES.includes(params.status as IngestionRequestStatus)
      ? (params.status as IngestionRequestStatus)
      : undefined
  const user_id =
    params.user_id && /^[0-9a-f-]{36}$/.test(params.user_id) ? params.user_id : undefined
  const offset = Math.max(0, Number(params.offset ?? 0))

  const result = await fetchAdminRequests({ status, user_id, limit: PAGE_LIMIT, offset })

  const requests = result?.requests ?? []
  const total = result?.total ?? 0
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_LIMIT < total

  function buildLink(nextOffset: number) {
    const sp = new URLSearchParams()
    if (status) sp.set("status", status)
    if (user_id) sp.set("user_id", user_id)
    sp.set("offset", String(nextOffset))
    return `/requests?${sp.toString()}`
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Ingestion requests</h1>

      {/* Filter form */}
      <form method="get" className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="status"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">(all)</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="user_id"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            User ID
          </label>
          <input
            id="user_id"
            name="user_id"
            type="text"
            defaultValue={user_id ?? ""}
            placeholder="uuid"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Filter
        </button>
      </form>

      {/* Results */}
      {requests.length === 0 ? (
        <p className="text-muted-foreground text-sm">No requests match these filters.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Slug</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Submitter</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Videos</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Tokens</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map((req) => (
                <tr key={req.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/requests/${req.id}`}
                      className="font-medium hover:underline underline-offset-4"
                    >
                      /{req.requested_slug}/
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={req.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {req.display_name ?? (
                      <span className="font-mono text-xs">{req.user_id.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {req.videos_ingested}/{req.videos_discovered}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {req.tokens_ingested.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {new Date(req.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_LIMIT && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            {hasPrev ? (
              <Link
                href={buildLink(offset - PAGE_LIMIT)}
                className="rounded-md border px-3 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Prev
              </Link>
            ) : (
              <span className="rounded-md border px-3 py-1 opacity-40 cursor-not-allowed">
                Prev
              </span>
            )}
            {hasNext ? (
              <Link
                href={buildLink(offset + PAGE_LIMIT)}
                className="rounded-md border px-3 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-md border px-3 py-1 opacity-40 cursor-not-allowed">
                Next
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
