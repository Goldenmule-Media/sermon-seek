import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely"
import { describe, expect, it } from "vitest"
import type { Database } from "./index.js"
import { ScopedDb, TENANT_TABLES, assertChurchId } from "./scoped.js"

const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})

const CHURCH_ID = "ch-uuid-test"

describe("assertChurchId", () => {
  it("throws on undefined", () => {
    expect(() => assertChurchId(undefined)).toThrow("ScopedDb requires a non-empty churchId")
  })

  it("throws on null", () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional test of runtime guard
    expect(() => assertChurchId(null as any)).toThrow()
  })

  it("throws on empty string", () => {
    expect(() => assertChurchId("")).toThrow()
  })

  it("throws on whitespace-only string", () => {
    expect(() => assertChurchId("   ")).toThrow()
  })

  it("throws on non-string", () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional test of runtime guard
    expect(() => assertChurchId(42 as any)).toThrow()
  })

  it("accepts a valid id string", () => {
    expect(() => assertChurchId("abc-123")).not.toThrow()
  })
})

describe("ScopedDb constructor", () => {
  it("exposes churchId via getter", () => {
    const s = new ScopedDb(db, CHURCH_ID)
    expect(s.churchId).toBe(CHURCH_ID)
  })

  it("throws on empty churchId", () => {
    expect(() => new ScopedDb(db, "")).toThrow()
  })

  it("throws on undefined churchId", () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional test of runtime guard
    expect(() => new ScopedDb(db, undefined as any)).toThrow()
  })
})

describe("ScopedDb.selectFrom — tenant tables", () => {
  const s = new ScopedDb(db, CHURCH_ID)

  it("auto-applies church_id filter for videos", () => {
    const { sql, parameters } = s.selectFrom("videos").selectAll().compile()
    expect(sql).toContain('"videos"."church_id" = $1')
    expect(parameters).toContain(CHURCH_ID)
  })

  it("uses alias in where clause for aliased table", () => {
    const { sql, parameters } = s.selectFrom("videos as v").selectAll().compile()
    expect(sql).toContain('"v"."church_id" = $1')
    expect(parameters).toContain(CHURCH_ID)
  })

  it.each([
    "channels",
    "playlists",
    "transcript_chunks",
    "embeddings",
    "topics",
    "videos_with_transcripts",
  ] as const)("auto-applies filter for %s", (table) => {
    // biome-ignore lint/suspicious/noExplicitAny: table-driven test
    const { sql, parameters } = (s.selectFrom(table as any) as any).selectAll().compile()
    expect(sql).toContain("church_id")
    expect(parameters).toContain(CHURCH_ID)
  })
})

describe("ScopedDb.selectFrom — non-tenant tables", () => {
  const s = new ScopedDb(db, CHURCH_ID)

  it("does NOT auto-filter transcripts", () => {
    const { sql } = s.selectFrom("transcripts").selectAll().compile()
    expect(sql).not.toContain("church_id")
  })
})

describe("ScopedDb.deleteFrom", () => {
  const s = new ScopedDb(db, CHURCH_ID)

  it("includes both the church_id filter and additional conditions", () => {
    const { sql, parameters } = s.deleteFrom("videos").where("id", "=", "x").compile()
    expect(sql).toContain("church_id")
    expect(parameters).toContain(CHURCH_ID)
    expect(parameters).toContain("x")
  })
})

describe("ScopedDb.updateTable", () => {
  const s = new ScopedDb(db, CHURCH_ID)

  it("includes the church_id where clause", () => {
    const { sql, parameters } = s.updateTable("videos").set({ title: "t" }).compile()
    expect(sql).toContain("church_id")
    expect(parameters).toContain(CHURCH_ID)
  })
})

describe("ScopedDb.insertInto", () => {
  const s = new ScopedDb(db, CHURCH_ID)

  it("injects church_id for tenant table insert without church_id", () => {
    const { parameters } = s
      .insertInto("videos")
      // biome-ignore lint/suspicious/noExplicitAny: omitting generated fields for compile-only test
      .values({ youtube_video_id: "yt-1", title: "Test", channel_id: "chan-1" } as any)
      .compile()
    expect(parameters).toContain(CHURCH_ID)
  })

  it("accepts insert when church_id matches the scope", () => {
    const { parameters } = s
      .insertInto("videos")
      .values({
        church_id: CHURCH_ID,
        youtube_video_id: "yt-2",
        title: "T2",
        channel_id: "chan-1",
        // biome-ignore lint/suspicious/noExplicitAny: omitting generated fields for compile-only test
      } as any)
      .compile()
    expect(parameters).toContain(CHURCH_ID)
  })

  it("throws when a conflicting church_id is passed", () => {
    expect(() =>
      s.insertInto("videos").values({
        church_id: "different-church",
        youtube_video_id: "yt-3",
        title: "T3",
        channel_id: "chan-1",
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
      } as any),
    ).toThrow("conflicting church_id")
  })

  it("injects church_id for each row in array inserts", () => {
    const { parameters } = s
      .insertInto("videos")
      .values([
        // biome-ignore lint/suspicious/noExplicitAny: omitting generated fields for compile-only test
        { youtube_video_id: "yt-4", title: "T4", channel_id: "chan-1" } as any,
        // biome-ignore lint/suspicious/noExplicitAny: omitting generated fields for compile-only test
        { youtube_video_id: "yt-5", title: "T5", channel_id: "chan-1" } as any,
      ])
      .compile()
    // Both rows get CHURCH_ID — appears twice in parameters
    expect(parameters.filter((p) => p === CHURCH_ID)).toHaveLength(2)
  })

  it("does not modify non-tenant table inserts", () => {
    const { parameters } = s
      .insertInto("transcripts")
      .values({ video_id: "vid-1", source: "youtube_public", full_text: "text" })
      .compile()
    expect(parameters).not.toContain(CHURCH_ID)
  })
})

describe("TENANT_TABLES set", () => {
  it("contains exactly the seven tenant-bearing tables", () => {
    expect(TENANT_TABLES).toEqual(
      new Set([
        "channels",
        "playlists",
        "videos",
        "transcript_chunks",
        "embeddings",
        "topics",
        "videos_with_transcripts",
      ]),
    )
  })
})
