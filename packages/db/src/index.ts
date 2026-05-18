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

export interface Database {
  channels: ChannelsTable
  playlists: PlaylistsTable
  videos: VideosTable
  video_playlists: VideoPlaylistsTable
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
