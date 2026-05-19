import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE video_enrichments (
      video_id uuid PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      summary text NOT NULL,
      model text,
      model_version text,
      enriched_at timestamptz NOT NULL DEFAULT now(),
      raw_response jsonb
    )
  `.execute(db)

  await sql`
    CREATE TABLE topics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      label text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE video_topics (
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      position integer NOT NULL,
      PRIMARY KEY (video_id, topic_id)
    )
  `.execute(db)

  await sql`CREATE INDEX video_topics_topic_id_idx ON video_topics (topic_id)`.execute(db)

  await sql`
    CREATE TABLE video_scripture_refs (
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      reference text NOT NULL,
      position integer NOT NULL,
      PRIMARY KEY (video_id, position)
    )
  `.execute(db)

  await sql`CREATE INDEX video_scripture_refs_reference_idx ON video_scripture_refs (reference)`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS video_scripture_refs`.execute(db)
  await sql`DROP TABLE IF EXISTS video_topics`.execute(db)
  await sql`DROP TABLE IF EXISTS topics`.execute(db)
  await sql`DROP TABLE IF EXISTS video_enrichments`.execute(db)
}
