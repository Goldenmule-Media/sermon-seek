import type { AdminLogRecord } from "@sermon-search/types"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { logBuffer, workerLogBuffer } from "../lib/log-buffer.js"
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

  it("source=api (default) returns only api-sourced records", async () => {
    const apiRec = makeRecord({ msg: "api-only", source: "api" })
    const workerRec = makeRecord({ msg: "worker-only", source: "worker", workerId: "w1" })
    logBuffer.push(apiRec)
    workerLogBuffer.push(workerRec)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const msgs = records.map((r: { msg: string }) => r.msg)
    expect(msgs).toContain("api-only")
    expect(msgs).not.toContain("worker-only")
    await app.close()
  })

  it("source=worker returns only worker-sourced records", async () => {
    const apiRec = makeRecord({ msg: "api-source-test", source: "api" })
    const workerRec = makeRecord({ msg: "worker-source-test", source: "worker", workerId: "w2" })
    logBuffer.push(apiRec)
    workerLogBuffer.push(workerRec)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?source=worker",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const msgs = records.map((r: { msg: string }) => r.msg)
    expect(msgs).toContain("worker-source-test")
    expect(msgs).not.toContain("api-source-test")
    await app.close()
  })

  it("source=all returns records from both buffers", async () => {
    const apiRec = makeRecord({ msg: "all-api", source: "api" })
    const workerRec = makeRecord({ msg: "all-worker", source: "worker", workerId: "w3" })
    logBuffer.push(apiRec)
    workerLogBuffer.push(workerRec)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?source=all",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const msgs = records.map((r: { msg: string }) => r.msg)
    expect(msgs).toContain("all-api")
    expect(msgs).toContain("all-worker")
    await app.close()
  })

  it("workerId filter returns only records for that worker", async () => {
    const rec1 = makeRecord({ msg: "wid-match", source: "worker", workerId: "target-worker" })
    const rec2 = makeRecord({ msg: "wid-other", source: "worker", workerId: "other-worker" })
    workerLogBuffer.push(rec1)
    workerLogBuffer.push(rec2)

    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/logs?source=worker&workerId=target-worker",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const { records } = res.json()
    const msgs = records.map((r: { msg: string }) => r.msg)
    expect(msgs).toContain("wid-match")
    expect(msgs).not.toContain("wid-other")
    await app.close()
  })

  // SSE follow mode (follow=true) is tested by the CLI logs tail card and via manual curl.
  // Fastify's inject() collects the full response body, so it cannot observe an open
  // streaming response without additional scaffolding.
})

describe("POST /admin/logs/ingest", () => {
  it("returns 401 with no key", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/admin/logs/ingest",
      payload: { records: [] },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("ingests records and makes them available via GET ?source=worker", async () => {
    const app = await buildApp()
    const rec = makeRecord({ msg: "ingest-round-trip" })
    const ingestRes = await app.inject({
      method: "POST",
      url: "/admin/logs/ingest",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY, "x-worker-id": "ingest-worker-1" },
      payload: { records: [rec] },
    })
    expect(ingestRes.statusCode).toBe(200)
    expect(ingestRes.json().ingested).toBe(1)

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/logs?source=worker",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    expect(getRes.statusCode).toBe(200)
    const { records } = getRes.json()
    const found = records.find(
      (r: { msg: string; workerId?: string }) =>
        r.msg === "ingest-round-trip" && r.workerId === "ingest-worker-1",
    )
    expect(found).toBeDefined()
    await app.close()
  })

  it("falls back to body workerId when x-worker-id header is absent", async () => {
    const app = await buildApp()
    const rec = makeRecord({ msg: "ingest-body-wid" })
    await app.inject({
      method: "POST",
      url: "/admin/logs/ingest",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
      payload: { records: [rec], workerId: "body-wid" },
    })

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/logs?source=worker&workerId=body-wid",
      headers: { "x-admin-key": TEST_ADMIN_API_KEY },
    })
    const { records } = getRes.json()
    expect(records.some((r: { msg: string }) => r.msg === "ingest-body-wid")).toBe(true)
    await app.close()
  })
})
