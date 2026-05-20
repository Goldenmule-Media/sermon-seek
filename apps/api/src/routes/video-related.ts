import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const paramsSchema = z.object({
  id: z.string().min(1),
})

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(8),
})

const reasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("same_series"), text: z.string(), playlist_id: z.string() }),
  z.object({
    kind: z.literal("chunk_similarity"),
    text: z.string(),
    matched_chunk_start_ms: z.number(),
  }),
  z.object({ kind: z.literal("topic_overlap"), text: z.string(), topics: z.array(z.string()) }),
  z.object({
    kind: z.literal("scripture_overlap"),
    text: z.string(),
    references: z.array(z.string()),
  }),
])

const relatedVideoSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  thumbnail_url: z.string(),
  score: z.number(),
  reason: reasonSchema,
})

const responseSchema = z.object({
  related: z.array(relatedVideoSchema),
})

export const SIGNAL_PRIORITY: Record<string, number> = {
  same_series: 0,
  chunk_similarity: 1,
  topic_overlap: 2,
  scripture_overlap: 3,
}

type ChunkPayload = { matched_chunk_start_ms: number; quoted_text: string }
type TopicPayload = { topics: string[] }
type ScripturePayload = { references: string[] }
type SeriesPayload = { playlist_id: string; playlist_title: string }

export function buildReason(signal: string, payload: unknown): z.infer<typeof reasonSchema> | null {
  if (signal === "same_series") {
    const p = payload as SeriesPayload
    return {
      kind: "same_series",
      text: `Same series: ${p.playlist_title}`,
      playlist_id: p.playlist_id,
    }
  }
  if (signal === "chunk_similarity") {
    const p = payload as ChunkPayload
    return {
      kind: "chunk_similarity",
      text: `Similar passage: "${p.quoted_text}"`,
      matched_chunk_start_ms: p.matched_chunk_start_ms,
    }
  }
  if (signal === "topic_overlap") {
    const p = payload as TopicPayload
    return { kind: "topic_overlap", text: `Also about: ${p.topics.join(", ")}`, topics: p.topics }
  }
  if (signal === "scripture_overlap") {
    const p = payload as ScripturePayload
    return {
      kind: "scripture_overlap",
      text: `Also references: ${p.references.join(", ")}`,
      references: p.references,
    }
  }
  return null
}

export const videoRelatedRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/videos/:id/related",
    {
      schema: {
        tags: ["videos"],
        summary: "Get related videos with reasons",
        params: paramsSchema,
        querystring: querySchema,
        response: {
          200: responseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { limit } = request.query

      const videoRow = await app.db
        .selectFrom("videos")
        .select("id")
        .where("youtube_video_id", "=", id)
        .executeTakeFirst()

      if (!videoRow) {
        return reply.code(404).send({ error: "video not found" })
      }

      type RelatedJoinRow = {
        related_video_id: string
        signal: string
        score: number
        payload: unknown
        related_youtube_id: string
        title: string
        thumbnail_url: string | null
      }

      const { rows } = await sql<RelatedJoinRow>`
        SELECT rv.related_video_id,
               rv.signal,
               rv.score,
               rv.payload,
               v.youtube_video_id AS related_youtube_id,
               v.title,
               v.thumbnail_url
        FROM related_videos rv
        JOIN videos_with_transcripts v ON v.id = rv.related_video_id
        WHERE rv.video_id = ${videoRow.id}
      `.execute(app.db)

      type Candidate = {
        video_id: string
        title: string
        thumbnail_url: string
        score: number
        signal: string
        payload: unknown
      }
      const byRelated = new Map<string, Candidate>()

      for (const row of rows) {
        const existing = byRelated.get(row.related_video_id)
        const newPri = SIGNAL_PRIORITY[row.signal] ?? 99
        const existPri = existing ? (SIGNAL_PRIORITY[existing.signal] ?? 99) : 99

        if (!existing || newPri < existPri || (newPri === existPri && row.score > existing.score)) {
          byRelated.set(row.related_video_id, {
            video_id: row.related_youtube_id,
            title: row.title,
            thumbnail_url: row.thumbnail_url ?? "",
            score: row.score,
            signal: row.signal,
            payload: row.payload,
          })
        }
      }

      const related = [...byRelated.values()]
        .flatMap((r) => {
          const reason = buildReason(r.signal, r.payload)
          if (!reason) return []
          return [
            {
              video_id: r.video_id,
              title: r.title,
              thumbnail_url: r.thumbnail_url,
              score: r.score,
              reason,
            },
          ]
        })
        .sort((a, b) => {
          const pa = SIGNAL_PRIORITY[a.reason.kind] ?? 99
          const pb = SIGNAL_PRIORITY[b.reason.kind] ?? 99
          return pa !== pb ? pa - pb : b.score - a.score
        })
        .slice(0, limit)

      return { related }
    },
  )
}
