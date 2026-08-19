import { readFile } from "node:fs/promises"
import type { Database } from "@sermon-search/db"
import { type Kysely, type Transaction, sql } from "kysely"
import { CaptionsUnavailable, fetchCaptions, parseVtt } from "../captions/index.js"
import type { Segment, Spawner } from "../captions/index.js"
import { YT_DLP_VERSION } from "../captions/version.js"
import type { YoutubeClient } from "../youtube/client.js"
import { ensureVideoMetadata } from "./video.js"

export interface IngestVideoTranscriptOptions {
  db: Kysely<Database>
  client: YoutubeClient
  youtubeVideoId: string
  churchId: string
  spawner?: Spawner
  ytDlpBin?: string
}

export type IngestVideoTranscriptResult =
  | {
      status: "ok"
      videoDbId: string
      transcriptId: string
      segmentCount: number
      wordCount: number
    }
  | {
      status: "skipped"
      videoDbId: string
      transcriptId: string
    }
  | {
      status: "no_captions"
      videoDbId: string
    }

// Minimum fraction of the video's runtime that spoken caption segments must
// cover. Worship-service videos contain long non-speech spans (music, singing,
// silence) that auto-captions never transcribe, so a *complete* transcript can
// legitimately cover only ~70% of the runtime. The default is deliberately
// permissive; raise it per-deployment via TRANSCRIPT_MIN_COVERAGE (a 0–1
// fraction) without a code change. Invalid/out-of-range values fall back to the
// default rather than failing ingestion.
const DEFAULT_MIN_COVERAGE_RATIO = 0.5

function resolveMinCoverageRatio(): number {
  const raw = process.env.TRANSCRIPT_MIN_COVERAGE
  if (raw === undefined || raw.trim() === "") return DEFAULT_MIN_COVERAGE_RATIO
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_MIN_COVERAGE_RATIO
  return parsed
}

export class TranscriptQualityError extends Error {
  readonly reason: "low_coverage" | "word_out_of_range"
  constructor(reason: "low_coverage" | "word_out_of_range", message: string) {
    super(message)
    this.name = "TranscriptQualityError"
    this.reason = reason
  }
}

export interface AssertTranscriptQualityInput {
  segments: readonly Segment[]
  durationSeconds: number | null
}

export function assertTranscriptQuality(input: AssertTranscriptQualityInput): void {
  const { segments, durationSeconds } = input

  if (durationSeconds != null && durationSeconds > 0) {
    let totalMs = 0
    for (const s of segments) {
      totalMs += Math.max(0, s.end_ms - s.start_ms)
    }
    const minRatio = resolveMinCoverageRatio()
    const requiredMs = durationSeconds * 1000 * minRatio
    if (totalMs < requiredMs) {
      throw new TranscriptQualityError(
        "low_coverage",
        `Transcript covers ${totalMs}ms of audio but video duration is ${
          durationSeconds * 1000
        }ms; below the ${minRatio * 100}% threshold (${requiredMs}ms required).`,
      )
    }
  }

  for (const seg of segments) {
    for (const w of seg.words) {
      if (w.start_ms < seg.start_ms) {
        throw new TranscriptQualityError(
          "word_out_of_range",
          `Word at position ${w.position} (start_ms=${w.start_ms}) is before its segment start (${seg.start_ms}).`,
        )
      }
    }
  }
}

export async function ingestVideoTranscript(
  opts: IngestVideoTranscriptOptions,
): Promise<IngestVideoTranscriptResult> {
  const { db, client, youtubeVideoId, churchId, spawner, ytDlpBin } = opts

  const { videoDbId, durationSeconds } = await ensureVideoMetadata({
    db,
    client,
    youtubeVideoId,
    churchId,
  })

  const existing = await db
    .selectFrom("transcripts")
    .select(["id"])
    .where("video_id", "=", videoDbId)
    .where("source", "=", "youtube_public")
    .where("model_version", "=", YT_DLP_VERSION)
    .executeTakeFirst()

  if (existing) {
    return {
      status: "skipped",
      videoDbId,
      transcriptId: existing.id,
    }
  }

  let vttPath: string
  try {
    const fetched = await fetchCaptions({ videoId: youtubeVideoId, spawner, ytDlpBin })
    vttPath = fetched.vttPath
  } catch (err) {
    if (err instanceof CaptionsUnavailable) {
      console.warn(
        `[transcript] captions unavailable for video ${youtubeVideoId}; skipping transcript insert`,
      )
      await recordCaptionsUnavailable(db, videoDbId)
      return { status: "no_captions", videoDbId }
    }
    throw err
  }

  const raw = await readFile(vttPath, "utf8")
  const { segments, words } = parseVtt(raw)

  assertTranscriptQuality({ segments, durationSeconds })

  const fullText = segments.map((s) => s.text).join(" ")

  const inserted = await db.transaction().execute(async (trx) => {
    const transcript = await trx
      .insertInto("transcripts")
      .values({
        video_id: videoDbId,
        source: "youtube_public",
        language: "en",
        model_version: YT_DLP_VERSION,
        full_text: fullText,
        raw_vtt: raw,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    const transcriptId = transcript.id

    const segmentIds = await insertSegments(trx, transcriptId, videoDbId, segments)

    const wordRows: {
      transcript_id: string
      segment_id: string
      video_id: string
      start_ms: number
      end_ms: number
      text: string
      position: number
    }[] = []
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx] as Segment
      const segmentId = segmentIds[segIdx] as string
      for (const w of seg.words) {
        wordRows.push({
          transcript_id: transcriptId,
          segment_id: segmentId,
          video_id: videoDbId,
          start_ms: w.start_ms,
          end_ms: w.end_ms,
          text: w.text,
          position: w.position,
        })
      }
    }

    // Postgres caps bound parameters at 65535. transcript_words has 7
    // inserted columns, so we batch to stay under that ceiling.
    const WORD_BATCH = 8000
    for (let i = 0; i < wordRows.length; i += WORD_BATCH) {
      const batch = wordRows.slice(i, i + WORD_BATCH)
      await trx.insertInto("transcript_words").values(batch).execute()
    }

    // A video that previously had no captions may have gained them since. Clear
    // the marker so it stops being treated as captionless.
    await trx
      .updateTable("videos")
      .set({ captions_unavailable_at: null, captions_attempts: 0 })
      .where("id", "=", videoDbId)
      .execute()

    return { transcriptId, segmentCount: segments.length, wordCount: words.length }
  })

  return {
    status: "ok",
    videoDbId,
    transcriptId: inserted.transcriptId,
    segmentCount: inserted.segmentCount,
    wordCount: inserted.wordCount,
  }
}

/**
 * Record that YouTube served no captions for this video. `captions_attempts`
 * bounds how many times an incremental re-ingest retries: auto-captions can
 * appear hours after upload, so a fresh video deserves a few attempts, but a
 * video that has come back empty repeatedly should stop costing a yt-dlp spawn
 * on every run. A full re-ingest ignores the marker and always retries.
 */
async function recordCaptionsUnavailable(db: Kysely<Database>, videoDbId: string): Promise<void> {
  await db
    .updateTable("videos")
    .set({
      captions_unavailable_at: sql`now()`,
      captions_attempts: sql`captions_attempts + 1`,
    })
    .where("id", "=", videoDbId)
    .execute()
}

async function insertSegments(
  trx: Transaction<Database>,
  transcriptId: string,
  videoDbId: string,
  segments: readonly Segment[],
): Promise<string[]> {
  if (segments.length === 0) return []
  const rows = segments.map((s) => ({
    transcript_id: transcriptId,
    video_id: videoDbId,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text,
  }))
  // Insert in order; rely on Postgres returning rows in insertion order for this single statement.
  const returned = await trx
    .insertInto("transcript_segments")
    .values(rows)
    .returning(["id"])
    .execute()
  return returned.map((r) => r.id)
}
