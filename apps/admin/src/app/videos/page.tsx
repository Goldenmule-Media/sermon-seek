import { getChurchVideos, getChurches } from "@/lib/admin-api"
import Link from "next/link"
import { RetranscribeButton } from "./retranscribe-button"

export const dynamic = "force-dynamic"

const LIMIT = 50

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const churchId = typeof sp.church === "string" ? sp.church : undefined
  const hasTranscriptParam = typeof sp.has_transcript === "string" ? sp.has_transcript : undefined
  const offset = Math.max(
    0,
    Number.parseInt(typeof sp.offset === "string" ? sp.offset : "0", 10) || 0,
  )

  const hasTranscriptFilter: boolean | undefined =
    hasTranscriptParam === "true" ? true : hasTranscriptParam === "false" ? false : undefined

  const { items: churches } = await getChurches({ limit: 100, offset: 0 })
  const selectedChurch = churches.find((c) => c.id === churchId)

  function videoPageLink(newOffset: number) {
    const params = new URLSearchParams()
    if (churchId) params.set("church", churchId)
    if (hasTranscriptParam !== undefined) params.set("has_transcript", hasTranscriptParam)
    if (newOffset > 0) params.set("offset", String(newOffset))
    const qs = params.toString()
    return `/videos${qs ? `?${qs}` : ""}`
  }

  let videos: Awaited<ReturnType<typeof getChurchVideos>> | null = null
  if (churchId) {
    videos = await getChurchVideos(churchId, {
      limit: LIMIT,
      offset,
      has_transcript: hasTranscriptFilter,
    })
  }

  const hasPrev = offset > 0
  const hasNext = videos !== null && offset + videos.items.length < videos.total

  return (
    <main className="mx-auto max-w-7xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Videos</h1>

      {/* Filter form */}
      <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
        <select
          name="church"
          defaultValue={churchId ?? ""}
          className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">Select a church…</option>
          {churches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.slug})
            </option>
          ))}
        </select>

        <select
          name="has_transcript"
          defaultValue={hasTranscriptParam ?? ""}
          className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">Any</option>
          <option value="true">Has transcript</option>
          <option value="false">No transcript</option>
        </select>

        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Filter
        </button>

        {(churchId || hasTranscriptParam !== undefined) && (
          <Link href="/videos" className="text-sm text-muted-foreground underline">
            Reset
          </Link>
        )}
      </form>

      {!churchId && <p className="text-sm text-muted-foreground">Pick a church to see videos.</p>}

      {churchId &&
        videos !== null &&
        (videos.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No videos match this filter.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-2.5 font-medium">YouTube ID</th>
                    <th className="px-4 py-2.5 font-medium">Title</th>
                    <th className="px-4 py-2.5 font-medium">Published at</th>
                    <th className="px-4 py-2.5 font-medium">Transcript</th>
                    <th className="px-4 py-2.5 font-medium">Last retranscribed</th>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.items.map((video) => (
                    <tr key={video.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <a
                          href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {video.youtube_id}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs truncate">{video.title}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {video.published_at
                          ? new Date(video.published_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {video.has_transcript ? (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {video.last_retranscribed_at
                          ? new Date(video.last_retranscribed_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <RetranscribeButton
                          youtubeId={video.youtube_id}
                          churchSlug={selectedChurch?.slug ?? ""}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{offset + videos.items.length} of {videos.total}
              </span>
              <div className="flex gap-2">
                {hasPrev ? (
                  <Link
                    href={videoPageLink(Math.max(0, offset - LIMIT))}
                    className="rounded-md border px-3 py-1.5 hover:bg-muted/50"
                  >
                    ← Prev
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-1.5 opacity-40">← Prev</span>
                )}
                {hasNext ? (
                  <Link
                    href={videoPageLink(offset + LIMIT)}
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
        ))}
    </main>
  )
}
