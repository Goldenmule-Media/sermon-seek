import type { Video } from "@sermon-search/types"
import Link from "next/link"
import { VideoCard } from "./video-card"

interface VideoStripProps {
  church: string
  title: string
  seeAllHref?: string
  videos: Video[]
}

export function VideoStrip({ church, title, seeAllHref, videos }: VideoStripProps) {
  if (videos.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {seeAllHref && (
          <Link href={seeAllHref} className="text-sm text-primary hover:underline">
            See all →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} church={church} />
        ))}
      </div>
    </section>
  )
}
