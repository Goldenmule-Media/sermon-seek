import type { AdminLogRecord } from "@sermon-search/types"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { config } from "../config.js"
import {
  ingestWorkerRecords,
  levelValueFromLabel,
  logBuffer,
  mergeRecent,
  workerLogBuffer,
} from "../lib/log-buffer.js"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const
const LOG_SOURCES = ["api", "worker", "all"] as const

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
  source: z.enum(["api", "worker"]).optional(),
  workerId: z.string().nullable().optional(),
})

const errorSchema = z.object({ error: z.string() })

function selectBuffers(source: "api" | "worker" | "all") {
  if (source === "api") return [logBuffer]
  if (source === "worker") return [workerLogBuffer]
  return [logBuffer, workerLogBuffer]
}

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
          source: z.enum(LOG_SOURCES).default("api"),
          workerId: z.string().optional(),
        }),
        response: {
          200: z.object({ records: z.array(logRecordSchema) }),
          401: errorSchema,
        },
      },
      preHandler: app.requireAdminApiKey,
    },
    async (request, reply) => {
      const { follow, level, since, limit, source, workerId } = request.query
      const minLevel = level ? levelValueFromLabel(level) : 0
      const sinceMs = since ? parseDuration(since) : 0
      const buffers = selectBuffers(source)

      const passesFilter = (rec: AdminLogRecord) =>
        rec.level >= minLevel &&
        (sinceMs === 0 || rec.time >= Date.now() - sinceMs) &&
        (workerId === undefined || rec.workerId === workerId)

      if (!follow) {
        const records = mergeRecent(buffers, { minLevel, sinceMs, limit }).filter(passesFilter)
        return reply.send({ records })
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

      // Replay buffered records
      for (const rec of mergeRecent(buffers, { minLevel, sinceMs, limit })) {
        if (passesFilter(rec)) raw.write(`data: ${JSON.stringify(rec)}\n\n`)
      }

      // Stream live records from selected buffers
      const unsubs = buffers.map((buf) =>
        buf.subscribe((rec) => {
          if (passesFilter(rec)) {
            raw.write(`data: ${JSON.stringify(rec)}\n\n`)
          }
        }),
      )

      const heartbeat = setInterval(() => {
        raw.write(": ping\n\n")
      }, 15_000)

      request.raw.on("close", () => {
        for (const unsub of unsubs) unsub()
        clearInterval(heartbeat)
        raw.end()
      })
    },
  )

  app.post(
    "/admin/logs/ingest",
    {
      schema: {
        tags: ["admin"],
        summary: "Ingest worker log records into the worker ring buffer",
        body: z.object({
          records: z.array(logRecordSchema),
          workerId: z.string().optional(),
        }),
        response: {
          200: z.object({ ingested: z.number() }),
          401: errorSchema,
        },
      },
      preHandler: app.requireAdminApiKey,
    },
    async (request, reply) => {
      const wid = request.headers["x-worker-id"] as string | undefined
      const workerId = wid ?? request.body.workerId ?? "unknown"
      ingestWorkerRecords(workerLogBuffer, request.body.records as AdminLogRecord[], workerId)
      return reply.send({ ingested: request.body.records.length })
    },
  )
}
