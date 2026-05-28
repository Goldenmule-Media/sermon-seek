import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const STALE_THRESHOLD_MS = 60_000

const workerRowSchema = z.object({
  worker_id: z.string(),
  kind: z.string(),
  last_beat_at: z.string(),
  status: z.string(),
  last_job_id: z.string().nullable(),
  message: z.string().nullable(),
  stale: z.boolean(),
})

const systemRunShape = z.object({
  last_run_at: z.string().nullable(),
  last_status: z.string().nullable(),
})

const healthResponseSchema = z.object({
  workers: z.array(workerRowSchema),
  view_stats: systemRunShape,
  smoke_test: systemRunShape,
})

const errorSchema = z.object({ error: z.string(), sign_in_url: z.string().optional() })

export const adminHealthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/health",
    {
      schema: {
        tags: ["admin"],
        summary: "Worker heartbeat and system run status",
        response: {
          200: healthResponseSchema,
          401: errorSchema,
          403: errorSchema,
        },
      },
      preHandler: app.requireAdminOrApiKey,
    },
    async (_request, reply) => {
      const now = Date.now()

      const heartbeatRows = await app.db
        .selectFrom("worker_heartbeats")
        .selectAll()
        .orderBy("kind")
        .orderBy("worker_id")
        .execute()

      const workers = heartbeatRows.map((row) => {
        const beatAt = row.last_beat_at instanceof Date ? row.last_beat_at : new Date(row.last_beat_at as string)
        return {
          worker_id: row.worker_id,
          kind: row.kind,
          last_beat_at: beatAt.toISOString(),
          status: row.status,
          last_job_id: row.last_job_id,
          message: row.message,
          stale: now - beatAt.getTime() > STALE_THRESHOLD_MS,
        }
      })

      const systemRows = await app.db
        .selectFrom("system_runs")
        .selectAll()
        .where("kind", "in", ["view-stats", "smoke-test"])
        .execute()

      const byKind = new Map(systemRows.map((r) => [r.kind, r]))

      const toShape = (kind: string) => {
        const row = byKind.get(kind)
        if (!row) return { last_run_at: null, last_status: null }
        const runAt = row.last_run_at instanceof Date ? row.last_run_at : new Date(row.last_run_at as string)
        return { last_run_at: runAt.toISOString(), last_status: row.last_status }
      }

      return reply.send({
        workers,
        view_stats: toShape("view-stats"),
        smoke_test: toShape("smoke-test"),
      })
    },
  )
}
