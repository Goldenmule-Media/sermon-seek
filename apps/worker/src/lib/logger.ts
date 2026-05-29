import { Writable } from "node:stream"
import pino from "pino"

const BATCH_SIZE = 20
const FLUSH_INTERVAL_MS = 2_000

function makeIngestStream(apiUrl: string, adminKey: string, workerId: string): Writable {
  const queue: string[] = []

  async function flush() {
    if (queue.length === 0) return
    const batch = queue.splice(0, queue.length)
    const records = batch.flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
    if (records.length === 0) return
    try {
      await fetch(`${apiUrl}/v1/admin/logs/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
          "x-worker-id": workerId,
        },
        body: JSON.stringify({ records }),
      })
    } catch {
      // Never let shipping failures affect the daemon
    }
  }

  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      const lines = text.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) queue.push(trimmed)
      }
      if (queue.length >= BATCH_SIZE) {
        void flush()
      }
      callback()
    },
  })

  const flushTimer = setInterval(() => {
    void flush()
  }, FLUSH_INTERVAL_MS)

  // Allow process to exit even if the timer is live
  if (flushTimer.unref) flushTimer.unref()

  async function drainAndStop() {
    clearInterval(flushTimer)
    await flush()
  }
  ;(stream as Writable & { flush: () => Promise<void> }).flush = drainAndStop

  return stream
}

export interface WorkerLogger {
  trace: pino.LogFn
  debug: pino.LogFn
  info: pino.LogFn
  warn: pino.LogFn
  error: pino.LogFn
  fatal: pino.LogFn
  flush: () => Promise<void>
}

function makeNoopFlush(): () => Promise<void> {
  return () => Promise.resolve()
}

export function createWorkerLogger(workerId: string): WorkerLogger {
  const apiUrl = process.env.WORKER_API_URL?.replace(/\/$/, "") ?? "http://localhost:3001"
  const adminKey = process.env.ADMIN_API_KEY

  const level = process.env.LOG_LEVEL ?? "info"

  let ingestStream: (Writable & { flush?: () => Promise<void> }) | undefined

  const streams: pino.StreamEntry[] = [{ stream: process.stdout }]

  if (adminKey) {
    ingestStream = makeIngestStream(apiUrl, adminKey, workerId) as Writable & {
      flush?: () => Promise<void>
    }
    streams.push({ stream: ingestStream })
  }

  const logger = pino({ level, base: { workerId } }, pino.multistream(streams))

  return {
    trace: logger.trace.bind(logger),
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    fatal: logger.fatal.bind(logger),
    flush: ingestStream?.flush ? ingestStream.flush.bind(ingestStream) : makeNoopFlush(),
  }
}
