import { extract } from "@sermon-search/scripture"
import { describe, expect, it } from "vitest"
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
    const ref = refs[0]!
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
    expect(refs[0]!.occurrences).toBe(2)
    expect(refs[0]!.positions).toHaveLength(2)
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
