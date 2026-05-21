"use client"

import { TranscriptView } from "@/components/video-detail/transcript-view"
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/video-detail/youtube-player"
import { fetchTranscript } from "@/lib/api"
import type { TranscriptResponse } from "@sermon-search/types"
import { ExternalLink, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

interface Props {
  church: string
  videoId: string
  startSeconds: number
  onClose: () => void
}

// Two-column expansion shown inline in a search result card: player on the
// left, lazily-loaded transcript on the right (stacked on narrow screens).
// Mirrors VideoDetailShell on /videos but coordinates its own seek/time state
// and supports start_ms updates from the parent (clicking a different hit on
// the same card seeks instead of remounting the iframe).
export function ExpandedVideoView({ church, videoId, startSeconds, onClose }: Props) {
  const router = useRouter()
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const playerWrapperRef = useRef<HTMLDivElement>(null)
  const initialStartRef = useRef(startSeconds)

  const [currentMs, setCurrentMs] = useState(startSeconds * 1000)
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [playerHeight, setPlayerHeight] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTranscript(church, videoId).then((t) => {
      if (cancelled) return
      setTranscript(t)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [church, videoId])

  // Seek when a different hit on the same video is selected.
  useEffect(() => {
    if (startSeconds === initialStartRef.current) return
    playerRef.current?.seekTo(startSeconds)
    setCurrentMs(startSeconds * 1000)
  }, [startSeconds])

  // Match the transcript height to the player so they look balanced.
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
  }

  function jumpToFullPage() {
    const current = playerRef.current?.getCurrentTime() ?? 0
    const t = Math.floor(current > 0 ? current : startSeconds)
    router.push(`/${church}/videos/${videoId}?t=${t}`)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/40">
          <span className="px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Now playing
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player and transcript"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3 lg:p-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6 lg:items-start">
            <div className="lg:col-span-3" ref={playerWrapperRef}>
              <YouTubePlayer
                ref={playerRef}
                key={videoId}
                videoId={videoId}
                initialStartSeconds={initialStartRef.current}
                autoplay
                onTimeUpdate={setCurrentMs}
              />
            </div>
            <div
              className="lg:col-span-2 flex flex-col min-h-0"
              style={{ height: playerHeight ?? 384 }}
            >
              {loading ? (
                <div className="flex-1 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6">
                  <p className="text-sm text-muted-foreground">Loading transcript…</p>
                </div>
              ) : transcript ? (
                <TranscriptView
                  segments={transcript.segments}
                  currentMs={currentMs}
                  onSeek={handleSeek}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No transcript available for this video.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={jumpToFullPage}
        className="flex w-full items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-left hover:bg-accent transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        Jump to video page
      </button>
    </div>
  )
}
