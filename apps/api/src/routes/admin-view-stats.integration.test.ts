import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { adminAuthPlugin } from "../plugins/admin-auth.js"
import { adminRoutes } from "./admin.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const { ADMIN_KEY, mockRunViewStats, mockIngestChannel, mockResolveChannel, mockIngestVideoTranscript, mockCacheUnlink } = vi.hoisted(() => ({
  ADMIN_KEY: "test-key-view-stats",
  mockRunViewStats: vi.fn(),
  mockIngestChannel: vi.fn(),
  mockResolveChannel: vi.fn(),
  mockIngestVideoTranscript: vi.fn(),
  mockCacheUnlink: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    ADMIN_API_KEY: ADMIN_KEY,
    SLUG_ALIAS_TTL_DAYS: 90,
  },
}))

vi.mock("@sermon-search/worker", () => ({
  resolveChannel: mockResolveChannel,
  ingestChannel: mockIngestChannel,
  runViewStats: mockRunViewStats,
  ingestVideoTranscript: mockIngestVideoTranscript,
  cache: { unlink: mockCacheUnlink },
}))

describeIfDb("POST /admin/ingest/view-stats — system_runs (integration)", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE system_runs`.execute(db)
    await sql`TRUNCATE churches RESTART IDENTITY CASCADE`.execute(db)
    vi.clearAllMocks()
  })

  async function buildApp() {
    const stubChurch = { id: "ch-1", slug: "jubileestl", name: "Jubilee" }
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(adminAuthPlugin)
    app.decorate("db", db)
    app.decorate("youtube", {} as never)
    app.decorate("resolveChurchBySlug", vi.fn().mockResolvedValue(stubChurch) as never)
    await app.register(adminRoutes)
    await app.ready()
    return app
  }

  it("upserts system_runs with last_status=success on successful view-stats run", async () => {
    mockRunViewStats.mockResolvedValue({ channelCount: 1, playlistCount: 2, videoCount: 10, fetchedFromApi: 5 })

    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "jubileestl" },
    })
    expect(res.statusCode).toBe(200)

    const row = await db
      .selectFrom("system_runs")
      .selectAll()
      .where("kind", "=", "view-stats")
      .executeTakeFirst()
    expect(row).toBeDefined()
    expect(row?.last_status).toBe("success")
    expect(row?.last_run_at).toBeInstanceOf(Date)
    await app.close()
  })

  it("upserts system_runs with last_status=failed when view-stats throws", async () => {
    mockRunViewStats.mockRejectedValue(new Error("YouTube quota exceeded"))

    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "jubileestl" },
    })
    expect(res.statusCode).toBe(500)

    const row = await db
      .selectFrom("system_runs")
      .selectAll()
      .where("kind", "=", "view-stats")
      .executeTakeFirst()
    expect(row).toBeDefined()
    expect(row?.last_status).toBe("failed")
    await app.close()
  })

  it("second success upserts (idempotent): only one row remains", async () => {
    mockRunViewStats.mockResolvedValue({ channelCount: 0, playlistCount: 0, videoCount: 0, fetchedFromApi: 0 })

    const app = await buildApp()
    await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "jubileestl" },
    })
    await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "jubileestl" },
    })

    const rows = await db.selectFrom("system_runs").selectAll().where("kind", "=", "view-stats").execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.last_status).toBe("success")
    await app.close()
  })
})
