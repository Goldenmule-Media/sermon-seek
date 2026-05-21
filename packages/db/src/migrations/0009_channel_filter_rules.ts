import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE channel_filter_rule_type AS ENUM ('include', 'exclude')`.execute(db)
  await sql`CREATE TYPE channel_filter_target_kind AS ENUM ('playlist')`.execute(db)

  await sql`
    CREATE TABLE channel_filter_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      rule_type channel_filter_rule_type NOT NULL,
      target_kind channel_filter_target_kind NOT NULL,
      target_id text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (channel_id, rule_type, target_kind, target_id)
    )
  `.execute(db)

  await sql`CREATE INDEX channel_filter_rules_channel_id_idx ON channel_filter_rules (channel_id)`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS channel_filter_rules`.execute(db)
  await sql`DROP TYPE IF EXISTS channel_filter_target_kind`.execute(db)
  await sql`DROP TYPE IF EXISTS channel_filter_rule_type`.execute(db)
}
