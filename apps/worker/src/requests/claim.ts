import type { Database } from "@sermon-search/db"
import type { IngestionRequest } from "@sermon-search/types"
import { type Kysely, sql } from "kysely"

export type ClaimPriorStatus = "received" | "approved"

export interface ClaimResult {
  request: IngestionRequest
  priorStatus: ClaimPriorStatus
}

function normalizeRow(row: {
  id: string
  user_id: string
  church_id: string | null
  requested_slug: string
  requested_name: string
  youtube_handle_or_url: string
  include_playlist_ids: string[]
  exclude_playlist_ids: string[]
  contact_email: string
  status: string
  videos_discovered: number
  videos_ingested: number
  tokens_ingested: string | number | bigint
  limit_reached: boolean
  admin_note: string | null
  retry_count: number
  created_at: Date | string
  updated_at: Date | string
}): IngestionRequest {
  return {
    id: row.id,
    user_id: row.user_id,
    church_id: row.church_id ?? null,
    requested_slug: row.requested_slug,
    requested_name: row.requested_name,
    youtube_handle_or_url: row.youtube_handle_or_url,
    include_playlist_ids: row.include_playlist_ids as string[],
    exclude_playlist_ids: row.exclude_playlist_ids as string[],
    contact_email: row.contact_email,
    status: row.status as IngestionRequest["status"],
    videos_discovered: row.videos_discovered,
    videos_ingested: row.videos_ingested,
    tokens_ingested: Number(row.tokens_ingested),
    limit_reached: row.limit_reached,
    admin_note: row.admin_note ?? null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

/**
 * Atomically claim a specific request by id. Returns null if the request
 * doesn't exist, is already running, or was raced by another dispatcher.
 *
 * Used by `--request <id>` (manual one-shot).
 */
export async function claimRequestById(
  db: Kysely<Database>,
  id: string,
): Promise<ClaimResult | null> {
  // Read the current status first so we can use it as a compare value.
  const current = await db
    .selectFrom("ingestion_requests")
    .select(["id", "status"])
    .where("id", "=", id)
    .executeTakeFirst()

  if (!current) return null
  if (current.status !== "received" && current.status !== "approved") return null

  const priorStatus = current.status as ClaimPriorStatus

  const claimed = await db
    .updateTable("ingestion_requests")
    .set({ status: "running", updated_at: sql`now()` })
    .where("id", "=", id)
    .where("status", "=", priorStatus)
    .returning(["id"])
    .execute()

  if (claimed.length === 0) return null

  // Reload the full row now that we own it.
  const row = await db
    .selectFrom("ingestion_requests")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow()

  return {
    request: normalizeRow(row as unknown as Parameters<typeof normalizeRow>[0]),
    priorStatus,
  }
}

/**
 * Pop the next queued request using SELECT FOR UPDATE SKIP LOCKED.
 * Returns null when the queue is empty.
 *
 * Used by the daemon poll loop. Concurrent callers will each claim a
 * distinct row — they can never double-process the same request.
 */
export async function claimNextRequest(db: Kysely<Database>): Promise<ClaimResult | null> {
  // Kysely doesn't have native FOR UPDATE SKIP LOCKED support, so use raw SQL
  // for the claim CTE and wrap the result in Kysely's type system via cast.
  type Row = {
    id: string
    user_id: string
    church_id: string | null
    requested_slug: string
    requested_name: string
    youtube_handle_or_url: string
    include_playlist_ids: string[]
    exclude_playlist_ids: string[]
    contact_email: string
    status: string
    videos_discovered: number
    videos_ingested: number
    tokens_ingested: string
    limit_reached: boolean
    admin_note: string | null
    retry_count: number
    created_at: Date
    updated_at: Date
    prior_status: string
  }

  const result = await sql<Row>`
    WITH next AS (
      SELECT id, status AS prior_status
      FROM ingestion_requests
      WHERE status IN ('received', 'approved')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ingestion_requests r
    SET status = 'running', updated_at = now()
    FROM next
    WHERE r.id = next.id
    RETURNING r.*, next.prior_status
  `.execute(db)

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Row
  const priorStatus = row.prior_status as ClaimPriorStatus

  return {
    request: normalizeRow(row as unknown as Parameters<typeof normalizeRow>[0]),
    priorStatus,
  }
}
