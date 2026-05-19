import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const topicSchema = z.object({
  slug: z.string(),
  label: z.string(),
  video_count: z.number(),
})

const videoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  published_at: z.string(),
  duration_ms: z.number(),
  playlist_ids: z.array(z.string()),
})

const topicsListResponseSchema = z.object({
  topics: z.array(topicSchema),
})

const topicVideosResponseSchema = z.object({
  topic: topicSchema,
  videos: z.array(videoSchema),
  total: z.number(),
})

const topicParamsSchema = z.object({ slug: z.string().min(1) })
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const topicsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/topics",
    {
      schema: {
        tags: ["topics"],
        summary: "List all topics with video counts",
        response: { 200: topicsListResponseSchema },
      },
    },
    async () => {
      const rows = await app.db
        .selectFrom("topics")
        .leftJoin("video_topics", "topics.id", "video_topics.topic_id")
        .select([
          "topics.id",
          "topics.slug",
          "topics.label",
          app.db.fn.count<string>("video_topics.video_id").as("video_count"),
        ])
        .groupBy(["topics.id", "topics.slug", "topics.label"])
        .orderBy(app.db.fn.count("video_topics.video_id"), "desc")
        .orderBy("topics.label", "asc")
        .execute()

      return {
        topics: rows.map((r) => ({
          slug: r.slug,
          label: r.label,
          video_count: Number(r.video_count),
        })),
      }
    },
  )

  app.get(
    "/topics/:slug",
    {
      schema: {
        tags: ["topics"],
        summary: "Get videos for a topic",
        params: topicParamsSchema,
        querystring: paginationSchema,
        response: {
          200: topicVideosResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params
      const { limit, offset } = request.query

      const topic = await app.db
        .selectFrom("topics")
        .select(["id", "slug", "label"])
        .where("slug", "=", slug)
        .executeTakeFirst()

      if (!topic) {
        return reply.code(404).send({ error: "topic not found" })
      }

      const total = Number(
        (
          await app.db
            .selectFrom("video_topics")
            .select(app.db.fn.countAll<string>().as("count"))
            .where("topic_id", "=", topic.id)
            .executeTakeFirstOrThrow()
        ).count,
      )

      const videoRows = await app.db
        .selectFrom("videos")
        .innerJoin("video_topics", "videos.id", "video_topics.video_id")
        .select([
          "videos.id",
          "videos.title",
          "videos.thumbnail_url",
          "videos.published_at",
          "videos.duration_seconds",
        ])
        .where("video_topics.topic_id", "=", topic.id)
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
        topic: {
          slug: topic.slug,
          label: topic.label,
          video_count: total,
        },
        videos: videoRows.map((v) => ({
          id: v.id,
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
