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

function RelatedCard({ video, church }: { video: RelatedVideo; church: string }) {
  const reasonDetail = video.reason.text.replace(/^[^:]+:\s*/, "")
  return (
    <Link
      href={`/${church}/videos/${video.video_id}`}
      className="group block rounded-md overflow-hidden hover:bg-muted/60 transition-colors"
    >
      <div className="relative w-full aspect-video bg-muted">
        <Image
          src={video.thumbnail_url || "/placeholder.svg"}
          alt={video.title}
          fill
          className="object-cover group-hover:scale-[1.02] transition-transform duration-200"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      </div>
      <div className="p-2 space-y-2">
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </p>
        <p className="text-xs leading-snug">
          <span className="font-medium text-primary">{reasonPrefix(video.reason.kind)}</span>{" "}
          <span className="text-muted-foreground">{reasonDetail}</span>
        </p>
      </div>
    </Link>
  )
}

export function RelatedVideosSlot({
  related,
  church,
}: { related: RelatedVideo[]; church: string }) {
  if (related.length === 0) return null

  return (
    <aside aria-label="Related videos">
      <h2 className="text-lg font-semibold mb-4">Related videos</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {related.map((video) => (
          <RelatedCard key={video.video_id} video={video} church={church} />
        ))}
      </div>
    </aside>
  )
}
