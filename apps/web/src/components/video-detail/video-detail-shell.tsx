"use client"

import type { TranscriptResponse, VideoDetailResponse } from "@sermon-search/types"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { TranscriptView } from "./transcript-view"
import type { YouTubePlayerHandle } from "./youtube-player"
import { YouTubePlayer } from "./youtube-player"

interface Props {
  video: VideoDetailResponse
  transcript: TranscriptResponse | null
}

export function VideoDetailShell({ video, transcript }: Props) {
  const searchParams = useSearchParams()
  const tParam = searchParams.get("t")
  const initialStartSeconds = tParam ? Number(tParam) : 0

  const playerRef = useRef<YouTubePlayerHandle>(null)
  const playerWrapperRef = useRef<HTMLDivElement>(null)
  const [currentMs, setCurrentMs] = useState(initialStartSeconds * 1000)
  const [playerHeight, setPlayerHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = playerWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setPlayerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function handleSeek(ms: number) {
    setCurrentMs(ms)
    playerRef.current?.seekTo(ms / 1000)
    const url = new URL(window.location.href)
    url.searchParams.set("t", String(Math.floor(ms / 1000)))
    window.history.replaceState(window.history.state, "", url.toString())
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3" ref={playerWrapperRef}>
        <YouTubePlayer
          ref={playerRef}
          videoId={video.youtube_video_id}
          initialStartSeconds={initialStartSeconds}
          onTimeUpdate={setCurrentMs}
        />
      </div>
      <div className="lg:col-span-2 flex flex-col min-h-0" style={{ height: playerHeight ?? 384 }}>
        <h2 className="text-sm font-semibold mb-2">Transcript</h2>
        {transcript ? (
          <TranscriptView
            segments={transcript.segments}
            currentMs={currentMs}
            onSeek={handleSeek}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No transcript is available for this video.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
