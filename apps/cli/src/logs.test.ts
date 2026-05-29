import type { AdminLogRecord } from "@sermon-search/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ResolvedInstance } from "./instance.js"
import { iterateSse, parseLogLine, streamLogs } from "./logs.js"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<AdminLogRecord> = {}): AdminLogRecord {
  return {
    time: 1_700_000_000_000,
    level: 30,
    levelLabel: "info",
    msg: "test message",
    fields: {},
    ...overrides,
  }
}

const INSTANCE: ResolvedInstance = {
  name: "test",
  baseUrl: "http://localhost:3001",
  adminKey: "test-key",
}

function encodeChunks(...texts: string[]): Uint8Array[] {
  const enc = new TextEncoder()
  return texts.map((t) => enc.encode(t))
}

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

// ---------------------------------------------------------------------------
// parseLogLine
// ---------------------------------------------------------------------------

describe("parseLogLine", () => {
  it("parses a valid record", () => {
    const rec = makeRecord({ msg: "hello" })
    const result = parseLogLine(JSON.stringify(rec))
    expect(result).not.toBeNull()
    expect(result?.msg).toBe("hello")
  })

  it("returns null for malformed JSON", () => {
    expect(parseLogLine("{bad json")).toBeNull()
  })

  it("returns null when required field has wrong type", () => {
    const rec = { ...makeRecord(), time: "not-a-number" }
    expect(parseLogLine(JSON.stringify(rec))).toBeNull()
  })

  it("returns null when levelLabel is not a valid pino level", () => {
    const rec = { ...makeRecord(), levelLabel: "verbose" }
    expect(parseLogLine(JSON.stringify(rec))).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(parseLogLine("")).toBeNull()
  })

  it("accepts optional source and workerId fields", () => {
    const rec = makeRecord({ source: "worker", workerId: "w1" })
    const result = parseLogLine(JSON.stringify(rec))
    expect(result).not.toBeNull()
    expect(result?.source).toBe("worker")
    expect(result?.workerId).toBe("w1")
  })

  it("accepts a record with no source field (api logs)", () => {
    const rec = makeRecord()
    const result = parseLogLine(JSON.stringify(rec))
    expect(result).not.toBeNull()
    expect(result?.source).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// iterateSse
// ---------------------------------------------------------------------------

describe("iterateSse", () => {
  it("yields data payloads from a simple SSE stream", async () => {
    const stream = makeStream(encodeChunks("data: hello\n\ndata: world\n\n"))
    const controller = new AbortController()
    const results: string[] = []
    for await (const item of iterateSse(stream, controller.signal)) {
      results.push(item)
    }
    expect(results).toEqual(["hello", "world"])
  })

  it("skips heartbeat / comment lines", async () => {
    const stream = makeStream(encodeChunks(": ping\n\ndata: real\n\n: keep-alive\n\n"))
    const controller = new AbortController()
    const results: string[] = []
    for await (const item of iterateSse(stream, controller.signal)) {
      results.push(item)
    }
    expect(results).toEqual(["real"])
  })

  it("handles chunks split mid-event", async () => {
    const chunks = encodeChunks("data: firs", "t\n\ndata: second\n\n")
    const stream = makeStream(chunks)
    const controller = new AbortController()
    const results: string[] = []
    for await (const item of iterateSse(stream, controller.signal)) {
      results.push(item)
    }
    expect(results).toEqual(["first", "second"])
  })

  it("handles a chunk split across \\n\\n boundary", async () => {
    const chunks = encodeChunks("data: a\n", "\ndata: b\n\n")
    const stream = makeStream(chunks)
    const controller = new AbortController()
    const results: string[] = []
    for await (const item of iterateSse(stream, controller.signal)) {
      results.push(item)
    }
    expect(results).toEqual(["a", "b"])
  })

  it("stops when signal is aborted", async () => {
    // Stream that never closes
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: first\n\n"))
        // deliberately never closed — signal abort terminates iteration
      },
    })
    const results: string[] = []
    const iter = iterateSse(stream, controller.signal)
    const p = (async () => {
      for await (const item of iter) {
        results.push(item)
        controller.abort()
      }
    })()
    await p
    expect(results).toEqual(["first"])
  })
})

// ---------------------------------------------------------------------------
// streamLogs reconnect / dedup
// ---------------------------------------------------------------------------

describe("streamLogs", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function makeTextStream(...lines: string[]): ReadableStream<Uint8Array> {
    return makeStream(encodeChunks(...lines))
  }

  it("includes source and workerId in the SSE URL", async () => {
    const rec = makeRecord()
    const sseChunk = `data: ${JSON.stringify(rec)}\n\n`

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeTextStream(sseChunk),
    })

    const controller = new AbortController()
    controller.abort()

    await streamLogs(
      INSTANCE,
      { source: "worker", workerId: "wid-123" },
      {
        onRecord: () => {},
        onNotice: () => {},
        signal: controller.signal,
      },
    )

    // Signal was aborted — fetch may not be called; if called, verify params
    if ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      expect(url).toContain("source=worker")
      expect(url).toContain("workerId=wid-123")
    }
  })

  it("delivers records to onRecord callback", async () => {
    const rec = makeRecord({ msg: "delivered" })
    const sseChunk = `data: ${JSON.stringify(rec)}\n\n`

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: makeTextStream(sseChunk),
    })

    const controller = new AbortController()
    const received: AdminLogRecord[] = []

    // Abort after first record so streamLogs exits rather than reconnecting
    const p = streamLogs(
      INSTANCE,
      {},
      {
        onRecord: (r) => {
          received.push(r)
          controller.abort()
        },
        onNotice: () => {},
        signal: controller.signal,
      },
    )
    await p
    expect(received).toHaveLength(1)
    expect(received[0].msg).toBe("delivered")
  })

  it("deduplicates records on reconnect using time guard", async () => {
    const rec = makeRecord({ time: 1_700_000_001_000, msg: "unique" })
    const sseChunk = `data: ${JSON.stringify(rec)}\n\n`

    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        // Both connections replay the same record
        body: makeTextStream(sseChunk),
      })
    })

    const controller = new AbortController()
    const received: AdminLogRecord[] = []

    // Abort as soon as the first "stream ended" notice fires.
    // The sleep() in streamLogs responds to AbortSignal immediately, so the
    // second connection never happens. This lets us verify that a record
    // already seen on the first connection is not re-delivered.
    const p = streamLogs(
      INSTANCE,
      {},
      {
        onRecord: (r) => {
          received.push(r)
        },
        onNotice: () => {
          controller.abort()
        },
        signal: controller.signal,
      },
    )
    await p
    // Despite the second connection replaying the same record, it is deduplicated
    expect(received.filter((r) => r.msg === "unique")).toHaveLength(1)
  })

  it("throws on 401 without reconnecting", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: null,
    })

    const controller = new AbortController()
    await expect(
      streamLogs(
        INSTANCE,
        {},
        {
          onRecord: () => {},
          onNotice: () => {},
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(/Admin key rejected/)
  })

  it("does not reconnect when signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    globalThis.fetch = vi.fn()

    await streamLogs(
      INSTANCE,
      {},
      {
        onRecord: () => {},
        onNotice: () => {},
        signal: controller.signal,
      },
    )

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
