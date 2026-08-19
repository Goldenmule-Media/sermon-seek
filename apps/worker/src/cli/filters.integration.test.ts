import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { YoutubeClient } from "../youtube/client.js"
import type { PlaylistsListResponse } from "../youtube/types.js"
import { runFiltersCli } from "./filters.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const YOUTUBE_CHANNEL_ID = "UCTestFiltersTestTestTT"

function makeYoutubeClient(
  playlistChannelId: string | null = YOUTUBE_CHANNEL_ID,
): Partial<YoutubeClient> {
  return {
    listPlaylistsById: vi.fn(async (id: string): Promise<PlaylistsListResponse> => {
      if (playlistChannelId === null) return { items: [] }
      return { items: [{ id, snippet: { channelId: playlistChannelId } }] }
    }),
    listChannelsById: vi.fn(async () => ({ items: [] })),
    listChannelsByHandle: vi.fn(async () => ({ items: [] })),
    listChannelsByUsername: vi.fn(async () => ({ items: [] })),
  }
}

describeIfDb("filters CLI (integration)", () => {
  let db: Kysely<Database>
  let channelId: string

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
    // Truncating churches cascades to channels and their filter rules.
    await sql`TRUNCATE churches RESTART IDENTITY CASCADE`.execute(db)

    // channels.church_id is NOT NULL, so the channel needs an owning church.
    const church = await db
      .insertInto("churches")
      .values({
        slug: "filters-int-church",
        name: "Filters Int Church",
        youtube_channel_id: YOUTUBE_CHANNEL_ID,
        status: "active",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()

    const row = await db
      .insertInto("channels")
      .values({
        church_id: church.id,
        youtube_channel_id: YOUTUBE_CHANNEL_ID,
        title: "Test Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    channelId = row.id
  })

  it("filters list on a channel with no rules → exit 0, empty rules array", async () => {
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runFiltersCli(["list", "--channel", channelId], { db })

    expect(code).toBe(0)
    const output = JSON.parse(lines.join(""))
    expect(output).toEqual({ rules: [] })

    vi.restoreAllMocks()
  })

  it("filters add --include happy path inserts a row and returns DTO", async () => {
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runFiltersCli(
      ["add", "--channel", channelId, "--include", "--playlist", "PLabc123"],
      { db, client: makeYoutubeClient() as YoutubeClient },
    )

    expect(code).toBe(0)
    const dto = JSON.parse(lines.join(""))
    expect(dto.channel_id).toBe(channelId)
    expect(dto.rule_type).toBe("include")
    expect(dto.target_kind).toBe("playlist")
    expect(dto.target_id).toBe("PLabc123")
    expect(dto.id).toBeTruthy()

    const rows = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelId)
      .execute()
    expect(rows).toHaveLength(1)

    vi.restoreAllMocks()
  })

  it("filters add --exclude happy path inserts a row", async () => {
    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runFiltersCli(
      ["add", "--channel", channelId, "--exclude", "--playlist", "PLxyz456"],
      { db, client: makeYoutubeClient() as YoutubeClient },
    )

    expect(code).toBe(0)
    const dto = JSON.parse(lines.join(""))
    expect(dto.rule_type).toBe("exclude")
    expect(dto.target_id).toBe("PLxyz456")

    vi.restoreAllMocks()
  })

  it("filters add with bogus playlist → non-zero exit, no row inserted", async () => {
    const errLines: string[] = []
    vi.spyOn(console, "error").mockImplementation((msg) => errLines.push(msg))

    const code = await runFiltersCli(
      ["add", "--channel", channelId, "--include", "--playlist", "PLbogus"],
      { db, client: makeYoutubeClient(null) as YoutubeClient },
    )

    expect(code).not.toBe(0)
    expect(errLines.some((l) => /not found/i.test(l))).toBe(true)

    const rows = await db.selectFrom("channel_filter_rules").selectAll().execute()
    expect(rows).toHaveLength(0)

    vi.restoreAllMocks()
  })

  it("filters add duplicate → non-zero exit with clear message, only one row in table", async () => {
    const client = makeYoutubeClient() as YoutubeClient

    const firstCode = await runFiltersCli(
      ["add", "--channel", channelId, "--include", "--playlist", "PLabc123"],
      { db, client },
    )
    expect(firstCode).toBe(0)

    const errLines: string[] = []
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation((msg) => errLines.push(msg))

    const secondCode = await runFiltersCli(
      ["add", "--channel", channelId, "--include", "--playlist", "PLabc123"],
      { db, client },
    )

    expect(secondCode).not.toBe(0)
    expect(errLines.some((l) => /rule already exists/i.test(l))).toBe(true)

    const rows = await db.selectFrom("channel_filter_rules").selectAll().execute()
    expect(rows).toHaveLength(1)

    vi.restoreAllMocks()
  })

  it("filters remove --rule-id deletes the row and exits 0", async () => {
    const client = makeYoutubeClient() as YoutubeClient
    await runFiltersCli(["add", "--channel", channelId, "--include", "--playlist", "PLabc123"], {
      db,
      client,
    })

    const row = await db.selectFrom("channel_filter_rules").select(["id"]).executeTakeFirstOrThrow()

    const lines: string[] = []
    vi.spyOn(console, "log").mockImplementation((msg) => lines.push(msg))

    const code = await runFiltersCli(["remove", "--rule-id", row.id], { db })

    expect(code).toBe(0)
    const result = JSON.parse(lines.join(""))
    expect(result).toEqual({ ok: true, deleted: row.id, channel_id: channelId })

    const remaining = await db.selectFrom("channel_filter_rules").selectAll().execute()
    expect(remaining).toHaveLength(0)

    vi.restoreAllMocks()
  })

  it("filters remove --rule-id with unknown id → non-zero exit with clear message", async () => {
    const errLines: string[] = []
    vi.spyOn(console, "error").mockImplementation((msg) => errLines.push(msg))

    const unknownId = "00000000-0000-0000-0000-000000000000"
    const code = await runFiltersCli(["remove", "--rule-id", unknownId], { db })

    expect(code).not.toBe(0)
    expect(errLines.some((l) => /rule not found/i.test(l))).toBe(true)

    vi.restoreAllMocks()
  })
})
