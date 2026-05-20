import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const { videoDetailRoutes } = await import("./video-detail.js")

const MOCK_VIDEO_ID = "abc123"

const mockVideoRow = {
  id: "vid-uuid-1",
  youtube_video_id: MOCK_VIDEO_ID,
  title: "Test Sermon",
  thumbnail_url: "https://example.com/thumb.jpg",
  published_at: new Date("2024-01-01"),
  duration_seconds: 3600,
  view_count: "1000",
  channel_id: "ch-uuid-1",
  channel_title: "Test Church",
}

function makeChain(terminal: {
  execute?: () => Promise<unknown[]>
  executeTakeFirst?: () => Promise<unknown>
}) {
  const c: Record<string, unknown> = {
    execute: terminal.execute ?? (() => Promise.resolve([])),
    executeTakeFirst: terminal.executeTakeFirst ?? (() => Promise.resolve(null)),
  }
  for (const m of [
    "innerJoin",
    "leftJoin",
    "select",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
  ]) {
    c[m] = () => c
  }
  return c
}

function buildMockDb(scriptureRefRows: object[]) {
  return {
    selectFrom: (table: string) => {
      if (table === "videos") {
        return makeChain({ executeTakeFirst: () => Promise.resolve(mockVideoRow) })
      }
      if (table === "playlists") {
        return makeChain({ execute: () => Promise.resolve([]) })
      }
      if (table === "video_enrichments") {
        return makeChain({ executeTakeFirst: () => Promise.resolve({ summary: "Test summary" }) })
      }
      if (table === "topics") {
        return makeChain({ execute: () => Promise.resolve([]) })
      }
      if (table === "video_scripture_refs") {
        return makeChain({ execute: () => Promise.resolve(scriptureRefRows) })
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    },
  } as unknown as Kysely<Database>
}

async function buildTestApp(mockDb: Kysely<Database>) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.decorate("db", mockDb)
  await app.register(videoDetailRoutes)
  await app.ready()
  return app
}

// Rows pre-sorted as the DB would return them: occurrences DESC, first_position ASC.
// Tied occurrences=5: Romans 8:3 (first_position=50) before John 3:16 (first_position=200).
const sortedRefRows = [
  {
    book_id: 45,
    chapter_start: 8,
    verse_start: 3,
    chapter_end: 8,
    verse_end: 3,
    start_coord: "45008003",
    end_coord: "45008003",
    occurrences: 5,
    first_position: 50,
  },
  {
    book_id: 43,
    chapter_start: 3,
    verse_start: 16,
    chapter_end: 3,
    verse_end: 16,
    start_coord: "43003016",
    end_coord: "43003016",
    occurrences: 5,
    first_position: 200,
  },
  {
    book_id: 45,
    chapter_start: 8,
    verse_start: 1,
    chapter_end: 8,
    verse_end: 39,
    start_coord: "45008001",
    end_coord: "45008039",
    occurrences: 3,
    first_position: 100,
  },
]

describe("GET /videos/:id", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    app = await buildTestApp(buildMockDb(sortedRefRows))
  })

  afterEach(async () => {
    await app.close()
  })

  it("returns 200 with structured scripture_refs", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.scripture_refs).toHaveLength(3)
  })

  it("each ref has all required structured fields", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    const body = res.json()
    for (const ref of body.scripture_refs) {
      expect(ref).toMatchObject({
        book_id: expect.any(Number),
        chapter_start: expect.any(Number),
        verse_start: expect.any(Number),
        chapter_end: expect.any(Number),
        verse_end: expect.any(Number),
        start_coord: expect.any(Number),
        end_coord: expect.any(Number),
        occurrences: expect.any(Number),
        display: expect.any(String),
      })
    }
  })

  it("start_coord and end_coord are numbers not strings", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    const body = res.json()
    for (const ref of body.scripture_refs) {
      expect(typeof ref.start_coord).toBe("number")
      expect(typeof ref.end_coord).toBe("number")
    }
  })

  it("display strings are correct canonical forms", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    const body = res.json()
    const displays = body.scripture_refs.map((r: { display: string }) => r.display)
    expect(displays).toContain("Romans 8:3")
    expect(displays).toContain("John 3:16")
    expect(displays).toContain("Romans 8")
  })

  it("preserves the DB sort order — occurrences DESC then first_position ASC", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    const body = res.json()
    // The mock returns rows in the sorted order the DB would produce.
    // The route maps them directly without reordering.
    expect(body.scripture_refs[0].display).toBe("Romans 8:3") // occurrences=5, first_position=50
    expect(body.scripture_refs[1].display).toBe("John 3:16") // occurrences=5, first_position=200
    expect(body.scripture_refs[2].display).toBe("Romans 8") // occurrences=3, first_position=100
    // Confirm descending occurrences
    expect(body.scripture_refs[0].occurrences).toBeGreaterThanOrEqual(
      body.scripture_refs[1].occurrences,
    )
    expect(body.scripture_refs[1].occurrences).toBeGreaterThanOrEqual(
      body.scripture_refs[2].occurrences,
    )
  })

  it("first_position is not exposed in the response", async () => {
    const res = await app.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    const body = res.json()
    for (const ref of body.scripture_refs) {
      expect(ref).not.toHaveProperty("first_position")
    }
  })

  it("returns empty scripture_refs when there are none", async () => {
    const emptyApp = await buildTestApp(buildMockDb([]))
    const res = await emptyApp.inject({ method: "GET", url: `/videos/${MOCK_VIDEO_ID}` })
    await emptyApp.close()
    expect(res.statusCode).toBe(200)
    expect(res.json().scripture_refs).toEqual([])
  })

  it("returns 404 when video is not found", async () => {
    const missingDb = {
      selectFrom: (table: string) => {
        if (table === "videos") {
          return makeChain({ executeTakeFirst: () => Promise.resolve(null) })
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    } as unknown as Kysely<Database>
    const missingApp = await buildTestApp(missingDb)
    const res = await missingApp.inject({ method: "GET", url: "/videos/nonexistent" })
    await missingApp.close()
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: "video not found" })
  })
})
