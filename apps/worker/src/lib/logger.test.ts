import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkerLogger } from "./logger.js"

describe("createWorkerLogger", () => {
  let originalFetch: typeof globalThis.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  it("is a no-op for ingest when ADMIN_API_KEY is unset", async () => {
    delete process.env.ADMIN_API_KEY
    globalThis.fetch = vi.fn()

    const logger = createWorkerLogger("test-worker")
    logger.info("hello from test")
    await logger.flush()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("sends a POST to the ingest endpoint when ADMIN_API_KEY is set", async () => {
    process.env.ADMIN_API_KEY = "test-key"
    process.env.WORKER_API_URL = "http://localhost:3001"

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    const logger = createWorkerLogger("ship-worker")
    logger.info("shipped log")
    await logger.flush()

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe("http://localhost:3001/v1/admin/logs/ingest")
    expect((init.headers as Record<string, string>)["x-admin-key"]).toBe("test-key")
    expect((init.headers as Record<string, string>)["x-worker-id"]).toBe("ship-worker")
    const body = JSON.parse(init.body as string) as { records: unknown[] }
    expect(body.records.length).toBeGreaterThan(0)
  })

  it("swallows fetch errors without throwing", async () => {
    process.env.ADMIN_API_KEY = "test-key"
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"))

    const logger = createWorkerLogger("resilient-worker")
    logger.info("will fail to ship")
    await expect(logger.flush()).resolves.toBeUndefined()
  })
})
