import { describe, expect, it } from "vitest"
import { TOP_N_PER_SIGNAL, jaccard, pickQuotedSnippet, topN } from "./signals.js"

describe("jaccard", () => {
  it("returns 0 for two empty arrays", () => {
    expect(jaccard([], [])).toBe(0)
  })

  it("returns 1 for identical sets", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "c"])).toBe(1)
  })

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0)
  })

  it("computes correct score for partial overlap", () => {
    // intersection={b,c}, union={a,b,c,d} → 2/4 = 0.5
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5)
  })

  it("deduplicates within each array", () => {
    // a=[a,b,b] → {a,b}, b=[b,c] → {b,c}: intersection={b}=1, union={a,b,c}=3 → 1/3
    expect(jaccard(["a", "b", "b"], ["b", "c"])).toBeCloseTo(1 / 3)
  })
})

describe("pickQuotedSnippet", () => {
  it("returns the full text when it fits within maxChars", () => {
    const text = "Short sentence."
    expect(pickQuotedSnippet(text, 180)).toBe("Short sentence.")
  })

  it("trims at a sentence boundary when possible", () => {
    const text = "First sentence. Second sentence that goes much longer and would exceed the limit."
    const result = pickQuotedSnippet(text, 30)
    expect(result).toBe("First sentence.")
  })

  it("falls back to a word boundary when no sentence fits", () => {
    const text = "Averylongwordwithnospacesuntilway later in the text."
    const result = pickQuotedSnippet(text, 20)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result.endsWith(" ")).toBe(false)
  })

  it("trims leading and trailing whitespace from input", () => {
    const text = "  Hello world.  "
    expect(pickQuotedSnippet(text, 180)).toBe("Hello world.")
  })
})

describe("topN", () => {
  it("returns top N items sorted by score desc", () => {
    const items = [
      { score: 0.5, id: "a" },
      { score: 0.9, id: "b" },
      { score: 0.1, id: "c" },
      { score: 0.7, id: "d" },
    ]
    const result = topN(items, 2)
    expect(result.map((x) => x.id)).toEqual(["b", "d"])
  })

  it("uses TOP_N_PER_SIGNAL as default N", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ score: i / 20, id: String(i) }))
    expect(topN(items)).toHaveLength(TOP_N_PER_SIGNAL)
  })

  it("does not mutate the input array", () => {
    const items = [{ score: 0.3 }, { score: 0.9 }, { score: 0.1 }]
    const copy = [...items]
    topN(items)
    expect(items).toEqual(copy)
  })
})
