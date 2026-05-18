import { readFile as nodeReadFile } from "node:fs/promises"
import { cache } from "../cache/cache.js"
import { CaptionError, fetchCaptions as defaultFetchCaptions, parseVtt } from "../captions/index.js"
import type { FetchCaptionsResult } from "../captions/index.js"
import { iso8601DurationToSeconds } from "../ingest/duration.js"
import { getVideosBatched } from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"

const DEFAULT_VIDEO_ID = "19l5OI_8ljQ"
const DEFAULT_MIN_SEGMENTS = 50
const DEFAULT_MIN_WORDS = 500
const DEFAULT_MIN_COVERAGE_PCT = 60

export type SmokeTestErrorCode =
  | "min_segments"
  | "min_words"
  | "low_coverage"
  | "unknown_duration"

export class SmokeTestInvariantFailed extends Error {
  readonly code: SmokeTestErrorCode
  readonly details: Record<string, unknown>

  constructor(code: SmokeTestErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "SmokeTestInvariantFailed"
    this.code = code
    this.details = details
  }
}

export interface SmokeTestSummary {
  video_id: string
  segment_count: number
  word_count: number
  coverage_pct: number
  duration_ms: number
}

export interface SmokeTestErrorLog {
  video_id: string
  error_code: string
  message: string
  [key: string]: unknown
}

export interface SmokeTestLogger {
  info(line: string): void
  error(line: string): void
}

const defaultLogger: SmokeTestLogger = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
}

export interface RunSmokeTestOptions {
  client?: YoutubeClient
  videoId?: string
  minSegments?: number
  minWords?: number
  minCoveragePct?: number
  fetchCaptions?: (opts: { videoId: string }) => Promise<FetchCaptionsResult>
  getDurationSeconds?: (videoId: string) => Promise<number | null>
  clearCache?: (videoId: string) => Promise<void>
  readVttFile?: (path: string) => Promise<string>
  logger?: SmokeTestLogger
}

export interface RunSmokeTestResult {
  exitCode: number
  summary?: SmokeTestSummary
  error?: SmokeTestErrorLog
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

async function defaultClearCache(videoId: string): Promise<void> {
  await cache.unlink(["videos", videoId, "captions.vtt"])
  await cache.unlink(["videos", videoId, "metadata.json"])
}

function makeDefaultGetDuration(
  client: YoutubeClient | undefined,
): (videoId: string) => Promise<number | null> {
  return async (videoId) => {
    if (!client) {
      throw new Error("smoke-test: YoutubeClient is required to look up video duration")
    }
    const { videos } = await getVideosBatched(client, [videoId])
    const video = videos.get(videoId)
    if (!video) return null
    const iso = video.contentDetails?.duration
    if (!iso) return null
    return iso8601DurationToSeconds(iso)
  }
}

export async function runSmokeTest(opts: RunSmokeTestOptions = {}): Promise<RunSmokeTestResult> {
  const logger = opts.logger ?? defaultLogger
  const videoId = opts.videoId ?? process.env.SMOKE_TEST_VIDEO_ID ?? DEFAULT_VIDEO_ID
  const minSegments =
    opts.minSegments ?? parsePositiveNumber(process.env.SMOKE_TEST_MIN_SEGMENTS, DEFAULT_MIN_SEGMENTS)
  const minWords =
    opts.minWords ?? parsePositiveNumber(process.env.SMOKE_TEST_MIN_WORDS, DEFAULT_MIN_WORDS)
  const minCoveragePct =
    opts.minCoveragePct ??
    parsePositiveNumber(process.env.SMOKE_TEST_MIN_COVERAGE_PCT, DEFAULT_MIN_COVERAGE_PCT)

  const clearCache = opts.clearCache ?? defaultClearCache
  const fetchFn = opts.fetchCaptions ?? ((o: { videoId: string }) => defaultFetchCaptions(o))
  const getDuration = opts.getDurationSeconds ?? makeDefaultGetDuration(opts.client)
  const readVtt = opts.readVttFile ?? ((p: string) => nodeReadFile(p, "utf8"))

  try {
    await clearCache(videoId)

    const durationSeconds = await getDuration(videoId)
    if (durationSeconds == null || durationSeconds <= 0) {
      throw new SmokeTestInvariantFailed(
        "unknown_duration",
        `Could not resolve duration for video ${videoId}`,
        { duration_seconds: durationSeconds },
      )
    }

    const fetched = await fetchFn({ videoId })
    const raw = await readVtt(fetched.vttPath)
    const { segments, words } = parseVtt(raw)

    if (segments.length < minSegments) {
      throw new SmokeTestInvariantFailed(
        "min_segments",
        `Segment count ${segments.length} is below floor ${minSegments}`,
        { segment_count: segments.length, min_segments: minSegments },
      )
    }
    if (words.length < minWords) {
      throw new SmokeTestInvariantFailed(
        "min_words",
        `Word count ${words.length} is below floor ${minWords}`,
        { word_count: words.length, min_words: minWords },
      )
    }

    const durationMs = durationSeconds * 1000
    let totalMs = 0
    for (const s of segments) {
      totalMs += Math.max(0, s.end_ms - s.start_ms)
    }
    const coveragePct = Math.round((totalMs / durationMs) * 10000) / 100
    if (coveragePct < minCoveragePct) {
      throw new SmokeTestInvariantFailed(
        "low_coverage",
        `Coverage ${coveragePct}% is below floor ${minCoveragePct}%`,
        { coverage_pct: coveragePct, min_coverage_pct: minCoveragePct, duration_ms: durationMs },
      )
    }

    const summary: SmokeTestSummary = {
      video_id: videoId,
      segment_count: segments.length,
      word_count: words.length,
      coverage_pct: coveragePct,
      duration_ms: durationMs,
    }
    logger.info(JSON.stringify(summary))
    return { exitCode: 0, summary }
  } catch (err) {
    const errorLog = buildErrorLog(videoId, err)
    logger.error(JSON.stringify(errorLog))
    return { exitCode: 1, error: errorLog }
  }
}

function buildErrorLog(videoId: string, err: unknown): SmokeTestErrorLog {
  if (err instanceof SmokeTestInvariantFailed) {
    return {
      video_id: videoId,
      error_code: err.code,
      message: err.message,
      ...err.details,
    }
  }
  if (err instanceof CaptionError) {
    return {
      video_id: videoId,
      error_code: err.code,
      message: err.message,
    }
  }
  return {
    video_id: videoId,
    error_code: "unknown_error",
    message: err instanceof Error ? err.message : String(err),
  }
}
