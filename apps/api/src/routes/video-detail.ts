import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const paramsSchema = z.object({
  id: z.string().min(1),
})

const playlistRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
})

const channelRefSchema = z.object({
  id: z.string(),
  title: z.string(),
})

const videoDetailResponseSchema = z.object({
  id: z.string(),
  youtube_video_id: z.string(),
  title: z.string(),
  channel: channelRefSchema,
  published_at: z.string(),
  duration_ms: z.number(),
  view_count: z.number(),
  thumbnail_url: z.string(),
  playlists: z.array(playlistRefSchema),
  summary: z.string(),
  topics: z.array(z.string()),
})

export const videoDetailRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/videos/:id",
    {
      schema: {
        tags: ["videos"],
        summary: "Get video metadata",
        params: paramsSchema,
        response: {
          200: videoDetailResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const videoRow = await app.db
        .selectFrom("videos")
        .innerJoin("channels", "videos.channel_id", "channels.id")
        .select([
          "videos.id",
          "videos.youtube_video_id",
          "videos.title",
          "videos.thumbnail_url",
          "videos.published_at",
          "videos.duration_seconds",
          "videos.view_count",
          "channels.id as channel_id",
          "channels.title as channel_title",
        ])
        .where("videos.youtube_video_id", "=", id)
        .executeTakeFirst()

      if (!videoRow) {
        return reply.code(404).send({ error: "video not found" })
      }

      const playlistRows = await app.db
        .selectFrom("playlists")
        .innerJoin("video_playlists", "playlists.id", "video_playlists.playlist_id")
        .select(["playlists.id", "playlists.slug", "playlists.title"])
        .where("video_playlists.video_id", "=", videoRow.id)
        .execute()

      return {
        id: videoRow.id,
        youtube_video_id: videoRow.youtube_video_id,
        title: videoRow.title,
        channel: {
          id: videoRow.channel_id,
          title: videoRow.channel_title,
        },
        published_at: videoRow.published_at ? videoRow.published_at.toISOString() : "",
        duration_ms: (videoRow.duration_seconds ?? 0) * 1000,
        view_count: videoRow.view_count ? Number(videoRow.view_count) : 0,
        thumbnail_url: videoRow.thumbnail_url ?? "",
        playlists: playlistRows,
        summary: "",
        topics: [],
      }
    },
  )
}
