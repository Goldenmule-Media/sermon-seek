import { getChurch } from "@/lib/admin-api"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RefreshForm } from "./refresh-form"
import { RenameForm } from "./rename-form"

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function ChurchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const church = await getChurch(id)
  if (!church) notFound()

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link
        href="/churches"
        className="mb-6 inline-flex text-sm text-muted-foreground hover:underline"
      >
        ← Churches
      </Link>

      {/* Header */}
      <div className="mb-8 mt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{church.name}</h1>
          {statusBadge(church.status)}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">/{church.slug}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Created {formatDate(church.created_at)}
        </p>
      </div>

      {/* Rename form */}
      <section className="mb-8">
        <h2 className="mb-4 text-base font-semibold">Rename</h2>
        <RenameForm id={church.id} currentSlug={church.slug} currentName={church.name} />
      </section>

      {/* Refresh */}
      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold">Ingest refresh</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Re-sync channel metadata, playlists, and video list from YouTube.
        </p>
        <RefreshForm slug={church.slug} />
      </section>

      {/* Aliases */}
      <section className="mb-8">
        <h2 className="mb-4 text-base font-semibold">Slug aliases</h2>
        {church.aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No aliases yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium">Old slug</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {church.aliases.map((alias) => (
                  <tr key={alias.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono">{alias.slug}</td>
                    <td className="px-4 py-2.5">{formatDate(alias.created_at)}</td>
                    <td className="px-4 py-2.5">
                      {alias.expires_at ? formatDate(alias.expires_at) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Channels */}
      <section>
        <h2 className="mb-4 text-base font-semibold">
          Channels{" "}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            ({church.channel_count})
          </span>
        </h2>
        {church.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No channels yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium">Channel ID</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Last ingested</th>
                </tr>
              </thead>
              <tbody>
                {church.channels.map((ch) => (
                  <tr key={ch.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{ch.youtube_channel_id}</td>
                    <td className="px-4 py-2.5">{ch.title}</td>
                    <td className="px-4 py-2.5">{formatDate(ch.ingested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
