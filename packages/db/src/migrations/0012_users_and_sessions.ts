import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      google_sub text NOT NULL UNIQUE,
      display_name text,
      avatar_url text,
      is_admin boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','suspended','deleted')),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await sql`
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token_hash text NOT NULL UNIQUE,
      user_agent text,
      ip inet,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    )
  `.execute(db)

  await sql`CREATE INDEX sessions_user_idx ON sessions (user_id)`.execute(db)
  await sql`CREATE INDEX sessions_expires_idx ON sessions (expires_at) WHERE revoked_at IS NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS sessions_expires_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS sessions_user_idx`.execute(db)
  await sql`DROP TABLE IF EXISTS sessions`.execute(db)
  await sql`DROP TABLE IF EXISTS users`.execute(db)
}
