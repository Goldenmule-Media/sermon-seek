import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const listQuerySchema = z.object({
  slug_prefix: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const churchStatusEnum = z.enum(["pending", "active", "suspended", "denied"])

const churchSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: churchStatusEnum,
  channel_count: z.number(),
  video_count: z.number(),
  created_at: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(churchSummarySchema),
  total: z.number(),
})

const aliasSchema = z.object({
  id: z.string(),
  slug: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
})

const channelSchema = z.object({
  id: z.string(),
  youtube_channel_id: z.string(),
  title: z.string(),
  ingested_at: z.string(),
})

const detailResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: churchStatusEnum,
  youtube_channel_id: z.string().nullable(),
  created_at: z.string(),
  channel_count: z.number(),
  video_count: z.number(),
  aliases: z.array(aliasSchema),
  channels: z.array(channelSchema),
})

const errorSchema = z.object({ error: z.string() })

export const adminChurchesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/churches",
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "List all churches (admin)",
        querystring: listQuerySchema,
        response: {
          200: listResponseSchema,
          401: errorSchema,
          403: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug_prefix, limit, offset } = request.query

      let baseQuery = app.db.selectFrom("churches")

      if (slug_prefix) {
        baseQuery = baseQuery.where("slug", "like", `${slug_prefix}%`)
      }

      const [rows, countResult] = await Promise.all([
        baseQuery
          .select((eb) => [
            "churches.id",
            "churches.slug",
            "churches.name",
            "churches.status",
            "churches.created_at",
            eb
              .selectFrom("channels")
              .select(sql<string>`count(*)`.as("c"))
              .whereRef("channels.church_id", "=", "churches.id")
              .as("channel_count"),
            eb
              .selectFrom("videos")
              .select(sql<string>`count(*)`.as("c"))
              .whereRef("videos.church_id", "=", "churches.id")
              .as("video_count"),
          ])
          .orderBy("churches.created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute(),
        baseQuery.select(sql<string>`count(*)`.as("count")).executeTakeFirstOrThrow(),
      ])

      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          status: row.status,
          channel_count: Number(row.channel_count ?? 0),
          video_count: Number(row.video_count ?? 0),
          created_at: (row.created_at as unknown as Date).toISOString(),
        })),
        total: Number(countResult.count),
      })
    },
  )

  app.get(
    "/admin/churches/:id",
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Get church detail (admin)",
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

      const church = await app.db
        .selectFrom("churches")
        .select(["id", "slug", "name", "status", "youtube_channel_id", "created_at"])
        .where("id", "=", id)
        .executeTakeFirst()

      if (!church) {
        return reply.code(404).send({ error: "not_found" })
      }

      const [aliases, channels, videoCountResult] = await Promise.all([
        app.db
          .selectFrom("church_slug_aliases")
          .select(["id", "slug", "created_at", "expires_at"])
          .where("church_id", "=", id)
          .orderBy("created_at", "desc")
          .execute(),
        app.db
          .selectFrom("channels")
          .select(["id", "youtube_channel_id", "title", "ingested_at"])
          .where("church_id", "=", id)
          .execute(),
        app.db
          .selectFrom("videos")
          .select(sql<string>`count(*)`.as("count"))
          .where("church_id", "=", id)
          .executeTakeFirstOrThrow(),
      ])

      return reply.send({
        id: church.id,
        slug: church.slug,
        name: church.name,
        status: church.status,
        youtube_channel_id: church.youtube_channel_id ?? null,
        created_at: (church.created_at as unknown as Date).toISOString(),
        channel_count: channels.length,
        video_count: Number(videoCountResult.count),
        aliases: aliases.map((a) => ({
          id: a.id,
          slug: a.slug,
          created_at: (a.created_at as unknown as Date).toISOString(),
          expires_at: a.expires_at ? (a.expires_at as unknown as Date).toISOString() : null,
        })),
        channels: channels.map((c) => ({
          id: c.id,
          youtube_channel_id: c.youtube_channel_id,
          title: c.title,
          ingested_at: (c.ingested_at as unknown as Date).toISOString(),
        })),
      })
    },
  )
}
