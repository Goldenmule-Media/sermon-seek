import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE related_videos (
      video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      related_video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      signal text NOT NULL CHECK (signal IN ('chunk_similarity','topic_overlap','scripture_overlap','same_series')),
      score real NOT NULL,
      payload jsonb NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (video_id, related_video_id, signal),
      CHECK (video_id <> related_video_id)
    )
  `.execute(db)

  await sql`
    CREATE INDEX related_videos_video_id_signal_score_idx
    ON related_videos (video_id, signal, score DESC)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS related_videos`.execute(db)
}
