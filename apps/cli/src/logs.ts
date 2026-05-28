import type { AdminLogRecord, LogLevelLabel } from "@sermon-search/types"
import { z } from "zod"
import type { LogQuery } from "./client.js"
import type { ResolvedInstance } from "./instance.js"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const

export const logRecordSchema = z.object({
  time: z.number(),
  level: z.number(),
  levelLabel: z.enum(LOG_LEVELS),
  msg: z.string().nullable(),
  fields: z.record(z.unknown()),
}) satisfies z.ZodType<AdminLogRecord>

export function parseLogLine(data: string): AdminLogRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  const result = logRecordSchema.safeParse(raw)
  return result.success ? result.data : null
}

export async function* iterateSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""

  const reader = body.getReader()
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        for (const line of block.split("\n")) {
          if (line.startsWith(":")) continue // heartbeat / comment
          if (line.startsWith("data:")) {
            yield line.slice(5).trimStart()
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

const MAX_BACKOFF_MS = 15_000

function buildSseUrl(baseUrl: string, query: LogQuery, lastSeenTime: number): string {
  const params = new URLSearchParams({ follow: "true" })
  if (query.level) params.set("level", query.level)
  if (query.limit != null) params.set("limit", String(query.limit))

  // After reconnect, tighten the `since` window to bound buffered replay.
  // Convert lastSeenTime (epoch ms) into a seconds-based since value.
  if (lastSeenTime > 0) {
    const secondsAgo = Math.max(1, Math.ceil((Date.now() - lastSeenTime) / 1_000))
    params.set("since", `${secondsAgo}s`)
  } else if (query.since) {
    params.set("since", query.since)
  }

  return `${baseUrl.replace(/\/$/, "")}/v1/admin/logs?${params.toString()}`
}

export interface StreamLogsCallbacks {
  onRecord: (rec: AdminLogRecord) => void
  onNotice: (msg: string) => void
  signal: AbortSignal
}

export async function streamLogs(
  instance: ResolvedInstance,
  query: LogQuery,
  { onRecord, onNotice, signal }: StreamLogsCallbacks,
): Promise<void> {
  const { baseUrl, adminKey, name } = instance
  let lastSeen = 0
  let backoffMs = 1_000
  let firstConnect = true

  while (!signal.aborted) {
    const url = buildSseUrl(baseUrl, query, firstConnect ? 0 : lastSeen)
    firstConnect = false

    let res: Response
    try {
      res = await fetch(url, {
        headers: { "x-admin-key": adminKey },
        signal,
      })
    } catch (err) {
      if (signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      onNotice(`Can't reach ${baseUrl}: ${msg} — reconnecting in ${backoffMs / 1000}s…`)
      await sleep(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
      continue
    }

    if (res.status === 401) {
      throw new Error(`Admin key rejected for instance "${name}". Check your stored key.`)
    }
    if (!res.ok) {
      onNotice(`HTTP ${res.status} from ${baseUrl} — reconnecting in ${backoffMs / 1000}s…`)
      await sleep(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
      continue
    }

    // Connected successfully — reset backoff
    backoffMs = 1_000

    if (!res.body) {
      onNotice("Empty response body — reconnecting…")
      await sleep(1_000, signal)
      continue
    }

    try {
      for await (const data of iterateSse(res.body as ReadableStream<Uint8Array>, signal)) {
        const rec = parseLogLine(data)
        if (!rec) continue
        if (rec.time > lastSeen) {
          lastSeen = rec.time
          onRecord(rec)
        }
      }
    } catch (err) {
      if (signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      onNotice(`Stream error: ${msg} — reconnecting in ${backoffMs / 1000}s…`)
      await sleep(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
      continue
    }

    // Stream ended cleanly — reconnect
    if (!signal.aborted) {
      onNotice(`Stream ended — reconnecting in ${backoffMs / 1000}s…`)
      await sleep(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const tid = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(tid)
      resolve()
    })
  })
}

export type { LogLevelLabel }
export const LOG_LEVEL_LABELS: readonly LogLevelLabel[] = LOG_LEVELS
