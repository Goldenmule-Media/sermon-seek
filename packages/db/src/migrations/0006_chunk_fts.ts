import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE transcript_chunks
      ADD COLUMN text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
  `.execute(db)
  await sql`CREATE INDEX transcript_chunks_text_tsv_idx ON transcript_chunks USING gin (text_tsv)`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS transcript_chunks_text_tsv_idx`.execute(db)
  await sql`ALTER TABLE transcript_chunks DROP COLUMN IF EXISTS text_tsv`.execute(db)
}
