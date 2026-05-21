import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_youtube_channel_id_key`.execute(db)
  await sql`ALTER TABLE playlists DROP CONSTRAINT IF EXISTS playlists_youtube_playlist_id_key`.execute(db)
  await sql`ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_youtube_video_id_key`.execute(db)

  await sql`CREATE UNIQUE INDEX channels_church_youtube_id_idx ON channels (church_id, youtube_channel_id)`.execute(db)
  await sql`CREATE UNIQUE INDEX playlists_church_youtube_id_idx ON playlists (church_id, youtube_playlist_id)`.execute(db)
  await sql`CREATE UNIQUE INDEX videos_church_youtube_id_idx ON videos (church_id, youtube_video_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS videos_church_youtube_id_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS playlists_church_youtube_id_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS channels_church_youtube_id_idx`.execute(db)

  await sql`ALTER TABLE videos ADD CONSTRAINT videos_youtube_video_id_key UNIQUE (youtube_video_id)`.execute(db)
  await sql`ALTER TABLE playlists ADD CONSTRAINT playlists_youtube_playlist_id_key UNIQUE (youtube_playlist_id)`.execute(db)
  await sql`ALTER TABLE channels ADD CONSTRAINT channels_youtube_channel_id_key UNIQUE (youtube_channel_id)`.execute(db)
}
