import { createScopedDb } from "@sermon-search/db"
import { validateSlug } from "@sermon-search/types"
import {
  cache,
  ingestChannel,
  ingestVideoTranscript,
  resolveChannel,
  runViewStats,
} from "@sermon-search/worker"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"
import { config } from "../config.js"
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

const renameChurchParamsSchema = z.object({
  id: z.string().uuid(),
})

const renameChurchBodySchema = z
  .object({
    slug: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .refine((d) => d.slug !== undefined || d.name !== undefined, {
    message: "At least one of slug or name must be provided",
  })

const renameChurchResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  previous_slug: z.string(),
})

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAdminOrApiKey)

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
          409: z.object({ error: z.string() }),
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
        .onConflict((oc) =>
          oc
            .column("youtube_channel_id")
            .doUpdateSet({ title: resolved.title })
            .where("channels.church_id", "=", church.id),
        )
        .returning(["id", "youtube_channel_id", "title", "ingested_at"])
        .executeTakeFirst()

      if (!row) {
        return reply.code(409).send({ error: "Channel is already registered to another church" })
      }

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

      let summary: Awaited<ReturnType<typeof runViewStats>>
      try {
        summary = await runViewStats({
          db: app.db,
          client: app.youtube,
          churchId: church.id,
        })
      } catch (err) {
        try {
          await app.db
            .insertInto("system_runs")
            .values({ kind: "view-stats", last_run_at: sql`now()`, last_status: "failed" })
            .onConflict((oc) =>
              oc.column("kind").doUpdateSet({ last_run_at: sql`now()`, last_status: "failed" }),
            )
            .execute()
        } catch {
          // best-effort — don't mask the original error
        }
        throw err
      }
      try {
        await app.db
          .insertInto("system_runs")
          .values({ kind: "view-stats", last_run_at: sql`now()`, last_status: "success" })
          .onConflict((oc) =>
            oc.column("kind").doUpdateSet({ last_run_at: sql`now()`, last_status: "success" }),
          )
          .execute()
      } catch {
        // best-effort
      }
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

  app.patch(
    "/admin/churches/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Rename a church's slug and/or display name",
        params: renameChurchParamsSchema,
        body: renameChurchBodySchema,
        response: {
          200: renameChurchResponseSchema,
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { slug: newSlug, name: newName } = request.body

      const church = await app.db
        .selectFrom("churches")
        .select(["id", "slug", "name"])
        .where("id", "=", id)
        .executeTakeFirst()

      if (!church) {
        return reply.code(404).send({ error: "church not found" })
      }

      const currentSlug = church.slug
      const slugChanged = newSlug !== undefined && newSlug !== currentSlug

      // Validation runs even for no-op renames (newSlug === currentSlug) so
      // policy changes can't turn an idempotent PATCH into a silent stale write.
      if (newSlug !== undefined) {
        const validation = validateSlug(newSlug)
        if (!validation.ok) {
          return reply.code(400).send({ error: `invalid slug: ${validation.reason}` })
        }

        if (slugChanged) {
          const collision = await app.db
            .selectFrom("churches")
            .select("id")
            .where("slug", "=", newSlug)
            .unionAll(
              app.db.selectFrom("church_slug_aliases").select("id").where("slug", "=", newSlug),
            )
            .executeTakeFirst()

          if (collision) {
            return reply.code(409).send({ error: "slug already in use" })
          }
        }
      }

      await app.db.transaction().execute(async (trx) => {
        if (slugChanged) {
          await trx
            .insertInto("church_slug_aliases")
            .values({
              church_id: id,
              slug: currentSlug,
              expires_at: sql`now() + ${config.SLUG_ALIAS_TTL_DAYS} * interval '1 day'`,
            })
            .execute()
        }

        const updates: { slug?: string; name?: string } = {}
        if (slugChanged) updates.slug = newSlug
        if (newName !== undefined) updates.name = newName

        await trx.updateTable("churches").set(updates).where("id", "=", id).execute()
      })

      if (slugChanged) {
        app.evictSlug(currentSlug)
        app.evictSlug(newSlug as string)
      }

      const finalSlug = slugChanged ? (newSlug as string) : currentSlug
      const finalName = newName ?? church.name

      return reply.send({
        id,
        slug: finalSlug,
        name: finalName,
        previous_slug: currentSlug,
      })
    },
  )
}
