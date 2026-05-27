import type { IngestionRequestDetail, IngestionRequestSummary } from "@sermon-search/types"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"
import { config } from "../config.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const detailParamsSchema = z.object({
  id: z.string().uuid(),
})

const summaryShape = z.object({
  id: z.string(),
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
})

const listResponseSchema = z.object({
  requests: z.array(summaryShape),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
})

const detailResponseSchema = summaryShape.extend({
  requested_name: z.string(),
  youtube_handle_or_url: z.string(),
  contact_email: z.string(),
  include_playlist_ids: z.array(z.string()),
  exclude_playlist_ids: z.array(z.string()),
  admin_note: z.string().nullable(),
  updated_at: z.string(),
})

export function buildSearchUrl(churchSlug: string | null | undefined): string | null {
  return churchSlug ? `/${churchSlug}/` : null
}

function toSummary(
  row: {
    id: string
    requested_slug: string
    status: string
    videos_discovered: number
    videos_ingested: number
    tokens_ingested: unknown
    limit_reached: boolean
    created_at: unknown
    church_slug: string | null
  },
  tokensCap: number,
): IngestionRequestSummary {
  return {
    id: row.id,
    requested_slug: row.requested_slug,
    status: row.status as IngestionRequestSummary["status"],
    videos_discovered: row.videos_discovered,
    videos_ingested: row.videos_ingested,
    tokens_ingested: Number(row.tokens_ingested),
    tokens_cap: tokensCap,
    search_url: buildSearchUrl(row.church_slug),
    limit_reached: row.limit_reached,
    created_at: (row.created_at as Date).toISOString(),
  }
}

export const meRequestsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me/requests",
    {
      preHandler: app.requireUser,
      schema: {
        tags: ["auth"],
        summary: "List the current user's ingestion requests",
        querystring: listQuerySchema,
        response: {
          200: listResponseSchema,
          401: z.object({ error: z.string(), sign_in_url: z.string().optional() }),
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: "unauthenticated" })

      const { limit, offset } = request.query
      const userId = request.user.id
      const tokensCap = config.LIMITED_INGEST_TOKEN_CAP

      const baseQuery = app.db
        .selectFrom("ingestion_requests")
        .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
        .where("ingestion_requests.user_id", "=", userId)

      const [rows, countResult] = await Promise.all([
        baseQuery
          .select([
            "ingestion_requests.id",
            "ingestion_requests.requested_slug",
            "ingestion_requests.status",
            "ingestion_requests.videos_discovered",
            "ingestion_requests.videos_ingested",
            "ingestion_requests.tokens_ingested",
            "ingestion_requests.limit_reached",
            "ingestion_requests.created_at",
            "churches.slug as church_slug",
          ])
          .orderBy("ingestion_requests.created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute(),
        baseQuery
          .select(sql<string>`count(*)`.as("count"))
          .executeTakeFirstOrThrow(),
      ])

      const requests = rows.map((row) => toSummary(row, tokensCap))

      return reply.send({
        requests,
        total: Number(countResult.count),
        limit,
        offset,
      })
    },
  )

  app.get(
    "/me/requests/:id",
    {
      preHandler: app.requireUser,
      schema: {
        tags: ["auth"],
        summary: "Get a single ingestion request status",
        params: detailParamsSchema,
        response: {
          200: detailResponseSchema,
          401: z.object({ error: z.string(), sign_in_url: z.string().optional() }),
          403: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: "unauthenticated" })

      const { id } = request.params
      const tokensCap = config.LIMITED_INGEST_TOKEN_CAP

      const row = await app.db
        .selectFrom("ingestion_requests")
        .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
        .where("ingestion_requests.id", "=", id)
        .select([
          "ingestion_requests.id",
          "ingestion_requests.user_id",
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
          "churches.slug as church_slug",
        ])
        .executeTakeFirst()

      if (!row) {
        return reply.code(404).send({ error: "not_found" })
      }

      if (row.user_id !== request.user.id) {
        return reply.code(403).send({ error: "forbidden" })
      }

      const detail: IngestionRequestDetail = {
        ...toSummary(row, tokensCap),
        requested_name: row.requested_name,
        youtube_handle_or_url: row.youtube_handle_or_url,
        contact_email: row.contact_email,
        include_playlist_ids: row.include_playlist_ids,
        exclude_playlist_ids: row.exclude_playlist_ids,
        admin_note: row.admin_note,
        updated_at: (row.updated_at as unknown as Date).toISOString(),
      }

      return reply.send(detail)
    },
  )
}
