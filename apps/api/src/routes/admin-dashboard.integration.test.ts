import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import fp from "fastify-plugin"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { hashToken, mintToken, sessionPlugin } from "../plugins/session.js"
import { dashboardSummaryRoutes } from "./admin-dashboard.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"

vi.mock("../config.js", () => ({
  config: {
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/v1/auth/google/callback",
    COOKIE_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    SESSION_COOKIE_NAME: "sermon_session",
    STATE_COOKIE_NAME: "sermon_oauth_state",
    WEB_BASE_URL: "http://localhost:3000",
    COOKIE_SECURE: false,
    SLUG_ALIAS_TTL_DAYS: 90,
    LIMITED_INGEST_TOKEN_CAP: 750_000,
  },
}))

describeIfDb("Dashboard summary integration", () => {
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
    await sql`TRUNCATE ingestion_requests, sessions, users, churches, playlists RESTART IDENTITY CASCADE`.execute(
      db,
    )
  })

  // --- Helpers ---

  async function buildApp() {
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(
      fp(
        async (instance) => {
          instance.decorate("db", db)
        },
        { name: "db" },
      ),
    )
    await app.register(sessionPlugin)
    await app.register(dashboardSummaryRoutes)
    await app.ready()
    return app
  }

  async function insertUser(overrides: { is_admin?: boolean; status?: string } = {}) {
    const row = await db
      .insertInto("users")
      .values({
        google_sub: `sub-${Math.random()}`,
        display_name: "Test User",
        is_admin: overrides.is_admin ?? false,
        ...(overrides.status ? { status: overrides.status as "active" } : {}),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertSession(userId: string): Promise<string> {
    const token = mintToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db
      .insertInto("sessions")
      .values({
        user_id: userId,
        session_token_hash: hashToken(token),
        expires_at: expiresAt,
      })
      .execute()
    return token
  }

  async function insertChurch(slug: string): Promise<string> {
    const row = await db
      .insertInto("churches")
      .values({ slug, name: `${slug} church` })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertRequest(
    userId: string,
    overrides: {
      church_id?: string | null
      status?: string
    } = {},
  ): Promise<string> {
    const row = await db
      .insertInto("ingestion_requests")
      .values({
        user_id: userId,
        church_id: overrides.church_id ?? null,
        requested_slug: `slug-${Math.random().toString(36).slice(2)}`,
        requested_name: "Test Church",
        youtube_handle_or_url: "@TestChannel",
        contact_email: "submitter@example.com",
        status: (overrides.status ?? "received") as "received",
        tokens_ingested: 0,
        videos_discovered: 0,
        videos_ingested: 0,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  // --- Auth guard tests ---

  it("returns 401 with no session", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/admin/dashboard/summary" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 for a non-admin session", async () => {
    const app = await buildApp()
    const userId = await insertUser({ is_admin: false })
    const token = await insertSession(userId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/summary",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  // --- Shape tests ---

  it("returns zeroed counters and empty arrays on an empty DB", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/summary",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.requests).toEqual({
      pending: 0,
      awaiting_approval: 0,
      running: 0,
      failed: 0,
      complete: 0,
      denied: 0,
    })
    expect(body.recent_ingests).toEqual([])
    expect(body.last_view_stats_at).toBeNull()
    expect(body.last_smoke_test_at).toBeNull()
    // The admin user we created is active; count includes them
    expect(body.active_users).toBe(1)
    await app.close()
  })

  it("returns correct counters, recent ingests (capped at 10), and active_users on a seeded DB", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    // One non-active user — must NOT count toward active_users
    await insertUser({ is_admin: false, status: "suspended" })

    const churchId = await insertChurch("test-church")

    // One request per status that surfaces in the response
    await insertRequest(adminId, { status: "received" })
    await insertRequest(adminId, { status: "running" })
    await insertRequest(adminId, { status: "awaiting_approval" })
    await insertRequest(adminId, { status: "failed" })
    await insertRequest(adminId, { status: "complete" })
    await insertRequest(adminId, { status: "denied" })
    // Extra "received" to verify the pending counter accumulates
    await insertRequest(adminId, { status: "received" })

    // Insert 11 more requests so recent_ingests is capped at 10
    for (let i = 0; i < 11; i++) {
      await insertRequest(adminId, { church_id: churchId, status: "received" })
    }

    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/summary",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    // received: 1 standalone + 1 extra standalone + 11 church-linked = 13
    expect(body.requests.pending).toBe(13)
    expect(body.requests.running).toBe(1)
    expect(body.requests.awaiting_approval).toBe(1)
    expect(body.requests.failed).toBe(1)
    expect(body.requests.complete).toBe(1)
    expect(body.requests.denied).toBe(1)

    expect(body.recent_ingests).toHaveLength(10)

    // Verify newest-first ordering by updated_at
    const dates = body.recent_ingests.map((r: { updated_at: string }) => new Date(r.updated_at).getTime())
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1])
    }

    // Only the one active admin user (suspended user doesn't count)
    expect(body.active_users).toBe(1)

    await app.close()
  })

  it("returns null slug when the request has no church_id", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertRequest(adminId, { church_id: null, status: "received" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/summary",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.recent_ingests).toHaveLength(1)
    expect(body.recent_ingests[0].slug).toBeNull()
    await app.close()
  })
})
