/**
 * Integration tests for atomic request claiming.
 *
 * Requires TEST_DATABASE_URL to be set and pointing at a throwaway DB.
 * Run with: TEST_DATABASE_URL=postgres://... pnpm test
 */
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { claimNextRequest, claimRequestById } from "./claim.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const FAKE_USER_ID = "00000000-0000-0000-0000-000000000001"

describeIfDb("claim (integration)", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
    // Ensure a user row exists for FK.
    await sql`
      INSERT INTO users (id, google_sub, display_name, is_admin)
      VALUES (${FAKE_USER_ID}, 'claim-test-sub', 'Claim Test', false)
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

  async function insertRequest(status: "received" | "approved" = "received"): Promise<string> {
    const row = await db
      .insertInto("ingestion_requests")
      .values({
        user_id: FAKE_USER_ID,
        requested_slug: "test-church",
        requested_name: "Test Church",
        youtube_handle_or_url: "@TestChurch",
        contact_email: "test@example.com",
        status,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  it("claimRequestById returns the claim and sets status to running", async () => {
    const id = await insertRequest("received")
    const result = await claimRequestById(db, id)
    expect(result).not.toBeNull()
    expect(result?.priorStatus).toBe("received")
    expect(result?.request.id).toBe(id)

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("running")
  })

  it("claimRequestById returns null on a second attempt (already running)", async () => {
    const id = await insertRequest("received")
    const first = await claimRequestById(db, id)
    expect(first).not.toBeNull()

    const second = await claimRequestById(db, id)
    expect(second).toBeNull()
  })

  it("claimRequestById returns null for a non-existent id", async () => {
    const result = await claimRequestById(db, "00000000-0000-0000-0000-000000000099")
    expect(result).toBeNull()
  })

  it("claimRequestById preserves priorStatus=approved", async () => {
    const id = await insertRequest("approved")
    const result = await claimRequestById(db, id)
    expect(result).not.toBeNull()
    expect(result?.priorStatus).toBe("approved")
  })

  it("claimNextRequest returns the oldest queued request", async () => {
    const id = await insertRequest("received")
    const result = await claimNextRequest(db)
    expect(result).not.toBeNull()
    expect(result?.request.id).toBe(id)
    expect(result?.priorStatus).toBe("received")

    const row = await db
      .selectFrom("ingestion_requests")
      .select(["status"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("running")
  })

  it("claimNextRequest returns null when queue is empty", async () => {
    const result = await claimNextRequest(db)
    expect(result).toBeNull()
  })

  it("two concurrent claimNextRequest calls never double-process the same request", async () => {
    const id = await insertRequest("received")

    // Fire both concurrently without awaiting between them.
    const [a, b] = await Promise.all([claimNextRequest(db), claimNextRequest(db)])

    const results = [a, b].filter((r) => r !== null)
    expect(results).toHaveLength(1)
    expect(results[0]?.request.id).toBe(id)
  })

  it("claimNextRequest preserves priorStatus=approved", async () => {
    const id = await insertRequest("approved")
    const result = await claimNextRequest(db)
    expect(result).not.toBeNull()
    expect(result?.priorStatus).toBe("approved")
    expect(result?.request.id).toBe(id)
  })

  it("claimNextRequest skips non-queued requests", async () => {
    const id = await insertRequest("received")
    // Mark it as running manually so it's already in-flight.
    await db
      .updateTable("ingestion_requests")
      .set({ status: "running" })
      .where("id", "=", id)
      .execute()

    const result = await claimNextRequest(db)
    expect(result).toBeNull()
  })
})
