import { RelatedVideosSlot } from "@/components/video-detail/related-videos-slot"
import { VideoDetailShell } from "@/components/video-detail/video-detail-shell"
import { fetchTranscript, fetchVideo } from "@/lib/api"
import { formatDate, formatDuration } from "@/lib/utils"
import Link from "next/link"
import { notFound } from "next/navigation"

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [video, transcript] = await Promise.all([fetchVideo(id), fetchTranscript(id)])

  if (!video) notFound()

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-primary hover:underline mb-4 inline-block">
        ← back to home
      </Link>
      <div className="mb-4 space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{video.title}</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{video.channel.title}</span>
          {video.published_at && <span>{formatDate(video.published_at)}</span>}
          {video.duration_ms > 0 && <span>{formatDuration(video.duration_ms)}</span>}
        </div>
        {video.playlists.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {video.playlists.map((p) => (
              <span
                key={p.id}
                className="inline-block px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
              >
                {p.title}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VideoDetailShell video={video} transcript={transcript} />
        </div>
        <div>
          <RelatedVideosSlot />
        </div>
      </div>
    </main>
  )
}
