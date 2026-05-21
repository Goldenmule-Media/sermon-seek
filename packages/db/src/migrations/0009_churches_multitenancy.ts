import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE churches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`ALTER TABLE channels ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER TABLE playlists ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER TABLE videos ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER TABLE transcript_chunks ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER TABLE embeddings ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)
  await sql`ALTER TABLE topics ADD COLUMN church_id uuid REFERENCES churches(id) ON DELETE CASCADE`.execute(db)

  await sql`INSERT INTO churches (slug, name) VALUES ('jubileestl', 'Jubilee Church STL')`.execute(db)

  await sql`UPDATE channels SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)
  await sql`UPDATE playlists SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)
  await sql`UPDATE videos SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)
  await sql`UPDATE transcript_chunks SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)
  await sql`UPDATE embeddings SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)
  await sql`UPDATE topics SET church_id = (SELECT id FROM churches WHERE slug = 'jubileestl') WHERE church_id IS NULL`.execute(db)

  await sql`ALTER TABLE channels ALTER COLUMN church_id SET NOT NULL`.execute(db)
  await sql`ALTER TABLE playlists ALTER COLUMN church_id SET NOT NULL`.execute(db)
  await sql`ALTER TABLE videos ALTER COLUMN church_id SET NOT NULL`.execute(db)
  await sql`ALTER TABLE transcript_chunks ALTER COLUMN church_id SET NOT NULL`.execute(db)
  await sql`ALTER TABLE embeddings ALTER COLUMN church_id SET NOT NULL`.execute(db)
  await sql`ALTER TABLE topics ALTER COLUMN church_id SET NOT NULL`.execute(db)

  await sql`ALTER TABLE playlists DROP CONSTRAINT IF EXISTS playlists_channel_id_slug_key`.execute(db)
  await sql`CREATE UNIQUE INDEX playlists_church_slug_idx ON playlists (church_id, slug)`.execute(db)

  await sql`ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_slug_key`.execute(db)
  await sql`CREATE UNIQUE INDEX topics_church_slug_idx ON topics (church_id, slug)`.execute(db)

  await sql`CREATE INDEX videos_church_idx ON videos (church_id)`.execute(db)
  await sql`CREATE INDEX transcript_chunks_church_idx ON transcript_chunks (church_id)`.execute(db)
  await sql`CREATE INDEX embeddings_church_idx ON embeddings (church_id)`.execute(db)

  await sql`DROP VIEW IF EXISTS videos_with_transcripts`.execute(db)
  await sql`
    CREATE VIEW videos_with_transcripts AS
    SELECT v.*
    FROM videos v
    WHERE EXISTS (
      SELECT 1 FROM transcripts t WHERE t.video_id = v.id
    )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS videos_with_transcripts`.execute(db)

  await sql`DROP INDEX IF EXISTS videos_church_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS transcript_chunks_church_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS embeddings_church_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS playlists_church_slug_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS topics_church_slug_idx`.execute(db)

  await sql`ALTER TABLE playlists ADD CONSTRAINT playlists_channel_id_slug_key UNIQUE (channel_id, slug)`.execute(db)
  await sql`ALTER TABLE topics ADD CONSTRAINT topics_slug_key UNIQUE (slug)`.execute(db)

  await sql`ALTER TABLE channels DROP COLUMN IF EXISTS church_id`.execute(db)
  await sql`ALTER TABLE playlists DROP COLUMN IF EXISTS church_id`.execute(db)
  await sql`ALTER TABLE videos DROP COLUMN IF EXISTS church_id`.execute(db)
  await sql`ALTER TABLE transcript_chunks DROP COLUMN IF EXISTS church_id`.execute(db)
  await sql`ALTER TABLE embeddings DROP COLUMN IF EXISTS church_id`.execute(db)
  await sql`ALTER TABLE topics DROP COLUMN IF EXISTS church_id`.execute(db)

  await sql`DROP TABLE IF EXISTS churches`.execute(db)

  await sql`
    CREATE VIEW videos_with_transcripts AS
    SELECT v.*
    FROM videos v
    WHERE EXISTS (
      SELECT 1 FROM transcripts t WHERE t.video_id = v.id
    )
  `.execute(db)
}
