import type { FtsResult, MatchType } from "./fts.js"

// Cap each video's hit list so a video full of weak matches doesn't push a
// massive payload. 10 keeps the result card scannable without truncating
// videos that are genuinely dense.
const DEFAULT_HITS_PER_VIDEO = 10

// Top-K decayed sum for per-video scoring: the strongest chunk counts in
// full, each subsequent chunk's contribution halves. This prevents the
// failure mode where a video with many weak hits (e.g. dozens of passing
// mentions of a common query token) outranks a video with a few strong
// hits — pure-sum scoring was vulnerable to that. With decay=0.5 the total
// boost over the top chunk is capped at ~1× the top chunk's score.
const SCORE_TOP_K = 5
const SCORE_DECAY = 0.5

function aggregateChunkScores(hits: GroupedHit[]): number {
  const sorted = hits.map((h) => h.score).sort((a, b) => b - a)
  let total = 0
  let weight = 1
  for (let i = 0; i < Math.min(sorted.length, SCORE_TOP_K); i++) {
    total += (sorted[i] ?? 0) * weight
    weight *= SCORE_DECAY
  }
  return total
}

export interface GroupedHit {
  snippet: string
  start_ms: number
  score: number
  match_type: MatchType
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

// Groups per-chunk FTS results into per-video buckets. Videos rank by the
// top-K decayed sum of their chunks' scores (see aggregateChunkScores), or
// by the caller-provided videoScores when set. Within a video, hits are
// sorted chronologically and capped.
export function groupByVideo(
  chunks: FtsResult[],
  opts: GroupOptions,
): { videos: GroupedVideo[]; total: number } {
  const hitsPerVideo = opts.hitsPerVideo ?? DEFAULT_HITS_PER_VIDEO
  const map = new Map<string, GroupedVideo>()

  for (const c of chunks) {
    const existing = map.get(c.youtube_video_id)
    const hit: GroupedHit = {
      snippet: c.snippet,
      start_ms: c.start_ms,
      score: c.score,
      match_type: c.match_type,
    }
    if (existing) {
      existing.hits.push(hit)
    } else {
      map.set(c.youtube_video_id, {
        youtube_video_id: c.youtube_video_id,
        title: c.title,
        thumbnail_url: c.thumbnail_url,
        score: 0,
        hits: [hit],
      })
    }
  }

  for (const v of map.values()) {
    const override = opts.videoScores?.get(v.youtube_video_id)
    v.score = override !== undefined ? override : aggregateChunkScores(v.hits)
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
