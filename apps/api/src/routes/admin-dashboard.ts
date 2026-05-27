import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"

const requestCountsSchema = z.object({
  pending: z.number(),
  awaiting_approval: z.number(),
  approved: z.number(),
  running: z.number(),
  failed: z.number(),
  complete: z.number(),
  denied: z.number(),
})

const recentIngestSchema = z.object({
  request_id: z.string(),
  slug: z.string().nullable(),
  status: z.string(),
  updated_at: z.string(),
})

const summaryResponseSchema = z.object({
  requests: requestCountsSchema,
  recent_ingests: z.array(recentIngestSchema),
  last_view_stats_at: z.string().nullable(),
  last_smoke_test_at: z.string().nullable(),
  active_users: z.number(),
})

const errorSchema = z.object({ error: z.string() })

function createDashboardSummaryRoutes(): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/admin/dashboard/summary",
      {
        preHandler: app.requireAdmin,
        schema: {
          tags: ["admin"],
          summary: "Dashboard summary (admin)",
          response: {
            200: summaryResponseSchema,
            401: errorSchema,
            403: errorSchema,
          },
        },
      },
      async (_request, reply) => {
        const [statusRows, recentRows, userCountRow, systemRows] = await Promise.all([
          app.db
            .selectFrom("ingestion_requests")
            .select(["status", sql<number>`count(*)::int`.as("count")])
            .groupBy("status")
            .execute(),

          app.db
            .selectFrom("ingestion_requests")
            .leftJoin("churches", "churches.id", "ingestion_requests.church_id")
            .select([
              "ingestion_requests.id as request_id",
              "churches.slug",
              "ingestion_requests.status",
              "ingestion_requests.updated_at",
            ])
            .orderBy("ingestion_requests.updated_at", "desc")
            .limit(10)
            .execute(),

          app.db
            .selectFrom("users")
            .select(sql<number>`count(*)::int`.as("count"))
            .where("status", "=", "active")
            .executeTakeFirstOrThrow(),

          app.db
            .selectFrom("system_runs")
            .selectAll()
            .where("kind", "in", ["view-stats", "smoke-test"])
            .execute(),
        ])

        const countByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))
        const systemByKind = new Map(systemRows.map((r) => [r.kind, r]))

        return reply.send({
          requests: {
            pending: countByStatus["received"] ?? 0,
            awaiting_approval: countByStatus["awaiting_approval"] ?? 0,
            approved: countByStatus["approved"] ?? 0,
            running: countByStatus["running"] ?? 0,
            failed: countByStatus["failed"] ?? 0,
            complete: countByStatus["complete"] ?? 0,
            denied: countByStatus["denied"] ?? 0,
          },
          recent_ingests: recentRows.map((r) => ({
            request_id: r.request_id,
            slug: r.slug ?? null,
            status: r.status,
            updated_at: (r.updated_at as unknown as Date).toISOString(),
          })),
          last_view_stats_at: (() => {
            const r = systemByKind.get("view-stats")
            if (!r) return null
            const d = r.last_run_at instanceof Date ? r.last_run_at : new Date(r.last_run_at as string)
            return d.toISOString()
          })(),
          last_smoke_test_at: (() => {
            const r = systemByKind.get("smoke-test")
            if (!r) return null
            const d = r.last_run_at instanceof Date ? r.last_run_at : new Date(r.last_run_at as string)
            return d.toISOString()
          })(),
          active_users: userCountRow.count,
        })
      },
    )
  }
}

export const dashboardSummaryRoutes = createDashboardSummaryRoutes()
