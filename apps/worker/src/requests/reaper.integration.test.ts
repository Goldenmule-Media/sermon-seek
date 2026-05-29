/**
 * Integration tests for stale-request reaping.
 *
 * Requires TEST_DATABASE_URL to be set and pointing at a throwaway DB.
 * Run with: TEST_DATABASE_URL=postgres://... pnpm test
 */
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { reapStaleRequests } from "./reaper.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const FAKE_USER_ID = "00000000-0000-0000-0000-000000000002"

describeIfDb("reapStaleRequests (integration)", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
    await sql`
      INSERT INTO users (id, google_sub, display_name, is_admin)
      VALUES (${FAKE_USER_ID}, 'reaper-test-sub', 'Reaper Test', false)
      ON CONFLICT DO NOTHING
    `.execute(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE ingestion_requests CASCADE`.execute(db)
    await sql`TRUNCATE worker_heartbeats`.execute(db)
  })

  async function insertRunningRequest(retryCount = 0): Promise<string> {
    const row = await db
      .insertInto("ingestion_requests")
      .values({
        user_id: FAKE_USER_ID,
        requested_slug: "reaper-church",
        requested_name: "Reaper Church",
        youtube_handle_or_url: "@ReaperChurch",
        contact_email: "reaper@example.com",
        status: "running",
        retry_count: retryCount,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertHeartbeat(jobId: string, ageMs: number): Promise<void> {
    const beatAt = new Date(Date.now() - ageMs)
    await sql`
      INSERT INTO worker_heartbeats (worker_id, kind, last_beat_at, last_job_id, status, message)
      VALUES ('test-worker', 'ingest', ${beatAt.toISOString()}, ${jobId}, 'busy', 'test')
      ON CONFLICT (worker_id) DO UPDATE SET last_beat_at = EXCLUDED.last_beat_at, last_job_id = EXCLUDED.last_job_id
    `.execute(db)
  }

  it("resets a running request with no heartbeat to received", async () => {
    const id = await insertRunningRequest()
    const result = await reapStaleRequests({ db, staleMs: 60_000, maxRetries: 3 })
    expect(result.reset).toBe(1)
    expect(result.failed).toBe(0)

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status", "retry_count"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("received")
    expect(row.retry_count).toBe(1)
  })

  it("fails a running request that has reached maxRetries", async () => {
    const id = await insertRunningRequest(3)
    const result = await reapStaleRequests({ db, staleMs: 60_000, maxRetries: 3 })
    expect(result.reset).toBe(0)
    expect(result.failed).toBe(1)

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("failed")
  })

  it("leaves a running request with a fresh heartbeat alone", async () => {
    const id = await insertRunningRequest()
    // Heartbeat very recently — well within staleMs.
    await insertHeartbeat(id, 1_000)

    const result = await reapStaleRequests({ db, staleMs: 60_000, maxRetries: 3 })
    expect(result.reset).toBe(0)
    expect(result.failed).toBe(0)

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("running")
  })

  it("reaps a running request with only a stale heartbeat", async () => {
    const id = await insertRunningRequest()
    // Heartbeat well beyond staleMs.
    await insertHeartbeat(id, 600_000)

    const result = await reapStaleRequests({ db, staleMs: 60_000, maxRetries: 3 })
    expect(result.reset).toBe(1)

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("received")
  })

  it("does nothing when there are no running requests", async () => {
    const result = await reapStaleRequests({ db, staleMs: 60_000, maxRetries: 3 })
    expect(result.reset).toBe(0)
    expect(result.failed).toBe(0)
  })
})
