import os from "node:os"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getWorkerId, heartbeat } from "./heartbeat.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

describeIfDb("heartbeat (integration)", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE worker_heartbeats`.execute(db)
  })

  it("inserts a new row on first call", async () => {
    await heartbeat(db, {
      workerId: "test-worker:1",
      kind: "ingest",
      status: "busy",
      lastJobId: "req-1",
      message: "start",
    })

    const row = await db
      .selectFrom("worker_heartbeats")
      .selectAll()
      .where("worker_id", "=", "test-worker:1")
      .executeTakeFirst()

    expect(row).toBeDefined()
    expect(row?.kind).toBe("ingest")
    expect(row?.status).toBe("busy")
    expect(row?.last_job_id).toBe("req-1")
    expect(row?.message).toBe("start")
    expect(row?.last_beat_at).toBeInstanceOf(Date)
  })

  it("upserts on second call — updates all mutable columns", async () => {
    await heartbeat(db, {
      workerId: "test-worker:2",
      kind: "ingest",
      status: "busy",
      lastJobId: "req-1",
      message: "start",
    })
    await heartbeat(db, {
      workerId: "test-worker:2",
      kind: "view-stats",
      status: "idle",
      lastJobId: "req-2",
      message: "done",
    })

    const rows = await db
      .selectFrom("worker_heartbeats")
      .selectAll()
      .where("worker_id", "=", "test-worker:2")
      .execute()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe("view-stats")
    expect(rows[0]?.status).toBe("idle")
    expect(rows[0]?.last_job_id).toBe("req-2")
    expect(rows[0]?.message).toBe("done")
  })

  it("truncates message to 500 chars", async () => {
    const long = "x".repeat(600)
    await heartbeat(db, {
      workerId: "test-worker:3",
      kind: "ingest",
      status: "busy",
      message: long,
    })

    const row = await db
      .selectFrom("worker_heartbeats")
      .select("message")
      .where("worker_id", "=", "test-worker:3")
      .executeTakeFirstOrThrow()

    expect(row.message?.length).toBe(500)
  })

  it("handles null lastJobId and message", async () => {
    await heartbeat(db, { workerId: "test-worker:4", kind: "ingest", status: "idle" })

    const row = await db
      .selectFrom("worker_heartbeats")
      .selectAll()
      .where("worker_id", "=", "test-worker:4")
      .executeTakeFirstOrThrow()

    expect(row.last_job_id).toBeNull()
    expect(row.message).toBeNull()
  })
})

describe("getWorkerId", () => {
  it("returns WORKER_ID env var when set", () => {
    vi.stubEnv("WORKER_ID", "custom-worker-id")
    expect(getWorkerId()).toBe("custom-worker-id")
    vi.unstubAllEnvs()
  })

  it("defaults to hostname:pid format", () => {
    vi.stubEnv("WORKER_ID", "")
    expect(getWorkerId()).toBe(`${os.hostname()}:${process.pid}`)
    vi.unstubAllEnvs()
  })

  it("returns a non-empty string", () => {
    expect(getWorkerId()).toBeTruthy()
    expect(typeof getWorkerId()).toBe("string")
  })
})
