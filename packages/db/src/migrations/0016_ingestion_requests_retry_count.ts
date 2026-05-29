import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE ingestion_requests ADD COLUMN retry_count integer NOT NULL DEFAULT 0`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE ingestion_requests DROP COLUMN IF EXISTS retry_count`.execute(db)
}
