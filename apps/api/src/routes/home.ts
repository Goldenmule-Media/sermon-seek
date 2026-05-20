import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const STRIP_SIZE = 12
const TOP_PLAYLISTS = 3

const videoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  published_at: z.string(),
  duration_ms: z.number(),
  playlist_ids: z.array(z.string()),
})

const playlistWithStatsSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  video_count: z.number(),
  total_views: z.number(),
})

const homeResponseSchema = z.object({
  recent: z.array(videoSchema),
  top_playlists: z.array(
    z.object({
      playlist: playlistWithStatsSchema,
      videos: z.array(videoSchema),
    }),
  ),
})

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/home",
    {
      schema: {
        tags: ["home"],
        summary: "Landing-page aggregate data",
        description: "Returns recent videos and top playlists for the landing page.",
        response: { 200: homeResponseSchema },
      },
    },
    async () => {
      const db = app.db

      const recentRows = await db
        .selectFrom("videos")
        .select([
          "id",
          "youtube_video_id",
          "title",
          "thumbnail_url",
          "published_at",
          "duration_seconds",
        ])
        .where("published_at", "is not", null)
        .orderBy("published_at", "desc")
        .limit(STRIP_SIZE)
        .execute()

      const topPlaylistRows = await db
        .selectFrom("playlists")
        .select(["id", "slug", "title", "total_views", "video_count"])
        .orderBy(sql`total_views DESC NULLS LAST`)
        .limit(TOP_PLAYLISTS)
        .execute()

      const playlistVideoRows = await Promise.all(
        topPlaylistRows.map((p) =>
          db
            .selectFrom("videos")
            .innerJoin("video_playlists", "videos.id", "video_playlists.video_id")
            .select([
              "videos.id",
              "videos.youtube_video_id",
              "videos.title",
              "videos.thumbnail_url",
              "videos.published_at",
              "videos.duration_seconds",
            ])
            .where("video_playlists.playlist_id", "=", p.id)
            .orderBy("videos.published_at", "desc")
            .limit(STRIP_SIZE)
            .execute(),
        ),
      )

      const allVideoIds = [
        ...recentRows.map((v) => v.id),
        ...playlistVideoRows.flat().map((v) => v.id),
      ]
      const uniqueVideoIds = [...new Set(allVideoIds)]

      const vpRows =
        uniqueVideoIds.length > 0
          ? await db
              .selectFrom("video_playlists")
              .select(["video_id", "playlist_id"])
              .where("video_id", "in", uniqueVideoIds)
              .execute()
          : []

      const playlistIdsMap = new Map<string, string[]>()
      for (const vp of vpRows) {
        const list = playlistIdsMap.get(vp.video_id) ?? []
        list.push(vp.playlist_id)
        playlistIdsMap.set(vp.video_id, list)
      }

      type VideoRow = {
        id: string
        youtube_video_id: string
        title: string
        thumbnail_url: string | null
        published_at: Date | null
        duration_seconds: number | null
      }

      const toVideo = (row: VideoRow) => ({
        id: row.youtube_video_id,
        title: row.title,
        thumbnail_url: row.thumbnail_url ?? "",
        published_at: row.published_at ? row.published_at.toISOString() : "",
        duration_ms: (row.duration_seconds ?? 0) * 1000,
        playlist_ids: playlistIdsMap.get(row.id) ?? [],
      })

      return {
        recent: recentRows.map(toVideo),
        top_playlists: topPlaylistRows.map((p, i) => ({
          playlist: {
            id: p.id,
            slug: p.slug,
            title: p.title,
            video_count: p.video_count ?? 0,
            total_views: p.total_views ? Number(p.total_views) : 0,
          },
          videos: (playlistVideoRows[i] ?? []).map(toVideo),
        })),
      }
    },
  )
}
