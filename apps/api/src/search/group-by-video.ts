import type { FtsResult } from "./fts.js"

// Cap each video's hit list so a video full of weak matches doesn't push a
// massive payload. 10 keeps the result card scannable without truncating
// videos that are genuinely dense.
const DEFAULT_HITS_PER_VIDEO = 10

export interface GroupedHit {
  snippet: string
  start_ms: number
  score: number
}

export interface GroupedVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  score: number
  hits: GroupedHit[]
}

export interface GroupOptions {
  limit: number
  offset: number
  hitsPerVideo?: number
  // Optional pre-computed per-video score (e.g. ref-mode's SUM(occurrences)).
  // When provided, videos rank by this score; chunks contribute hits only.
  videoScores?: Map<string, number>
}

// Groups per-chunk FTS results into per-video buckets. Videos rank by the sum
// of their chunks' scores (so a video with multiple strong hits floats above a
// single-hit video), or by the caller-provided videoScores when set. Within a
// video, hits are sorted chronologically and capped.
export function groupByVideo(
  chunks: FtsResult[],
  opts: GroupOptions,
): { videos: GroupedVideo[]; total: number } {
  const hitsPerVideo = opts.hitsPerVideo ?? DEFAULT_HITS_PER_VIDEO
  const map = new Map<string, GroupedVideo>()

  for (const c of chunks) {
    const existing = map.get(c.youtube_video_id)
    const hit: GroupedHit = { snippet: c.snippet, start_ms: c.start_ms, score: c.score }
    if (existing) {
      existing.score += c.score
      existing.hits.push(hit)
    } else {
      map.set(c.youtube_video_id, {
        youtube_video_id: c.youtube_video_id,
        title: c.title,
        thumbnail_url: c.thumbnail_url,
        score: c.score,
        hits: [hit],
      })
    }
  }

  if (opts.videoScores) {
    for (const v of map.values()) {
      const override = opts.videoScores.get(v.youtube_video_id)
      if (override !== undefined) v.score = override
    }
  }

  const all = Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.youtube_video_id.localeCompare(b.youtube_video_id),
  )
  const paged = all.slice(opts.offset, opts.offset + opts.limit)

  for (const v of paged) {
    v.hits.sort((a, b) => a.start_ms - b.start_ms)
    if (v.hits.length > hitsPerVideo) v.hits = v.hits.slice(0, hitsPerVideo)
  }

  return { videos: paged, total: all.length }
}
