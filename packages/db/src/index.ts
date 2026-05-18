import { Kysely, PostgresDialect } from "kysely"
import pg from "pg"

export type Database = Record<string, never>

export function resolveDatabaseUrl(connectionString?: string): string {
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env or pass a connection string explicitly.",
    )
  }
  return url
}

export function createDb(connectionString?: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(connectionString) })
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}
