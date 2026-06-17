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
import { auditActor, auditWrite } from "../lib/audit.js"
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

// Admin-initiated re-ingest of an existing church. Inserts ingestion_requests
// rows the worker claims and runs through the full pipeline (transcripts +
// embeddings + enrichment), unlike `channel refresh` which only syncs metadata
// inline and never reaches the worker.
const reingestBodySchema = z.object({
  churchSlug: churchSlugSchema,
  channel: z.string().optional(),
})

const reingestResponseSchema = z.object({
  requests: z.array(
    z.object({
      id: z.string(),
      youtubeChannelId: z.string(),
    }),
  ),
})

// Re-ingests have no end-user requester, but ingestion_requests.contact_email is
// NOT NULL and the worker emails it (best-effort) on completion. Address it to an
// internal mailbox rather than a real user.
const REINGEST_CONTACT_EMAIL = "reingest@sermonseek.ai"

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
          oc.columns(["church_id", "youtube_channel_id"]).doUpdateSet({ title: resolved.title }),
        )
        .returning(["id", "youtube_channel_id", "title", "ingested_at"])
        .executeTakeFirst()

      if (!row) {
        return reply.code(409).send({ error: "Channel is already registered to another church" })
      }

      const { user_id, actor } = auditActor(request)
      await auditWrite(app.db, {
        user_id,
        action: "channel.register",
        target_type: "channel",
        target_id: row.id,
        payload: {
          actor,
          churchSlug,
          handle,
          youtubeChannelId,
          youtube_channel_id: resolved.youtubeChannelId,
        },
      })

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

      const { user_id: refreshUserId, actor: refreshActor } = auditActor(request)
      await auditWrite(app.db, {
        user_id: refreshUserId,
        action: "ingest.refresh",
        target_type: "church",
        target_id: church.id,
        payload: {
          actor: refreshActor,
          churchSlug,
          force,
          channel,
          channels: results.map((r) => r.youtubeChannelId),
        },
      })

      return reply.send({ channels: results })
    },
  )

  app.post(
    "/admin/ingest/reingest",
    {
      schema: {
        tags: ["admin"],
        summary: "Queue a full worker re-ingest of an existing church's videos",
        body: reingestBodySchema,
        response: {
          200: reingestResponseSchema,
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string(), note: z.string().optional() }),
        },
      },
    },
    async (request, reply) => {
      const { churchSlug, channel } = request.body
      const church = await resolveChurchOrReply(app, churchSlug, reply)
      if (!church) return

      // The worker's ensureChurch rejects denied/suspended churches; fail fast here.
      const churchRow = await app.db
        .selectFrom("churches")
        .select(["status"])
        .where("id", "=", church.id)
        .executeTakeFirst()
      if (churchRow?.status === "denied" || churchRow?.status === "suspended") {
        return reply.code(409).send({
          error: "church_unavailable",
          note: `church status is '${churchRow.status}'`,
        })
      }

      // ingestion_requests.user_id is NOT NULL. Admin-initiated re-ingests have no
      // end-user requester, so attribute to the acting session admin if present,
      // else the earliest admin user.
      const { user_id: sessionUserId, actor } = auditActor(request)
      let actingUserId = sessionUserId
      if (!actingUserId) {
        const admin = await app.db
          .selectFrom("users")
          .select(["id"])
          .where("is_admin", "=", true)
          .orderBy("created_at", "asc")
          .executeTakeFirst()
        if (!admin) {
          return reply.code(409).send({ error: "no_admin_user" })
        }
        actingUserId = admin.id
      }

      // One request per channel; runPipeline resolves a single channel per request.
      const scopedDb = createScopedDb(app.db, church.id)
      let channelIds: string[]
      if (channel) {
        channelIds = [channel]
      } else {
        const rows = await scopedDb.selectFrom("channels").select(["youtube_channel_id"]).execute()
        channelIds = rows.map((r) => r.youtube_channel_id)
      }
      if (channelIds.length === 0) {
        return reply.code(409).send({ error: "no_channels" })
      }

      const requests: Array<{ id: string; youtubeChannelId: string }> = []
      for (const youtubeChannelId of channelIds) {
        const row = await app.db
          .insertInto("ingestion_requests")
          .values({
            user_id: actingUserId,
            church_id: church.id,
            requested_slug: church.slug,
            requested_name: church.name,
            youtube_handle_or_url: youtubeChannelId,
            contact_email: REINGEST_CONTACT_EMAIL,
            status: "received",
            tokens_ingested: 0,
          })
          .returning("id")
          .executeTakeFirstOrThrow()
        requests.push({ id: row.id, youtubeChannelId })
      }

      await auditWrite(app.db, {
        user_id: sessionUserId,
        action: "ingest.reingest",
        target_type: "church",
        target_id: church.id,
        payload: { actor, churchSlug, channel, requests: requests.map((r) => r.id) },
      })

      return reply.send({ requests })
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

      const { user_id: vsUserId, actor: vsActor } = auditActor(request)
      await auditWrite(app.db, {
        user_id: vsUserId,
        action: "ingest.view_stats",
        target_type: "church",
        target_id: church.id,
        payload: { actor: vsActor, churchSlug },
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

      const { user_id: rtUserId, actor: rtActor } = auditActor(request)

      if (result.status === "no_captions") {
        await auditWrite(app.db, {
          user_id: rtUserId,
          action: "video.retranscribe",
          target_type: "video",
          target_id: id,
          payload: { actor: rtActor, churchSlug, outcome: "no_captions", video_uuid: video.id },
        })
        return reply.code(422).send({ error: "No captions available for this video" })
      }

      await auditWrite(app.db, {
        user_id: rtUserId,
        action: "video.retranscribe",
        target_type: "video",
        target_id: id,
        payload: {
          actor: rtActor,
          churchSlug,
          transcriptId: result.transcriptId,
          video_uuid: video.id,
        },
      })

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

      const { user_id: renameUserId, actor: renameActor } = auditActor(request)

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

        await auditWrite(trx, {
          user_id: renameUserId,
          action: "church.rename",
          target_type: "church",
          target_id: id,
          payload: {
            actor: renameActor,
            previous_slug: currentSlug,
            new_slug: newSlug ?? null,
            new_name: newName ?? null,
            slug_changed: slugChanged,
          },
        })
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
