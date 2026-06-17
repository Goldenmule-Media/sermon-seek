import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE admin_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`CREATE INDEX admin_audit_log_created_idx ON admin_audit_log (created_at DESC)`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS admin_audit_log_created_idx`.execute(db)
  await sql`DROP TABLE IF EXISTS admin_audit_log`.execute(db)
}
