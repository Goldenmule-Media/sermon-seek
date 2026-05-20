"use client"

import type { ScriptureRefDetail } from "@sermon-search/types"
import Link from "next/link"
import { useState } from "react"

const DEFAULT_COLLAPSED = 15

interface ScriptureRefBoxProps {
  refs: ScriptureRefDetail[]
  label: string
  collapsedCount?: number
}

export function ScriptureRefBox({
  refs,
  label,
  collapsedCount = DEFAULT_COLLAPSED,
}: ScriptureRefBoxProps) {
  const [expanded, setExpanded] = useState(false)
  if (refs.length === 0) return null

  const canCollapse = refs.length > collapsedCount
  const shown = expanded || !canCollapse ? refs : refs.slice(0, collapsedCount)
  const hiddenCount = refs.length - shown.length

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((r) => (
          <Link
            key={`${r.start_coord}-${r.end_coord}`}
            href={`/search?ref=${encodeURIComponent(r.display)}`}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent transition-colors"
          >
            <span>{r.display}</span>
            <span className="text-muted-foreground">{r.occurrences}</span>
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
