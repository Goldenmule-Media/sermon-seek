import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { searchSegments } from "../search/fts.js"

const paramsSchema = z.object({
  id: z.string().min(1),
})

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const searchResultSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  snippet: z.string(),
  start_ms: z.number(),
  score: z.number(),
  thumbnail_url: z.string(),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number(),
  took_ms: z.number(),
})

export const videoSearchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/videos/:id/search",
    {
      schema: {
        tags: ["search"],
        summary: "Full-text search within a single video",
        params: paramsSchema,
        querystring: querySchema,
        response: {
          200: searchResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { q, limit, offset } = request.query

      // Verify video exists by running a scoped search; if no rows at all and
      // no video record, return 404. We check by looking up the video directly.
      const videoRow = await app.db
        .selectFrom("videos")
        .select("id")
        .where("youtube_video_id", "=", id)
        .executeTakeFirst()

      if (!videoRow) {
        return reply.code(404).send({ error: "video not found" })
      }

      const t0 = Date.now()
      const { results, total } = await searchSegments(app.db, { q, videoId: id, limit, offset })

      return {
        results: results.map((r) => ({
          video_id: r.youtube_video_id,
          title: r.title,
          snippet: r.snippet,
          start_ms: r.start_ms,
          score: r.score,
          thumbnail_url: r.thumbnail_url ?? "",
        })),
        total,
        took_ms: Date.now() - t0,
      }
    },
  )
}
