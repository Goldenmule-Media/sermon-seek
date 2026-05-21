import { formatDate, formatDuration } from "@/lib/utils"
import type { Video } from "@sermon-search/types"
import Image from "next/image"
import Link from "next/link"

export function VideoCard({ video, church }: { video: Video; church: string }) {
  return (
    <Link href={`/${church}/videos/${video.id}`} className="group flex flex-col gap-2 min-w-0">
      <div className="relative aspect-video rounded-md overflow-hidden bg-muted">
        <Image
          src={video.thumbnail_url || "/placeholder.svg"}
          alt={video.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-200"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        <span className="absolute bottom-1 right-1 bg-black/75 text-white text-xs px-1 rounded">
          {formatDuration(video.duration_ms)}
        </span>
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(video.published_at)}</p>
      </div>
    </Link>
  )
}
