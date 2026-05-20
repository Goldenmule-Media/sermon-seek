"use client"

import { InlineYouTubePlayer } from "@/components/inline-youtube-player"
import { VideoSummary } from "@/components/video-summary"
import { formatDuration } from "@/lib/utils"
import type { SearchResult } from "@sermon-search/types"
import { ChevronRight, Play } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

const PER_CARD_REF_LIMIT = 6

interface SearchResultCardProps {
  result: SearchResult
  // When this card is the one currently playing inline, this is the start
  // timestamp (in seconds) of the active hit. null when not expanded.
  expandedStart: number | null
  onPlayHit: (startSeconds: number) => void
  onClosePlayer: () => void
}

export function SearchResultCard({
  result,
  expandedStart,
  onPlayHit,
  onClosePlayer,
}: SearchResultCardProps) {
  const refs = result.scripture_refs.slice(0, PER_CARD_REF_LIMIT)
  const overflow = result.scripture_refs.length - refs.length
  const videoHref = `/videos/${result.video_id}`
  const isExpanded = expandedStart !== null

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border bg-card">
      {!isExpanded && (
        <div className="flex items-center gap-4">
          <Link
            href={videoHref}
            className="relative shrink-0 w-40 h-24 rounded overflow-hidden bg-muted"
          >
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
          </div>
        </div>
      )}

      {isExpanded && expandedStart !== null && (
        <InlineYouTubePlayer
          videoId={result.video_id}
          startSeconds={expandedStart}
          onClose={onClosePlayer}
        />
      )}

      <div className="rounded-md border bg-background overflow-hidden">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-3 py-1.5 border-b bg-muted/40">
          {result.hits.length} match{result.hits.length === 1 ? "" : "es"} — jump to timestamp
        </p>
        <ul className="divide-y">
          {result.hits.map((hit, i) => {
            const t = Math.floor(hit.start_ms / 1000)
            const hasTimestamp = hit.start_ms > 0 || hit.snippet.length > 0
            const isActive = isExpanded && expandedStart === t
            return (
              <li key={`${hit.start_ms}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPlayHit(t)}
                  className={`group flex w-full items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                    isActive ? "bg-accent" : "hover:bg-accent"
                  }`}
                >
                  {hasTimestamp && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary font-mono shrink-0 tabular-nums">
                      <Play
                        className="h-3 w-3 fill-current opacity-60 group-hover:opacity-100 transition-opacity"
                        aria-hidden
                      />
                      {formatDuration(hit.start_ms)}
                    </span>
                  )}
                  {hit.match_type === "semantic" && (
                    <span
                      className="shrink-0 rounded border border-muted-foreground/30 px-1 py-0 text-[9px] uppercase tracking-wide text-muted-foreground"
                      title="Semantic match — conceptually related but your words may not appear in this excerpt"
                    >
                      Related
                    </span>
                  )}
                  {hit.snippet && (
                    <span
                      className={`snippet flex-1 min-w-0 line-clamp-2 ${hit.match_type === "semantic" ? "italic text-muted-foreground/80" : "text-foreground/90"}`}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: ts_headline HTML-escapes source text; only emits configured <mark> tags
                      dangerouslySetInnerHTML={{ __html: hit.snippet }}
                    />
                  )}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all"
                    aria-hidden
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {refs.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-2">
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

      {result.topics.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Topics
          </p>
          <div className="flex flex-wrap gap-1">
            {result.topics.map((t) => (
              <Link
                key={t.slug}
                href={`/topics/${t.slug}`}
                className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent transition-colors"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
