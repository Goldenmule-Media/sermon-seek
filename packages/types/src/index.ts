export * from "./slug.js"

export type UserStatus = "active" | "suspended" | "deleted"

export interface User {
  id: string
  display_name: string | null
  avatar_url: string | null
  is_admin: boolean
  status: UserStatus
  created_at: string
  last_seen_at: string
}

export interface Session {
  id: string
  user_id: string
  user_agent: string | null
  ip: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export type AuthMeResponse = Pick<User, "id" | "display_name" | "avatar_url" | "is_admin">

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

export type PlaylistFilterMode = "none" | "include" | "exclude"

export interface PlaylistFilters {
  mode: PlaylistFilterMode
  playlist_ids: string[]
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

export type ChurchStatus = "pending" | "active" | "suspended" | "denied"

export type IngestionRequestStatus =
  | "received"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "failed"
  | "complete"

export interface IngestionRequest {
  id: string
  user_id: string
  church_id: string | null
  requested_slug: string
  requested_name: string
  youtube_handle_or_url: string
  include_playlist_ids: string[]
  exclude_playlist_ids: string[]
  contact_email: string
  status: IngestionRequestStatus
  videos_discovered: number
  videos_ingested: number
  tokens_ingested: number
  limit_reached: boolean
  admin_note: string | null
  created_at: string
  updated_at: string
}

export interface IngestionRequestSummary {
  id: string
  requested_slug: string
  status: IngestionRequestStatus
  videos_discovered: number
  videos_ingested: number
  tokens_ingested: number
  tokens_cap: number
  search_url: string | null
  limit_reached: boolean
  created_at: string
}

export interface IngestionRequestDetail extends IngestionRequestSummary {
  requested_name: string
  youtube_handle_or_url: string
  contact_email: string
  playlist_filters: PlaylistFilters
  admin_note: string | null
  updated_at: string
}

export interface MeRequestsListResponse {
  requests: IngestionRequestSummary[]
  total: number
  limit: number
  offset: number
}
