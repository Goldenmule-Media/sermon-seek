import type { Database } from "@sermon-search/db"
import { coord } from "@sermon-search/scripture"
import type { Kysely } from "kysely"
import { describe, expect, it, vi } from "vitest"
import { BadRefError, parseRefQuery, searchVideosByRef } from "./by-ref.js"

// Romans 8 has 39 verses (max_verse[7] = 39)
const ROMANS_8_VERSE_COUNT = 39

describe("parseRefQuery", () => {
  it("single ref returns expected interval coords", () => {
    const result = parseRefQuery("Romans 8:3")
    expect(result.start_coord).toBe(coord(45, 8, 3))
    expect(result.end_coord).toBe(coord(45, 8, 3))
  })

  it("chapter-only ref spans the whole chapter", () => {
    const result = parseRefQuery("Romans 8")
    expect(result.start_coord).toBe(coord(45, 8, 1))
    expect(result.end_coord).toBe(coord(45, 8, ROMANS_8_VERSE_COUNT))
  })

  it("no ref throws BadRefError with correct message", () => {
    expect(() => parseRefQuery("this is not a scripture")).toThrow(BadRefError)
    expect(() => parseRefQuery("this is not a scripture")).toThrow(
      "no scripture reference found in query",
    )
  })

  it("multiple refs throws BadRefError naming the count", () => {
    expect(() => parseRefQuery("Romans 8 and John 3:16")).toThrow(BadRefError)
    expect(() => parseRefQuery("Romans 8 and John 3:16")).toThrow(
      "expected a single scripture reference, found 2",
    )
  })

  it("is case-insensitive", () => {
    const lower = parseRefQuery("romans 8:3")
    const upper = parseRefQuery("Romans 8:3")
    expect(lower.start_coord).toBe(upper.start_coord)
    expect(lower.end_coord).toBe(upper.end_coord)
  })
})

describe("searchVideosByRef", () => {
  function makeChain(terminal: {
    execute?: () => Promise<unknown[]>
    executeTakeFirst?: () => Promise<unknown>
  }) {
    const c: Record<string, unknown> = {
      execute: terminal.execute ?? (() => Promise.resolve([])),
      executeTakeFirst: terminal.executeTakeFirst ?? (() => Promise.resolve({ total: "0" })),
    }
    for (const m of ["innerJoin", "select", "where", "groupBy", "orderBy", "limit", "offset"]) {
      c[m] = vi.fn(() => c)
    }
    return c
  }

  function makeMockDb(rows: object[], countStr = "0") {
    return {
      selectFrom: vi.fn(() =>
        makeChain({
          execute: () => Promise.resolve(rows),
          executeTakeFirst: () => Promise.resolve({ total: countStr }),
        }),
      ),
    } as unknown as Kysely<Database>
  }

  it("returns formatted results and total", async () => {
    const rows = [
      {
        id: "vid1",
        youtube_video_id: "abc123",
        title: "Test Sermon",
        thumbnail_url: "https://example.com/thumb.jpg",
        ref_score: 5,
      },
    ]
    const db = makeMockDb(rows, "1")
    const result = await searchVideosByRef(db, {
      startCoord: coord(45, 8, 3),
      endCoord: coord(45, 8, 3),
      limit: 20,
      offset: 0,
    })
    expect(result.total).toBe(1)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      youtube_video_id: "abc123",
      title: "Test Sermon",
      ref_score: 5,
    })
  })

  it("returns total as number even when db returns a string", async () => {
    const db = makeMockDb([], "42")
    const result = await searchVideosByRef(db, {
      startCoord: coord(45, 8, 1),
      endCoord: coord(45, 8, ROMANS_8_VERSE_COUNT),
      limit: 10,
      offset: 0,
    })
    expect(result.total).toBe(42)
    expect(typeof result.total).toBe("number")
  })

  it("returns empty results when no matches", async () => {
    const db = makeMockDb([], "0")
    const result = await searchVideosByRef(db, {
      startCoord: 1,
      endCoord: 1,
      limit: 20,
      offset: 0,
    })
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  it("calls db.selectFrom twice — once for results, once for count", async () => {
    const db = makeMockDb([], "0")
    await searchVideosByRef(db, {
      startCoord: coord(45, 8, 3),
      endCoord: coord(45, 8, 3),
      limit: 20,
      offset: 0,
    })
    expect((db.selectFrom as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it("passes where clauses for interval overlap", async () => {
    const whereArgs: unknown[][] = []
    const chain: Record<string, unknown> = {
      execute: vi.fn().mockResolvedValue([]),
      executeTakeFirst: vi.fn().mockResolvedValue({ total: "0" }),
    }
    for (const m of ["innerJoin", "select", "groupBy", "orderBy", "limit", "offset"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.where = vi.fn((...args: unknown[]) => {
      whereArgs.push(args)
      return chain
    })
    const db = { selectFrom: vi.fn(() => chain) } as unknown as Kysely<Database>

    await searchVideosByRef(db, {
      startCoord: coord(45, 8, 3),
      endCoord: coord(45, 8, 3),
      limit: 20,
      offset: 0,
    })

    // At minimum two where calls per query (overlap start + overlap end)
    expect((chain.where as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
