import type { Database } from "@sermon-search/db"
import { type Kysely, sql } from "kysely"

export interface ReapStaleRequestsOptions {
  db: Kysely<Database>
  staleMs: number
  maxRetries: number
  log?: (msg: string) => void
}

export interface ReapResult {
  reset: number
  failed: number
}

/**
 * Find running requests with no fresh owning heartbeat and recover them.
 * A request is stale when no worker_heartbeats row with last_job_id=request.id
 * has beaten within staleMs. Stale requests are reset to 'received' and their
 * retry_count incremented; once retry_count reaches maxRetries they are failed.
 */
export async function reapStaleRequests({
  db,
  staleMs,
  maxRetries,
  log = () => {},
}: ReapStaleRequestsOptions): Promise<ReapResult> {
  const staleInterval = `${staleMs} milliseconds`

  // Find all running requests with no fresh owning heartbeat.
  const staleRows = await sql<{ id: string; retry_count: number }>`
    SELECT r.id, r.retry_count
    FROM ingestion_requests r
    WHERE r.status = 'running'
      AND NOT EXISTS (
        SELECT 1
        FROM worker_heartbeats h
        WHERE h.last_job_id = r.id
          AND h.last_beat_at > now() - interval ${sql.lit(staleInterval)}
      )
  `.execute(db)

  let reset = 0
  let failed = 0

  for (const row of staleRows.rows) {
    if (row.retry_count < maxRetries) {
      const note = `Reaped after stale run (retry ${row.retry_count + 1}/${maxRetries})`
      await db
        .updateTable("ingestion_requests")
        .set({
          status: "received",
          retry_count: row.retry_count + 1,
          admin_note: note,
          updated_at: sql`now()`,
        })
        .where("id", "=", row.id)
        .where("status", "=", "running")
        .execute()
      log(
        `[reaper] reset request ${row.id} to received (retry ${row.retry_count + 1}/${maxRetries})`,
      )
      reset++
    } else {
      const note = `Failed after ${maxRetries} reap attempts`
      await db
        .updateTable("ingestion_requests")
        .set({
          status: "failed",
          admin_note: note,
          updated_at: sql`now()`,
        })
        .where("id", "=", row.id)
        .where("status", "=", "running")
        .execute()
      log(`[reaper] failed request ${row.id} after ${maxRetries} retries`)
      failed++
    }
  }

  return { reset, failed }
}
