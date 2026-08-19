import { type Kysely, sql } from "kysely"

// Incremental re-ingest support.
//
// `ingestion_requests.mode` distinguishes a full re-ingest (walk every
// discovered video, today's behaviour) from an incremental one (only videos
// that have not been ingested yet — i.e. everything published since the last
// successful run, plus anything a prior run missed).
//
// The two `videos.captions_*` columns persist the outcome of a caption fetch
// that came back empty. Without them an incremental run has no way to tell
// "new video" from "video YouTube has no captions for", and would re-spawn
// yt-dlp for every captionless video on every run — the exact cost incremental
// mode exists to avoid.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE ingestion_requests
      ADD COLUMN mode text NOT NULL DEFAULT 'full'
        CHECK (mode IN ('full','incremental'))
  `.execute(db)

  await sql`ALTER TABLE videos ADD COLUMN captions_unavailable_at timestamptz`.execute(db)
  await sql`ALTER TABLE videos ADD COLUMN captions_attempts integer NOT NULL DEFAULT 0`.execute(db)

  // `videos_with_transcripts` is defined as SELECT v.* — Postgres expands the
  // star at creation time, so the new columns do not appear until the view is
  // recreated. The Kysely types declare the view and the table as the same
  // shape; leaving it stale would make that a lie.
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

  await sql`ALTER TABLE videos DROP COLUMN IF EXISTS captions_attempts`.execute(db)
  await sql`ALTER TABLE videos DROP COLUMN IF EXISTS captions_unavailable_at`.execute(db)
  await sql`ALTER TABLE ingestion_requests DROP COLUMN IF EXISTS mode`.execute(db)

  await sql`
    CREATE VIEW videos_with_transcripts AS
    SELECT v.*
    FROM videos v
    WHERE EXISTS (
      SELECT 1 FROM transcripts t WHERE t.video_id = v.id
    )
  `.execute(db)
}
