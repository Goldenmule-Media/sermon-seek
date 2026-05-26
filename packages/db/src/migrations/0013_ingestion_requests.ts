import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE churches ADD COLUMN youtube_channel_id text`.execute(db)

  await sql`
    ALTER TABLE churches
      ADD COLUMN status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending','active','suspended','denied'))
  `.execute(db)

  await sql`
    CREATE UNIQUE INDEX churches_youtube_channel_active_idx
      ON churches (youtube_channel_id)
      WHERE status IN ('pending','active')
  `.execute(db)

  await sql`
    CREATE TABLE ingestion_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
      requested_slug text NOT NULL,
      requested_name text NOT NULL,
      youtube_handle_or_url text NOT NULL,
      include_playlist_ids text[] NOT NULL DEFAULT '{}',
      exclude_playlist_ids text[] NOT NULL DEFAULT '{}',
      contact_email text NOT NULL,
      status text NOT NULL CHECK (status IN (
        'received','running','awaiting_approval','approved','denied','failed','complete'
      )),
      videos_discovered integer NOT NULL DEFAULT 0,
      videos_ingested integer NOT NULL DEFAULT 0,
      tokens_ingested bigint NOT NULL DEFAULT 0,
      limit_reached boolean NOT NULL DEFAULT false,
      admin_note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE INDEX ingestion_requests_user_idx ON ingestion_requests (user_id)`.execute(db)
  await sql`CREATE INDEX ingestion_requests_status_idx ON ingestion_requests (status)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS ingestion_requests_status_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS ingestion_requests_user_idx`.execute(db)
  await sql`DROP TABLE IF EXISTS ingestion_requests`.execute(db)
  await sql`DROP INDEX IF EXISTS churches_youtube_channel_active_idx`.execute(db)
  await sql`ALTER TABLE churches DROP COLUMN IF EXISTS status`.execute(db)
  await sql`ALTER TABLE churches DROP COLUMN IF EXISTS youtube_channel_id`.execute(db)
}
