import { describe, expect, it, vi } from "vitest"
import { CaptionsUnavailable } from "../captions/errors.js"
import type { FetchCaptionsResult } from "../captions/fetch.js"
import { runSmokeTest, SmokeTestInvariantFailed } from "./smoke-test.js"

const SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.080 --> 00:00:03.000 align:start position:0%


00:00:03.000 --> 00:00:05.500 align:start position:0%
welcome<00:00:03.479><c> to</c><00:00:04.000><c> the</c><00:00:04.560><c> sermon</c>

00:00:05.500 --> 00:00:08.000 align:start position:0%
welcome to the sermon
today<00:00:05.760><c> we</c><00:00:06.000><c> read</c><00:00:06.799><c> from</c><00:00:07.359><c> John</c>

00:00:08.000 --> 00:00:10.500 align:start position:0%
today we read from John
let<00:00:08.479><c> us</c><00:00:09.000><c> pray</c>

00:00:10.500 --> 00:00:13.200 align:start position:0%
let us pray
our<00:00:10.760><c> father</c><00:00:11.200><c> who</c><00:00:11.560><c> art</c><00:00:12.000><c> in</c><00:00:12.500><c> heaven</c>
`

interface CapturedLogger {
  info: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

function makeLogger(): CapturedLogger {
  return { info: vi.fn(), error: vi.fn() }
}

function makeBaseDeps(overrides: Partial<Parameters<typeof runSmokeTest>[0]> = {}) {
  const fetchCaptions = vi.fn(async () => ({
    vttPath: "/tmp/fake.vtt",
    fromCache: false,
  } satisfies FetchCaptionsResult))
  const getDurationSeconds = vi.fn(async () => 14)
  const clearCache = vi.fn(async () => {})
  const readVttFile = vi.fn(async () => SAMPLE_VTT)
  return {
    videoId: "testVideoId",
    minSegments: 2,
    minWords: 5,
    minCoveragePct: 60,
    fetchCaptions,
    getDurationSeconds,
    clearCache,
    readVttFile,
    ...overrides,
  }
}

describe("runSmokeTest", () => {
  it("happy path: logs structured JSON summary and exits 0", async () => {
    const logger = makeLogger()
    const deps = makeBaseDeps()
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.summary).toMatchObject({
      video_id: "testVideoId",
      duration_ms: 14000,
    })
    expect(typeof result.summary?.segment_count).toBe("number")
    expect(typeof result.summary?.word_count).toBe("number")
    expect(typeof result.summary?.coverage_pct).toBe("number")
    expect(result.summary?.segment_count).toBeGreaterThanOrEqual(2)
    expect(result.summary?.word_count).toBeGreaterThanOrEqual(5)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
    const logged = JSON.parse(logger.info.mock.calls[0]?.[0] as string)
    expect(logged).toEqual(result.summary)
    expect(Object.keys(logged).sort()).toEqual(
      ["coverage_pct", "duration_ms", "segment_count", "video_id", "word_count"].sort(),
    )
  })

  it("clears the cache for the reference video before fetching", async () => {
    const callOrder: string[] = []
    const deps = makeBaseDeps({
      clearCache: vi.fn(async (id: string) => {
        callOrder.push(`clear:${id}`)
      }),
      fetchCaptions: vi.fn(async (o: { videoId: string }) => {
        callOrder.push(`fetch:${o.videoId}`)
        return { vttPath: "/tmp/fake.vtt", fromCache: false }
      }),
    })
    await runSmokeTest({ ...deps, logger: makeLogger() })
    expect(callOrder).toEqual(["clear:testVideoId", "fetch:testVideoId"])
  })

  it("exits non-zero with captions_unavailable when fetcher throws CaptionsUnavailable", async () => {
    const logger = makeLogger()
    const deps = makeBaseDeps({
      fetchCaptions: vi.fn(async () => {
        throw new CaptionsUnavailable("testVideoId")
      }),
    })
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).not.toBe(0)
    expect(result.summary).toBeUndefined()
    expect(result.error?.error_code).toBe("captions_unavailable")
    expect(result.error?.message).toContain("testVideoId")
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.info).not.toHaveBeenCalled()
    const errLogged = JSON.parse(logger.error.mock.calls[0]?.[0] as string)
    expect(errLogged.error_code).toBe("captions_unavailable")
    expect(errLogged.video_id).toBe("testVideoId")
  })

  it("surfaces malformed VTT as a typed vtt_parse_error", async () => {
    const logger = makeLogger()
    const deps = makeBaseDeps({
      readVttFile: vi.fn(async () => "not a valid vtt at all"),
    })
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).not.toBe(0)
    expect(result.error?.error_code).toBe("vtt_parse_error")
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it("fails with low_coverage when coverage falls below the floor", async () => {
    const logger = makeLogger()
    // Pretend the video is an hour long → coverage will be tiny.
    const deps = makeBaseDeps({ getDurationSeconds: vi.fn(async () => 3600) })
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).toBe(1)
    expect(result.error?.error_code).toBe("low_coverage")
    expect(result.error?.coverage_pct).toBeLessThan(60)
  })

  it("fails with min_segments when segment floor is not reached", async () => {
    const logger = makeLogger()
    const deps = makeBaseDeps({ minSegments: 9999 })
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).toBe(1)
    expect(result.error?.error_code).toBe("min_segments")
  })

  it("fails with unknown_duration when duration lookup returns null", async () => {
    const logger = makeLogger()
    const deps = makeBaseDeps({ getDurationSeconds: vi.fn(async () => null) })
    const result = await runSmokeTest({ ...deps, logger })

    expect(result.exitCode).toBe(1)
    expect(result.error?.error_code).toBe("unknown_duration")
  })

  it("exports SmokeTestInvariantFailed as a real class", () => {
    const e = new SmokeTestInvariantFailed("min_words", "boom", { extra: 1 })
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe("min_words")
    expect(e.details).toEqual({ extra: 1 })
  })
})
