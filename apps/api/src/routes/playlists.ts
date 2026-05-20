import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const playlistWithStatsSchema = z.object({
  slug: z.string(),
  title: z.string(),
  video_count: z.number(),
  total_views: z.number(),
})

const videoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  published_at: z.string(),
  duration_ms: z.number(),
  playlist_ids: z.array(z.string()),
})

const playlistsListResponseSchema = z.object({
  playlists: z.array(playlistWithStatsSchema),
})

const playlistVideosResponseSchema = z.object({
  playlist: playlistWithStatsSchema,
  videos: z.array(videoSchema),
  total: z.number(),
})

const playlistParamsSchema = z.object({ slug: z.string().min(1) })
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const playlistsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/playlists",
    {
      schema: {
        tags: ["playlists"],
        summary: "List all playlists with video counts",
        response: { 200: playlistsListResponseSchema },
      },
    },
    async () => {
      const rows = await app.db
        .selectFrom("playlists")
        .leftJoin("video_playlists", "video_playlists.playlist_id", "playlists.id")
        .select([
          "playlists.slug",
          "playlists.title",
          "playlists.total_views",
          app.db.fn.count<string>("video_playlists.video_id").as("video_count"),
        ])
        .groupBy(["playlists.id", "playlists.slug", "playlists.title", "playlists.total_views"])
        .orderBy(sql`playlists.total_views DESC NULLS LAST`)
        .orderBy("playlists.title", "asc")
        .execute()

      return {
        playlists: rows.map((r) => ({
          slug: r.slug,
          title: r.title,
          video_count: Number(r.video_count),
          total_views: r.total_views ? Number(r.total_views) : 0,
        })),
      }
    },
  )

  app.get(
    "/playlists/:slug/videos",
    {
      schema: {
        tags: ["playlists"],
        summary: "Get videos for a playlist",
        params: playlistParamsSchema,
        querystring: paginationSchema,
        response: {
          200: playlistVideosResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params
      const { limit, offset } = request.query

      const playlist = await app.db
        .selectFrom("playlists")
        .leftJoin("video_playlists", "video_playlists.playlist_id", "playlists.id")
        .select([
          "playlists.id",
          "playlists.slug",
          "playlists.title",
          "playlists.total_views",
          app.db.fn.count<string>("video_playlists.video_id").as("video_count"),
        ])
        .groupBy(["playlists.id", "playlists.slug", "playlists.title", "playlists.total_views"])
        .where("playlists.slug", "=", slug)
        .executeTakeFirst()

      if (!playlist) {
        return reply.code(404).send({ error: "playlist not found" })
      }

      const total = Number(
        (
          await app.db
            .selectFrom("video_playlists")
            .select(app.db.fn.countAll<string>().as("count"))
            .where("playlist_id", "=", playlist.id)
            .executeTakeFirstOrThrow()
        ).count,
      )

      const videoRows = await app.db
        .selectFrom("videos")
        .innerJoin("video_playlists", "video_playlists.video_id", "videos.id")
        .select([
          "videos.id",
          "videos.youtube_video_id",
          "videos.title",
          "videos.thumbnail_url",
          "videos.published_at",
          "videos.duration_seconds",
        ])
        .where("video_playlists.playlist_id", "=", playlist.id)
        .orderBy("videos.published_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute()

      const videoIds = videoRows.map((v) => v.id)

      const vpRows =
        videoIds.length > 0
          ? await app.db
              .selectFrom("video_playlists")
              .select(["video_id", "playlist_id"])
              .where("video_id", "in", videoIds)
              .execute()
          : []

      const playlistIdsMap = new Map<string, string[]>()
      for (const vp of vpRows) {
        const list = playlistIdsMap.get(vp.video_id) ?? []
        list.push(vp.playlist_id)
        playlistIdsMap.set(vp.video_id, list)
      }

      return {
        playlist: {
          slug: playlist.slug,
          title: playlist.title,
          video_count: total,
          total_views: playlist.total_views ? Number(playlist.total_views) : 0,
        },
        videos: videoRows.map((v) => ({
          id: v.youtube_video_id,
          title: v.title,
          thumbnail_url: v.thumbnail_url ?? "",
          published_at: v.published_at ? v.published_at.toISOString() : "",
          duration_ms: (v.duration_seconds ?? 0) * 1000,
          playlist_ids: playlistIdsMap.get(v.id) ?? [],
        })),
        total,
      }
    },
  )
}
