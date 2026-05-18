import { readFile } from "node:fs/promises"
import type { Database } from "@sermon-search/db"
import type { Kysely, Transaction } from "kysely"
import { CaptionsUnavailable, fetchCaptions, parseVtt } from "../captions/index.js"
import type { Segment, Spawner, Word } from "../captions/index.js"
import { YT_DLP_VERSION } from "../captions/version.js"
import type { YoutubeClient } from "../youtube/client.js"
import { ensureVideoMetadata } from "./video.js"

export interface IngestVideoTranscriptOptions {
  db: Kysely<Database>
  client: YoutubeClient
  youtubeVideoId: string
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

const MIN_COVERAGE_RATIO = 0.9

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
  words: readonly Word[]
  durationSeconds: number | null
}

export function assertTranscriptQuality(input: AssertTranscriptQualityInput): void {
  const { segments, words, durationSeconds } = input

  if (durationSeconds != null && durationSeconds > 0) {
    let totalMs = 0
    for (const s of segments) {
      totalMs += Math.max(0, s.end_ms - s.start_ms)
    }
    const requiredMs = durationSeconds * 1000 * MIN_COVERAGE_RATIO
    if (totalMs < requiredMs) {
      throw new TranscriptQualityError(
        "low_coverage",
        `Transcript covers ${totalMs}ms of audio but video duration is ${
          durationSeconds * 1000
        }ms; below the ${MIN_COVERAGE_RATIO * 100}% threshold (${requiredMs}ms required).`,
      )
    }
  }

  const segmentForWord = mapWordsToSegments(segments, words)
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word
    const segIdx = segmentForWord[i]
    if (segIdx === undefined) {
      throw new TranscriptQualityError(
        "word_out_of_range",
        `Word at position ${w.position} (start_ms=${w.start_ms}) has no containing segment.`,
      )
    }
    const seg = segments[segIdx] as Segment
    if (w.start_ms < seg.start_ms || w.start_ms > seg.end_ms) {
      throw new TranscriptQualityError(
        "word_out_of_range",
        `Word at position ${w.position} has start_ms=${w.start_ms}, outside segment range [${seg.start_ms}, ${seg.end_ms}].`,
      )
    }
  }
}

function mapWordsToSegments(
  segments: readonly Segment[],
  words: readonly Word[],
): readonly (number | undefined)[] {
  const out: (number | undefined)[] = new Array(words.length)
  if (segments.length === 0) return out
  let segIdx = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word
    while (
      segIdx + 1 < segments.length &&
      w.start_ms >= (segments[segIdx + 1] as Segment).start_ms
    ) {
      segIdx += 1
    }
    out[i] = segIdx
  }
  return out
}

export async function ingestVideoTranscript(
  opts: IngestVideoTranscriptOptions,
): Promise<IngestVideoTranscriptResult> {
  const { db, client, youtubeVideoId, spawner, ytDlpBin } = opts

  const { videoDbId, durationSeconds } = await ensureVideoMetadata({
    db,
    client,
    youtubeVideoId,
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
      return { status: "no_captions", videoDbId }
    }
    throw err
  }

  const raw = await readFile(vttPath, "utf8")
  const { segments, words } = parseVtt(raw)

  assertTranscriptQuality({ segments, words, durationSeconds })

  const segmentForWord = mapWordsToSegments(segments, words)
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

    const wordRows = words.map((w, i) => {
      const segIdx = segmentForWord[i] as number
      const segmentId = segmentIds[segIdx] as string
      return {
        transcript_id: transcriptId,
        segment_id: segmentId,
        video_id: videoDbId,
        start_ms: w.start_ms,
        end_ms: w.end_ms,
        text: w.text,
        position: w.position,
      }
    })

    if (wordRows.length > 0) {
      await trx.insertInto("transcript_words").values(wordRows).execute()
    }

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
