import type { Database } from "@sermon-search/db"
import type { Kysely, Transaction } from "kysely"
import {
  getChannelMetadata,
  getChannelPlaylists,
  getPlaylistItems,
  getVideosBatched,
} from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import {
  type YoutubePlaylist,
  type YoutubePlaylistItem,
  type YoutubeVideo,
  pickThumbnailUrl,
} from "../youtube/types.js"
import { iso8601DurationToSeconds } from "./duration.js"
import { resolveChannel } from "./handle.js"
import { uniqueSlugForPlaylist } from "./slug.js"

export interface IngestChannelOptions {
  db: Kysely<Database>
  client: YoutubeClient
  handleOrId: string
  force?: boolean
}

export interface IngestChannelSummary {
  channelId: string
  youtubeChannelId: string
  playlistCount: number
  videoCount: number
}

export async function ingestChannel(opts: IngestChannelOptions): Promise<IngestChannelSummary> {
  const { db, client, handleOrId, force } = opts

  const resolved = await resolveChannel(client, handleOrId)
  const { channel } = await getChannelMetadata(client, resolved.youtubeChannelId, { force })
  const channelTitle = channel.snippet?.title ?? resolved.title

  const channelRow = await db
    .insertInto("channels")
    .values({
      youtube_channel_id: resolved.youtubeChannelId,
      title: channelTitle,
    })
    .onConflict((oc) => oc.column("youtube_channel_id").doUpdateSet({ title: channelTitle }))
    .returning(["id"])
    .executeTakeFirstOrThrow()

  const channelDbId = channelRow.id

  const { playlists } = await getChannelPlaylists(client, resolved.youtubeChannelId, { force })

  // Preload existing slugs for this channel so re-ingestion reuses them (sticky)
  // and new playlists can't collide with stored ones regardless of API ordering.
  const existingRows = await db
    .selectFrom("playlists")
    .select(["youtube_playlist_id", "slug"])
    .where("channel_id", "=", channelDbId)
    .execute()
  const existingSlugByPlaylistId = new Map<string, string>(
    existingRows.map((r) => [r.youtube_playlist_id, r.slug]),
  )
  const takenSlugs = new Set<string>(existingRows.map((r) => r.slug))

  // Capture YouTube-response positions before sorting.
  const positionByPlaylistId = new Map<string, number>(playlists.map((pl, i) => [pl.id, i]))

  // Sort by youtube_playlist_id for stable slug assignment across runs.
  const sortedPlaylists = [...playlists].sort((a, b) => a.id.localeCompare(b.id))

  const playlistDbIds = new Map<string, string>()
  for (const pl of sortedPlaylists) {
    const title = pl.snippet?.title ?? "(untitled playlist)"
    const position = positionByPlaylistId.get(pl.id) ?? 0

    // Reuse the stored slug when one exists; otherwise compute and record a new one.
    let slug = existingSlugByPlaylistId.get(pl.id)
    if (slug === undefined) {
      slug = uniqueSlugForPlaylist(title, pl.id, takenSlugs)
      takenSlugs.add(slug)
    }

    const playlistRow = await db
      .insertInto("playlists")
      .values({
        channel_id: channelDbId,
        youtube_playlist_id: pl.id,
        slug,
        title,
        description: pl.snippet?.description ?? null,
        position,
        video_count: pl.contentDetails?.itemCount ?? null,
      })
      .onConflict((oc) =>
        oc.column("youtube_playlist_id").doUpdateSet({
          channel_id: channelDbId,
          slug,
          title,
          description: pl.snippet?.description ?? null,
          position,
          video_count: pl.contentDetails?.itemCount ?? null,
        }),
      )
      .returning(["id"])
      .executeTakeFirstOrThrow()
    playlistDbIds.set(pl.id, playlistRow.id)
  }

  const videoFirstSeen = new Map<string, YoutubePlaylistItem>()
  const joinRows: Array<{ youtubeVideoId: string; youtubePlaylistId: string; position: number }> =
    []

  for (const pl of playlists) {
    const { items } = await getPlaylistItems(client, resolved.youtubeChannelId, pl.id, { force })
    for (const item of items) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      if (!videoId) continue
      const position = item.snippet?.position ?? 0
      joinRows.push({
        youtubeVideoId: videoId,
        youtubePlaylistId: pl.id,
        position,
      })
      if (!videoFirstSeen.has(videoId)) {
        videoFirstSeen.set(videoId, item)
      }
    }
  }

  await db.transaction().execute(async (trx) => {
    for (const [videoId, item] of videoFirstSeen) {
      await upsertVideoFromPlaylistItem(trx, channelDbId, videoId, item)
    }
    const youtubeVideoIds = Array.from(videoFirstSeen.keys())
    const videoDbIdByYoutubeId = new Map<string, string>()
    if (youtubeVideoIds.length > 0) {
      const rows = await trx
        .selectFrom("videos")
        .select(["id", "youtube_video_id"])
        .where("youtube_video_id", "in", youtubeVideoIds)
        .execute()
      for (const r of rows) {
        videoDbIdByYoutubeId.set(r.youtube_video_id, r.id)
      }
    }
    for (const row of joinRows) {
      const videoDbId = videoDbIdByYoutubeId.get(row.youtubeVideoId)
      const playlistDbId = playlistDbIds.get(row.youtubePlaylistId)
      if (!videoDbId || !playlistDbId) continue
      await trx
        .insertInto("video_playlists")
        .values({
          video_id: videoDbId,
          playlist_id: playlistDbId,
          position: row.position,
        })
        .onConflict((oc) =>
          oc.columns(["video_id", "playlist_id"]).doUpdateSet({ position: row.position }),
        )
        .execute()
    }
  })

  const allVideoIds = Array.from(videoFirstSeen.keys())
  const idsMissingDuration = await findVideosMissingDuration(db, allVideoIds)
  if (idsMissingDuration.length > 0) {
    const { videos } = await getVideosBatched(client, idsMissingDuration)
    await db.transaction().execute(async (trx) => {
      for (const id of idsMissingDuration) {
        const video = videos.get(id)
        if (!video) continue
        await updateVideoFromMetadata(trx, id, video)
      }
    })
  }

  return {
    channelId: channelDbId,
    youtubeChannelId: resolved.youtubeChannelId,
    playlistCount: playlists.length,
    videoCount: videoFirstSeen.size,
  }
}

async function upsertVideoFromPlaylistItem(
  trx: Transaction<Database>,
  channelDbId: string,
  videoId: string,
  item: YoutubePlaylistItem,
): Promise<void> {
  const title = item.snippet?.title ?? "(untitled)"
  const description = item.snippet?.description ?? null
  const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null
  const thumbnailUrl = pickThumbnailUrl(item.snippet?.thumbnails)

  await trx
    .insertInto("videos")
    .values({
      channel_id: channelDbId,
      youtube_video_id: videoId,
      title,
      description,
      published_at: publishedAt,
      thumbnail_url: thumbnailUrl,
    })
    .onConflict((oc) =>
      oc.column("youtube_video_id").doUpdateSet({
        title,
        description,
        published_at: publishedAt,
        thumbnail_url: thumbnailUrl,
      }),
    )
    .execute()
}

async function updateVideoFromMetadata(
  trx: Transaction<Database>,
  videoId: string,
  video: YoutubeVideo,
): Promise<void> {
  const title = video.snippet?.title ?? "(untitled)"
  const description = video.snippet?.description ?? null
  const publishedAt = video.snippet?.publishedAt ?? null
  const thumbnailUrl = pickThumbnailUrl(video.snippet?.thumbnails)
  const durationSeconds = video.contentDetails?.duration
    ? iso8601DurationToSeconds(video.contentDetails.duration)
    : null

  await trx
    .updateTable("videos")
    .set({
      title,
      description,
      published_at: publishedAt,
      thumbnail_url: thumbnailUrl,
      duration_seconds: durationSeconds,
    })
    .where("youtube_video_id", "=", videoId)
    .execute()
}

async function findVideosMissingDuration(
  db: Kysely<Database>,
  youtubeVideoIds: readonly string[],
): Promise<string[]> {
  if (youtubeVideoIds.length === 0) return []
  const rows = await db
    .selectFrom("videos")
    .select(["youtube_video_id"])
    .where("youtube_video_id", "in", youtubeVideoIds as string[])
    .where("duration_seconds", "is", null)
    .execute()
  return rows.map((r) => r.youtube_video_id)
}
