import {
  type ColumnType,
  type Generated,
  type Insertable,
  Kysely,
  PostgresDialect,
  type Selectable,
  type Updateable,
} from "kysely"
import pg from "pg"

type Timestamptz = ColumnType<Date, Date | string, Date | string>

export type UserStatus = "active" | "suspended" | "deleted"
export type ChurchStatus = "pending" | "active" | "suspended" | "denied"
export type IngestionRequestStatus =
  | "received"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "failed"
  | "complete"

/**
 * `full` walks every discovered video; `incremental` only those not ingested
 * yet (everything published since the last successful run, plus prior misses).
 */
export type IngestionRequestMode = "full" | "incremental"

export interface UsersTable {
  id: Generated<string>
  google_sub: string
  display_name: string | null
  avatar_url: string | null
  is_admin: Generated<boolean>
  status: Generated<UserStatus>
  created_at: Generated<Timestamptz>
  last_seen_at: Generated<Timestamptz>
}

export interface SessionsTable {
  id: Generated<string>
  user_id: string
  session_token_hash: string
  user_agent: string | null
  ip: string | null
  created_at: Generated<Timestamptz>
  expires_at: Timestamptz
  revoked_at: Timestamptz | null
}

export interface AdminAuditLogTable {
  id: Generated<string>
  user_id: string | null
  action: string
  target_type: string
  target_id: string
  payload: ColumnType<unknown | null, unknown | null, unknown | null>
  created_at: Generated<Timestamptz>
}

export type WorkerHeartbeatStatus = "idle" | "busy" | "error"

export interface WorkerHeartbeatsTable {
  worker_id: string
  kind: string
  last_beat_at: Timestamptz
  last_job_id: string | null
  status: WorkerHeartbeatStatus
  message: string | null
}

export interface SystemRunsTable {
  kind: string
  last_run_at: Timestamptz
  last_status: string
}

export interface ChurchesTable {
  id: Generated<string>
  slug: string
  name: string
  youtube_channel_id: string | null
  status: Generated<ChurchStatus>
  created_at: Generated<Timestamptz>
}

export interface IngestionRequestsTable {
  id: Generated<string>
  user_id: string
  church_id: string | null
  requested_slug: string
  requested_name: string
  youtube_handle_or_url: string
  include_playlist_ids: Generated<string[]>
  exclude_playlist_ids: Generated<string[]>
  contact_email: string
  status: IngestionRequestStatus
  videos_discovered: Generated<number>
  videos_ingested: Generated<number>
  tokens_ingested: ColumnType<string, string | number, string | number>
  limit_reached: Generated<boolean>
  admin_note: string | null
  retry_count: Generated<number>
  mode: Generated<IngestionRequestMode>
  created_at: Generated<Timestamptz>
  updated_at: Generated<Timestamptz>
}

export interface ChurchSlugAliasesTable {
  id: Generated<string>
  church_id: string
  slug: string
  created_at: Generated<Timestamptz>
  expires_at: Timestamptz | null
}

export interface ChannelsTable {
  id: Generated<string>
  church_id: string
  youtube_channel_id: string
  title: string
  ingested_at: Generated<Timestamptz>
}

export interface PlaylistsTable {
  id: Generated<string>
  church_id: string
  channel_id: string
  youtube_playlist_id: string
  slug: string
  title: string
  description: string | null
  position: number | null
  total_views: ColumnType<string | null, string | number | null, string | number | null>
  video_count: number | null
  stats_updated_at: Timestamptz | null
}

export interface VideosTable {
  id: Generated<string>
  church_id: string
  channel_id: string
  youtube_video_id: string
  title: string
  description: string | null
  published_at: Timestamptz | null
  duration_seconds: number | null
  thumbnail_url: string | null
  view_count: ColumnType<string | null, string | number | null, string | number | null>
  view_count_updated_at: Timestamptz | null
  captions_unavailable_at: Timestamptz | null
  captions_attempts: Generated<number>
}

export interface VideoPlaylistsTable {
  video_id: string
  playlist_id: string
  position: number
}

export type TranscriptSource = "youtube_public" | "whisper"

export interface TranscriptsTable {
  id: Generated<string>
  video_id: string
  source: TranscriptSource
  language: Generated<string>
  model_version: string | null
  full_text: string
  raw_vtt: string | null
  created_at: Generated<Timestamptz>
}

export interface TranscriptSegmentsTable {
  id: Generated<string>
  transcript_id: string
  video_id: string
  start_ms: number
  end_ms: number
  text: string
  speaker_id: string | null
}

export interface TranscriptWordsTable {
  id: Generated<string>
  transcript_id: string
  segment_id: string
  video_id: string
  start_ms: number
  end_ms: number
  text: string
  position: number
}

export interface TranscriptChunksTable {
  id: Generated<string>
  church_id: string
  video_id: string
  transcript_id: string
  start_ms: number
  end_ms: number
  text: string
  position: number
  created_at: Generated<Timestamptz>
  text_tsv: ColumnType<string, never, never>
}

export interface EmbeddingsTable {
  church_id: string
  chunk_id: string
  model: string
  vector: ColumnType<string, string, string>
}

export interface VideoEnrichmentsTable {
  video_id: string
  summary: string
  model: string | null
  model_version: string | null
  enriched_at: Generated<Timestamptz>
  raw_response: ColumnType<unknown | null, unknown | null, unknown | null>
}

export interface TopicsTable {
  id: Generated<string>
  church_id: string
  slug: string
  label: string
  created_at: Generated<Timestamptz>
}

export interface VideoTopicsTable {
  video_id: string
  topic_id: string
  position: number
}

export interface VideoScriptureRefsTable {
  id: Generated<string>
  video_id: string
  book_id: number
  chapter_start: number
  verse_start: number
  chapter_end: number
  verse_end: number
  start_coord: ColumnType<string, string | number, string | number>
  end_coord: ColumnType<string, string | number, string | number>
  occurrences: number
  positions: number[]
  first_position: number
  raw_first: string
}

export interface RelatedVideosTable {
  video_id: string
  related_video_id: string
  signal: string
  score: number
  payload: ColumnType<unknown, unknown, unknown>
  computed_at: Generated<Timestamptz>
}

export type IngestionFilterRuleType = "include" | "exclude"
export type IngestionFilterTargetKind = "playlist"

export interface ChannelFilterRulesTable {
  id: Generated<string>
  channel_id: string
  rule_type: IngestionFilterRuleType
  target_kind: IngestionFilterTargetKind
  target_id: string
  note: string | null
  created_at: Generated<Timestamptz>
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  admin_audit_log: AdminAuditLogTable
  churches: ChurchesTable
  ingestion_requests: IngestionRequestsTable
  church_slug_aliases: ChurchSlugAliasesTable
  channels: ChannelsTable
  playlists: PlaylistsTable
  videos: VideosTable
  // Read-only view: same columns as `videos`, filtered to rows that have at
  // least one transcript. Used by recommendation surfaces.
  videos_with_transcripts: VideosTable
  video_playlists: VideoPlaylistsTable
  transcripts: TranscriptsTable
  transcript_segments: TranscriptSegmentsTable
  transcript_words: TranscriptWordsTable
  transcript_chunks: TranscriptChunksTable
  embeddings: EmbeddingsTable
  video_enrichments: VideoEnrichmentsTable
  topics: TopicsTable
  video_topics: VideoTopicsTable
  video_scripture_refs: VideoScriptureRefsTable
  related_videos: RelatedVideosTable
  channel_filter_rules: ChannelFilterRulesTable
  worker_heartbeats: WorkerHeartbeatsTable
  system_runs: SystemRunsTable
}

export type UserRow = Selectable<UsersTable>
export type UserInsert = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>

export type SessionRow = Selectable<SessionsTable>
export type SessionInsert = Insertable<SessionsTable>
export type SessionUpdate = Updateable<SessionsTable>

export type AdminAuditLogRow = Selectable<AdminAuditLogTable>
export type AdminAuditLogInsert = Insertable<AdminAuditLogTable>
export type AdminAuditLogUpdate = Updateable<AdminAuditLogTable>

export type ChurchRow = Selectable<ChurchesTable>
export type ChurchInsert = Insertable<ChurchesTable>
export type ChurchUpdate = Updateable<ChurchesTable>

export type ChurchSlugAliasRow = Selectable<ChurchSlugAliasesTable>
export type ChurchSlugAliasInsert = Insertable<ChurchSlugAliasesTable>
export type ChurchSlugAliasUpdate = Updateable<ChurchSlugAliasesTable>

export type IngestionRequestRow = Selectable<IngestionRequestsTable>
export type IngestionRequestInsert = Insertable<IngestionRequestsTable>
export type IngestionRequestUpdate = Updateable<IngestionRequestsTable>

export type ChannelRow = Selectable<ChannelsTable>
export type ChannelInsert = Insertable<ChannelsTable>
export type ChannelUpdate = Updateable<ChannelsTable>

export type PlaylistRow = Selectable<PlaylistsTable>
export type PlaylistInsert = Insertable<PlaylistsTable>
export type PlaylistUpdate = Updateable<PlaylistsTable>

export type VideoRow = Selectable<VideosTable>
export type VideoInsert = Insertable<VideosTable>
export type VideoUpdate = Updateable<VideosTable>

export type VideoPlaylistRow = Selectable<VideoPlaylistsTable>
export type VideoPlaylistInsert = Insertable<VideoPlaylistsTable>
export type VideoPlaylistUpdate = Updateable<VideoPlaylistsTable>

export type TranscriptRow = Selectable<TranscriptsTable>
export type TranscriptInsert = Insertable<TranscriptsTable>
export type TranscriptUpdate = Updateable<TranscriptsTable>

export type TranscriptSegmentRow = Selectable<TranscriptSegmentsTable>
export type TranscriptSegmentInsert = Insertable<TranscriptSegmentsTable>
export type TranscriptSegmentUpdate = Updateable<TranscriptSegmentsTable>

export type TranscriptWordRow = Selectable<TranscriptWordsTable>
export type TranscriptWordInsert = Insertable<TranscriptWordsTable>
export type TranscriptWordUpdate = Updateable<TranscriptWordsTable>

export type TranscriptChunkRow = Selectable<TranscriptChunksTable>
export type TranscriptChunkInsert = Insertable<TranscriptChunksTable>
export type TranscriptChunkUpdate = Updateable<TranscriptChunksTable>

export type EmbeddingRow = Selectable<EmbeddingsTable>
export type EmbeddingInsert = Insertable<EmbeddingsTable>
export type EmbeddingUpdate = Updateable<EmbeddingsTable>

export type VideoEnrichmentRow = Selectable<VideoEnrichmentsTable>
export type VideoEnrichmentInsert = Insertable<VideoEnrichmentsTable>
export type VideoEnrichmentUpdate = Updateable<VideoEnrichmentsTable>

export type TopicRow = Selectable<TopicsTable>
export type TopicInsert = Insertable<TopicsTable>
export type TopicUpdate = Updateable<TopicsTable>

export type VideoTopicRow = Selectable<VideoTopicsTable>
export type VideoTopicInsert = Insertable<VideoTopicsTable>
export type VideoTopicUpdate = Updateable<VideoTopicsTable>

export type VideoScriptureRefRow = Selectable<VideoScriptureRefsTable>
export type VideoScriptureRefInsert = Insertable<VideoScriptureRefsTable>
export type VideoScriptureRefUpdate = Updateable<VideoScriptureRefsTable>

export type RelatedVideoRow = Selectable<RelatedVideosTable>
export type RelatedVideoInsert = Insertable<RelatedVideosTable>
export type RelatedVideoUpdate = Updateable<RelatedVideosTable>

export type ChannelFilterRuleRow = Selectable<ChannelFilterRulesTable>
export type ChannelFilterRuleInsert = Insertable<ChannelFilterRulesTable>
export type ChannelFilterRuleUpdate = Updateable<ChannelFilterRulesTable>

export type WorkerHeartbeatRow = Selectable<WorkerHeartbeatsTable>
export type WorkerHeartbeatInsert = Insertable<WorkerHeartbeatsTable>
export type WorkerHeartbeatUpdate = Updateable<WorkerHeartbeatsTable>

export type SystemRunRow = Selectable<SystemRunsTable>
export type SystemRunInsert = Insertable<SystemRunsTable>
export type SystemRunUpdate = Updateable<SystemRunsTable>

export function resolveDatabaseUrl(connectionString?: string): string {
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env or pass a connection string explicitly.",
    )
  }
  return url
}

export function createDb(connectionString?: string, options?: { max?: number }): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString: resolveDatabaseUrl(connectionString),
    max: options?.max,
  })
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}

export { migrateToLatest } from "./migrate.js"
export {
  ScopedDb,
  createScopedDb,
  TENANT_TABLES,
  assertChurchId,
  type TenantTable,
} from "./scoped.js"
