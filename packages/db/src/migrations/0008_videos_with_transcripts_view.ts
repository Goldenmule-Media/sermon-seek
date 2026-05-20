import { type Kysely, sql } from "kysely"

// Recommendation surfaces (home strip, related videos, playlist/topic listings,
// scripture-ref search) should never expose videos without a transcript — there
// is nothing for the user to read or search inside. This view is the canonical
// "publishable videos" filter; the underlying `videos` table is unchanged so
// admin/detail routes can still see everything.
export async function up(db: Kysely<unknown>): Promise<void> {
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
}
