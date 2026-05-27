import { getChurches } from "@/lib/admin-api"
import Link from "next/link"

const LIMIT = 20

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    pending: "bg-slate-100 text-slate-700",
    active: "bg-green-100 text-green-700",
    suspended: "bg-amber-100 text-amber-700",
    denied: "bg-red-100 text-red-700",
  }
  const cls = colors[status] ?? "bg-slate-100 text-slate-700"
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

export default async function ChurchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const slugPrefix = typeof sp.slug_prefix === "string" ? sp.slug_prefix : undefined
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1)
  const offset = (page - 1) * LIMIT

  const { items, total } = await getChurches({ slug_prefix: slugPrefix, limit: LIMIT, offset })

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasPrev = page > 1
  const hasNext = page < totalPages

  function pageLink(p: number) {
    const params = new URLSearchParams()
    if (slugPrefix) params.set("slug_prefix", slugPrefix)
    if (p > 1) params.set("page", String(p))
    const qs = params.toString()
    return `/churches${qs ? `?${qs}` : ""}`
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Churches</h1>

      {/* Filter form */}
      <form method="get" className="mb-6 flex items-center gap-3">
        <input
          type="text"
          name="slug_prefix"
          defaultValue={slugPrefix ?? ""}
          placeholder="Filter by slug prefix…"
          className="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Filter
        </button>
        {slugPrefix && (
          <Link href="/churches" className="text-sm text-muted-foreground underline">
            Reset
          </Link>
        )}
      </form>

      {/* Table */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No churches match this filter.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium">Slug</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Channels</th>
                  <th className="px-4 py-2.5 font-medium text-right">Videos</th>
                </tr>
              </thead>
              <tbody>
                {items.map((church) => (
                  <tr key={church.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/churches/${church.id}`}
                        className="font-mono text-primary underline-offset-2 hover:underline"
                      >
                        {church.slug}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{church.name}</td>
                    <td className="px-4 py-2.5">{statusBadge(church.status)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{church.channel_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{church.video_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  href={pageLink(page - 1)}
                  className="rounded-md border px-3 py-1.5 hover:bg-muted/50"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-1.5 opacity-40">← Prev</span>
              )}
              {hasNext ? (
                <Link
                  href={pageLink(page + 1)}
                  className="rounded-md border px-3 py-1.5 hover:bg-muted/50"
                >
                  Next →
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-1.5 opacity-40">Next →</span>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
