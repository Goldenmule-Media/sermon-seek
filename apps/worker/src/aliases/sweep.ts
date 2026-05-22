import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"

export interface RunAliasSweepOptions {
  db: Kysely<Database>
}

export interface RunAliasSweepSummary {
  swept: number
}

export async function runAliasSweep(opts: RunAliasSweepOptions): Promise<RunAliasSweepSummary> {
  const { db } = opts
  const result = await db
    .deleteFrom("church_slug_aliases")
    .where("expires_at", "is not", null)
    .where("expires_at", "<", sql<Date>`now()`)
    .executeTakeFirst()
  return { swept: Number(result.numDeletedRows ?? 0) }
}
