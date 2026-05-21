import { display } from "@sermon-search/scripture"
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

const topicTagSchema = z.object({
  slug: z.string(),
  label: z.string(),
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
  topics: z.array(topicTagSchema),
  scripture_refs: z.array(scriptureRefDetailSchema),
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

      const videoRow = await request.scopedDb
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

      const [playlistRows, enrichmentRow, topicRows, refRows] = await Promise.all([
        request.scopedDb
          .selectFrom("playlists")
          .innerJoin("video_playlists", "playlists.id", "video_playlists.playlist_id")
          .select(["playlists.id", "playlists.slug", "playlists.title"])
          .where("video_playlists.video_id", "=", videoRow.id)
          .execute(),
        request.scopedDb
          .selectFrom("video_enrichments")
          .select(["summary"])
          .where("video_id", "=", videoRow.id)
          .executeTakeFirst(),
        request.scopedDb
          .selectFrom("topics")
          .innerJoin("video_topics", "topics.id", "video_topics.topic_id")
          .select(["topics.slug", "topics.label", "video_topics.position"])
          .where("video_topics.video_id", "=", videoRow.id)
          .orderBy("video_topics.position", "asc")
          .execute(),
        request.scopedDb
          .selectFrom("video_scripture_refs")
          .select([
            "book_id",
            "chapter_start",
            "verse_start",
            "chapter_end",
            "verse_end",
            "start_coord",
            "end_coord",
            "occurrences",
            "first_position",
          ])
          .where("video_id", "=", videoRow.id)
          .orderBy("occurrences", "desc")
          .orderBy("first_position", "asc")
          .execute(),
      ])

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
        summary: enrichmentRow?.summary ?? "",
        topics: topicRows.map(({ slug, label }) => ({ slug, label })),
        scripture_refs: refRows.map((r) => {
          const startCoord = Number(r.start_coord)
          const endCoord = Number(r.end_coord)
          return {
            book_id: r.book_id,
            chapter_start: r.chapter_start,
            verse_start: r.verse_start,
            chapter_end: r.chapter_end,
            verse_end: r.verse_end,
            start_coord: startCoord,
            end_coord: endCoord,
            occurrences: r.occurrences,
            display: display({
              book_id: r.book_id,
              chapter_start: r.chapter_start,
              verse_start: r.verse_start,
              chapter_end: r.chapter_end,
              verse_end: r.verse_end,
              start_coord: startCoord,
              end_coord: endCoord,
            }),
          }
        }),
      }
    },
  )
}
