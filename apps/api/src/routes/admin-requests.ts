import {
  createEmailSender,
  notify as defaultNotify,
  loadConfigFromEnv,
} from "@sermon-search/notifications"
import type { EmailSender, NotificationConfig, NotifyContext } from "@sermon-search/notifications"
import type { TemplateName } from "@sermon-search/notifications"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"
import { config } from "../config.js"
import { auditActor, auditWrite } from "../lib/audit.js"
import { columnsToPlaylistFilters } from "../lib/playlist-filters.js"
import { buildSearchUrl } from "./me-requests.js"

// --- Zod schemas ---

const listQuerySchema = z.object({
  status: z
    .enum(["received", "running", "awaiting_approval", "approved", "denied", "failed", "complete"])
    .optional(),
  user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const denyBodySchema = z.object({
  note: z.string().min(1).max(500),
})

const requestSummaryShape = z.object({
  id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  requested_slug: z.string(),
  status: z.enum([
    "received",
    "running",
    "awaiting_approval",
    "approved",
    "denied",
    "failed",
    "complete",
  ]),
  videos_discovered: z.number(),
  videos_ingested: z.number(),
  tokens_ingested: z.number(),
  tokens_cap: z.number(),
  search_url: z.string().nullable(),
  limit_reached: z.boolean(),
  created_at: z.string(),
  playlist_filters: z.object({
    mode: z.enum(["none", "include", "exclude"]),
    playlist_ids: z.array(z.string()),
  }),
})

const listResponseSchema = z.object({
  requests: z.array(requestSummaryShape),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
})

const detailResponseSchema = requestSummaryShape.extend({
  requested_name: z.string(),
  youtube_handle_or_url: z.string(),
  contact_email: z.string(),
  admin_note: z.string().nullable(),
  updated_at: z.string(),
  church_slug: z.string().nullable(),
  church_status: z.string().nullable(),
  youtube_channel_id: z.string().nullable(),
  channel_title: z.string().nullable(),
  discovered_playlists: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      video_count: z.number().nullable(),
    }),
  ),
})

const approveResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
})

const denyResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
})

const errorSchema = z.object({ error: z.string(), sign_in_url: z.string().optional() })
const conflictSchema = z.object({ error: z.string(), current_status: z.string() })

// --- Dependency injection ---

export type NotifyFn = (
  sender: EmailSender,
  status: TemplateName,
  ctx: NotifyContext,
  notificationConfig: NotificationConfig,
) => Promise<{ recipients: string[] }>

export interface AdminRequestsRouteDeps {
  sender: EmailSender
  notificationConfig: NotificationConfig
  notifyFn: NotifyFn
  webBaseUrl: string
}

function makeDefaultDeps(): AdminRequestsRouteDeps {
  const notificationConfig = loadConfigFromEnv()
  return {
    sender: createEmailSender(notificationConfig),
    notificationConfig,
    notifyFn: defaultNotify,
    webBaseUrl: config.WEB_BASE_URL,
  }
}

// --- Plugin factory ---

export function createAdminRequestsRoutes(deps?: AdminRequestsRouteDeps): FastifyPluginAsyncZod {
  return async (app) => {
    // Resolve deps lazily (inside the plugin body) so that loadConfigFromEnv()
    // and createEmailSender() are not called at module-import time when no deps
    // are supplied — e.g. from tooling that doesn't intend to send mail.
    const { sender, notificationConfig, notifyFn, webBaseUrl } = deps ?? makeDefaultDeps()
    const tokensCap = config.LIMITED_INGEST_TOKEN_CAP

    async function buildSearchUrlForRequest(
      churchSlug: string | null | undefined,
    ): Promise<string> {
      return buildSearchUrl(churchSlug) ?? ""
    }

    // --- GET /admin/requests ---
    app.get(
      "/admin/requests",
      {
        preHandler: app.requireAdminOrApiKey,
        schema: {
          tags: ["admin"],
          summary: "List all ingestion requests (admin)",
          querystring: listQuerySchema,
          response: {
            200: listResponseSchema,
            401: errorSchema,
            403: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const { status, user_id, limit, offset } = request.query

        let baseQuery = app.db
          .selectFrom("ingestion_requests")
          .leftJoin("users", "users.id", "ingestion_requests.user_id")
          .leftJoin("churches", "churches.id", "ingestion_requests.church_id")

        if (status) {
          baseQuery = baseQuery.where("ingestion_requests.status", "=", status)
        }
        if (user_id) {
          baseQuery = baseQuery.where("ingestion_requests.user_id", "=", user_id)
        }

        const [rows, countResult] = await Promise.all([
          baseQuery
            .select([
              "ingestion_requests.id",
              "ingestion_requests.user_id",
              "ingestion_requests.requested_slug",
              "ingestion_requests.status",
              "ingestion_requests.videos_discovered",
              "ingestion_requests.videos_ingested",
              "ingestion_requests.tokens_ingested",
              "ingestion_requests.limit_reached",
              "ingestion_requests.created_at",
              "ingestion_requests.include_playlist_ids",
              "ingestion_requests.exclude_playlist_ids",
              "users.display_name",
              "churches.slug as church_slug",
            ])
            .orderBy("ingestion_requests.created_at", "desc")
            .limit(limit)
            .offset(offset)
            .execute(),
          baseQuery.select(sql<string>`count(*)`.as("count")).executeTakeFirstOrThrow(),
        ])

        const requests = rows.map((row) => ({
          id: row.id,
          user_id: row.user_id,
          display_name: row.display_name ?? null,
          requested_slug: row.requested_slug,
          status: row.status,
          videos_discovered: row.videos_discovered,
          videos_ingested: row.videos_ingested,
          tokens_ingested: Number(row.tokens_ingested),
          tokens_cap: tokensCap,
          search_url: buildSearchUrl(row.church_slug),
          limit_reached: row.limit_reached,
          created_at: (row.created_at as unknown as Date).toISOString(),
          playlist_filters: columnsToPlaylistFilters(
            row.include_playlist_ids as string[],
            row.exclude_playlist_ids as string[],
          ),
        }))

        return reply.send({
          requests,
          total: Number(countResult.count),
          limit,
          offset,
        })
      },
    )

    // --- GET /admin/requests/:id ---
    app.get(
      "/admin/requests/:id",
      {
        preHandler: app.requireAdminOrApiKey,
        schema: {
          tags: ["admin"],
          summary: "Get ingestion request detail (admin)",
          params: idParamsSchema,
          response: {
            200: detailResponseSchema,
            401: errorSchema,
            403: errorSchema,
            404: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params

        const row = await app.db
          .selectFrom("ingestion_requests")
          .leftJoin("users", "users.id", "ingestion_requests.user_id")
          .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
          .leftJoin("channels", (join) =>
            join
              .onRef("channels.church_id", "=", "ingestion_requests.church_id")
              .onRef("channels.youtube_channel_id", "=", "churches.youtube_channel_id"),
          )
          .where("ingestion_requests.id", "=", id)
          .select([
            "ingestion_requests.id",
            "ingestion_requests.user_id",
            "ingestion_requests.church_id",
            "ingestion_requests.requested_slug",
            "ingestion_requests.requested_name",
            "ingestion_requests.youtube_handle_or_url",
            "ingestion_requests.contact_email",
            "ingestion_requests.include_playlist_ids",
            "ingestion_requests.exclude_playlist_ids",
            "ingestion_requests.status",
            "ingestion_requests.videos_discovered",
            "ingestion_requests.videos_ingested",
            "ingestion_requests.tokens_ingested",
            "ingestion_requests.limit_reached",
            "ingestion_requests.admin_note",
            "ingestion_requests.created_at",
            "ingestion_requests.updated_at",
            "users.display_name",
            "churches.slug as church_slug",
            "churches.status as church_status",
            "churches.youtube_channel_id",
            "channels.title as channel_title",
          ])
          .executeTakeFirst()

        if (!row) {
          return reply.code(404).send({ error: "not_found" })
        }

        // Load discovered playlists if linked to a church.
        // TODO: playlists are keyed by church_id only; a church that gets
        // re-ingested after a deny+re-request cycle may retain stale rows from
        // the prior run.  Filter by current channel_id or add a generation
        // column to bound the staleness window.
        const playlists = row.church_id
          ? await app.db
              .selectFrom("playlists")
              .select(["id", "title", "slug", "video_count"])
              .where("church_id", "=", row.church_id)
              .orderBy("position", "asc")
              .execute()
          : []

        return reply.send({
          id: row.id,
          user_id: row.user_id,
          display_name: row.display_name ?? null,
          requested_slug: row.requested_slug,
          requested_name: row.requested_name,
          youtube_handle_or_url: row.youtube_handle_or_url,
          contact_email: row.contact_email,
          playlist_filters: columnsToPlaylistFilters(
            row.include_playlist_ids as string[],
            row.exclude_playlist_ids as string[],
          ),
          status: row.status,
          videos_discovered: row.videos_discovered,
          videos_ingested: row.videos_ingested,
          tokens_ingested: Number(row.tokens_ingested),
          tokens_cap: tokensCap,
          search_url: buildSearchUrl(row.church_slug),
          limit_reached: row.limit_reached,
          admin_note: row.admin_note,
          created_at: (row.created_at as unknown as Date).toISOString(),
          updated_at: (row.updated_at as unknown as Date).toISOString(),
          church_slug: row.church_slug ?? null,
          church_status: row.church_status ?? null,
          youtube_channel_id: row.youtube_channel_id ?? null,
          channel_title: row.channel_title ?? null,
          discovered_playlists: playlists.map((p) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            video_count: p.video_count ?? null,
          })),
        })
      },
    )

    // --- POST /admin/requests/:id/approve ---
    app.post(
      "/admin/requests/:id/approve",
      {
        preHandler: app.requireAdminOrApiKey,
        schema: {
          tags: ["admin"],
          summary: "Approve an ingestion request (admin)",
          params: idParamsSchema,
          response: {
            200: approveResponseSchema,
            401: errorSchema,
            403: errorSchema,
            404: errorSchema,
            409: conflictSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params

        const req = await app.db
          .selectFrom("ingestion_requests")
          .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
          .where("ingestion_requests.id", "=", id)
          .select([
            "ingestion_requests.id",
            "ingestion_requests.user_id",
            "ingestion_requests.church_id",
            "ingestion_requests.requested_slug",
            "ingestion_requests.requested_name",
            "ingestion_requests.youtube_handle_or_url",
            "ingestion_requests.contact_email",
            "ingestion_requests.include_playlist_ids",
            "ingestion_requests.exclude_playlist_ids",
            "ingestion_requests.status",
            "ingestion_requests.mode",
            "ingestion_requests.videos_discovered",
            "ingestion_requests.videos_ingested",
            "ingestion_requests.tokens_ingested",
            "ingestion_requests.limit_reached",
            "ingestion_requests.admin_note",
            "ingestion_requests.created_at",
            "ingestion_requests.updated_at",
            "churches.slug as church_slug",
          ])
          .executeTakeFirst()

        if (!req) {
          return reply.code(404).send({ error: "not_found" })
        }

        // Idempotent: already approved
        if (req.status === "approved") {
          return reply.send({ id: req.id, status: req.status })
        }

        if (req.status !== "awaiting_approval") {
          return reply.code(409).send({ error: "invalid_transition", current_status: req.status })
        }

        // Look up the channel created during the initial ingest run.
        const channelRow = req.church_id
          ? await app.db
              .selectFrom("channels")
              .select(["id"])
              .where("church_id", "=", req.church_id)
              .executeTakeFirst()
          : null

        const { user_id: approveUserId, actor: approveActor } = auditActor(request)

        await app.db.transaction().execute(async (trx) => {
          await trx
            .updateTable("ingestion_requests")
            .set({ status: "approved", updated_at: sql`now()` })
            .where("id", "=", id)
            .execute()

          await auditWrite(trx, {
            user_id: approveUserId,
            action: "request.approve",
            target_type: "request",
            target_id: id,
            payload: {
              actor: approveActor,
              from_status: req.status,
              to_status: "approved",
              requested_slug: req.requested_slug,
              user_id_of_subject: req.user_id,
            },
          })

          if (channelRow) {
            const filters = columnsToPlaylistFilters(
              req.include_playlist_ids as string[],
              req.exclude_playlist_ids as string[],
            )
            if (filters.mode !== "none") {
              for (const targetId of filters.playlist_ids) {
                const ruleRow = await trx
                  .insertInto("channel_filter_rules")
                  .values({
                    channel_id: channelRow.id,
                    rule_type: filters.mode,
                    target_kind: "playlist",
                    target_id: targetId,
                    note: null,
                  })
                  .onConflict((oc) => oc.doNothing())
                  .returning(["id"])
                  .executeTakeFirst()

                if (ruleRow) {
                  await auditWrite(trx, {
                    user_id: approveUserId,
                    action: "filter_rule.create",
                    target_type: "filter_rule",
                    target_id: ruleRow.id,
                    payload: {
                      actor: approveActor,
                      channel_id: channelRow.id,
                      rule_type: filters.mode,
                      target_kind: "playlist",
                      target_id: targetId,
                      note: null,
                      source: "request.approve",
                      request_id: id,
                    },
                  })
                }
              }
            }
          }
        })

        // Best-effort notification
        try {
          const searchUrl = await buildSearchUrlForRequest(req.church_slug)
          const notifyRequest = {
            id: req.id,
            user_id: req.user_id,
            church_id: req.church_id ?? null,
            requested_slug: req.requested_slug,
            requested_name: req.requested_name,
            youtube_handle_or_url: req.youtube_handle_or_url,
            contact_email: req.contact_email,
            include_playlist_ids: req.include_playlist_ids as string[],
            exclude_playlist_ids: req.exclude_playlist_ids as string[],
            status: "approved" as const,
            mode: req.mode,
            videos_discovered: req.videos_discovered,
            videos_ingested: req.videos_ingested,
            tokens_ingested: Number(req.tokens_ingested),
            limit_reached: req.limit_reached,
            admin_note: req.admin_note ?? null,
            created_at: (req.created_at as unknown as Date).toISOString(),
            updated_at: new Date().toISOString(),
          }
          await notifyFn(
            sender,
            "approved",
            { request: notifyRequest, webBaseUrl, searchUrl },
            notificationConfig,
          )
        } catch (err) {
          app.log.error({ err }, "admin-requests: notification failed on approve")
        }

        return reply.send({ id, status: "approved" })
      },
    )

    // --- POST /admin/requests/:id/deny ---
    app.post(
      "/admin/requests/:id/deny",
      {
        preHandler: app.requireAdminOrApiKey,
        schema: {
          tags: ["admin"],
          summary: "Deny an ingestion request (admin)",
          params: idParamsSchema,
          body: denyBodySchema,
          response: {
            200: denyResponseSchema,
            400: errorSchema,
            401: errorSchema,
            403: errorSchema,
            404: errorSchema,
            409: conflictSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params
        const { note } = request.body

        const req = await app.db
          .selectFrom("ingestion_requests")
          .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
          .where("ingestion_requests.id", "=", id)
          .select([
            "ingestion_requests.id",
            "ingestion_requests.user_id",
            "ingestion_requests.church_id",
            "ingestion_requests.requested_slug",
            "ingestion_requests.requested_name",
            "ingestion_requests.youtube_handle_or_url",
            "ingestion_requests.contact_email",
            "ingestion_requests.include_playlist_ids",
            "ingestion_requests.exclude_playlist_ids",
            "ingestion_requests.status",
            "ingestion_requests.mode",
            "ingestion_requests.videos_discovered",
            "ingestion_requests.videos_ingested",
            "ingestion_requests.tokens_ingested",
            "ingestion_requests.limit_reached",
            "ingestion_requests.admin_note",
            "ingestion_requests.created_at",
            "ingestion_requests.updated_at",
            "churches.slug as church_slug",
          ])
          .executeTakeFirst()

        if (!req) {
          return reply.code(404).send({ error: "not_found" })
        }

        // Terminal states that cannot be denied
        if (req.status === "approved" || req.status === "complete") {
          return reply.code(409).send({ error: "invalid_transition", current_status: req.status })
        }

        // Idempotent: already denied — update note if changed, no re-notify
        if (req.status === "denied") {
          if (req.admin_note !== note) {
            await app.db
              .updateTable("ingestion_requests")
              .set({ admin_note: note, updated_at: sql`now()` })
              .where("id", "=", id)
              .execute()
            const { user_id: denyIdempotentUserId, actor: denyIdempotentActor } =
              auditActor(request)
            await auditWrite(app.db, {
              user_id: denyIdempotentUserId,
              action: "request.deny",
              target_type: "request",
              target_id: id,
              payload: {
                actor: denyIdempotentActor,
                from_status: "denied",
                to_status: "denied",
                admin_note: note,
                requested_slug: req.requested_slug,
                user_id_of_subject: req.user_id,
                church_id: req.church_id ?? null,
              },
            })
          }
          return reply.send({ id: req.id, status: "denied" })
        }

        // Transition: received | running | awaiting_approval | failed → denied
        await app.db.transaction().execute(async (trx) => {
          await trx
            .updateTable("ingestion_requests")
            .set({ status: "denied", admin_note: note, updated_at: sql`now()` })
            .where("id", "=", id)
            .execute()

          if (req.church_id) {
            await trx
              .updateTable("churches")
              .set({ status: "denied" })
              .where("id", "=", req.church_id)
              .execute()
          }

          const { user_id: denyUserId, actor: denyActor } = auditActor(request)
          await auditWrite(trx, {
            user_id: denyUserId,
            action: "request.deny",
            target_type: "request",
            target_id: id,
            payload: {
              actor: denyActor,
              from_status: req.status,
              to_status: "denied",
              admin_note: note,
              requested_slug: req.requested_slug,
              user_id_of_subject: req.user_id,
              church_id: req.church_id ?? null,
            },
          })
        })

        // Best-effort notification
        try {
          const searchUrl = await buildSearchUrlForRequest(req.church_slug)
          const notifyRequest = {
            id: req.id,
            user_id: req.user_id,
            church_id: req.church_id ?? null,
            requested_slug: req.requested_slug,
            requested_name: req.requested_name,
            youtube_handle_or_url: req.youtube_handle_or_url,
            contact_email: req.contact_email,
            include_playlist_ids: req.include_playlist_ids as string[],
            exclude_playlist_ids: req.exclude_playlist_ids as string[],
            status: "denied" as const,
            mode: req.mode,
            videos_discovered: req.videos_discovered,
            videos_ingested: req.videos_ingested,
            tokens_ingested: Number(req.tokens_ingested),
            limit_reached: req.limit_reached,
            admin_note: note,
            created_at: (req.created_at as unknown as Date).toISOString(),
            updated_at: new Date().toISOString(),
          }
          await notifyFn(
            sender,
            "denied",
            { request: notifyRequest, webBaseUrl, searchUrl },
            notificationConfig,
          )
        } catch (err) {
          app.log.error({ err }, "admin-requests: notification failed on deny")
        }

        return reply.send({ id, status: "denied" })
      },
    )

    // --- POST /admin/requests/:id/retry ---
    app.post(
      "/admin/requests/:id/retry",
      {
        preHandler: app.requireAdminOrApiKey,
        schema: {
          tags: ["admin"],
          summary: "Retry a failed ingestion request (admin)",
          params: idParamsSchema,
          response: {
            200: approveResponseSchema,
            401: errorSchema,
            403: errorSchema,
            404: errorSchema,
            409: conflictSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params

        const req = await app.db
          .selectFrom("ingestion_requests")
          .where("id", "=", id)
          .select(["id", "user_id", "requested_slug", "status"])
          .executeTakeFirst()

        if (!req) {
          return reply.code(404).send({ error: "not_found" })
        }

        // Idempotent: already re-queued (e.g. double-click) — no-op, no audit row.
        if (req.status === "received") {
          return reply.send({ id: req.id, status: req.status })
        }

        // Only failed requests can be retried.
        if (req.status !== "failed") {
          return reply.code(409).send({ error: "invalid_transition", current_status: req.status })
        }

        const { user_id: retryUserId, actor: retryActor } = auditActor(request)

        // Transition failed → received so the worker re-claims it (it claims
        // status IN ('received','approved')). Clear the stale error note,
        // reset the reaper's retry budget, and drop any prior cap flag. Leave
        // videos_discovered / videos_ingested / tokens_ingested alone — the
        // ingest pipeline is idempotent and only counts newly-ingested work.
        await app.db.transaction().execute(async (trx) => {
          await trx
            .updateTable("ingestion_requests")
            .set({
              status: "received",
              retry_count: 0,
              limit_reached: false,
              admin_note: null,
              updated_at: sql`now()`,
            })
            .where("id", "=", id)
            .execute()

          await auditWrite(trx, {
            user_id: retryUserId,
            action: "request.retry",
            target_type: "request",
            target_id: id,
            payload: {
              actor: retryActor,
              from_status: req.status,
              to_status: "received",
              requested_slug: req.requested_slug,
              user_id_of_subject: req.user_id,
            },
          })
        })

        return reply.send({ id, status: "received" })
      },
    )
  }
}

export const adminRequestsRoutes = createAdminRequestsRoutes()
