import { adminApiFetch } from "@/lib/api"
import { formatTimestamp, isStale } from "@/lib/format"
import Link from "next/link"

export const dynamic = "force-dynamic"

interface RequestCounts {
  pending: number
  awaiting_approval: number
  running: number
  failed: number
  complete: number
  denied: number
}

interface RecentIngest {
  request_id: string
  slug: string | null
  status: string
  updated_at: string
}

interface DashboardSummary {
  requests: RequestCounts
  recent_ingests: RecentIngest[]
  last_view_stats_at: string | null
  last_smoke_test_at: string | null
  active_users: number
}

const STATUS_TILES: { label: string; key: keyof RequestCounts; queryStatus: string }[] = [
  { label: "Pending", key: "pending", queryStatus: "received" },
  { label: "Awaiting approval", key: "awaiting_approval", queryStatus: "awaiting_approval" },
  { label: "Running", key: "running", queryStatus: "running" },
  { label: "Failed", key: "failed", queryStatus: "failed" },
  { label: "Complete", key: "complete", queryStatus: "complete" },
  { label: "Denied", key: "denied", queryStatus: "denied" },
]

export default async function DashboardPage() {
  const res = await adminApiFetch("/v1/admin/dashboard/summary")

  if (!res.ok) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-4 text-muted-foreground">
          Failed to load dashboard data (HTTP {res.status}).
        </p>
      </main>
    )
  }

  const data: DashboardSummary = await res.json()

  return (
    <main className="mx-auto max-w-6xl p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <span className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
          Active users: {data.active_users}
        </span>
      </div>

      {/* Request status counters */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Requests
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STATUS_TILES.map(({ label, key, queryStatus }) => (
            <Link
              key={key}
              href={`/requests?status=${queryStatus}`}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
            >
              <span className="text-2xl font-bold tabular-nums">{data.requests[key]}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent ingests */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Recent ingests
        </h2>
        {data.recent_ingests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent ingestion requests.</p>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {data.recent_ingests.map((ingest) => (
              <Link
                key={ingest.request_id}
                href={`/requests/${ingest.request_id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
              >
                <span className="text-sm font-medium">{ingest.slug ?? "—"}</span>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {ingest.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(ingest.updated_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* System freshness */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">
          System
        </h2>
        <div className="rounded-lg border bg-card divide-y">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">Last view-stats run</span>
            <span
              className={isStale(data.last_view_stats_at) ? "text-sm text-destructive" : "text-sm"}
            >
              {formatTimestamp(data.last_view_stats_at)}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">Last smoke-test run</span>
            <span
              className={isStale(data.last_smoke_test_at) ? "text-sm text-destructive" : "text-sm"}
            >
              {formatTimestamp(data.last_smoke_test_at)}
            </span>
          </div>
        </div>
      </section>
    </main>
  )
}
