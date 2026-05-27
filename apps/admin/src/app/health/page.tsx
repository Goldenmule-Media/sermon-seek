import { adminApiUrl } from "@/lib/env"
import { cn } from "@/lib/utils"
import { cookies } from "next/headers"
import { RefreshTicker } from "./refresh-ticker"

export const dynamic = "force-dynamic"

interface WorkerRow {
  worker_id: string
  kind: string
  last_beat_at: string
  status: string
  last_job_id: string | null
  message: string | null
  stale: boolean
}

interface SystemRunShape {
  last_run_at: string | null
  last_status: string | null
}

interface HealthResponse {
  workers: WorkerRow[]
  view_stats: SystemRunShape
  smoke_test: SystemRunShape
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString()
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const color =
    status === "success"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : status === "failed" || status === "error"
        ? "bg-destructive/15 text-destructive"
        : "bg-secondary text-secondary-foreground"
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", color)}>
      {status}
    </span>
  )
}

function SystemRunPanel({ label, run }: { label: string; run: SystemRunShape }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm font-medium text-muted-foreground mb-2">{label}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Last run</dt>
        <dd>{formatDate(run.last_run_at)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusBadge status={run.last_status} />
        </dd>
      </dl>
    </div>
  )
}

export default async function HealthPage() {
  const cookieHeader = (await cookies()).toString()

  let data: HealthResponse | null = null
  let fetchError: string | null = null

  try {
    const res = await fetch(`${adminApiUrl()}/v1/admin/health`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    })
    if (!res.ok) {
      fetchError = `API returned ${res.status}`
    } else {
      data = (await res.json()) as HealthResponse
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Unknown error"
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
        <RefreshTicker />
      </div>

      {fetchError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load health data: {fetchError}
        </div>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Workers</h2>
            {data.workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workers have reported yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Worker ID</th>
                      <th className="px-4 py-2 font-medium">Kind</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Last Beat</th>
                      <th className="px-4 py-2 font-medium">Last Job</th>
                      <th className="px-4 py-2 font-medium">Message</th>
                      <th className="px-4 py-2 font-medium">Freshness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workers.map((w) => (
                      <tr key={w.worker_id} className="border-b last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">{w.worker_id}</td>
                        <td className="px-4 py-2">{w.kind}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={w.status} />
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatDate(w.last_beat_at)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {w.last_job_id ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">
                          {w.message ?? "—"}
                        </td>
                        <td className="px-4 py-2">
                          {w.stale ? (
                            <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-destructive text-destructive-foreground">
                              stale
                            </span>
                          ) : (
                            <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-secondary text-secondary-foreground">
                              fresh
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <SystemRunPanel label="View-stats" run={data.view_stats} />
            <SystemRunPanel label="Smoke test" run={data.smoke_test} />
          </section>
        </>
      )}
    </main>
  )
}
