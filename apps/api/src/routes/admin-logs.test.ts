import type { AdminLogRecord } from "@sermon-search/types"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { logBuffer } from "../lib/log-buffer.js"
import { adminAuthPlugin } from "../plugins/admin-auth.js"
import { adminLogsRoutes } from "./admin-logs.js"

// String literal required here — vi.mock is hoisted before const initializers run
vi.mock("../config.js", () => ({
  config: {
    ADMIN_API_KEY: "test-admin-api-key",
    LOG_BUFFER_SIZE: 1000,
  },
}))

const TEST_ADMIN_API_KEY = "test-admin-api-key"

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

async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(adminAuthPlugin)
  await app.register(adminLogsRoutes)
  await app.ready()
  return app
}

describe("GET /admin/logs", () => {
  beforeEach(() => {
    // Drain any records pushed by other tests
    logBuffer.recent({ limit: 10000 }) // read-only; just to confirm it's accessible
    // Clear internal state by pushing nothing — we rely on each test pushing its own records
  })

  afterEach(async () => {
    // nothing to tear down; logBuffer is a singleton but tests push distinct data
  })

  it("returns 401 with no key", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/admin/logs" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 401 with wrong key", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs",
      headers: { "x-admin-key": "wrong" },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 200 with valid key and empty buffer", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.records)).toBe(true)
    await app.close()
  })

  it("non-follow returns buffered records", async () => {
    const rec = makeRecord({ msg: "hello from test" })
    logBuffer.push(rec)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const found = records.find((r: { msg: string }) => r.msg === "hello from test")
    expect(found).toBeDefined()
    await app.close()
  })

  it("level filter excludes lower-level records", async () => {
    const low = makeRecord({ level: 10, levelLabel: "trace", msg: "low-level" })
    const high = makeRecord({ level: 40, levelLabel: "warn", msg: "high-level" })
    logBuffer.push(low)
    logBuffer.push(high)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?level=warn",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    expect(records.every((r: { level: number }) => r.level >= 40)).toBe(true)
    await app.close()
  })

  it("limit bounds the number of returned records", async () => {
    for (let i = 0; i < 20; i++) {
      logBuffer.push(makeRecord({ msg: `limit-test-${i}` }))
    }

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?limit=5",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    expect(records.length).toBeLessThanOrEqual(5)
    await app.close()
  })

  it("since filter excludes records older than the window", async () => {
    const old = makeRecord({ time: Date.now() - 120_000, msg: "ancient" })
    const fresh = makeRecord({ time: Date.now(), msg: "fresh-since-test" })
    logBuffer.push(old)
    logBuffer.push(fresh)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?since=60s",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const msgs = records.map((r: { msg: string }) => r.msg)
    expect(msgs).not.toContain("ancient")
    expect(msgs).toContain("fresh-since-test")
    await app.close()
  })

  // SSE follow mode (follow=true) is tested by the CLI logs tail card and via manual curl.
  // Fastify's inject() collects the full response body, so it cannot observe an open
  // streaming response without additional scaffolding.
})
