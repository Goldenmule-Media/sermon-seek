import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { searchSegments } from "../search/fts.js"
import { searchHybrid } from "../search/hybrid.js"
import { searchSemantic } from "../search/semantic.js"

const querySchema = z.object({
  q: z.string().min(1).max(200),
  mode: z.enum(["fulltext", "semantic", "hybrid"]).default("hybrid"),
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
        summary: "Hybrid (default), full-text, and semantic corpus search",
        querystring: querySchema,
        response: {
          200: searchResponseSchema,
          503: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { q, mode, limit, offset } = request.query
      const t0 = Date.now()

      if (mode === "semantic") {
        if (!app.embedder) {
          return reply.code(503).send({ message: "OPENAI_API_KEY is not configured" } as never)
        }
        const { results, total } = await searchSemantic(app.db, app.embedder, { q, limit, offset })
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
      }

      if (mode === "hybrid") {
        const { results, total } = await searchHybrid(app.db, app.embedder, { q, limit, offset })
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
      }

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
