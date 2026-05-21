"use client"

import type { ScriptureRefDetail } from "@sermon-search/types"
import Link from "next/link"
import { useState } from "react"

const COLLAPSE_THRESHOLD = 8

interface VideoEnrichmentProps {
  church: string
  summary: string
  topics: Array<{ slug: string; label: string }>
  scriptureRefs: ScriptureRefDetail[]
}

export function VideoEnrichment({ church, summary, topics, scriptureRefs }: VideoEnrichmentProps) {
  const [showAll, setShowAll] = useState(false)

  if (!summary && topics.length === 0 && scriptureRefs.length === 0) return null

  const visibleRefs =
    showAll || scriptureRefs.length <= COLLAPSE_THRESHOLD
      ? scriptureRefs
      : scriptureRefs.slice(0, COLLAPSE_THRESHOLD)

  return (
    <div className="space-y-3 mb-4">
      {summary && <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <Link
              key={t.slug}
              href={`/${church}/topics/${t.slug}`}
              className="inline-block px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
      {scriptureRefs.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2">
            {visibleRefs.map((ref) => (
              <Link
                key={`${ref.book_id}-${ref.start_coord}-${ref.end_coord}`}
                href={`/${church}/search?ref=${encodeURIComponent(ref.display)}`}
                className="inline-block px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {ref.display}
                {ref.occurrences > 1 ? ` ×${ref.occurrences}` : ""}
              </Link>
            ))}
          </div>
          {!showAll && scriptureRefs.length > COLLAPSE_THRESHOLD && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-1 text-xs text-primary hover:underline"
            >
              show all ({scriptureRefs.length})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
