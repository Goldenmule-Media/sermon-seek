import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { parseVtt } from "../captions/parse.js"
import type { Segment, Word } from "../captions/parse.js"
import { TranscriptQualityError, assertTranscriptQuality } from "./transcript.js"

const FIXTURE_URL = new URL("../captions/__fixtures__/sample.vtt", import.meta.url)

async function loadFixture(): Promise<string> {
  return await readFile(fileURLToPath(FIXTURE_URL), "utf8")
}

function makeWord(start_ms: number, end_ms: number, position: number, text = "w"): Word {
  return { start_ms, end_ms, position, text }
}

function makeSegment(start_ms: number, end_ms: number, text = "x", words: Word[] = []): Segment {
  return { start_ms, end_ms, text, words }
}

describe("assertTranscriptQuality", () => {
  it("passes when segment coverage meets the threshold and words are in range", () => {
    const segments = [
      makeSegment(0, 9000, "x", [makeWord(0, 1000, 0)]),
      makeSegment(9000, 10000, "x", [makeWord(9500, 9900, 1)]),
    ]
    expect(() => assertTranscriptQuality({ segments, durationSeconds: 10 })).not.toThrow()
  })

  it("throws low_coverage when summed segment durations cover less than the threshold", () => {
    const segments = [makeSegment(0, 5000, "x", [makeWord(0, 1000, 0)])]
    try {
      assertTranscriptQuality({ segments, durationSeconds: 100 })
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptQualityError)
      expect((err as TranscriptQualityError).reason).toBe("low_coverage")
    }
  })

  it("accepts ~70% coverage under the default 0.5 threshold (worship-service case)", () => {
    // A complete service transcript: 7000ms of speech in a 10s video (music fills the rest).
    const segments = [makeSegment(0, 7000, "x", [makeWord(0, 1000, 0)])]
    expect(() => assertTranscriptQuality({ segments, durationSeconds: 10 })).not.toThrow()
  })

  it("honors TRANSCRIPT_MIN_COVERAGE to raise the threshold", () => {
    const segments = [makeSegment(0, 7000, "x", [makeWord(0, 1000, 0)])]
    vi.stubEnv("TRANSCRIPT_MIN_COVERAGE", "0.9")
    try {
      expect(() => assertTranscriptQuality({ segments, durationSeconds: 10 })).toThrow(
        TranscriptQualityError,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("falls back to the default when TRANSCRIPT_MIN_COVERAGE is invalid", () => {
    const segments = [makeSegment(0, 7000, "x", [makeWord(0, 1000, 0)])]
    vi.stubEnv("TRANSCRIPT_MIN_COVERAGE", "not-a-number")
    try {
      expect(() => assertTranscriptQuality({ segments, durationSeconds: 10 })).not.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("throws word_out_of_range when a word starts before its owning segment", () => {
    // A word whose start_ms is before its segment's start_ms indicates a parse error.
    const segments = [makeSegment(1000, 2000, "x", [makeWord(500, 800, 0)])]
    try {
      assertTranscriptQuality({ segments, durationSeconds: null })
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptQualityError)
      expect((err as TranscriptQualityError).reason).toBe("word_out_of_range")
    }
  })

  it("skips the coverage check when durationSeconds is null", () => {
    const segments = [makeSegment(0, 100, "x", [makeWord(0, 100, 0)])]
    expect(() => assertTranscriptQuality({ segments, durationSeconds: null })).not.toThrow()
  })

  it("accepts a word whose start_ms equals its owning segment's end_ms (cue-overlap quirk)", () => {
    // YouTube cue-overlap: the parser emits a word at the cue boundary; its start_ms equals
    // the segment's end_ms. Parser grouping is authoritative — the check must not reject it.
    const boundaryWord = makeWord(5500, 5500, 2, "overlap")
    const segments = [
      makeSegment(3000, 5500, "hello world overlap", [
        makeWord(3000, 3200, 0, "hello"),
        makeWord(3200, 5500, 1, "world"),
        boundaryWord,
      ]),
      makeSegment(5500, 8000, "next word", [
        makeWord(5500, 6000, 3, "next"),
        makeWord(6000, 8000, 4, "word"),
      ]),
    ]
    expect(() => assertTranscriptQuality({ segments, durationSeconds: null })).not.toThrow()
  })

  it("passes for the fixture VTT — every word lies inside its segment's range", async () => {
    const raw = await loadFixture()
    const { segments } = parseVtt(raw)
    // Fixture spans 3000-15800ms; choose a duration matching that range so the coverage check has room.
    expect(() => assertTranscriptQuality({ segments, durationSeconds: null })).not.toThrow()
  })
})
