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

  it("every segment appears in at least one chunk; covers full transcript", () => {
    const segs = Array.from({ length: 10 }, (_, i) =>
      makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000, `word-${i}`),
    )
    const chunks = chunkSegments(segs, { minMs: 20_000, targetMs: 30_000, maxMs: 40_000 })
    const coveredIds = new Set(chunks.flatMap((c) => c.segment_ids))
    expect(coveredIds.size).toBe(segs.length)
    for (const s of segs) expect(coveredIds.has(s.id)).toBe(true)
  })

  it("adjacent chunks share their boundary segment (overlap of one)", () => {
    const segs = Array.from({ length: 20 }, (_, i) => makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000))
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]
      const cur = chunks[i]
      if (!prev || !cur) continue
      const prevLast = prev.segment_ids[prev.segment_ids.length - 1]
      const curFirst = cur.segment_ids[0]
      expect(curFirst).toBe(prevLast)
    }
  })

  it("a phrase straddling a chunk boundary still appears whole in some chunk", () => {
    // Build segments so that the join "Psalm" + "127" lives across what would
    // otherwise be a chunk boundary. With overlap, "127" should be reachable
    // from the chunk that contains "Psalm".
    const segs: TranscriptSegmentRow[] = [
      ...Array.from({ length: 8 }, (_, i) => makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000, "filler")),
      makeSeg("psalm", 8 * 5_000, 9 * 5_000, "Psalm"),
      makeSeg("num", 9 * 5_000, 10 * 5_000, "127"),
      ...Array.from({ length: 8 }, (_, i) =>
        makeSeg(`tail-${i}`, (10 + i) * 5_000, (11 + i) * 5_000, "tail"),
      ),
    ]
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    const phraseChunk = chunks.find((c) => c.text.includes("Psalm 127"))
    expect(phraseChunk).toBeDefined()
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
    const segs = Array.from({ length: 10 }, (_, i) => makeSeg(`${i}`, i * 5_000, (i + 1) * 5_000))
    const chunks = chunkSegments(segs, { minMs: 30_000, targetMs: 45_000, maxMs: 60_000 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const coveredIds = new Set(chunks.flatMap((c) => c.segment_ids))
    expect(coveredIds.size).toBe(segs.length)
  })
})
