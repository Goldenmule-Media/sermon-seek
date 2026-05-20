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
  function makeChain(rows: unknown[] = []) {
    const c: Record<string, unknown> = {
      execute: () => Promise.resolve(rows),
      executeTakeFirst: () => Promise.resolve(rows[0]),
    }
    for (const m of [
      "innerJoin",
      "select",
      "where",
      "groupBy",
      "orderBy",
      "limit",
      "offset",
      "as",
    ]) {
      c[m] = vi.fn(() => c)
    }
    return c
  }

  it("returns empty results and empty videoScores when no candidate videos", async () => {
    const db = { selectFrom: vi.fn(() => makeChain([])) } as unknown as Kysely<Database>
    const result = await searchVideosByRef(db, {
      startCoord: 1,
      endCoord: 1,
      rawQuery: "no match",
      candidateLimit: 20,
    })
    expect(result.results).toEqual([])
    expect(result.videoScores.size).toBe(0)
  })

  it("emits per-chunk FtsResults and seeds videoScores from ref_score", async () => {
    const videoRows = [
      {
        id: "vid-uuid-1",
        youtube_video_id: "abc123",
        title: "Test Sermon",
        thumbnail_url: "https://example.com/thumb.jpg",
        ref_score: 5,
      },
    ]
    const chunkRows = [
      {
        video_id: "vid-uuid-1",
        start_ms: 1000,
        end_ms: 30000,
        chunk_score: 0.42,
        snippet: "<mark>Romans 8</mark>",
      },
      {
        video_id: "vid-uuid-1",
        start_ms: 60000,
        end_ms: 90000,
        chunk_score: 0.31,
        snippet: "another <mark>Romans 8</mark>",
      },
    ]
    const responses: unknown[][] = [videoRows, chunkRows]
    let call = 0
    const db = {
      selectFrom: vi.fn(() => makeChain(responses[call++] ?? [])),
    } as unknown as Kysely<Database>

    const result = await searchVideosByRef(db, {
      startCoord: coord(45, 8, 3),
      endCoord: coord(45, 8, 3),
      rawQuery: "Romans 8:3",
      candidateLimit: 20,
    })

    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({
      youtube_video_id: "abc123",
      title: "Test Sermon",
      start_ms: 1000,
      end_ms: 30000,
      score: 0.42,
    })
    expect(result.videoScores.get("abc123")).toBe(5)
  })

  it("issues two selectFrom calls (videos, then chunks)", async () => {
    const videoRows = [
      {
        id: "vid-uuid-1",
        youtube_video_id: "abc123",
        title: "Test",
        thumbnail_url: null,
        ref_score: 1,
      },
    ]
    const responses: unknown[][] = [videoRows, []]
    let call = 0
    const selectFrom = vi.fn(() => makeChain(responses[call++] ?? []))
    const db = { selectFrom } as unknown as Kysely<Database>

    await searchVideosByRef(db, {
      startCoord: coord(45, 8, 3),
      endCoord: coord(45, 8, 3),
      rawQuery: "Romans 8:3",
      candidateLimit: 20,
    })

    expect(selectFrom.mock.calls).toHaveLength(2)
  })
})
