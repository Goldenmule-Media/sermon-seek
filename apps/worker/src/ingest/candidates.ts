import type { Database, IngestionRequestMode } from "@sermon-search/db"
import type { Kysely } from "kysely"

/**
 * How many times an incremental re-ingest retries a video YouTube served no
 * captions for. Auto-captions can land hours after upload, so a fresh video
 * gets several chances across successive runs before it is treated as
 * permanently captionless. A full re-ingest ignores the marker entirely.
 */
export const CAPTIONLESS_MAX_ATTEMPTS = 3

export interface IngestCandidate {
  id: string
  youtube_video_id: string
  title: string
}

export interface LoadIngestCandidatesOptions {
  db: Kysely<Database>
  churchId: string
  /** YouTube ids discovered by this run's playlist enumeration. */
  youtubeVideoIds: readonly string[]
  mode: IngestionRequestMode
}

/**
 * The videos a pipeline run should process, newest first.
 *
 * `full` returns everything the run discovered; the per-video stages are all
 * idempotent, so a full run re-checks work that is already done.
 *
 * `incremental` narrows to videos that have no transcript yet. That is
 * "everything since the last ingest" expressed without a published_at
 * watermark — no clock to get wrong, and it also picks up videos an earlier
 * run missed. Videos that have come back captionless too many times are
 * dropped so a run does not spend a yt-dlp spawn on each of them every time.
 */
export async function loadIngestCandidates({
  db,
  churchId,
  youtubeVideoIds,
  mode,
}: LoadIngestCandidatesOptions): Promise<IngestCandidate[]> {
  if (youtubeVideoIds.length === 0) return []

  let query = db
    .selectFrom("videos")
    .select(["id", "youtube_video_id", "title"])
    .where("church_id", "=", churchId)
    .where("youtube_video_id", "in", [...youtubeVideoIds])

  if (mode === "incremental") {
    query = query
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("transcripts")
              .select("transcripts.id")
              .whereRef("transcripts.video_id", "=", "videos.id"),
          ),
        ),
      )
      .where("captions_attempts", "<", CAPTIONLESS_MAX_ATTEMPTS)
  }

  return query.orderBy("published_at", "desc").execute()
}
