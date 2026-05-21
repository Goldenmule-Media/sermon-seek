export interface SearchHit {
  snippet: string
  start_ms: number
  score: number
  match_type: "lexical" | "semantic"
}

export interface SearchResult {
  video_id: string
  title: string
  thumbnail_url: string
  summary: string
  score: number
  hits: SearchHit[]
  scripture_refs: ScriptureRefDetail[]
  topics: Topic[]
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  took_ms: number
  scripture_refs: ScriptureRefDetail[]
  topics: Topic[]
}

export interface SearchRequest {
  church: string
  q: string
  limit?: number
  offset?: number
}

export interface ChurchRef {
  id: string
  slug: string
  name: string
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

export interface RelatedVideosResponse {
  related: RelatedVideo[]
}

export interface HomeResponse {
  recent: Video[]
  category_strips: Array<{ playlist: PlaylistWithStats; videos: Video[] }>
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

export interface Topic {
  slug: string
  label: string
  video_count: number
}

export interface TopicVideos {
  topic: Topic
  videos: Video[]
  total: number
}

export interface PlaylistVideos {
  playlist: PlaylistWithStats
  videos: Video[]
  total: number
}

export interface PlaylistsResponse {
  playlists: PlaylistWithStats[]
}

export interface ScriptureRefDetail {
  book_id: number
  chapter_start: number
  verse_start: number
  chapter_end: number
  verse_end: number
  start_coord: number
  end_coord: number
  occurrences: number
  display: string
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
  topics: Array<{ slug: string; label: string }>
  scripture_refs: ScriptureRefDetail[]
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

export type IngestionFilterRuleType = "include" | "exclude"
export type IngestionFilterTargetKind = "playlist"

export interface IngestionFilterRule {
  id: string
  channel_id: string
  rule_type: IngestionFilterRuleType
  target_kind: IngestionFilterTargetKind
  target_id: string
  note: string | null
  created_at: string
}
