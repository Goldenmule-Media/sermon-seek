import type { RelatedVideo, RelatedVideoReason } from "@sermon-search/types"
import Image from "next/image"
import Link from "next/link"

function reasonPrefix(kind: RelatedVideoReason["kind"]): string {
  switch (kind) {
    case "same_series":
      return "Series:"
    case "chunk_similarity":
      return "Passage:"
    case "topic_overlap":
      return "Topic:"
    case "scripture_overlap":
      return "Scripture:"
    default:
      return "Related:"
  }
}

function RelatedCard({ video }: { video: RelatedVideo }) {
  return (
    <Link
      href={`/videos/${video.video_id}`}
      className="group flex gap-3 items-start hover:bg-muted/60 rounded-md p-1 -mx-1 transition-colors"
    >
      <div className="relative w-24 shrink-0 aspect-video rounded overflow-hidden bg-muted">
        <Image
          src={video.thumbnail_url || "/placeholder.svg"}
          alt={video.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-200"
          sizes="96px"
        />
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          <span className="font-medium">{reasonPrefix(video.reason.kind)}</span>{" "}
          {video.reason.text.replace(/^[^:]+:\s*/, "")}
        </p>
      </div>
    </Link>
  )
}

export function RelatedVideosSlot({ related }: { related: RelatedVideo[] }) {
  if (related.length === 0) return null

  return (
    <aside aria-label="Related videos">
      <h2 className="text-sm font-semibold mb-3">Related videos</h2>
      <div className="space-y-3">
        {related.map((video) => (
          <RelatedCard key={video.video_id} video={video} />
        ))}
      </div>
    </aside>
  )
}
