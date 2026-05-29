import { Writable } from "node:stream"
import type { AdminLogRecord, LogLevelLabel } from "@sermon-search/types"
import pino from "pino"
import { config } from "../config.js"

type Subscriber = (rec: AdminLogRecord) => void

export class LogBuffer {
  private readonly capacity: number
  private readonly records: AdminLogRecord[] = []
  private readonly subscribers = new Set<Subscriber>()

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(rec: AdminLogRecord): void {
    if (this.records.length >= this.capacity) {
      this.records.shift()
    }
    this.records.push(rec)
    for (const fn of this.subscribers) {
      fn(rec)
    }
  }

  recent({
    minLevel = 0,
    sinceMs = 0,
    limit = 200,
  }: { minLevel?: number; sinceMs?: number; limit?: number } = {}): AdminLogRecord[] {
    const cutoff = sinceMs > 0 ? Date.now() - sinceMs : 0
    const filtered = this.records.filter((r) => r.level >= minLevel && r.time >= cutoff)
    return filtered.slice(-limit)
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }
}

export function mergeRecent(
  buffers: LogBuffer[],
  opts: { minLevel?: number; sinceMs?: number; limit?: number } = {},
): AdminLogRecord[] {
  const { limit = 200 } = opts
  const all = buffers.flatMap((b) => b.recent(opts))
  all.sort((a, b) => a.time - b.time)
  return all.slice(-limit)
}

export function ingestWorkerRecords(
  workerBuffer: LogBuffer,
  records: AdminLogRecord[],
  workerId: string,
): void {
  for (const rec of records) {
    workerBuffer.push({ ...rec, source: "worker", workerId })
  }
}

export function createLogBufferStream(buffer: LogBuffer): Writable {
  let partial = ""

  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      partial += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      const lines = partial.split("\n")
      partial = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>
          const { time, level, msg, ...rest } = parsed
          const numLevel = typeof level === "number" ? level : 0
          const rec: AdminLogRecord = {
            time: typeof time === "number" ? time : Date.now(),
            level: numLevel,
            levelLabel: (pino.levels.labels[numLevel] ?? "info") as LogLevelLabel,
            msg: typeof msg === "string" ? msg : null,
            fields: rest,
            source: "api",
          }
          buffer.push(rec)
        } catch {
          // malformed NDJSON — ignore
        }
      }
      callback()
    },
  })
}

export function levelValueFromLabel(label: string): number {
  return (pino.levels.values as Record<string, number>)[label] ?? 0
}

export const logBuffer = new LogBuffer(config.LOG_BUFFER_SIZE)
export const workerLogBuffer = new LogBuffer(config.LOG_BUFFER_SIZE)
