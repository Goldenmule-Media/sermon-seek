import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().min(1).max(100).optional(),
  target_type: z.string().min(1).max(100).optional(),
  user_id: z.string().uuid().optional(),
})

const auditEntrySchema = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  user_display_name: z.string().nullable(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  payload: z.any().nullable(),
  created_at: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number(),
})

const errorSchema = z.object({ error: z.string() })

export const adminAuditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/audit",
    {
      preHandler: app.requireAdminOrApiKey,
      schema: {
        tags: ["admin"],
        summary: "List admin audit log entries",
        querystring: listQuerySchema,
        response: {
          200: listResponseSchema,
          401: errorSchema,
          403: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { limit, offset, action, target_type, user_id } = request.query

      let baseQuery = app.db
        .selectFrom("admin_audit_log")
        .leftJoin("users", "users.id", "admin_audit_log.user_id")

      if (action) {
        baseQuery = baseQuery.where("admin_audit_log.action", "=", action)
      }
      if (target_type) {
        baseQuery = baseQuery.where("admin_audit_log.target_type", "=", target_type)
      }
      if (user_id) {
        baseQuery = baseQuery.where("admin_audit_log.user_id", "=", user_id)
      }

      const [rows, countResult] = await Promise.all([
        baseQuery
          .select([
            "admin_audit_log.id",
            "admin_audit_log.user_id",
            "admin_audit_log.action",
            "admin_audit_log.target_type",
            "admin_audit_log.target_id",
            "admin_audit_log.payload",
            "admin_audit_log.created_at",
            "users.display_name",
          ])
          .orderBy("admin_audit_log.created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute(),
        baseQuery.select(sql<string>`count(*)`.as("count")).executeTakeFirstOrThrow(),
      ])

      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          user_id: row.user_id ?? null,
          user_display_name: row.display_name ?? null,
          action: row.action,
          target_type: row.target_type,
          target_id: row.target_id,
          payload: row.payload ?? null,
          created_at: (row.created_at as unknown as Date).toISOString(),
        })),
        total: Number(countResult.count),
      })
    },
  )
}
