export interface SearchResult {
  video_id: string
  title: string
  snippet: string
  start_ms: number
  score: number
  thumbnail_url: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  took_ms: number
}

export interface Video {
  id: string
  title: string
  thumbnail_url: string
  published_at: string
  duration_ms: number
  playlist_ids: string[]
}

export interface Playlist {
  id: string
  slug: string
  title: string
}

export interface PlaylistWithStats extends Playlist {
  video_count: number
  total_views: number
}

export interface TranscriptWord {
  text: string
  start_ms: number
  end_ms: number
}

export interface TranscriptSegment {
  id: string
  start_ms: number
  end_ms: number
  text: string
  words?: TranscriptWord[]
}

export interface VideoDetail extends Video {
  summary: string
  topics: string[]
  transcript: TranscriptSegment[]
}

// `same_speaker` is v2 / diarization-gated.
export type RelatedVideoReason =
  | { kind: "chunk_similarity"; text: string; matched_chunk_start_ms: number }
  | { kind: "topic_overlap"; text: string; topics: string[] }
  | { kind: "scripture_overlap"; text: string; references: string[] }
  | { kind: "same_series"; text: string; playlist_id: string }
  | { kind: "same_speaker"; text: string; speaker: string }

export interface RelatedVideo {
  video_id: string
  title: string
  thumbnail_url: string
  score: number
  reason: RelatedVideoReason
}

export interface HomeResponse {
  recent: Video[]
  top_playlists: Array<{ playlist: PlaylistWithStats; videos: Video[] }>
}

export interface PlaylistRef {
  id: string
  slug: string
  title: string
}

export interface ChannelRef {
  id: string
  title: string
}

export interface VideoDetailResponse {
  id: string
  youtube_video_id: string
  title: string
  channel: ChannelRef
  published_at: string
  duration_ms: number
  view_count: number
  thumbnail_url: string
  playlists: PlaylistRef[]
  summary: string
  topics: string[]
}

export interface TranscriptSegmentWithWords {
  id: string
  start_ms: number
  end_ms: number
  text: string
  words: TranscriptWord[]
}

export interface TranscriptResponse {
  transcript_id: string
  source: string
  language: string
  segments: TranscriptSegmentWithWords[]
}
