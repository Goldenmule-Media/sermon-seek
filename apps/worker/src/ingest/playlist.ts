import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import {
  getChannelMetadata,
  getPlaylistById,
  getPlaylistItems,
} from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import { ingestVideoTranscript } from "./transcript.js"
import { uniqueSlugForPlaylist } from "./slug.js"

export interface IngestPlaylistOptions {
  db: Kysely<Database>
  client: YoutubeClient
  youtubePlaylistId: string
  churchId: string
}

export interface IngestPlaylistSummary {
  channelId: string
  youtubeChannelId: string
  playlistId: string
  youtubePlaylistId: string
  videoCount: number
  ingested: number
  skipped: number
  noCaptions: number
}

export async function ingestPlaylist(opts: IngestPlaylistOptions): Promise<IngestPlaylistSummary> {
  const { db, client, youtubePlaylistId, churchId } = opts

  const { playlist } = await getPlaylistById(client, youtubePlaylistId)
  const youtubeChannelId = playlist.snippet?.channelId
  if (!youtubeChannelId) {
    throw new Error(`Playlist ${youtubePlaylistId} has no channelId in snippet`)
  }

  const { channel } = await getChannelMetadata(client, youtubeChannelId)
  const channelTitle = channel.snippet?.title ?? youtubeChannelId

  const channelRow = await db
    .insertInto("channels")
    .values({
      church_id: churchId,
      youtube_channel_id: youtubeChannelId,
      title: channelTitle,
    })
    .onConflict((oc) =>
      oc.column("youtube_channel_id").doUpdateSet({ church_id: churchId, title: channelTitle }),
    )
    .returning(["id"])
    .executeTakeFirstOrThrow()

  const channelDbId = channelRow.id

  // Preload existing slugs so re-runs reuse the stored slug and can't collide.
  const existingRows = await db
    .selectFrom("playlists")
    .select(["youtube_playlist_id", "slug"])
    .where("channel_id", "=", channelDbId)
    .execute()
  const existingSlugByPlaylistId = new Map<string, string>(
    existingRows.map((r) => [r.youtube_playlist_id, r.slug]),
  )
  const takenSlugs = new Set<string>(existingRows.map((r) => r.slug))

  const title = playlist.snippet?.title ?? "(untitled playlist)"
  let slug = existingSlugByPlaylistId.get(youtubePlaylistId)
  if (slug === undefined) {
    slug = uniqueSlugForPlaylist(title, youtubePlaylistId, takenSlugs)
  }

  const playlistRow = await db
    .insertInto("playlists")
    .values({
      church_id: churchId,
      channel_id: channelDbId,
      youtube_playlist_id: youtubePlaylistId,
      slug,
      title,
      description: playlist.snippet?.description ?? null,
      position: 0,
      video_count: playlist.contentDetails?.itemCount ?? null,
    })
    .onConflict((oc) =>
      oc.column("youtube_playlist_id").doUpdateSet({
        church_id: churchId,
        channel_id: channelDbId,
        slug,
        title,
        description: playlist.snippet?.description ?? null,
        video_count: playlist.contentDetails?.itemCount ?? null,
      }),
    )
    .returning(["id"])
    .executeTakeFirstOrThrow()

  const playlistDbId = playlistRow.id

  const { items } = await getPlaylistItems(client, youtubeChannelId, youtubePlaylistId)

  const videoIds: Array<{ youtubeVideoId: string; position: number }> = []
  for (const item of items) {
    const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
    if (!videoId) continue
    videoIds.push({ youtubeVideoId: videoId, position: item.snippet?.position ?? 0 })
  }

  let ingested = 0
  let skipped = 0
  let noCaptions = 0

  const ingestedVideoDbIds: Array<{ videoDbId: string; position: number }> = []

  for (const { youtubeVideoId, position } of videoIds) {
    const result = await ingestVideoTranscript({ db, client, youtubeVideoId, churchId })
    if (result.status === "ok") ingested++
    else if (result.status === "skipped") skipped++
    else if (result.status === "no_captions") noCaptions++
    ingestedVideoDbIds.push({ videoDbId: result.videoDbId, position })
  }

  await db.transaction().execute(async (trx) => {
    for (const { videoDbId, position } of ingestedVideoDbIds) {
      await trx
        .insertInto("video_playlists")
        .values({
          video_id: videoDbId,
          playlist_id: playlistDbId,
          position,
        })
        .onConflict((oc) =>
          oc.columns(["video_id", "playlist_id"]).doUpdateSet({ position }),
        )
        .execute()
    }
  })

  return {
    channelId: channelDbId,
    youtubeChannelId,
    playlistId: playlistDbId,
    youtubePlaylistId,
    videoCount: videoIds.length,
    ingested,
    skipped,
    noCaptions,
  }
}
