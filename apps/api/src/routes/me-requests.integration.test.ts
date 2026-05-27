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
import { meRequestsRoutes } from "./me-requests.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"
const TOKEN_CAP = 750_000

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

describeIfDb("GET /me/requests integration", () => {
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
    await sql`TRUNCATE ingestion_requests, sessions, users, churches RESTART IDENTITY CASCADE`.execute(
      db,
    )
  })

  async function buildApp() {
    const app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(fp(async (instance) => { instance.decorate("db", db) }, { name: "db" }))
    await app.register(sessionPlugin)
    await app.register(meRequestsRoutes)
    await app.ready()
    return app
  }

  async function insertUser(
    overrides: { id?: string; google_sub?: string; is_admin?: boolean } = {},
  ) {
    const row = await db
      .insertInto("users")
      .values({
        google_sub: overrides.google_sub ?? `sub-${Math.random()}`,
        display_name: "Test User",
        is_admin: overrides.is_admin ?? false,
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
      requested_slug?: string
      status?: string
      tokens_ingested?: number
      videos_discovered?: number
      videos_ingested?: number
      created_at?: Date
    } = {},
  ): Promise<string> {
    const row = await db
      .insertInto("ingestion_requests")
      .values({
        user_id: userId,
        church_id: overrides.church_id ?? null,
        requested_slug: overrides.requested_slug ?? `slug-${Math.random().toString(36).slice(2)}`,
        requested_name: "Test Church",
        youtube_handle_or_url: "@TestChannel",
        contact_email: "test@example.com",
        status: (overrides.status ?? "received") as "received",
        tokens_ingested: overrides.tokens_ingested ?? 0,
        videos_discovered: overrides.videos_discovered ?? 0,
        videos_ingested: overrides.videos_ingested ?? 0,
        ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  // --- list endpoint ---

  it("returns 401 when no session cookie", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/me/requests" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns empty list when user has no requests", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)

    const res = await app.inject({
      method: "GET",
      url: "/me/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ requests: [], total: 0, limit: 20, offset: 0 })
    await app.close()
  })

  it("returns only the current user's requests, sorted DESC by created_at", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const otherId = await insertUser()
    const token = await insertSession(userId)

    const now = Date.now()
    const ids = await Promise.all([
      insertRequest(userId, { created_at: new Date(now - 2000) }),
      insertRequest(userId, { created_at: new Date(now - 1000) }),
      insertRequest(userId, { created_at: new Date(now) }),
      insertRequest(otherId),
      insertRequest(otherId),
    ])

    const res = await app.inject({
      method: "GET",
      url: "/me/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(3)
    expect(body.requests).toHaveLength(3)
    // DESC order: newest first (ids[2], ids[1], ids[0])
    expect(body.requests[0].id).toBe(ids[2])
    expect(body.requests[1].id).toBe(ids[1])
    expect(body.requests[2].id).toBe(ids[0])
    await app.close()
  })

  it("sets search_url when request is linked to a church, null otherwise", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)
    const churchId = await insertChurch("grace-chapel")

    await insertRequest(userId, { church_id: churchId, requested_slug: "grace-chapel" })
    await insertRequest(userId, { church_id: null, requested_slug: "pending-req" })

    const res = await app.inject({
      method: "GET",
      url: "/me/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const withChurch = body.requests.find((r: { requested_slug: string }) => r.requested_slug === "grace-chapel")
    const withoutChurch = body.requests.find((r: { requested_slug: string }) => r.requested_slug === "pending-req")
    expect(withChurch?.search_url).toBe("/grace-chapel/")
    expect(withoutChurch?.search_url).toBeNull()
    await app.close()
  })

  it("paginates correctly: limit=2&offset=1 of 5 rows returns 2 with total=5", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)

    for (let i = 0; i < 5; i++) {
      await insertRequest(userId)
    }

    const res = await app.inject({
      method: "GET",
      url: "/me/requests?limit=2&offset=1",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(5)
    expect(body.requests).toHaveLength(2)
    expect(body.limit).toBe(2)
    expect(body.offset).toBe(1)
    await app.close()
  })

  it("includes tokens_cap from config on each row", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)
    await insertRequest(userId)

    const res = await app.inject({
      method: "GET",
      url: "/me/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.requests[0].tokens_cap).toBe(TOKEN_CAP)
    await app.close()
  })

  // --- detail endpoint ---

  it("returns 401 on detail when no session cookie", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/me/requests/00000000-0000-0000-0000-000000000000",
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 400 for non-UUID id", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)

    const res = await app.inject({
      method: "GET",
      url: "/me/requests/not-a-uuid",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it("returns 404 for an unknown UUID", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)

    const res = await app.inject({
      method: "GET",
      url: "/me/requests/00000000-0000-0000-0000-000000000001",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe("not_found")
    await app.close()
  })

  it("returns 403 (not 404) for another user's request", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const otherId = await insertUser()
    const token = await insertSession(userId)
    const requestId = await insertRequest(otherId)

    const res = await app.inject({
      method: "GET",
      url: `/me/requests/${requestId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe("forbidden")
    await app.close()
  })

  it("returns 200 detail for own request with counters and search_url", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)
    const churchId = await insertChurch("mount-olive")
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      requested_slug: "mount-olive",
      status: "complete",
      tokens_ingested: 123456,
      videos_discovered: 10,
      videos_ingested: 10,
    })

    const res = await app.inject({
      method: "GET",
      url: `/me/requests/${requestId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(requestId)
    expect(body.status).toBe("complete")
    expect(body.tokens_ingested).toBe(123456)
    expect(body.tokens_cap).toBe(TOKEN_CAP)
    expect(body.videos_discovered).toBe(10)
    expect(body.videos_ingested).toBe(10)
    expect(body.search_url).toBe("/mount-olive/")
    expect(body.requested_name).toBe("Test Church")
    expect(body.contact_email).toBe("test@example.com")
    expect(body.include_playlist_ids).toEqual([])
    expect(body.exclude_playlist_ids).toEqual([])
    expect(typeof body.created_at).toBe("string")
    expect(typeof body.updated_at).toBe("string")
    await app.close()
  })

  it("returns tokens_ingested as a number even for large bigint values", async () => {
    const app = await buildApp()
    const userId = await insertUser()
    const token = await insertSession(userId)
    const requestId = await insertRequest(userId, { tokens_ingested: 1_234_567 })

    const res = await app.inject({
      method: "GET",
      url: `/me/requests/${requestId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.tokens_ingested).toBe("number")
    expect(body.tokens_ingested).toBe(1_234_567)
    await app.close()
  })
})
