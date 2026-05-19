import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { searchSegments } from "../search/fts.js"

const querySchema = z.object({
  q: z.string().min(1).max(200),
  mode: z.enum(["fulltext"]).default("fulltext"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  topic: z.string().optional(),
  playlist: z.string().optional(),
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

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Full-text corpus search",
        querystring: querySchema,
        response: { 200: searchResponseSchema },
      },
    },
    async (request) => {
      const { q, limit, offset } = request.query
      const t0 = Date.now()
      const { results, total } = await searchSegments(app.db, { q, limit, offset })
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
