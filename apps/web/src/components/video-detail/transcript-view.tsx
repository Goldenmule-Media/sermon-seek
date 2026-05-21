"use client"

import { msToTimecode } from "@/lib/utils"
import type { TranscriptSegmentWithWords } from "@sermon-search/types"
import { useEffect, useMemo, useRef, useState } from "react"

interface Props {
  segments: TranscriptSegmentWithWords[]
  currentMs: number
  onSeek: (ms: number) => void
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function renderWithHighlight(text: string, query: string) {
  if (!query) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        // biome-ignore lint/suspicious/noArrayIndexKey: part position is stable per render
        key={i}
        className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: part position is stable per render
      <span key={i}>{part}</span>
    ),
  )
}

export function TranscriptView({ segments, currentMs, onSeek }: Props) {
  const activeSegmentRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState("")
  const trimmedQuery = query.trim()

  const filteredSegments = useMemo(() => {
    if (!trimmedQuery) return segments
    const q = trimmedQuery.toLowerCase()
    return segments.filter((s) => s.text.toLowerCase().includes(q))
  }, [segments, trimmedQuery])

  let activeIdx = -1
  if (!trimmedQuery) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg && seg.start_ms <= currentMs) {
        activeIdx = i
      } else {
        break
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIdx is the change signal
  useEffect(() => {
    if (trimmedQuery) return
    activeSegmentRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeIdx])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript…"
            className="w-full px-3 py-2 pr-20 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {trimmedQuery && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {filteredSegments.length} {filteredSegments.length === 1 ? "match" : "matches"}
            </span>
          )}
        </div>
        {trimmedQuery && (
          <button
            type="button"
            onClick={() => setQuery("")}
            title="Clear filter and follow playback"
            className="px-3 py-2 text-xs font-medium rounded-md border border-input bg-background hover:bg-muted transition-colors whitespace-nowrap"
          >
            Clear · follow
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 pr-2">
        {filteredSegments.length === 0 ? (
          <p className="text-sm text-muted-foreground px-3 py-2">No matches in transcript.</p>
        ) : (
          filteredSegments.map((segment) => {
            const originalIdx = segments.indexOf(segment)
            const isActive = !trimmedQuery && originalIdx === activeIdx
            return (
              <button
                key={segment.id}
                ref={isActive ? activeSegmentRef : undefined}
                type="button"
                onClick={() => onSeek(segment.start_ms)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-xs font-mono mr-2 opacity-60">
                  {msToTimecode(segment.start_ms)}
                </span>
                {isActive && segment.words.length > 0 ? (
                  <span>
                    {segment.words.map((word, wi) => {
                      const isActiveWord = word.start_ms <= currentMs && currentMs < word.end_ms
                      return (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: word position is stable
                          key={wi}
                          className={
                            isActiveWord
                              ? "bg-yellow-200 dark:bg-yellow-800 rounded px-0.5"
                              : undefined
                          }
                        >
                          {word.text}{" "}
                        </span>
                      )
                    })}
                  </span>
                ) : (
                  <span>{renderWithHighlight(segment.text, trimmedQuery)}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
