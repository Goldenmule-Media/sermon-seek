import { describe, expect, it } from "vitest"
import { RRF_K, fuseRRF } from "./hybrid.js"
import type { FtsResult } from "./fts.js"

function makeResult(
  youtube_video_id: string,
  start_ms: number,
  snippet: string,
  score = 1.0,
): FtsResult {
  return { youtube_video_id, start_ms, snippet, score, title: "Test Video", thumbnail_url: null }
}

describe("fuseRRF", () => {
  it("returns empty array when both inputs are empty", () => {
    expect(fuseRRF([], [])).toEqual([])
  })

  it("returns FTS-only results when semantic list is empty", () => {
    const fts = [makeResult("v1", 1000, "fts-a"), makeResult("v2", 2000, "fts-b")]
    const result = fuseRRF(fts, [])
    expect(result.map((r) => r.youtube_video_id)).toEqual(["v1", "v2"])
  })

  it("merges and ranks by hand-computed RRF scores (k=60)", () => {
    // FTS: [v1@1000, v2@2000, v3@3000]  → ranks 1, 2, 3
    // Sem: [v2@2000, v4@4000, v1@1000]  → ranks 1, 2, 3
    //
    // v2: 1/(61+1) + 1/(61)   = 1/62 + 1/61 = 0.016129 + 0.016393 = 0.032522
    // v1: 1/(61)   + 1/(61+2) = 1/61 + 1/63 = 0.016393 + 0.015873 = 0.032266
    // v4: 1/(61+1)             = 1/62        = 0.016129
    // v3: 1/(61+2)             = 1/63        = 0.015873
    const fts = [
      makeResult("v1", 1000, "fts-a"),
      makeResult("v2", 2000, "fts-b"),
      makeResult("v3", 3000, "fts-c"),
    ]
    const sem = [
      makeResult("v2", 2000, "sem-b"),
      makeResult("v4", 4000, "sem-d"),
      makeResult("v1", 1000, "sem-a"),
    ]
    // Pin equal weights here so this test exercises RRF math regardless of
    // production weight tuning.
    const result = fuseRRF(fts, sem, { ftsWeight: 1, semanticWeight: 1 })
    expect(result.map((r) => r.youtube_video_id)).toEqual(["v2", "v1", "v4", "v3"])

    // Verify scores match hand-computed values within float tolerance
    const k = RRF_K
    expect(result[0]?.score).toBeCloseTo(1 / (k + 2) + 1 / (k + 1), 6) // v2
    expect(result[1]?.score).toBeCloseTo(1 / (k + 1) + 1 / (k + 3), 6) // v1
    expect(result[2]?.score).toBeCloseTo(1 / (k + 2), 6) // v4
    expect(result[3]?.score).toBeCloseTo(1 / (k + 3), 6) // v3
  })

  it("keeps the FTS snippet when the same key appears in both lists", () => {
    const fts = [makeResult("v1", 1000, "fts-highlighted <mark>snippet</mark>")]
    const sem = [makeResult("v1", 1000, "sem plain snippet")]
    const result = fuseRRF(fts, sem)
    expect(result).toHaveLength(1)
    expect(result[0]?.snippet).toBe("fts-highlighted <mark>snippet</mark>")
  })

  it("deduplicates by (youtube_video_id, start_ms) — different start_ms are distinct entries", () => {
    const fts = [makeResult("v1", 1000, "fts-early"), makeResult("v1", 5000, "fts-late")]
    const sem = [makeResult("v1", 1000, "sem-early")]
    const result = fuseRRF(fts, sem)
    expect(result).toHaveLength(2)
    const keys = result.map((r) => `${r.youtube_video_id}:${r.start_ms}`)
    expect(keys).toContain("v1:1000")
    expect(keys).toContain("v1:5000")
  })

  it("respects custom k, ftsWeight, semanticWeight", () => {
    // With k=0 and weights, score = ftsWeight/rank + semanticWeight/rank
    const fts = [makeResult("v1", 0, "a"), makeResult("v2", 0, "b")]
    const sem = [makeResult("v2", 0, "b-sem"), makeResult("v1", 0, "a-sem")]
    // k=0: v1 scores 2/1 + 1/2 = 2.5, v2 scores 1/2 + 2/1 = 2.5 — tie; order stable
    // Use k=1 for cleaner math: v2 = 1/(1+2) + 2/(1+1) = 1/3 + 1 = 1.333; v1 = 2/(1+1) + 1/(1+2) = 1 + 1/3 = 1.333
    // Use ftsWeight=2 to tip: v1(fts rank1)=2/2 + 1/3 = 1.333; v2(fts rank2)=2/3 + 1/2 = 1.166 → v1 wins
    const result = fuseRRF(fts, sem, { k: 1, ftsWeight: 2, semanticWeight: 1 })
    expect(result[0]?.youtube_video_id).toBe("v1")
  })
})
