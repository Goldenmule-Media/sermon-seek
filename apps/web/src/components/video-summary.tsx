"use client"

import { useState } from "react"

const EXPAND_THRESHOLD = 200

interface VideoSummaryProps {
  summary: string
}

export function VideoSummary({ summary }: VideoSummaryProps) {
  const [expanded, setExpanded] = useState(false)
  if (!summary) return null
  const showToggle = summary.length > EXPAND_THRESHOLD

  return (
    <div className="rounded-md border-l-2 border-primary/40 bg-muted/30 px-3 py-2">
      <p
        className={`text-sm italic text-foreground/80 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {summary}
      </p>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}
