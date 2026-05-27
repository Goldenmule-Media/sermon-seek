import type { Database } from "@sermon-search/db"
import { validateSlug } from "@sermon-search/types"
import { resolveChannel } from "@sermon-search/worker"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { z } from "zod"
import type { RateLimitPreHandler } from "../plugins/rate-limit.js"

const HOUR_MS = 60 * 60 * 1000

function searchUrlFor(slug: string): string {
  return `/${slug}/`
}

function statusUrlFor(requestId: string): string {
  return `/me/requests/${requestId}`
}

async function lookupSlugCollision(db: Kysely<Database>, slug: string): Promise<boolean> {
  const hit = await db
    .selectFrom("churches")
    .select("id")
    .where("slug", "=", slug)
    .unionAll(db.selectFrom("church_slug_aliases").select("id").where("slug", "=", slug))
    .limit(1)
    .executeTakeFirst()
  return hit !== undefined
}

interface ChurchRecord {
  id: string
  slug: string
  status: string
}

async function lookupChurchByYoutubeChannelId(
  db: Kysely<Database>,
  ytChannelId: string,
): Promise<ChurchRecord | null> {
  const row = await db
    .selectFrom("churches")
    .select(["id", "slug", "status"])
    .where("youtube_channel_id", "=", ytChannelId)
    .executeTakeFirst()
  return row ?? null
}

interface InFlightRequest {
  id: string
  user_id: string
}

async function lookupInFlightRequestForChurch(
  db: Kysely<Database>,
  churchId: string,
): Promise<InFlightRequest | null> {
  const row = await db
    .selectFrom("ingestion_requests")
    .select(["id", "user_id"])
    .where("church_id", "=", churchId)
    .where("status", "in", ["received", "running", "awaiting_approval"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

type ResolvedChannelResult = { youtubeChannelId: string; title: string } | null

export async function resolveChannelOrNull(
  youtube: Parameters<typeof resolveChannel>[0],
  handle: string,
): Promise<ResolvedChannelResult> {
  try {
    return await resolveChannel(youtube, handle)
  } catch {
    return null
  }
}

// --- Zod schemas ---

const postBodySchema = z.object({
  requested_slug: z.string().min(1).max(64),
  requested_name: z.string().min(1),
  youtube_handle_or_url: z.string().min(1),
  include_playlist_ids: z.array(z.string()).default([]),
  exclude_playlist_ids: z.array(z.string()).default([]),
  contact_email: z.string().email(),
})

const post201Schema = z.object({
  request_id: z.string(),
  status_url: z.string(),
  search_url: z.string(),
})

const post400Schema = z.object({ error: z.string(), reason: z.string().optional() })
const post409Schema = z.object({
  error: z.string(),
  existing_slug: z.string().optional(),
  search_url: z.string().optional(),
  is_yours: z.boolean().optional(),
  request_id: z.string().optional(),
  note: z.string().optional(),
})
const post422Schema = z.object({ error: z.string() })
const post429Schema = z.object({
  error: z.string(),
  retry_after_seconds: z.number(),
})
const errorSchema = z.object({ error: z.string(), sign_in_url: z.string().optional() })

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(64),
})

const preflightQuerySchema = z.object({
  handle: z.string().min(1),
})

const preflightResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), youtube_channel_id: z.string() }),
  z.object({
    state: z.literal("already_ingested"),
    existing_slug: z.string(),
    search_url: z.string(),
  }),
  z.object({
    state: z.literal("request_in_flight"),
    existing_slug: z.string(),
    search_url: z.string(),
    is_yours: z.boolean(),
    request_id: z.string().optional(),
  }),
  z.object({ state: z.literal("channel_unavailable") }),
  z.object({ state: z.literal("unknown_handle") }),
])

// --- Plugin factory (dependency injection for testability) ---

export interface RequestsRouteDeps {
  lookupSlugCollision: typeof lookupSlugCollision
  lookupChurchByYoutubeChannelId: typeof lookupChurchByYoutubeChannelId
  lookupInFlightRequestForChurch: typeof lookupInFlightRequestForChurch
  resolveChannelOrNull: typeof resolveChannelOrNull
}

const defaultDeps: RequestsRouteDeps = {
  lookupSlugCollision,
  lookupChurchByYoutubeChannelId,
  lookupInFlightRequestForChurch,
  resolveChannelOrNull,
}

export function createRequestsRoutes(deps: RequestsRouteDeps = defaultDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const ipRateLimit: RateLimitPreHandler = app.rateLimit({
      bucket: "requests:tree:ip",
      limit: 60,
      windowMs: HOUR_MS,
      keyFn: (req) => req.ip,
    })

    const postUserRateLimit: RateLimitPreHandler = app.rateLimit({
      bucket: "requests:post:user",
      limit: 5,
      windowMs: HOUR_MS,
      keyFn: (req) => req.user?.id ?? req.ip,
    })

    const preflightUserRateLimit: RateLimitPreHandler = app.rateLimit({
      bucket: "requests:preflight:user",
      limit: 30,
      windowMs: HOUR_MS,
      keyFn: (req) => req.user?.id ?? req.ip,
    })

    // POST /requests
    app.post(
      "/requests",
      {
        preHandler: [app.requireUser, ipRateLimit, postUserRateLimit],
        schema: {
          tags: ["requests"],
          summary: "Submit a new ingestion request",
          body: postBodySchema,
          response: {
            201: post201Schema,
            400: post400Schema,
            401: errorSchema,
            409: post409Schema,
            422: post422Schema,
            429: post429Schema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) return reply.code(401).send({ error: "unauthenticated" })

        const {
          requested_slug,
          requested_name,
          youtube_handle_or_url,
          include_playlist_ids,
          exclude_playlist_ids,
          contact_email,
        } = request.body

        // 1. Slug validation
        const slugResult = validateSlug(requested_slug)
        if (!slugResult.ok) {
          return reply.code(400).send({ error: "invalid_slug", reason: slugResult.reason })
        }

        // 2. Slug collision
        const taken = await deps.lookupSlugCollision(app.db, requested_slug)
        if (taken) {
          return reply.code(409).send({ error: "slug_taken" })
        }

        // 3. Resolve YouTube channel
        const resolved = await deps.resolveChannelOrNull(app.youtube, youtube_handle_or_url)
        if (!resolved) {
          return reply.code(422).send({ error: "unknown_handle" })
        }

        // 4. Channel dedupe
        const church = await deps.lookupChurchByYoutubeChannelId(app.db, resolved.youtubeChannelId)
        if (church) {
          if (church.status === "active") {
            return reply.code(409).send({
              error: "channel_already_ingested",
              existing_slug: church.slug,
              search_url: searchUrlFor(church.slug),
            })
          }
          if (church.status === "pending") {
            const inflight = await deps.lookupInFlightRequestForChurch(app.db, church.id)
            const is_yours = inflight?.user_id === user.id
            return reply.code(409).send({
              error: "channel_request_in_flight",
              existing_slug: church.slug,
              search_url: searchUrlFor(church.slug),
              is_yours,
              ...(is_yours && inflight ? { request_id: inflight.id } : {}),
            })
          }
          if (church.status === "denied" || church.status === "suspended") {
            return reply.code(409).send({
              error: "channel_unavailable",
              note: "admin attention required",
            })
          }
        }

        // 5. Insert ingestion request
        const row = await app.db
          .insertInto("ingestion_requests")
          .values({
            user_id: user.id,
            church_id: null,
            requested_slug,
            requested_name,
            youtube_handle_or_url,
            include_playlist_ids,
            exclude_playlist_ids,
            contact_email,
            status: "received",
            tokens_ingested: 0,
          })
          .returning("id")
          .executeTakeFirstOrThrow()

        return reply.code(201).send({
          request_id: row.id,
          status_url: statusUrlFor(row.id),
          search_url: searchUrlFor(requested_slug),
        })
      },
    )

    // HEAD /requests/slug-available/:slug
    app.head(
      "/requests/slug-available/:slug",
      {
        preHandler: [app.requireUser, ipRateLimit, preflightUserRateLimit],
        schema: {
          tags: ["requests"],
          summary: "Check if a slug is available",
          params: slugParamsSchema,
          response: {
            200: z.null(),
            400: z.null(),
            401: errorSchema,
            409: z.null(),
            429: post429Schema,
          },
        },
      },
      async (request, reply) => {
        const { slug } = request.params

        const slugResult = validateSlug(slug)
        if (!slugResult.ok) {
          return reply.code(400).send(null)
        }

        const taken = await deps.lookupSlugCollision(app.db, slug)
        if (taken) {
          return reply.code(409).send(null)
        }

        return reply.code(200).send(null)
      },
    )

    // GET /requests/channel-preflight
    app.get(
      "/requests/channel-preflight",
      {
        preHandler: [app.requireUser, ipRateLimit, preflightUserRateLimit],
        schema: {
          tags: ["requests"],
          summary: "Pre-flight check for a YouTube channel handle",
          querystring: preflightQuerySchema,
          response: {
            200: preflightResponseSchema,
            401: errorSchema,
            429: post429Schema,
          },
        },
      },
      async (request, reply) => {
        const user = request.user
        if (!user) return reply.code(401).send({ error: "unauthenticated" })

        const { handle } = request.query

        const resolved = await deps.resolveChannelOrNull(app.youtube, handle)
        if (!resolved) {
          return reply.send({ state: "unknown_handle" as const })
        }

        const church = await deps.lookupChurchByYoutubeChannelId(app.db, resolved.youtubeChannelId)
        if (!church) {
          return reply.send({
            state: "available" as const,
            youtube_channel_id: resolved.youtubeChannelId,
          })
        }

        if (church.status === "active") {
          return reply.send({
            state: "already_ingested" as const,
            existing_slug: church.slug,
            search_url: searchUrlFor(church.slug),
          })
        }

        if (church.status === "pending") {
          const inflight = await deps.lookupInFlightRequestForChurch(app.db, church.id)
          const is_yours = inflight?.user_id === user.id
          return reply.send({
            state: "request_in_flight" as const,
            existing_slug: church.slug,
            search_url: searchUrlFor(church.slug),
            is_yours,
            ...(is_yours && inflight ? { request_id: inflight.id } : {}),
          })
        }

        // denied | suspended
        return reply.send({ state: "channel_unavailable" as const })
      },
    )
  }
}

export const requestsRoutes = createRequestsRoutes(defaultDeps)
