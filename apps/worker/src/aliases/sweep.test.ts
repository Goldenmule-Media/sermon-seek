import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { runAliasSweep } from "./sweep.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

describeIfDb("runAliasSweep", () => {
  let db: Kysely<Database>
  let churchId: string

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database (e.g. sermon_search_test)",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
    const churchRow = await db
      .insertInto("churches")
      .values({ slug: "sweep-test-church", name: "Sweep Test Church" })
      .onConflict((oc) => oc.column("slug").doUpdateSet({ name: "Sweep Test Church" }))
      .returning(["id"])
      .executeTakeFirstOrThrow()
    churchId = churchRow.id
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`DELETE FROM church_slug_aliases WHERE church_id = ${churchId}`.execute(db)
  })

  it("deletes only rows with expires_at IS NOT NULL AND expires_at < now()", async () => {
    await db
      .insertInto("church_slug_aliases")
      .values([
        {
          church_id: churchId,
          slug: "expired-alias",
          expires_at: sql<Date>`now() - interval '1 day'`,
        },
        {
          church_id: churchId,
          slug: "future-alias",
          expires_at: sql<Date>`now() + interval '30 days'`,
        },
        {
          church_id: churchId,
          slug: "permanent-alias",
          expires_at: null,
        },
      ])
      .execute()

    const summary = await runAliasSweep({ db })
    expect(summary).toEqual({ swept: 1 })

    const remaining = await db
      .selectFrom("church_slug_aliases")
      .select(["slug"])
      .where("church_id", "=", churchId)
      .orderBy("slug")
      .execute()
    expect(remaining.map((r) => r.slug)).toEqual(["future-alias", "permanent-alias"])
  })

  it("returns swept: 0 when no rows are expired and leaves the table unchanged", async () => {
    await db
      .insertInto("church_slug_aliases")
      .values([
        {
          church_id: churchId,
          slug: "future-only",
          expires_at: sql<Date>`now() + interval '7 days'`,
        },
        {
          church_id: churchId,
          slug: "permanent-only",
          expires_at: null,
        },
      ])
      .execute()

    const summary = await runAliasSweep({ db })
    expect(summary).toEqual({ swept: 0 })

    const remaining = await db
      .selectFrom("church_slug_aliases")
      .select(["slug"])
      .where("church_id", "=", churchId)
      .orderBy("slug")
      .execute()
    expect(remaining.map((r) => r.slug)).toEqual(["future-only", "permanent-only"])
  })
})
