import { formatDuration } from "@/lib/utils"
import type { SearchResult } from "@sermon-search/types"
import Image from "next/image"
import Link from "next/link"

interface SearchResultCardProps {
  result: SearchResult
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const t = Math.floor(result.start_ms / 1000)
  const href = `/videos/${result.video_id}?t=${t}`

  return (
    <Link
      href={href}
      className="flex gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
    >
      <div className="relative shrink-0 w-40 h-24 rounded overflow-hidden bg-muted">
        {result.thumbnail_url ? (
          <Image
            src={result.thumbnail_url}
            alt={result.title}
            fill
            className="object-cover"
            sizes="160px"
          />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <p className="font-semibold leading-snug line-clamp-2">{result.title}</p>
        <p
          className="snippet text-sm text-muted-foreground line-clamp-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline HTML-escapes source text; only emits configured <mark> tags
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />
        <span className="text-xs text-primary font-mono mt-auto">
          {formatDuration(result.start_ms)}
        </span>
      </div>
    </Link>
  )
}
