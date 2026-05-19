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

export interface ChannelsTable {
  id: Generated<string>
  youtube_channel_id: string
  title: string
  ingested_at: Generated<Timestamptz>
}

export interface PlaylistsTable {
  id: Generated<string>
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
  channel_id: string
  youtube_video_id: string
  title: string
  description: string | null
  published_at: Timestamptz | null
  duration_seconds: number | null
  thumbnail_url: string | null
  view_count: ColumnType<string | null, string | number | null, string | number | null>
  view_count_updated_at: Timestamptz | null
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
  video_id: string
  transcript_id: string
  start_ms: number
  end_ms: number
  text: string
  position: number
  created_at: Generated<Timestamptz>
}

export interface EmbeddingsTable {
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
  video_id: string
  reference: string
  position: number
}

export interface RelatedVideosTable {
  video_id: string
  related_video_id: string
  signal: string
  score: number
  payload: ColumnType<unknown, unknown, unknown>
  computed_at: Generated<Timestamptz>
}

export interface Database {
  channels: ChannelsTable
  playlists: PlaylistsTable
  videos: VideosTable
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
}

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

export function resolveDatabaseUrl(connectionString?: string): string {
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env or pass a connection string explicitly.",
    )
  }
  return url
}

export function createDb(connectionString?: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(connectionString) })
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}

export { migrateToLatest } from "./migrate.js"
