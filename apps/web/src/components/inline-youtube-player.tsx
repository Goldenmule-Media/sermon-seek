"use client"

import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/video-detail/youtube-player"
import { ExternalLink, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

interface InlineYouTubePlayerProps {
  videoId: string
  startSeconds: number
  onClose: () => void
}

export function InlineYouTubePlayer({ videoId, startSeconds, onClose }: InlineYouTubePlayerProps) {
  const router = useRouter()
  const playerRef = useRef<YouTubePlayerHandle>(null)
  const initialStartRef = useRef(startSeconds)

  // When the user picks a different hit on the same video, the parent re-renders
  // with a new startSeconds. Seek the existing player instead of remounting it,
  // so playback continues without reloading the iframe and prompting another
  // click-to-play. The very first startSeconds is consumed by initialStartSeconds.
  useEffect(() => {
    if (startSeconds === initialStartRef.current) return
    playerRef.current?.seekTo(startSeconds)
  }, [startSeconds])

  function jumpToFullPage() {
    const current = playerRef.current?.getCurrentTime() ?? 0
    const t = Math.floor(current > 0 ? current : startSeconds)
    router.push(`/videos/${videoId}?t=${t}`)
  }

  return (
    <div className="relative w-full max-w-2xl mx-auto space-y-2">
      <div className="relative rounded-md overflow-hidden bg-black">
        <YouTubePlayer
          ref={playerRef}
          // Key only on videoId so picking a different hit on the same video
          // seeks rather than reloading the iframe. A switch to a different
          // video remounts the player (and its iframe).
          key={videoId}
          videoId={videoId}
          initialStartSeconds={initialStartRef.current}
          autoplay
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player"
          className="absolute -top-2 -right-2 z-10 h-7 w-7 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-accent transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
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
