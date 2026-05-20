"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

// Minimal inline types for the YouTube IFrame API (no @types/youtube needed)
interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  destroy(): void
}

interface YTPlayerOptions {
  videoId: string
  playerVars?: Record<string, unknown>
  events?: {
    onStateChange?: (event: { data: number }) => void
  }
}

declare global {
  interface Window {
    YT: {
      Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer
      PlayerState: { PLAYING: number }
    }
    onYouTubeIframeAPIReady: () => void
  }
}

export interface YouTubePlayerHandle {
  seekTo(seconds: number): void
  getCurrentTime(): number
}

interface Props {
  videoId: string
  initialStartSeconds?: number
  autoplay?: boolean
  onTimeUpdate?: (ms: number) => void
}

let apiLoadPromise: Promise<void> | null = null

function loadYouTubeApi(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise
  apiLoadPromise = new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve()
      return
    }
    if (window.YT?.Player) {
      resolve()
      return
    }
    window.onYouTubeIframeAPIReady = resolve
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    document.head.appendChild(script)
  })
  return apiLoadPromise
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(
  ({ videoId, initialStartSeconds = 0, autoplay = false, onTimeUpdate }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<YTPlayer | null>(null)
    const rafRef = useRef<number>(0)
    const onTimeUpdateRef = useRef(onTimeUpdate)
    onTimeUpdateRef.current = onTimeUpdate

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        playerRef.current?.seekTo(seconds, true)
      },
      getCurrentTime() {
        return playerRef.current?.getCurrentTime() ?? 0
      },
    }))

    useEffect(() => {
      let destroyed = false

      async function init() {
        await loadYouTubeApi()
        if (destroyed || !containerRef.current) return

        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          playerVars: {
            start: Math.floor(initialStartSeconds),
            rel: 0,
            modestbranding: 1,
            autoplay: autoplay ? 1 : 0,
          },
          events: {
            onStateChange(event) {
              cancelAnimationFrame(rafRef.current)
              if (event.data === window.YT.PlayerState.PLAYING) {
                const tick = () => {
                  if (!playerRef.current) return
                  const ms = Math.round(playerRef.current.getCurrentTime() * 1000)
                  onTimeUpdateRef.current?.(ms)
                  rafRef.current = requestAnimationFrame(tick)
                }
                rafRef.current = requestAnimationFrame(tick)
              }
            },
          },
        })
      }

      init()

      return () => {
        destroyed = true
        cancelAnimationFrame(rafRef.current)
        playerRef.current?.destroy()
        playerRef.current = null
      }
    }, [videoId, initialStartSeconds])

    return (
      // YT.Player REPLACES `containerRef` with an iframe (it doesn't inject
      // inside it), so we target the iframe from the outer wrapper. Default
      // YT iframe attrs are width="640" height="360" which overflow narrower
      // columns; forcing it to absolute-fill the 16:9 padding box keeps the
      // player inside its grid cell no matter how tight the layout is.
      <div
        className="relative w-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:w-full [&_iframe]:h-full"
        style={{ paddingBottom: "56.25%" }}
      >
        <div ref={containerRef} />
      </div>
    )
  },
)

YouTubePlayer.displayName = "YouTubePlayer"
