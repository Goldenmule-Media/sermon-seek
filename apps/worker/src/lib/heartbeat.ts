import os from "node:os"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"

export type HeartbeatStatus = "idle" | "busy" | "error"

const _workerId = process.env.WORKER_ID || `${os.hostname()}:${process.pid}`

export function getWorkerId(): string {
  return _workerId
}

export interface HeartbeatParams {
  workerId: string
  kind: string
  status: HeartbeatStatus
  lastJobId?: string | null
  message?: string | null
}

export async function heartbeat(db: Kysely<Database>, params: HeartbeatParams): Promise<void> {
  const { workerId, kind, status, lastJobId = null, message = null } = params
  const truncated = message !== null ? message.slice(0, 500) : null
  try {
    await db
      .insertInto("worker_heartbeats")
      .values({
        worker_id: workerId,
        kind,
        last_beat_at: sql`now()`,
        last_job_id: lastJobId,
        status,
        message: truncated,
      })
      .onConflict((oc) =>
        oc.column("worker_id").doUpdateSet({
          kind,
          last_beat_at: sql`now()`,
          last_job_id: lastJobId,
          status,
          message: truncated,
        }),
      )
      .execute()
  } catch (err) {
    console.error("[heartbeat] upsert failed:", err instanceof Error ? err.message : String(err))
  }
}
