import { createScopedDb } from "@sermon-search/db"
import {
  cache,
  ingestChannel,
  ingestVideoTranscript,
  resolveChannel,
  runViewStats,
} from "@sermon-search/worker"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { resolveChurchOrReply } from "../plugins/church-context.js"

const churchSlugSchema = z.string().min(1)

const channelBodySchema = z
  .object({
    churchSlug: churchSlugSchema,
    handle: z.string().optional(),
    youtubeChannelId: z.string().optional(),
  })
  .refine((d) => Boolean(d.handle) !== Boolean(d.youtubeChannelId), {
    message: "Provide exactly one of handle or youtubeChannelId",
  })

const channelResponseSchema = z.object({
  id: z.string(),
  youtube_channel_id: z.string(),
  title: z.string(),
  ingested_at: z.string(),
})

const refreshQuerySchema = z.object({
  churchSlug: churchSlugSchema,
  force: z.coerce.boolean().optional().default(false),
  channel: z.string().optional(),
})

const refreshResponseSchema = z.object({
  channels: z.array(
    z.object({
      youtubeChannelId: z.string(),
      playlistCount: z.number(),
      videoCount: z.number(),
    }),
  ),
})

const viewStatsBodySchema = z.object({
  churchSlug: churchSlugSchema,
})

const viewStatsResponseSchema = z.object({
  channelCount: z.number(),
  playlistCount: z.number(),
  videoCount: z.number(),
  fetchedFromApi: z.number(),
})

const retranscribeParamsSchema = z.object({
  id: z.string().min(1),
})

const retranscribeBodySchema = z.object({
  churchSlug: churchSlugSchema,
})

const retranscribeResponseSchema = z.object({
  transcriptId: z.string(),
})

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAdmin)

  app.post(
    "/admin/channels",
    {
      schema: {
        tags: ["admin"],
        summary: "Register a YouTube channel",
        body: channelBodySchema,
        response: {
          200: channelResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { churchSlug, handle, youtubeChannelId } = request.body
      const church = await resolveChurchOrReply(app, churchSlug, reply)
      if (!church) return

      const handleOrId = (handle ?? youtubeChannelId) as string
      const resolved = await resolveChannel(app.youtube, handleOrId)

      const scopedDb = createScopedDb(app.db, church.id)
      const row = await scopedDb
        .insertInto("channels")
        .values({ youtube_channel_id: resolved.youtubeChannelId, title: resolved.title })
        .onConflict((oc) => oc.column("youtube_channel_id").doUpdateSet({ title: resolved.title }))
        .returning(["id", "youtube_channel_id", "title", "ingested_at"])
        .executeTakeFirstOrThrow()

      return reply.send({
        id: row.id,
        youtube_channel_id: row.youtube_channel_id,
        title: row.title,
        ingested_at: (row.ingested_at as unknown as Date).toISOString(),
      })
    },
  )

  app.post(
    "/admin/ingest/refresh",
    {
      schema: {
        tags: ["admin"],
        summary: "Refresh channel/playlist/video metadata",
        querystring: refreshQuerySchema,
        response: {
          200: refreshResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { churchSlug, force, channel } = request.query
      const church = await resolveChurchOrReply(app, churchSlug, reply)
      if (!church) return

      const scopedDb = createScopedDb(app.db, church.id)
      const results: Array<{
        youtubeChannelId: string
        playlistCount: number
        videoCount: number
      }> = []

      if (channel) {
        const summary = await ingestChannel({
          db: app.db,
          client: app.youtube,
          handleOrId: channel,
          churchId: church.id,
          force,
        })
        results.push({
          youtubeChannelId: summary.youtubeChannelId,
          playlistCount: summary.playlistCount,
          videoCount: summary.videoCount,
        })
      } else {
        const channels = await scopedDb
          .selectFrom("channels")
          .select(["youtube_channel_id"])
          .execute()
        for (const ch of channels) {
          const summary = await ingestChannel({
            db: app.db,
            client: app.youtube,
            handleOrId: ch.youtube_channel_id,
            churchId: church.id,
            force,
          })
          results.push({
            youtubeChannelId: summary.youtubeChannelId,
            playlistCount: summary.playlistCount,
            videoCount: summary.videoCount,
          })
        }
      }

      return reply.send({ channels: results })
    },
  )

  app.post(
    "/admin/ingest/view-stats",
    {
      schema: {
        tags: ["admin"],
        summary: "Update playlist view statistics",
        body: viewStatsBodySchema,
        response: {
          200: viewStatsResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { churchSlug } = request.body
      const church = await resolveChurchOrReply(app, churchSlug, reply)
      if (!church) return

      const summary = await runViewStats({
        db: app.db,
        client: app.youtube,
        churchId: church.id,
      })
      return reply.send(summary)
    },
  )

  app.post(
    "/admin/videos/:id/retranscribe",
    {
      schema: {
        tags: ["admin"],
        summary: "Delete cached transcript and re-run Path A for a video",
        params: retranscribeParamsSchema,
        body: retranscribeBodySchema,
        response: {
          200: retranscribeResponseSchema,
          404: z.object({ error: z.string() }),
          422: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { churchSlug } = request.body
      const church = await resolveChurchOrReply(app, churchSlug, reply)
      if (!church) return

      const scopedDb = createScopedDb(app.db, church.id)
      const video = await scopedDb
        .selectFrom("videos")
        .select(["id"])
        .where("youtube_video_id", "=", id)
        .executeTakeFirst()

      if (!video) {
        return reply.code(404).send({ error: `Video not found: ${id}` })
      }

      await app.db
        .deleteFrom("transcripts")
        .where("video_id", "=", video.id)
        .where("source", "=", "youtube_public")
        .execute()

      await cache.unlink(["videos", id, "captions.vtt"])

      const result = await ingestVideoTranscript({
        db: app.db,
        client: app.youtube,
        youtubeVideoId: id,
        churchId: church.id,
      })

      if (result.status === "no_captions") {
        return reply.code(422).send({ error: "No captions available for this video" })
      }

      return reply.send({ transcriptId: result.transcriptId })
    },
  )
}
