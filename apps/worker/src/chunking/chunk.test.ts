import type { TranscriptSegmentRow } from "@sermon-search/db"
import { describe, expect, it } from "vitest"
import { chunkSegments } from "./chunk.js"

function makeSeg(
  id: string,
  start_ms: number,
  end_ms: number,
  text = `seg-${id}`,
): TranscriptSegmentRow {
  return {
    id,
    transcript_id: "t1",
    video_id: "v1",
    start_ms,
    end_ms,
    text,
    speaker_id: null,
  }
}

describe("chunkSegments", () => {
  it("returns empty array for empty input", () => {
    expect(chunkSegments([])).toEqual([])
  })

  it("produces chunks where each is ≥ minMs except possibly the last", () => {
    const segs = Array.from({ length: 20 }, (_, i) => makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000))
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunk = chunks[i]
      if (!chunk) continue
      const duration = chunk.end_ms - chunk.start_ms
      expect(duration).toBeGreaterThanOrEqual(30_000)
    }
    for (const chunk of chunks) {
      const duration = chunk.end_ms - chunk.start_ms
      expect(duration).toBeLessThanOrEqual(60_000)
    }
  })

  it("chunk boundaries align with segment boundaries — no chunk splits a segment", () => {
    const segs = Array.from({ length: 12 }, (_, i) => makeSeg(`${i}`, i * 4_000, (i + 1) * 4_000))
    const chunks = chunkSegments(segs, { minMs: 20_000, targetMs: 30_000, maxMs: 40_000 })
    const segStarts = new Set(segs.map((s) => s.start_ms))
    const segEnds = new Set(segs.map((s) => s.end_ms))
    for (const chunk of chunks) {
      expect(segStarts.has(chunk.start_ms)).toBe(true)
      expect(segEnds.has(chunk.end_ms)).toBe(true)
    }
  })

  it("concatenated text covers every segment text exactly once", () => {
    const segs = Array.from({ length: 10 }, (_, i) =>
      makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000, `word-${i}`),
    )
    const chunks = chunkSegments(segs, { minMs: 20_000, targetMs: 30_000, maxMs: 40_000 })
    const allWords = chunks.flatMap((c) => c.text.split(" "))
    expect(allWords.sort()).toEqual(segs.map((s) => s.text).sort())
  })

  it("single long segment > maxMs becomes one chunk on its own", () => {
    const segs = [makeSeg("a", 0, 90_000, "very long segment")]
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.start_ms).toBe(0)
    expect(chunks[0]?.end_ms).toBe(90_000)
    expect(chunks[0]?.text).toBe("very long segment")
  })

  it("last chunk may be shorter than minMs", () => {
    // 9 × 5000ms = 45000ms → first chunk; 1 × 5000ms = 5000ms → last chunk (< minMs=30000)
    const segs = Array.from({ length: 10 }, (_, i) => makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000))
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // all segments are covered
    const coveredIds = chunks.flatMap((c) => c.segment_ids)
    expect(coveredIds.sort()).toEqual(segs.map((s) => s.id).sort())
  })
})
