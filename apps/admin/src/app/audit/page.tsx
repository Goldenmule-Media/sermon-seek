import { adminApiUrl } from "@/lib/env"
import { cn } from "@/lib/utils"
import { cookies } from "next/headers"
import Link from "next/link"

export const dynamic = "force-dynamic"

const ACTIONS = [
  "admin.access.denied",
  "admin.grant",
  "channel.register",
  "church.rename",
  "filter-rule.create",
  "filter-rule.delete",
  "filter-rule.update",
  "ingest.refresh",
  "ingest.view-stats",
  "request.approve",
  "request.deny",
  "video.retranscribe",
]

const TARGET_TYPES = ["channel", "church", "filter-rule", "request", "user", "video"]

interface AuditEntry {
  id: string
  user_id: string | null
  user_display_name: string | null
  action: string
  target_type: string
  target_id: string
  payload: unknown
  created_at: string
}

interface AuditResponse {
  items: AuditEntry[]
  total: number
}

function UserCell({ entry }: { entry: AuditEntry }) {
  if (entry.user_id === null) {
    return <span className="italic text-muted-foreground">cli</span>
  }
  if (entry.user_display_name) {
    return <span>{entry.user_display_name}</span>
  }
  return <span className="font-mono text-xs text-muted-foreground">{entry.user_id}</span>
}

function PayloadCell({ payload }: { payload: unknown }) {
  if (payload == null) return <span className="text-muted-foreground">—</span>
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
        view
      </summary>
      <pre className="mt-1 max-w-xs overflow-auto rounded bg-muted p-2 text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  )
}

function filterLink(
  base: Record<string, string>,
  overrides: Record<string, string | number>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== "" && v !== undefined) params.set(k, String(v))
  }
  const qs = params.toString()
  return `/audit${qs ? `?${qs}` : ""}`
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const action = sp.action ?? ""
  const targetType = sp.target_type ?? ""
  const userId = sp.user_id ?? ""
  const limit = Math.min(100, Math.max(1, Number(sp.limit) || 50))
  const offset = Math.max(0, Number(sp.offset) || 0)

  const cookieHeader = (await cookies()).toString()

  let data: AuditResponse | null = null
  let fetchError: string | null = null

  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (action) params.set("action", action)
    if (targetType) params.set("target_type", targetType)
    if (userId.trim()) params.set("user_id", userId.trim())

    const res = await fetch(`${adminApiUrl()}/v1/admin/audit?${params}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    })
    if (!res.ok) {
      fetchError = `API returned ${res.status}`
    } else {
      data = (await res.json()) as AuditResponse
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Unknown error"
  }

  const filterBase = {
    ...(action ? { action } : {}),
    ...(targetType ? { target_type: targetType } : {}),
    ...(userId.trim() ? { user_id: userId.trim() } : {}),
    limit: String(limit),
  }

  const count = data?.items.length ?? 0
  const total = data?.total ?? 0
  const hasPrev = offset > 0
  const hasNext = offset + count < total

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-xs text-muted-foreground font-medium">
            Action
          </label>
          <select
            id="action"
            name="action"
            defaultValue={action}
            className={cn(
              "h-9 rounded-md border border-input bg-background px-3 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="target_type" className="text-xs text-muted-foreground font-medium">
            Target type
          </label>
          <select
            id="target_type"
            name="target_type"
            defaultValue={targetType}
            className={cn(
              "h-9 rounded-md border border-input bg-background px-3 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="">All types</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="user_id" className="text-xs text-muted-foreground font-medium">
            User ID
          </label>
          <input
            id="user_id"
            name="user_id"
            type="text"
            defaultValue={userId}
            placeholder="UUID"
            className={cn(
              "h-9 w-64 rounded-md border border-input bg-background px-3 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>

        <button
          type="submit"
          className={cn(
            "h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        >
          Filter
        </button>

        <Link
          href="/audit"
          className={cn(
            "h-9 inline-flex items-center rounded-md border border-input px-4 text-sm",
            "hover:bg-accent hover:text-accent-foreground",
          )}
        >
          Clear
        </Link>
      </form>

      {fetchError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load audit log: {fetchError}
        </div>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Target type</th>
                  <th className="px-4 py-2 font-medium">Target ID</th>
                  <th className="px-4 py-2 font-medium">Payload</th>
                  <th className="px-4 py-2 font-medium">Created at</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No audit entries found.
                    </td>
                  </tr>
                ) : (
                  data.items.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <UserCell entry={entry} />
                      </td>
                      <td className="px-4 py-2">{entry.action}</td>
                      <td className="px-4 py-2">{entry.target_type}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {entry.target_id}
                      </td>
                      <td className="px-4 py-2">
                        <PayloadCell payload={entry.payload} />
                      </td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total === 0
                ? "No results"
                : `Showing ${offset + 1}–${offset + count} of ${total}`}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  href={filterLink(filterBase, { offset: Math.max(0, offset - limit) })}
                  className="rounded-md border border-input px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-md border border-input px-3 py-1 text-sm opacity-40">
                  Previous
                </span>
              )}
              {hasNext ? (
                <Link
                  href={filterLink(filterBase, { offset: offset + limit })}
                  className="rounded-md border border-input px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded-md border border-input px-3 py-1 text-sm opacity-40">
                  Next
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
