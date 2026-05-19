import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import type { Spawner } from "../captions/index.js"
import type { YoutubeClient } from "../youtube/client.js"
import { ingestVideoTranscript } from "./transcript.js"

export interface TranscriptsBackfillOptions {
  db: Kysely<Database>
  client: YoutubeClient
  log?: (msg: string) => void
  spawner?: Spawner
  ytDlpBin?: string
}

export interface TranscriptsBackfillResult {
  videosProcessed: number
  videosSkipped: number
  videosNoCaptions: number
  videosFailed: number
}

export async function runTranscriptsBackfill({
  db,
  client,
  log = () => {},
  spawner,
  ytDlpBin,
}: TranscriptsBackfillOptions): Promise<TranscriptsBackfillResult> {
  const totals: TranscriptsBackfillResult = {
    videosProcessed: 0,
    videosSkipped: 0,
    videosNoCaptions: 0,
    videosFailed: 0,
  }

  const videos = await db.selectFrom("videos").select(["id", "youtube_video_id"]).execute()

  for (const video of videos) {
    try {
      const result = await ingestVideoTranscript({
        db,
        client,
        youtubeVideoId: video.youtube_video_id,
        spawner,
        ytDlpBin,
      })
      if (result.status === "skipped") {
        log(`skip ${video.youtube_video_id}: already transcribed`)
        totals.videosSkipped++
      } else if (result.status === "no_captions") {
        log(`no captions ${video.youtube_video_id}`)
        totals.videosNoCaptions++
      } else {
        log(
          `done ${video.youtube_video_id}: ${result.segmentCount} segments, ${result.wordCount} words`,
        )
        totals.videosProcessed++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`fail ${video.youtube_video_id}: ${message}`)
      totals.videosFailed++
    }
  }

  return totals
}
