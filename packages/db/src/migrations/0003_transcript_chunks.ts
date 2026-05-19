import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE transcript_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      start_ms integer NOT NULL,
      end_ms integer NOT NULL,
      text text NOT NULL,
      position integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (transcript_id, position)
    )
  `.execute(db)
  await sql`CREATE INDEX transcript_chunks_transcript_id_idx ON transcript_chunks (transcript_id)`.execute(
    db,
  )
  await sql`CREATE INDEX transcript_chunks_video_start_idx ON transcript_chunks (video_id, start_ms)`.execute(
    db,
  )

  await sql`
    ALTER TABLE embeddings
      ADD CONSTRAINT embeddings_chunk_id_fk
      FOREIGN KEY (chunk_id) REFERENCES transcript_chunks(id) ON DELETE CASCADE
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE embeddings DROP CONSTRAINT IF EXISTS embeddings_chunk_id_fk`.execute(db)
  await sql`DROP TABLE IF EXISTS transcript_chunks`.execute(db)
}
