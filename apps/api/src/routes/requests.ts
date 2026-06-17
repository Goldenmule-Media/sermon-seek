import type { Database } from "@sermon-search/db"
import { validateSlug } from "@sermon-search/types"
import { resolveChannel, validatePlaylistTarget } from "@sermon-search/worker"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { z } from "zod"
import { columnsToPlaylistFilters, playlistFiltersToColumns } from "../lib/playlist-filters.js"
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
    .unionAll(
      db
        .selectFrom("ingestion_requests")
        .select("id")
        .where("requested_slug", "=", slug)
        .where("status", "not in", ["denied", "failed", "complete"]),
    )
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

// NOTE: Only finds requests that already have church_id set. A freshly-submitted
// request has church_id=null until the worker creates the church row on its first
// run, so the YouTube-channel dedupe window doesn't open until then.
// Follow-up: widen to non-terminal requests sharing the same resolved youtube_channel_id.
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

const playlistFiltersSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("none"), playlist_ids: z.array(z.string()).max(0).default([]) }),
    z.object({ mode: z.literal("include"), playlist_ids: z.array(z.string()).min(1) }),
    z.object({ mode: z.literal("exclude"), playlist_ids: z.array(z.string()).min(1) }),
  ])
  .default({ mode: "none", playlist_ids: [] })

const postBodySchema = z.object({
  requested_slug: z.string().min(1).max(64),
  requested_name: z.string().min(1),
  youtube_handle_or_url: z.string().min(1),
  playlist_filters: playlistFiltersSchema,
  contact_email: z.string().email(),
})

/**
 * `search_url` is always null at submit time because `church_id` is not yet
 * populated — the worker links the church row on its first run and the status
 * page falls back to `/${requested_slug}/` until then.
 */
const post201Schema = z.object({
  request_id: z.string(),
  status_url: z.string(),
  search_url: z.string().nullable(),
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
const post422Schema = z.discriminatedUnion("error", [
  z.object({ error: z.literal("unknown_handle") }),
  z.object({
    error: z.literal("invalid_playlist_filters"),
    playlist_errors: z.record(z.string()),
  }),
])
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

    // Separate, higher IP bucket for typing-feedback endpoints (slug-available + channel-preflight).
    // These are hit per keystroke (~300ms debounce) and must not share the POST submission bucket —
    // users on shared NAT would exhaust 60/hr before anyone can submit.
    const ipTypingRateLimit: RateLimitPreHandler = app.rateLimit({
      bucket: "requests:typing:ip",
      limit: 600,
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
          playlist_filters,
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

        // 3.5 Validate playlist filters
        if (playlist_filters.mode !== "none") {
          const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{13,64}$/
          const playlist_errors: Record<string, string> = {}

          const ids = playlist_filters.playlist_ids
          const syntaxOk: string[] = []
          for (const id of ids) {
            if (!PLAYLIST_ID_RE.test(id)) {
              playlist_errors[id] = "invalid_format"
            } else {
              syntaxOk.push(id)
            }
          }

          if (syntaxOk.length > 0) {
            const results = await Promise.all(
              syntaxOk.map((id) =>
                validatePlaylistTarget({
                  youtube: app.youtube,
                  youtubeChannelId: resolved.youtubeChannelId,
                  targetId: id,
                }),
              ),
            )
            for (const [i, id] of syntaxOk.entries()) {
              const result = results[i]
              if (!result) continue
              if (!result.ok) {
                const code =
                  result.reason === "not_found"
                    ? "not_found_on_youtube"
                    : result.reason === "wrong_channel"
                      ? "wrong_channel"
                      : "youtube_error"
                playlist_errors[id] = code
              }
            }
          }

          if (Object.keys(playlist_errors).length > 0) {
            return reply.code(422).send({ error: "invalid_playlist_filters", playlist_errors })
          }
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
        const { include_playlist_ids, exclude_playlist_ids } =
          playlistFiltersToColumns(playlist_filters)
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
          search_url: null,
        })
      },
    )

    // HEAD /requests/slug-available/:slug
    app.head(
      "/requests/slug-available/:slug",
      {
        preHandler: [app.requireUser, ipTypingRateLimit, preflightUserRateLimit],
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
        preHandler: [app.requireUser, ipTypingRateLimit, preflightUserRateLimit],
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
