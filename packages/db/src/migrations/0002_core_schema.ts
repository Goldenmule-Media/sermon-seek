import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE transcript_source AS ENUM ('youtube_public', 'whisper')`.execute(db)

  await sql`
    CREATE TABLE channels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      youtube_channel_id text NOT NULL UNIQUE,
      title text NOT NULL,
      ingested_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE playlists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      youtube_playlist_id text NOT NULL UNIQUE,
      slug text NOT NULL,
      title text NOT NULL,
      description text,
      position integer,
      total_views bigint,
      video_count integer,
      stats_updated_at timestamptz,
      UNIQUE (channel_id, slug)
    )
  `.execute(db)
  await sql`CREATE INDEX playlists_channel_id_idx ON playlists (channel_id)`.execute(db)

  await sql`
    CREATE TABLE videos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      youtube_video_id text NOT NULL UNIQUE,
      title text NOT NULL,
      description text,
      published_at timestamptz,
      duration_seconds integer,
      thumbnail_url text,
      view_count bigint,
      view_count_updated_at timestamptz
    )
  `.execute(db)
  await sql`CREATE INDEX videos_channel_id_idx ON videos (channel_id)`.execute(db)

  await sql`
    CREATE TABLE video_playlists (
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position integer NOT NULL,
      PRIMARY KEY (video_id, playlist_id)
    )
  `.execute(db)
  await sql`CREATE INDEX video_playlists_playlist_id_idx ON video_playlists (playlist_id)`.execute(db)

  await sql`
    CREATE TABLE transcripts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      source transcript_source NOT NULL,
      language text NOT NULL DEFAULT 'en',
      model_version text,
      full_text text NOT NULL,
      raw_vtt text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (video_id, source, model_version)
    )
  `.execute(db)
  await sql`CREATE INDEX transcripts_video_id_idx ON transcripts (video_id)`.execute(db)

  await sql`
    CREATE TABLE transcript_segments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      start_ms integer NOT NULL,
      end_ms integer NOT NULL,
      text text NOT NULL,
      speaker_id text,
      text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
    )
  `.execute(db)
  await sql`CREATE INDEX transcript_segments_transcript_id_idx ON transcript_segments (transcript_id)`.execute(db)
  await sql`CREATE INDEX transcript_segments_video_start_idx ON transcript_segments (video_id, start_ms)`.execute(db)
  await sql`CREATE INDEX transcript_segments_text_tsv_idx ON transcript_segments USING gin (text_tsv)`.execute(db)

  await sql`
    CREATE TABLE transcript_words (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      segment_id uuid NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      start_ms integer NOT NULL,
      end_ms integer NOT NULL,
      text text NOT NULL,
      position integer NOT NULL,
      UNIQUE (segment_id, position)
    )
  `.execute(db)
  await sql`CREATE INDEX transcript_words_segment_id_idx ON transcript_words (segment_id)`.execute(db)
  await sql`CREATE INDEX transcript_words_video_start_idx ON transcript_words (video_id, start_ms)`.execute(db)

  await sql`
    CREATE TABLE embeddings (
      chunk_id uuid NOT NULL,
      model text NOT NULL,
      vector vector(1536) NOT NULL,
      PRIMARY KEY (chunk_id, model)
    )
  `.execute(db)
  await sql`CREATE INDEX embeddings_vector_hnsw_idx ON embeddings USING hnsw (vector vector_cosine_ops)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS embeddings`.execute(db)
  await sql`DROP TABLE IF EXISTS transcript_words`.execute(db)
  await sql`DROP TABLE IF EXISTS transcript_segments`.execute(db)
  await sql`DROP TABLE IF EXISTS transcripts`.execute(db)
  await sql`DROP TABLE IF EXISTS video_playlists`.execute(db)
  await sql`DROP TABLE IF EXISTS videos`.execute(db)
  await sql`DROP TABLE IF EXISTS playlists`.execute(db)
  await sql`DROP TABLE IF EXISTS channels`.execute(db)
  await sql`DROP TYPE IF EXISTS transcript_source`.execute(db)
}
