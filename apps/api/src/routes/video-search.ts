import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { searchSegments } from "../search/fts.js"
import { hydrateScriptureRefs } from "../search/hydrate-refs.js"
import { refineSegmentStarts } from "../search/refine.js"

const paramsSchema = z.object({
  id: z.string().min(1),
})

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const scriptureRefDetailSchema = z.object({
  book_id: z.number(),
  chapter_start: z.number(),
  verse_start: z.number(),
  chapter_end: z.number(),
  verse_end: z.number(),
  start_coord: z.number(),
  end_coord: z.number(),
  occurrences: z.number(),
  display: z.string(),
})

const searchHitSchema = z.object({
  snippet: z.string(),
  start_ms: z.number(),
  score: z.number(),
})

const searchResultSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  score: z.number(),
  hits: z.array(searchHitSchema),
  scripture_refs: z.array(scriptureRefDetailSchema),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number(),
  took_ms: z.number(),
  scripture_refs: z.array(scriptureRefDetailSchema),
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
      const { results: rawResults, total } = await searchSegments(app.db, { q, videoId: id, limit, offset })
      const refined = await refineSegmentStarts(app.db, q, rawResults)
      const refs = await hydrateScriptureRefs(app.db, [id])
      const videoRefs = refs.perVideo.get(id) ?? []

      if (refined.length === 0) {
        return {
          results: [],
          total,
          took_ms: Date.now() - t0,
          scripture_refs: refs.aggregate,
        }
      }

      const head = refined[0]!
      const aggScore = refined.reduce((acc, r) => acc + r.score, 0)
      return {
        results: [
          {
            video_id: head.youtube_video_id,
            title: head.title,
            thumbnail_url: head.thumbnail_url ?? "",
            score: aggScore,
            hits: refined.map((r) => ({
              snippet: r.snippet,
              start_ms: r.start_ms,
              score: r.score,
            })),
            scripture_refs: videoRefs,
          },
        ],
        total,
        took_ms: Date.now() - t0,
        scripture_refs: refs.aggregate,
      }
    },
  )
}
