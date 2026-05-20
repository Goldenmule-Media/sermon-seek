import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { BadRefError, parseRefQuery, searchVideosByRef } from "../search/by-ref.js"
import { searchSegments } from "../search/fts.js"
import { searchHybrid } from "../search/hybrid.js"
import { hydrateScriptureRefs } from "../search/hydrate-refs.js"
import { refineSegmentStarts } from "../search/refine.js"
import { searchSemantic } from "../search/semantic.js"

const querySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    ref: z.string().min(1).max(200).optional(),
    mode: z.enum(["fulltext", "semantic", "hybrid"]).default("hybrid"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    topic: z.string().optional(),
    playlist: z.string().optional(),
    date: z.enum(["year", "month"]).optional(),
  })
  .refine((data) => Boolean(data.q) !== Boolean(data.ref), {
    message: "exactly one of 'q' or 'ref' must be provided",
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

const searchResultSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  snippet: z.string(),
  start_ms: z.number(),
  score: z.number(),
  thumbnail_url: z.string(),
  scripture_refs: z.array(scriptureRefDetailSchema),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number(),
  took_ms: z.number(),
  scripture_refs: z.array(scriptureRefDetailSchema),
})

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/search",
    {
      schema: {
        tags: ["search"],
        summary: "Hybrid (default), full-text, semantic, and scripture-ref corpus search",
        querystring: querySchema,
        response: {
          200: searchResponseSchema,
          400: z.object({ message: z.string() }),
          503: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { q, ref, mode, limit, offset, topic, playlist, date } = request.query
      const t0 = Date.now()

      const topicSlug = topic || undefined
      const playlistSlug = playlist || undefined
      const publishedAfter =
        date === "month"
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : date === "year"
            ? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
            : undefined

      const respond = async (
        results: Array<{
          youtube_video_id: string
          title: string
          thumbnail_url: string | null
          start_ms: number
          score: number
          snippet: string
        }>,
        total: number,
      ) => {
        const ids = results.map((r) => r.youtube_video_id)
        const refs = await hydrateScriptureRefs(app.db, ids)
        return {
          results: results.map((r) => ({
            video_id: r.youtube_video_id,
            title: r.title,
            snippet: r.snippet,
            start_ms: r.start_ms,
            score: r.score,
            thumbnail_url: r.thumbnail_url ?? "",
            scripture_refs: refs.perVideo.get(r.youtube_video_id) ?? [],
          })),
          total,
          took_ms: Date.now() - t0,
          scripture_refs: refs.aggregate,
        }
      }

      if (ref) {
        let interval: { start_coord: number; end_coord: number }
        try {
          interval = parseRefQuery(ref)
        } catch (err) {
          if (err instanceof BadRefError) {
            return reply.code(400).send({ message: err.message } as never)
          }
          throw err
        }

        const { results: rawResults, total } = await searchVideosByRef(app.db, {
          startCoord: interval.start_coord,
          endCoord: interval.end_coord,
          rawQuery: ref,
          limit,
          offset,
          topicSlug,
          playlistSlug,
          publishedAfter,
        })
        const ftsShape = rawResults.map((r) => ({
          youtube_video_id: r.youtube_video_id,
          title: r.title,
          thumbnail_url: r.thumbnail_url,
          start_ms: r.start_ms,
          end_ms: r.end_ms,
          score: r.ref_score,
          snippet: r.snippet,
        }))
        const refined = await refineSegmentStarts(app.db, ref, ftsShape)
        return respond(refined, total)
      }

      // q is guaranteed present when ref is absent (enforced by refine above)
      const qStr = q!

      if (mode === "semantic") {
        if (!app.embedder) {
          return reply.code(503).send({ message: "OPENAI_API_KEY is not configured" } as never)
        }
        const { results: rawResults, total } = await searchSemantic(app.db, app.embedder, {
          q: qStr,
          limit,
          offset,
          topicSlug,
          playlistSlug,
          publishedAfter,
        })
        const results = await refineSegmentStarts(app.db, qStr, rawResults)
        return respond(results, total)
      }

      if (mode === "hybrid") {
        const { results: rawResults, total } = await searchHybrid(app.db, app.embedder, {
          q: qStr,
          limit,
          offset,
          topicSlug,
          playlistSlug,
          publishedAfter,
        })
        const results = await refineSegmentStarts(app.db, qStr, rawResults)
        return respond(results, total)
      }

      const { results: rawResults, total } = await searchSegments(app.db, {
        q: qStr,
        limit,
        offset,
        topicSlug,
        playlistSlug,
        publishedAfter,
      })
      const results = await refineSegmentStarts(app.db, qStr, rawResults)
      return respond(results, total)
    },
  )
}
