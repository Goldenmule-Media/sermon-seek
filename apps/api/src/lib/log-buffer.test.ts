import type { Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { LOG_BUFFER_SIZE: 1000 },
}))

import type { AdminLogRecord } from "@sermon-search/types"
import { LogBuffer, createLogBufferStream } from "./log-buffer.js"

function makeRecord(overrides: Partial<AdminLogRecord> = {}): AdminLogRecord {
  return {
    time: Date.now(),
    level: 30,
    levelLabel: "info",
    msg: "test",
    fields: {},
    ...overrides,
  }
}

describe("LogBuffer", () => {
  it("evicts oldest record when capacity is exceeded", () => {
    const buf = new LogBuffer(3)
    const r1 = makeRecord({ msg: "first" })
    const r2 = makeRecord({ msg: "second" })
    const r3 = makeRecord({ msg: "third" })
    const r4 = makeRecord({ msg: "fourth" })
    buf.push(r1)
    buf.push(r2)
    buf.push(r3)
    buf.push(r4)
    const all = buf.recent({ limit: 10 })
    expect(all).toHaveLength(3)
    expect(all.map((r) => r.msg)).toEqual(["second", "third", "fourth"])
  })

  it("recent filters by minLevel", () => {
    const buf = new LogBuffer(100)
    buf.push(makeRecord({ level: 10, levelLabel: "trace" }))
    buf.push(makeRecord({ level: 20, levelLabel: "debug" }))
    buf.push(makeRecord({ level: 30, levelLabel: "info" }))
    buf.push(makeRecord({ level: 40, levelLabel: "warn" }))
    const result = buf.recent({ minLevel: 30 })
    expect(result.every((r) => r.level >= 30)).toBe(true)
    expect(result).toHaveLength(2)
  })

  it("recent filters by sinceMs", async () => {
    const buf = new LogBuffer(100)
    const old = makeRecord({ time: Date.now() - 10_000 })
    const fresh = makeRecord({ time: Date.now() })
    buf.push(old)
    buf.push(fresh)
    const result = buf.recent({ sinceMs: 5_000 })
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(fresh.time)
  })

  it("recent honors limit", () => {
    const buf = new LogBuffer(100)
    for (let i = 0; i < 10; i++) buf.push(makeRecord({ msg: `msg-${i}` }))
    const result = buf.recent({ limit: 3 })
    expect(result).toHaveLength(3)
    expect(result[2].msg).toBe("msg-9")
  })

  it("notifies live subscribers on push", () => {
    const buf = new LogBuffer(100)
    const received: AdminLogRecord[] = []
    const unsub = buf.subscribe((r) => received.push(r))
    const rec = makeRecord()
    buf.push(rec)
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(rec)
    unsub()
    buf.push(makeRecord())
    expect(received).toHaveLength(1)
  })

  it("unsubscribe stops future deliveries", () => {
    const buf = new LogBuffer(100)
    const received: AdminLogRecord[] = []
    const unsub = buf.subscribe((r) => received.push(r))
    unsub()
    buf.push(makeRecord())
    expect(received).toHaveLength(0)
  })
})

describe("createLogBufferStream", () => {
  function writeToStream(stream: Writable, lines: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.write(`${lines.join("\n")}\n`, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  it("parses NDJSON lines into AdminLogRecords", async () => {
    const buf = new LogBuffer(100)
    const stream = createLogBufferStream(buf)
    const nowMs = Date.now()
    await writeToStream(stream, [
      JSON.stringify({ time: nowMs, level: 30, msg: "hello", pid: 1, hostname: "h" }),
    ])
    const records = buf.recent()
    expect(records).toHaveLength(1)
    expect(records[0].time).toBe(nowMs)
    expect(records[0].level).toBe(30)
    expect(records[0].levelLabel).toBe("info")
    expect(records[0].msg).toBe("hello")
    expect(records[0].fields.pid).toBe(1)
    expect(records[0].fields.hostname).toBe("h")
  })

  it("ignores malformed lines without throwing", async () => {
    const buf = new LogBuffer(100)
    const stream = createLogBufferStream(buf)
    await writeToStream(stream, ["not json", "{broken"])
    expect(buf.recent()).toHaveLength(0)
  })

  it("handles partial chunks split across writes", async () => {
    const buf = new LogBuffer(100)
    const stream = createLogBufferStream(buf)
    const line = JSON.stringify({ time: Date.now(), level: 40, msg: "split" })
    await new Promise<void>((resolve) => stream.write(line.slice(0, 10), () => resolve()))
    expect(buf.recent()).toHaveLength(0)
    await new Promise<void>((resolve) => stream.write(`${line.slice(10)}\n`, () => resolve()))
    expect(buf.recent()).toHaveLength(1)
    expect(buf.recent()[0].msg).toBe("split")
  })
})
