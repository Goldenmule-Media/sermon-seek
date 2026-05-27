import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE worker_heartbeats (
      worker_id text PRIMARY KEY,
      kind text NOT NULL,
      last_beat_at timestamptz NOT NULL,
      last_job_id text,
      status text NOT NULL,
      message text
    )
  `.execute(db)

  await sql`CREATE INDEX worker_heartbeats_kind_idx ON worker_heartbeats (kind)`.execute(db)

  await sql`
    CREATE TABLE system_runs (
      kind text PRIMARY KEY,
      last_run_at timestamptz NOT NULL,
      last_status text NOT NULL
    )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS system_runs`.execute(db)
  await sql`DROP INDEX IF EXISTS worker_heartbeats_kind_idx`.execute(db)
  await sql`DROP TABLE IF EXISTS worker_heartbeats`.execute(db)
}
