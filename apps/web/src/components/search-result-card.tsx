import { VideoSummary } from "@/components/video-summary"
import { formatDuration } from "@/lib/utils"
import type { SearchResult } from "@sermon-search/types"
import Image from "next/image"
import Link from "next/link"

const PER_CARD_REF_LIMIT = 6

interface SearchResultCardProps {
  result: SearchResult
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const refs = result.scripture_refs.slice(0, PER_CARD_REF_LIMIT)
  const overflow = result.scripture_refs.length - refs.length
  const videoHref = `/videos/${result.video_id}`

  return (
    <div className="flex gap-4 p-4 rounded-lg border bg-card">
      <Link href={videoHref} className="relative shrink-0 w-40 h-24 rounded overflow-hidden bg-muted">
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
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <Link
          href={videoHref}
          className="font-semibold leading-snug line-clamp-2 hover:underline"
        >
          {result.title}
        </Link>

        <VideoSummary summary={result.summary} />

        <ul className="flex flex-col gap-1 -mx-2">
          {result.hits.map((hit, i) => {
            const t = Math.floor(hit.start_ms / 1000)
            const hasTimestamp = hit.start_ms > 0 || hit.snippet.length > 0
            const hitHref = hasTimestamp
              ? `/videos/${result.video_id}?t=${t}`
              : `/videos/${result.video_id}`
            return (
              <li key={`${hit.start_ms}-${i}`}>
                <Link
                  href={hitHref}
                  className="flex items-baseline gap-3 rounded-md px-2 py-1 text-sm hover:bg-accent transition-colors"
                >
                  {hasTimestamp && (
                    <span className="text-xs text-primary font-mono shrink-0 tabular-nums">
                      {formatDuration(hit.start_ms)}
                    </span>
                  )}
                  {hit.snippet && (
                    <span
                      className="snippet text-muted-foreground line-clamp-2"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline HTML-escapes source text; only emits configured <mark> tags
                      dangerouslySetInnerHTML={{ __html: hit.snippet }}
                    />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>

        {refs.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 mt-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Scripture references
            </p>
            <div className="flex flex-wrap gap-1">
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
          </div>
        )}
      </div>
    </div>
  )
}
