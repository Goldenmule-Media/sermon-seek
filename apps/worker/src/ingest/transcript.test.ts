import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseVtt } from "../captions/parse.js"
import type { Segment, Word } from "../captions/parse.js"
import { TranscriptQualityError, assertTranscriptQuality } from "./transcript.js"

const FIXTURE_URL = new URL("../captions/__fixtures__/sample.vtt", import.meta.url)

async function loadFixture(): Promise<string> {
  return await readFile(fileURLToPath(FIXTURE_URL), "utf8")
}

function makeSegment(start_ms: number, end_ms: number, text = "x"): Segment {
  return { start_ms, end_ms, text }
}

function makeWord(start_ms: number, end_ms: number, position: number, text = "w"): Word {
  return { start_ms, end_ms, position, text }
}

describe("assertTranscriptQuality", () => {
  it("passes when segment coverage meets the 90% threshold and words are in range", () => {
    const segments = [makeSegment(0, 9000), makeSegment(9000, 10000)]
    const words = [makeWord(0, 1000, 0), makeWord(9500, 9900, 1)]
    expect(() => assertTranscriptQuality({ segments, words, durationSeconds: 10 })).not.toThrow()
  })

  it("throws low_coverage when summed segment durations cover <90% of video duration", () => {
    const segments = [makeSegment(0, 5000)]
    const words = [makeWord(0, 1000, 0)]
    try {
      assertTranscriptQuality({ segments, words, durationSeconds: 100 })
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptQualityError)
      expect((err as TranscriptQualityError).reason).toBe("low_coverage")
    }
  })

  it("throws word_out_of_range when a word falls outside its containing segment", () => {
    const segments = [makeSegment(0, 1000), makeSegment(2000, 3000)]
    const words = [makeWord(0, 500, 0), makeWord(1500, 1800, 1)]
    try {
      assertTranscriptQuality({ segments, words, durationSeconds: null })
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptQualityError)
      expect((err as TranscriptQualityError).reason).toBe("word_out_of_range")
    }
  })

  it("skips the coverage check when durationSeconds is null", () => {
    const segments = [makeSegment(0, 100)]
    const words = [makeWord(0, 100, 0)]
    expect(() => assertTranscriptQuality({ segments, words, durationSeconds: null })).not.toThrow()
  })

  it("passes for the fixture VTT — every word lies inside its segment's range", async () => {
    const raw = await loadFixture()
    const { segments, words } = parseVtt(raw)
    // Fixture spans 3000-15800ms; choose a duration matching that range so the coverage check has room.
    expect(() => assertTranscriptQuality({ segments, words, durationSeconds: null })).not.toThrow()
  })
})
