"use client"

import type { TranscriptResponse, VideoDetailResponse } from "@sermon-search/types"
import { useSearchParams } from "next/navigation"
import { useRef, useState } from "react"
import { InVideoSearch } from "./in-video-search"
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
  const [currentMs, setCurrentMs] = useState(initialStartSeconds * 1000)

  function handleSeek(ms: number) {
    setCurrentMs(ms)
    playerRef.current?.seekTo(ms / 1000)
  }

  return (
    <div className="space-y-4">
      <YouTubePlayer
        ref={playerRef}
        videoId={video.youtube_video_id}
        initialStartSeconds={initialStartSeconds}
        onTimeUpdate={setCurrentMs}
      />
      <InVideoSearch videoId={video.youtube_video_id} onSeek={handleSeek} />
      {transcript && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Transcript</h2>
          <TranscriptView
            segments={transcript.segments}
            currentMs={currentMs}
            onSeek={handleSeek}
          />
        </div>
      )}
    </div>
  )
}
