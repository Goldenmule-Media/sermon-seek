import { extract } from "@sermon-search/scripture"
import { describe, expect, it, vi } from "vitest"
import { runEnrichBackfill } from "./run.js"
import { slugifyTopic } from "./topics.js"

// Unit tests for enrichment orchestration logic (no DB required)

describe("skip predicate", () => {
  it("skips when already enriched at same model_version", () => {
    const alreadyEnriched = (existingModelVersion: string | null, enricherModel: string) =>
      existingModelVersion === enricherModel

    expect(alreadyEnriched("gpt-4o-mini", "gpt-4o-mini")).toBe(true)
    expect(alreadyEnriched(null, "gpt-4o-mini")).toBe(false)
    expect(alreadyEnriched("gpt-4o", "gpt-4o-mini")).toBe(false)
  })

  it("does not skip when force is true even if already enriched", () => {
    const shouldSkip = (
      existingModelVersion: string | null,
      enricherModel: string,
      force: boolean,
    ) => !force && existingModelVersion === enricherModel

    expect(shouldSkip("gpt-4o-mini", "gpt-4o-mini", false)).toBe(true)
    expect(shouldSkip("gpt-4o-mini", "gpt-4o-mini", true)).toBe(false)
  })
})

describe("topic slug deduplication", () => {
  it("maps multiple topic labels to unique slugs", () => {
    const topics = ["Grace and Truth", "Grace and Truth", "Faith", "faith"]
    const slugs = topics.map(slugifyTopic)
    const unique = [...new Set(slugs)]
    expect(unique).toEqual(["grace-and-truth", "faith"])
  })

  it("collapses special characters", () => {
    expect(slugifyTopic("God's Love")).toBe("god-s-love")
  })

  it("strips leading and trailing dashes", () => {
    expect(slugifyTopic("--grace--")).toBe("grace")
  })
})

describe("scripture extraction via deterministic extractor", () => {
  it("returns structured ExtractedRef with all required columns", () => {
    const refs = extract("In John 3:16 we see God's love.")
    expect(refs).toHaveLength(1)
    const ref = refs[0]
    if (!ref) throw new Error("expected one extracted ref")
    expect(typeof ref.book_id).toBe("number")
    expect(typeof ref.chapter_start).toBe("number")
    expect(typeof ref.verse_start).toBe("number")
    expect(typeof ref.chapter_end).toBe("number")
    expect(typeof ref.verse_end).toBe("number")
    expect(typeof ref.start_coord).toBe("number")
    expect(typeof ref.end_coord).toBe("number")
    expect(typeof ref.occurrences).toBe("number")
    expect(Array.isArray(ref.positions)).toBe(true)
    expect(typeof ref.first_position).toBe("number")
    expect(typeof ref.raw_first).toBe("string")
  })

  it("counts occurrences when the same ref appears multiple times", () => {
    const refs = extract("Romans 8:28 is great. As Romans 8:28 says, all things work together.")
    expect(refs).toHaveLength(1)
    const ref = refs[0]
    if (!ref) throw new Error("expected one extracted ref")
    expect(ref.occurrences).toBe(2)
    expect(ref.positions).toHaveLength(2)
  })

  it("returns one entry per unique canonical interval", () => {
    const refs = extract("See John 3:16 and Romans 8:28 and again John 3:16.")
    expect(refs).toHaveLength(2)
  })

  it("returns empty array for text with no scripture references", () => {
    const refs = extract("The weather was nice today and everyone felt good.")
    expect(refs).toHaveLength(0)
  })

  it("start_coord is less than or equal to end_coord for each ref", () => {
    const refs = extract("Romans 8:28-30 is a key passage.")
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref.start_coord).toBeLessThanOrEqual(ref.end_coord)
    }
  })
})

describe("runEnrichBackfill", () => {
  it("refreshes scripture refs even when LLM path is skipped for already-enriched video", async () => {
    const videoId = "video-1"
    const youtubeId = "yt-abc"
    const transcriptText = "In John 3:16 we see God's love."

    const deletedTables: string[] = []
    const insertedCalls: Array<{ table: string; values: unknown }> = []

    const makeSelectChain = (table: string) => {
      const canned: Record<string, unknown[]> = {
        videos: [{ id: videoId, youtube_video_id: youtubeId, title: "Test Sermon" }],
        transcripts: [{ id: "t-1", full_text: transcriptText, model_version: "v1" }],
        video_enrichments: [{ video_id: videoId }],
      }
      const rows = canned[table] ?? []
      const chain = {
        select: () => chain,
        where: () => chain,
        orderBy: () => chain,
        execute: async () => rows,
        executeTakeFirst: async () => rows[0],
        executeTakeFirstOrThrow: async () => {
          if (rows[0] == null) throw new Error(`no row in ${table}`)
          return rows[0]
        },
      }
      return chain
    }

    const makeDeleteChain = (table: string) => {
      const chain = {
        where: () => chain,
        execute: async () => {
          deletedTables.push(table)
        },
      }
      return chain
    }

    const makeInsertChain = (table: string) => {
      let storedValues: unknown = null
      const chain = {
        values: (vals: unknown) => {
          storedValues = vals
          return chain
        },
        onConflict: () => chain,
        execute: async () => {
          insertedCalls.push({ table, values: storedValues })
        },
      }
      return chain
    }

    const makeTrx = () => ({
      selectFrom: makeSelectChain,
      deleteFrom: makeDeleteChain,
      insertInto: makeInsertChain,
    })

    const db = {
      selectFrom: makeSelectChain,
      deleteFrom: makeDeleteChain,
      insertInto: makeInsertChain,
      transaction: () => ({
        execute: async (cb: (trx: ReturnType<typeof makeTrx>) => Promise<void>) => cb(makeTrx()),
      }),
    }

    const enricher = {
      model: "test-model",
      enrich: vi.fn(),
    }

    const result = await runEnrichBackfill({
      db: db as never,
      enricher,
      churchId: "test-church-id",
    })

    // LLM path must not run
    expect(enricher.enrich).not.toHaveBeenCalled()

    // video_scripture_refs was deleted and re-inserted with extracted refs
    expect(deletedTables).toContain("video_scripture_refs")
    const refsInsert = insertedCalls.find((c) => c.table === "video_scripture_refs")
    expect(refsInsert).toBeDefined()
    expect(Array.isArray(refsInsert?.values)).toBe(true)
    expect((refsInsert?.values as unknown[])?.length ?? 0).toBeGreaterThan(0)

    // No writes to LLM-gated tables
    expect(insertedCalls.map((c) => c.table)).not.toContain("video_enrichments")
    expect(insertedCalls.map((c) => c.table)).not.toContain("video_topics")
    expect(insertedCalls.map((c) => c.table)).not.toContain("topics")
    expect(deletedTables).not.toContain("video_topics")

    // Counters: one skipped, refs counted
    expect(result.videosSkipped).toBe(1)
    expect(result.videosProcessed).toBe(0)
    expect(result.refsInserted).toBeGreaterThan(0)
  })
})
