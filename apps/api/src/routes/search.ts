import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { BadRefError, parseRefQuery, searchVideosByRef } from "../search/by-ref.js"
import type { FtsResult } from "../search/fts.js"
import { searchSegments } from "../search/fts.js"
import { groupByVideo } from "../search/group-by-video.js"
import { searchHybrid } from "../search/hybrid.js"
import { hydrateScriptureRefs } from "../search/hydrate-refs.js"
import { hydrateSummaries } from "../search/hydrate-summaries.js"
import { hydrateTopics } from "../search/hydrate-topics.js"
import { refineSegmentStarts } from "../search/refine.js"
import { searchSemantic } from "../search/semantic.js"

// Over-fetch factor for candidate chunks before grouping by video. Larger
// values surface more videos to rank but cost more refine + group work.
const CANDIDATE_MULTIPLIER = 10
const MIN_CANDIDATES = 200

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .optional()

const querySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    ref: z.string().min(1).max(200).optional(),
    mode: z.enum(["fulltext", "semantic", "hybrid"]).default("hybrid"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    topic: z.string().optional(),
    playlist: z.string().optional(),
    from: isoDate,
    to: isoDate,
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

const searchHitSchema = z.object({
  snippet: z.string(),
  start_ms: z.number(),
  score: z.number(),
  match_type: z.enum(["lexical", "semantic"]),
})

const topicSchema = z.object({
  slug: z.string(),
  label: z.string(),
  video_count: z.number(),
})

const searchResultSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  summary: z.string(),
  score: z.number(),
  hits: z.array(searchHitSchema),
  scripture_refs: z.array(scriptureRefDetailSchema),
  topics: z.array(topicSchema),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  total: z.number(),
  took_ms: z.number(),
  scripture_refs: z.array(scriptureRefDetailSchema),
  topics: z.array(topicSchema),
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
      const { q, ref, mode, limit, offset, topic, playlist, from, to } = request.query
      const t0 = Date.now()

      const topicSlug = topic || undefined
      const playlistSlug = playlist || undefined
      const publishedAfter = from ? new Date(`${from}T00:00:00Z`) : undefined
      // Inclusive end of day so `to=2026-05-20` covers everything published on
      // 2026-05-20 in UTC.
      const publishedBefore = to ? new Date(`${to}T23:59:59.999Z`) : undefined

      const candidateLimit = Math.max(MIN_CANDIDATES, limit * CANDIDATE_MULTIPLIER)

      const respond = async (
        candidates: FtsResult[],
        refineQuery: string,
        videoScores?: Map<string, number>,
      ) => {
        const refined = await refineSegmentStarts(request.scopedDb, refineQuery, candidates)
        const { videos, total } = groupByVideo(refined, { limit, offset, videoScores })
        const ids = videos.map((v) => v.youtube_video_id)
        const [refs, summaries, topics] = await Promise.all([
          hydrateScriptureRefs(request.scopedDb, ids),
          hydrateSummaries(request.scopedDb, ids),
          hydrateTopics(request.scopedDb, ids),
        ])
        return {
          results: videos.map((v) => ({
            video_id: v.youtube_video_id,
            title: v.title,
            thumbnail_url: v.thumbnail_url ?? "",
            summary: summaries.get(v.youtube_video_id) ?? "",
            score: v.score,
            hits: v.hits.map((h) => ({
              snippet: h.snippet,
              start_ms: h.start_ms,
              score: h.score,
              match_type: h.match_type,
            })),
            scripture_refs: refs.perVideo.get(v.youtube_video_id) ?? [],
            topics: topics.perVideo.get(v.youtube_video_id) ?? [],
          })),
          total,
          took_ms: Date.now() - t0,
          scripture_refs: refs.aggregate,
          topics: topics.aggregate,
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

        const { results, videoScores } = await searchVideosByRef(request.scopedDb, {
          startCoord: interval.start_coord,
          endCoord: interval.end_coord,
          rawQuery: ref,
          candidateLimit,
          topicSlug,
          playlistSlug,
          publishedAfter,
          publishedBefore,
        })
        return respond(results, ref, videoScores)
      }

      if (!q) {
        return reply.code(400).send({ message: "q or ref is required" } as never)
      }
      const qStr = q

      if (mode === "semantic") {
        if (!app.embedder) {
          return reply.code(503).send({ message: "OPENAI_API_KEY is not configured" } as never)
        }
        const { results } = await searchSemantic(request.scopedDb, app.embedder, {
          q: qStr,
          limit: candidateLimit,
          offset: 0,
          topicSlug,
          playlistSlug,
          publishedAfter,
          publishedBefore,
        })
        return respond(results, qStr)
      }

      if (mode === "hybrid") {
        const { results } = await searchHybrid(request.scopedDb, app.embedder, {
          q: qStr,
          limit: candidateLimit,
          offset: 0,
          topicSlug,
          playlistSlug,
          publishedAfter,
          publishedBefore,
        })
        return respond(results, qStr)
      }

      const { results } = await searchSegments(request.scopedDb, {
        q: qStr,
        limit: candidateLimit,
        offset: 0,
        topicSlug,
        playlistSlug,
        publishedAfter,
      })
      return respond(results, qStr)
    },
  )
}
