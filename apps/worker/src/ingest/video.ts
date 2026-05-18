import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { getChannelMetadata, getVideosBatched } from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import { pickThumbnailUrl } from "../youtube/types.js"
import { iso8601DurationToSeconds } from "./duration.js"

export interface EnsureVideoMetadataOptions {
  db: Kysely<Database>
  client: YoutubeClient
  youtubeVideoId: string
}

export interface EnsureVideoMetadataResult {
  channelDbId: string
  videoDbId: string
  durationSeconds: number | null
}

export async function ensureVideoMetadata(
  opts: EnsureVideoMetadataOptions,
): Promise<EnsureVideoMetadataResult> {
  const { db, client, youtubeVideoId } = opts

  const { videos } = await getVideosBatched(client, [youtubeVideoId])
  const video = videos.get(youtubeVideoId)
  if (!video) {
    throw new Error(`YouTube returned no video for id: ${youtubeVideoId}`)
  }

  const youtubeChannelId = video.snippet?.channelId
  if (!youtubeChannelId) {
    throw new Error(`Video ${youtubeVideoId} is missing snippet.channelId`)
  }

  const { channel } = await getChannelMetadata(client, youtubeChannelId)
  const channelTitle = channel.snippet?.title ?? "(untitled channel)"

  const channelRow = await db
    .insertInto("channels")
    .values({
      youtube_channel_id: youtubeChannelId,
      title: channelTitle,
    })
    .onConflict((oc) => oc.column("youtube_channel_id").doUpdateSet({ title: channelTitle }))
    .returning(["id"])
    .executeTakeFirstOrThrow()

  const channelDbId = channelRow.id

  const title = video.snippet?.title ?? "(untitled)"
  const description = video.snippet?.description ?? null
  const publishedAt = video.snippet?.publishedAt ?? null
  const thumbnailUrl = pickThumbnailUrl(video.snippet?.thumbnails)
  const durationSeconds = video.contentDetails?.duration
    ? iso8601DurationToSeconds(video.contentDetails.duration)
    : null

  const videoRow = await db
    .insertInto("videos")
    .values({
      channel_id: channelDbId,
      youtube_video_id: youtubeVideoId,
      title,
      description,
      published_at: publishedAt,
      thumbnail_url: thumbnailUrl,
      duration_seconds: durationSeconds,
    })
    .onConflict((oc) =>
      oc.column("youtube_video_id").doUpdateSet({
        channel_id: channelDbId,
        title,
        description,
        published_at: publishedAt,
        thumbnail_url: thumbnailUrl,
        duration_seconds: durationSeconds,
      }),
    )
    .returning(["id"])
    .executeTakeFirstOrThrow()

  return {
    channelDbId,
    videoDbId: videoRow.id,
    durationSeconds,
  }
}
