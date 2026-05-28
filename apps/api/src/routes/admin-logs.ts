import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { config } from "../config.js"
import { levelValueFromLabel, logBuffer } from "../lib/log-buffer.js"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const

function parseDuration(s: string): number {
  const n = Number.parseInt(s.slice(0, -1), 10)
  const unit = s.at(-1)
  if (unit === "s") return n * 1_000
  if (unit === "m") return n * 60_000
  if (unit === "h") return n * 3_600_000
  return 0
}

const logRecordSchema = z.object({
  time: z.number(),
  level: z.number(),
  levelLabel: z.enum(LOG_LEVELS),
  msg: z.string().nullable(),
  fields: z.record(z.unknown()),
})

const errorSchema = z.object({ error: z.string() })

export const adminLogsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/admin/logs",
    {
      schema: {
        tags: ["admin"],
        summary: "Recent log records (JSON) or live stream (SSE)",
        querystring: z.object({
          follow: z.coerce.boolean().default(false),
          level: z.enum(LOG_LEVELS).optional(),
          since: z
            .string()
            .regex(/^\d+[smh]$/)
            .optional(),
          limit: z.coerce.number().int().min(1).max(config.LOG_BUFFER_SIZE).default(200),
        }),
        response: {
          200: z.object({ records: z.array(logRecordSchema) }),
          401: errorSchema,
        },
      },
      preHandler: app.requireAdminApiKey,
    },
    async (request, reply) => {
      const { follow, level, since, limit } = request.query
      const minLevel = level ? levelValueFromLabel(level) : 0
      const sinceMs = since ? parseDuration(since) : 0

      if (!follow) {
        return reply.send({ records: logBuffer.recent({ minLevel, sinceMs, limit }) })
      }

      // SSE follow mode — hijack the raw socket
      const raw = reply.raw
      reply.hijack()
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      })

      const passesFilter = (rec: { level: number; time: number }) =>
        rec.level >= minLevel && (sinceMs === 0 || rec.time >= Date.now() - sinceMs)

      // Replay buffered records
      for (const rec of logBuffer.recent({ minLevel, sinceMs, limit })) {
        raw.write(`data: ${JSON.stringify(rec)}\n\n`)
      }

      // Stream live records
      const unsub = logBuffer.subscribe((rec) => {
        if (passesFilter(rec)) {
          raw.write(`data: ${JSON.stringify(rec)}\n\n`)
        }
      })

      const heartbeat = setInterval(() => {
        raw.write(": ping\n\n")
      }, 15_000)

      request.raw.on("close", () => {
        unsub()
        clearInterval(heartbeat)
        raw.end()
      })
    },
  )
}
