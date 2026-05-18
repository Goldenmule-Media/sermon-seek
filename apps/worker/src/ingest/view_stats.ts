import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { getChannelPlaylists, getPlaylistItems, getVideosBatched } from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import type { YoutubeVideo } from "../youtube/types.js"

export interface RunViewStatsOptions {
  db: Kysely<Database>
  client: YoutubeClient
}

export interface RunViewStatsSummary {
  channelCount: number
  playlistCount: number
  videoCount: number
  fetchedFromApi: number
}

function parseViewCount(video: YoutubeVideo): string | null {
  const raw = video.statistics?.viewCount
  if (raw === undefined || raw === null || raw === "") return null
  if (!/^\d+$/.test(raw)) return null
  return raw
}

export async function runViewStats(opts: RunViewStatsOptions): Promise<RunViewStatsSummary> {
  const { db, client } = opts

  const channels = await db.selectFrom("channels").select(["id", "youtube_channel_id"]).execute()

  let playlistCount = 0
  let videoCount = 0
  let fetchedFromApi = 0

  for (const channel of channels) {
    const { playlists: ytPlaylists } = await getChannelPlaylists(client, channel.youtube_channel_id)
    const knownPlaylistIds = new Set(ytPlaylists.map((p) => p.id))

    const dbPlaylists = await db
      .selectFrom("playlists")
      .select(["id", "youtube_playlist_id"])
      .where("channel_id", "=", channel.id)
      .execute()

    const memberIdsByPlaylistDbId = new Map<string, string[]>()
    const allVideoIds = new Set<string>()

    for (const playlist of dbPlaylists) {
      if (!knownPlaylistIds.has(playlist.youtube_playlist_id)) {
        console.warn(
          `[view-stats] playlist ${playlist.youtube_playlist_id} not present in YouTube cache for channel ${channel.youtube_channel_id} — skipping membership refresh`,
        )
        memberIdsByPlaylistDbId.set(playlist.id, [])
        continue
      }
      const { items } = await getPlaylistItems(
        client,
        channel.youtube_channel_id,
        playlist.youtube_playlist_id,
      )
      const memberIds: string[] = []
      for (const item of items) {
        const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
        if (!id) continue
        memberIds.push(id)
        allVideoIds.add(id)
      }
      memberIdsByPlaylistDbId.set(playlist.id, memberIds)
    }

    const videoIdList = Array.from(allVideoIds)
    const { videos, fetchedIds } = await getVideosBatched(client, videoIdList, { force: true })
    fetchedFromApi += fetchedIds.length

    for (const playlist of dbPlaylists) {
      const memberYoutubeIds = memberIdsByPlaylistDbId.get(playlist.id) ?? []
      await db.transaction().execute(async (trx) => {
        if (memberYoutubeIds.length > 0) {
          const rows = await trx
            .selectFrom("videos")
            .select(["id", "youtube_video_id"])
            .where("youtube_video_id", "in", memberYoutubeIds)
            .execute()
          const dbIdByYoutubeId = new Map(rows.map((r) => [r.youtube_video_id, r.id]))

          for (const youtubeId of memberYoutubeIds) {
            const videoDbId = dbIdByYoutubeId.get(youtubeId)
            if (!videoDbId) continue
            const meta = videos.get(youtubeId)
            const count = meta ? parseViewCount(meta) : null
            await trx
              .updateTable("videos")
              .set({
                view_count: count,
                view_count_updated_at: sql<Date>`now()`,
              })
              .where("id", "=", videoDbId)
              .execute()
          }
        }

        const aggregate = await trx
          .selectFrom("videos as v")
          .innerJoin("video_playlists as vp", "vp.video_id", "v.id")
          .where("vp.playlist_id", "=", playlist.id)
          .select((eb) => [
            eb.fn.coalesce(eb.fn.sum<string>("v.view_count"), sql<string>`0`).as("total_views"),
            eb.fn.countAll<string>().as("video_count"),
          ])
          .executeTakeFirstOrThrow()

        await trx
          .updateTable("playlists")
          .set({
            total_views: aggregate.total_views,
            video_count: Number(aggregate.video_count),
            stats_updated_at: sql<Date>`now()`,
          })
          .where("id", "=", playlist.id)
          .execute()
      })
      playlistCount += 1
    }

    videoCount += videoIdList.length
  }

  return {
    channelCount: channels.length,
    playlistCount,
    videoCount,
    fetchedFromApi,
  }
}
