import { formatDuration } from "@/lib/utils"
import type { SearchResult } from "@sermon-search/types"
import Image from "next/image"
import Link from "next/link"

const PER_CARD_REF_LIMIT = 6

interface SearchResultCardProps {
  result: SearchResult
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const t = Math.floor(result.start_ms / 1000)
  const hasTimestamp = result.start_ms > 0 || result.snippet.length > 0
  const href = hasTimestamp ? `/videos/${result.video_id}?t=${t}` : `/videos/${result.video_id}`
  const refs = result.scripture_refs.slice(0, PER_CARD_REF_LIMIT)
  const overflow = result.scripture_refs.length - refs.length

  return (
    <div className="flex gap-4 p-4 rounded-lg border hover:bg-accent transition-colors">
      <Link href={href} className="relative shrink-0 w-40 h-24 rounded overflow-hidden bg-muted">
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
      </Link>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <Link href={href} className="font-semibold leading-snug line-clamp-2 hover:underline">
          {result.title}
        </Link>
        {result.snippet && (
          <Link href={href}>
            <p
              className="snippet text-sm text-muted-foreground line-clamp-2"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline HTML-escapes source text; only emits configured <mark> tags
              dangerouslySetInnerHTML={{ __html: result.snippet }}
            />
          </Link>
        )}
        <div className="flex items-center gap-2 mt-auto">
          {hasTimestamp && (
            <Link
              href={href}
              className="text-xs text-primary font-mono hover:underline"
            >
              {formatDuration(result.start_ms)}
            </Link>
          )}
        </div>
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {refs.map((r) => (
              <Link
                key={`${r.start_coord}-${r.end_coord}`}
                href={`/search?ref=${encodeURIComponent(r.display)}`}
                className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent transition-colors"
              >
                <span>{r.display}</span>
                <span className="text-muted-foreground">{r.occurrences}</span>
              </Link>
            ))}
            {overflow > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] text-muted-foreground">
                +{overflow} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
