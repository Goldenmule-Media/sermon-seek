"use client"

import { msToTimecode } from "@/lib/utils"
import type { TranscriptSegmentWithWords } from "@sermon-search/types"
import { useEffect, useRef } from "react"

interface Props {
  segments: TranscriptSegmentWithWords[]
  currentMs: number
  onSeek: (ms: number) => void
}

export function TranscriptView({ segments, currentMs, onSeek }: Props) {
  const activeSegmentRef = useRef<HTMLButtonElement>(null)

  let activeIdx = -1
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg && seg.start_ms <= currentMs) {
      activeIdx = i
    } else {
      break
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIdx is the change signal
  useEffect(() => {
    activeSegmentRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeIdx])

  return (
    <div className="h-96 overflow-y-auto space-y-1 pr-2">
      {segments.map((segment, idx) => {
        const isActive = idx === activeIdx
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
                        isActiveWord ? "bg-yellow-200 dark:bg-yellow-800 rounded px-0.5" : undefined
                      }
                    >
                      {word.text}{" "}
                    </span>
                  )
                })}
              </span>
            ) : (
              <span>{segment.text}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
