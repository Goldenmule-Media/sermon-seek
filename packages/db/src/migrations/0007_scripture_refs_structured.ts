import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS video_scripture_refs`.execute(db)

  await sql`
    CREATE TABLE video_scripture_refs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      book_id smallint NOT NULL,
      chapter_start smallint NOT NULL,
      verse_start smallint NOT NULL,
      chapter_end smallint NOT NULL,
      verse_end smallint NOT NULL,
      start_coord bigint NOT NULL,
      end_coord bigint NOT NULL,
      occurrences integer NOT NULL,
      positions integer[] NOT NULL,
      first_position integer NOT NULL,
      raw_first text NOT NULL,
      UNIQUE (video_id, start_coord, end_coord)
    )
  `.execute(db)

  await sql`CREATE INDEX video_scripture_refs_overlap_idx ON video_scripture_refs (start_coord, end_coord)`.execute(
    db,
  )
  await sql`CREATE INDEX video_scripture_refs_video_idx ON video_scripture_refs (video_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS video_scripture_refs`.execute(db)

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
