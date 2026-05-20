"use client"

import { X } from "lucide-react"

interface InlineYouTubePlayerProps {
  videoId: string
  startSeconds: number
  onClose: () => void
}

export function InlineYouTubePlayer({ videoId, startSeconds, onClose }: InlineYouTubePlayerProps) {
  // Reloading the iframe on prop change is fine — it always loads fast from
  // YouTube's edge, and we want the start time to actually jump.
  const src = `https://www.youtube.com/embed/${videoId}?start=${startSeconds}&autoplay=1&rel=0`

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <div className="relative aspect-video rounded-md overflow-hidden bg-black">
        <iframe
          key={`${videoId}:${startSeconds}`}
          src={src}
          title="YouTube player"
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close player"
        className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-background border shadow-sm flex items-center justify-center hover:bg-accent transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
