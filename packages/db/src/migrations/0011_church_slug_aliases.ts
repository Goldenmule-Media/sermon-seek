import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE church_slug_aliases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
      slug text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz
    )
  `.execute(db)

  await sql`CREATE INDEX church_slug_aliases_church_idx ON church_slug_aliases (church_id)`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS church_slug_aliases_church_idx`.execute(db)
  await sql`DROP TABLE IF EXISTS church_slug_aliases`.execute(db)
}
