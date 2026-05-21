import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const paramsSchema = z.object({
  id: z.string().min(1),
})

const transcriptWordSchema = z.object({
  text: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
})

const transcriptSegmentSchema = z.object({
  id: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  words: z.array(transcriptWordSchema),
})

const transcriptResponseSchema = z.object({
  transcript_id: z.string(),
  source: z.string(),
  language: z.string(),
  segments: z.array(transcriptSegmentSchema),
})

export const videoTranscriptRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/videos/:id/transcript",
    {
      schema: {
        tags: ["videos"],
        summary: "Get video transcript with word-level timing",
        params: paramsSchema,
        response: {
          200: transcriptResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const videoRow = await request.scopedDb
        .selectFrom("videos")
        .select("id")
        .where("youtube_video_id", "=", id)
        .executeTakeFirst()

      if (!videoRow) {
        return reply.code(404).send({ error: "video not found" })
      }

      const transcriptRow = await request.scopedDb
        .selectFrom("transcripts")
        .select(["id", "source", "language"])
        .where("video_id", "=", videoRow.id)
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst()

      if (!transcriptRow) {
        return reply.code(404).send({ error: "transcript not found" })
      }

      const [segments, words] = await Promise.all([
        request.scopedDb
          .selectFrom("transcript_segments")
          .select(["id", "start_ms", "end_ms", "text"])
          .where("transcript_id", "=", transcriptRow.id)
          .orderBy("start_ms", "asc")
          .execute(),
        request.scopedDb
          .selectFrom("transcript_words")
          .select(["segment_id", "text", "start_ms", "end_ms", "position"])
          .where("transcript_id", "=", transcriptRow.id)
          .orderBy("segment_id", "asc")
          .orderBy("position", "asc")
          .execute(),
      ])

      const wordsBySegment = new Map<
        string,
        Array<{ text: string; start_ms: number; end_ms: number }>
      >()
      for (const word of words) {
        const list = wordsBySegment.get(word.segment_id) ?? []
        list.push({ text: word.text, start_ms: word.start_ms, end_ms: word.end_ms })
        wordsBySegment.set(word.segment_id, list)
      }

      return {
        transcript_id: transcriptRow.id,
        source: transcriptRow.source,
        language: transcriptRow.language,
        segments: segments.map((seg) => ({
          id: seg.id,
          start_ms: seg.start_ms,
          end_ms: seg.end_ms,
          text: seg.text,
          words: wordsBySegment.get(seg.id) ?? [],
        })),
      }
    },
  )
}
