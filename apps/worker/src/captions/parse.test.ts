// Fixture sourced from a yt-dlp `--write-auto-subs --sub-langs en` run; trimmed
// to the first few cues for a stable, fast test.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { VttParseError } from "./errors.js"
import { parseVtt } from "./parse.js"

const FIXTURE_URL = new URL("./__fixtures__/sample.vtt", import.meta.url)

async function loadFixture(): Promise<string> {
  return await readFile(fileURLToPath(FIXTURE_URL), "utf8")
}

describe("parseVtt — fixture", () => {
  it("emits the expected segment count and total word count", async () => {
    const raw = await loadFixture()
    const { segments, words } = parseVtt(raw)
    expect(segments).toHaveLength(5)
    expect(words).toHaveLength(22)
  })

  it("round-trips: every word's timestamp falls within its segment range", async () => {
    const raw = await loadFixture()
    const { segments, words } = parseVtt(raw)

    // Words are emitted in position order with monotonic non-decreasing start_ms.
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as (typeof words)[number]
      expect(w.position).toBe(i)
      if (i > 0) {
        const prev = words[i - 1] as (typeof words)[number]
        expect(w.start_ms).toBeGreaterThanOrEqual(prev.start_ms)
      }
    }

    // For each word, find a segment whose half-open range [start_ms, end_ms) contains it.
    for (const w of words) {
      const containing = segments.find((s) => w.start_ms >= s.start_ms && w.start_ms < s.end_ms)
      expect(
        containing,
        `word at ${w.start_ms}ms ("${w.text}") had no containing segment`,
      ).toBeDefined()
    }
  })

  it("strips inline markup from segment text", async () => {
    const raw = await loadFixture()
    const { segments } = parseVtt(raw)
    for (const s of segments) {
      expect(s.text).not.toContain("<")
      expect(s.text).not.toContain(">")
    }
    expect(segments[0]?.text).toBe("welcome to the sermon")
    expect(segments[2]?.text).toBe("let us pray")
  })
})

describe("parseVtt — pathological inputs", () => {
  it("throws VttParseError on an empty string", () => {
    expect(() => parseVtt("")).toThrow(VttParseError)
  })

  it("throws VttParseError when WEBVTT header is missing", () => {
    expect(() => parseVtt("not-a-vtt-file\n")).toThrow(VttParseError)
  })

  it("throws VttParseError on header-only files with no cues", () => {
    expect(() => parseVtt("WEBVTT\nKind: captions\nLanguage: en\n")).toThrow(VttParseError)
  })

  it("throws VttParseError when the cue header is missing the arrow", () => {
    const raw = "WEBVTT\n\n00:00:00.000 00:00:01.000\nhello\n"
    expect(() => parseVtt(raw)).toThrow(VttParseError)
  })

  it("throws VttParseError on a malformed timestamp", () => {
    const raw = "WEBVTT\n\n00:00:0X.000 --> 00:00:01.000\nhello\n"
    expect(() => parseVtt(raw)).toThrow(VttParseError)
  })
})
