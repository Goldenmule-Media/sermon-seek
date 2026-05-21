import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { ADMIN_API_KEY: "test-key-abc" },
}))

const mockRunViewStats = vi.fn()
const mockIngestChannel = vi.fn()
const mockResolveChannel = vi.fn()
const mockIngestVideoTranscript = vi.fn()
const mockCacheUnlink = vi.fn()

vi.mock("@sermon-search/worker", () => ({
  resolveChannel: mockResolveChannel,
  ingestChannel: mockIngestChannel,
  runViewStats: mockRunViewStats,
  ingestVideoTranscript: mockIngestVideoTranscript,
  cache: { unlink: mockCacheUnlink },
}))

const { adminAuthPlugin } = await import("../plugins/admin-auth.js")
const { adminRoutes } = await import("./admin.js")
const { filterRulesRoutes } = await import("./filter-rules.js")

const CORRECT_KEY = "test-key-abc"
const WRONG_KEY = "wrong-key"
const STUB_CHURCH = { id: "ch-1", slug: "jubileestl", name: "Jubilee" }

async function buildTestApp(resolveChurch: unknown = vi.fn().mockResolvedValue(STUB_CHURCH)) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(adminAuthPlugin)

  // Stub decorators that adminRoutes depends on
  app.decorate("db", {} as Kysely<Database>)
  app.decorate("youtube", {} as never)
  app.decorate("resolveChurchBySlug", resolveChurch as never)

  await app.register(adminRoutes)
  await app.register(filterRulesRoutes)
  await app.ready()
  return app
}

describe("admin routes — auth gate", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    app = await buildTestApp()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app.close()
  })

  it("POST /admin/channels — missing key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/channels",
      payload: { churchSlug: "jubileestl", handle: "@foo" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/ingest/refresh — missing key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/refresh?churchSlug=jubileestl",
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/ingest/view-stats — missing key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      payload: { churchSlug: "jubileestl" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/videos/:id/retranscribe — missing key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/videos/abc123/retranscribe",
      payload: { churchSlug: "jubileestl" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("GET /admin/channels/:id/filter-rules — missing key → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/channels/00000000-0000-0000-0000-000000000001/filter-rules",
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/channels/:id/filter-rules — missing key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/channels/00000000-0000-0000-0000-000000000001/filter-rules",
      payload: { rule_type: "include", target_kind: "playlist", target_id: "PLxxx" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("DELETE /admin/channels/:id/filter-rules/:ruleId — missing key → 401", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/channels/00000000-0000-0000-0000-000000000001/filter-rules/00000000-0000-0000-0000-000000000002",
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/channels — wrong key → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/channels",
      headers: { "x-admin-key": WRONG_KEY },
      payload: { churchSlug: "jubileestl", handle: "@foo" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("POST /admin/ingest/view-stats — correct key passes auth gate", async () => {
    mockRunViewStats.mockResolvedValue({
      channelCount: 0,
      playlistCount: 0,
      videoCount: 0,
      fetchedFromApi: 0,
    })
    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": CORRECT_KEY },
    })
    expect(res.statusCode).not.toBe(401)
  })
})

describe("admin routes — schema validation", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    app = await buildTestApp()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app.close()
  })

  describe("POST /admin/channels", () => {
    it("empty body → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "x-admin-key": WRONG_KEY, "content-type": "application/json" },
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it("both handle and youtubeChannelId → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "x-admin-key": WRONG_KEY, "content-type": "application/json" },
        payload: { handle: "@foo", youtubeChannelId: "UCxxx" },
      })
      expect(res.statusCode).toBe(400)
    })

    it("only handle → passes validation (→ 401 from auth, not 400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "x-admin-key": WRONG_KEY, "content-type": "application/json" },
        payload: { churchSlug: "jubileestl", handle: "@foo" },
      })
      expect(res.statusCode).toBe(401)
    })

    it("only youtubeChannelId → passes validation (→ 401 from auth, not 400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "x-admin-key": WRONG_KEY, "content-type": "application/json" },
        payload: { churchSlug: "jubileestl", youtubeChannelId: "UCxxx" },
      })
      expect(res.statusCode).toBe(401)
    })
  })
})

describe("admin routes — churchSlug validation", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    app = await buildTestApp()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app.close()
  })

  it("POST /admin/channels — missing churchSlug → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/channels",
      headers: { "x-admin-key": CORRECT_KEY, "content-type": "application/json" },
      payload: { handle: "@foo" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("POST /admin/channels — unknown churchSlug → 404", async () => {
    const unknownApp = await buildTestApp(vi.fn().mockResolvedValue(null))
    const res = await unknownApp.inject({
      method: "POST",
      url: "/admin/channels",
      headers: { "x-admin-key": CORRECT_KEY, "content-type": "application/json" },
      payload: { churchSlug: "no-such-church", handle: "@foo" },
    })
    await unknownApp.close()
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: "church not found" })
  })
})
