"use client"

import type { Topic } from "@sermon-search/types"
import Link from "next/link"
import { useState } from "react"

const DEFAULT_COLLAPSED = 15

interface TopicBoxProps {
  topics: Topic[]
  label: string
  collapsedCount?: number
  // When true, suppress the per-chip count badge — useful for per-card chips
  // where the count is always 1 and would just be noise.
  hideCount?: boolean
}

export function TopicBox({
  topics,
  label,
  collapsedCount = DEFAULT_COLLAPSED,
  hideCount = false,
}: TopicBoxProps) {
  const [expanded, setExpanded] = useState(false)
  if (topics.length === 0) return null

  const canCollapse = topics.length > collapsedCount
  const shown = expanded || !canCollapse ? topics : topics.slice(0, collapsedCount)
  const hiddenCount = topics.length - shown.length

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <Link
            key={t.slug}
            href={`/topics/${t.slug}`}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent transition-colors"
          >
            <span>{t.label}</span>
            {!hideCount && <span className="text-muted-foreground">{t.video_count}</span>}
          </Link>
        ))}
        {canCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  )
}
