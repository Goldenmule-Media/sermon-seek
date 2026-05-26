import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { runUsersCli } from "./users.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const TEST_GOOGLE_SUB = "google-sub-test-001"

describeIfDb("users CLI (integration)", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`.execute(db)
    await db.insertInto("users").values({ google_sub: TEST_GOOGLE_SUB }).execute()
  })

  it("promote flips is_admin to true and exits 0", async () => {
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runUsersCli(["promote", TEST_GOOGLE_SUB], { db })

    expect(code).toBe(0)
    const result = JSON.parse(lines[0] as string)
    expect(result.ok).toBe(true)
    expect(result.google_sub).toBe(TEST_GOOGLE_SUB)
    expect(result.is_admin).toBe(true)

    vi.restoreAllMocks()
  })

  it("demote flips is_admin to false and exits 0", async () => {
    await db
      .updateTable("users")
      .set({ is_admin: true })
      .where("google_sub", "=", TEST_GOOGLE_SUB)
      .execute()

    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runUsersCli(["demote", TEST_GOOGLE_SUB], { db })

    expect(code).toBe(0)
    const result = JSON.parse(lines[0] as string)
    expect(result.ok).toBe(true)
    expect(result.google_sub).toBe(TEST_GOOGLE_SUB)
    expect(result.is_admin).toBe(false)

    vi.restoreAllMocks()
  })

  it("promote on unknown google_sub exits 1 with user not found on stderr", async () => {
    const errLines: string[] = []
    vi.spyOn(console, "error").mockImplementation((msg) => errLines.push(msg))

    const code = await runUsersCli(["promote", "no-such-sub"], { db })

    expect(code).toBe(1)
    expect(errLines[0]).toMatch(/user not found: no-such-sub/)

    vi.restoreAllMocks()
  })

  it("promote on already-admin user is idempotent and exits 0", async () => {
    await db
      .updateTable("users")
      .set({ is_admin: true })
      .where("google_sub", "=", TEST_GOOGLE_SUB)
      .execute()

    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runUsersCli(["promote", TEST_GOOGLE_SUB], { db })

    expect(code).toBe(0)
    const result = JSON.parse(lines[0] as string)
    expect(result.is_admin).toBe(true)

    vi.restoreAllMocks()
  })
})
