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
import { adminAuthPlugin } from "../plugins/admin-auth.js"
import { hashToken, mintToken, sessionPlugin } from "../plugins/session.js"
import { adminAuditRoutes } from "./admin-audit.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"

const ADMIN_API_KEY = "test-admin-key-audit"

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
    ADMIN_API_KEY: "test-admin-key-audit",
  },
}))

describeIfDb("Admin audit integration", () => {
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
    await sql`TRUNCATE admin_audit_log, church_slug_aliases, channels, videos, ingestion_requests, playlists, sessions, users, churches RESTART IDENTITY CASCADE`.execute(
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
    await app.register(adminAuthPlugin)
    await app.register(adminAuditRoutes)
    await app.ready()
    return app
  }

  async function insertUser(overrides: { is_admin?: boolean; display_name?: string } = {}) {
    const row = await db
      .insertInto("users")
      .values({
        google_sub: `sub-${Math.random()}`,
        display_name: overrides.display_name ?? "Test User",
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

  async function insertAudit(opts: {
    user_id?: string | null
    action: string
    target_type: string
    target_id: string
    payload?: unknown
  }) {
    const row = await db
      .insertInto("admin_audit_log")
      .values({
        user_id: opts.user_id ?? null,
        action: opts.action,
        target_type: opts.target_type,
        target_id: opts.target_id,
        payload: opts.payload !== undefined ? (opts.payload as never) : null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  // --- Auth guard tests ---

  it("returns 200 via x-admin-key on GET /admin/audit", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      headers: { "x-admin-key": ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    await app.close()
  })

  it("returns 401 with no session on GET /admin/audit", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/admin/audit" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 for a non-admin session on GET /admin/audit", async () => {
    const app = await buildApp()
    const userId = await insertUser({ is_admin: false })
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  // --- GET /admin/audit ---

  it("returns empty list when no audit entries exist", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    await app.close()
  })

  it("returns entries newest-first", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const id1 = await insertAudit({
      action: "church.rename",
      target_type: "church",
      target_id: "a",
    })
    const id2 = await insertAudit({
      action: "church.rename",
      target_type: "church",
      target_id: "b",
    })
    const id3 = await insertAudit({
      action: "church.rename",
      target_type: "church",
      target_id: "c",
    })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(3)
    expect(body.items[0].id).toBe(id3)
    expect(body.items[1].id).toBe(id2)
    expect(body.items[2].id).toBe(id1)
    await app.close()
  })

  it("paginates correctly", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    for (let i = 0; i < 5; i++) {
      await insertAudit({
        action: "request.approve",
        target_type: "request",
        target_id: `req-${i}`,
      })
    }

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit?limit=2&offset=1",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(5)
    expect(body.items).toHaveLength(2)
    await app.close()
  })

  it("filters by action", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertAudit({ action: "church.rename", target_type: "church", target_id: "c1" })
    await insertAudit({ action: "church.rename", target_type: "church", target_id: "c2" })
    await insertAudit({ action: "request.approve", target_type: "request", target_id: "r1" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit?action=church.rename",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((x: { action: string }) => x.action === "church.rename")).toBe(true)
    await app.close()
  })

  it("filters by target_type", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertAudit({ action: "church.rename", target_type: "church", target_id: "c1" })
    await insertAudit({ action: "request.approve", target_type: "request", target_id: "r1" })
    await insertAudit({ action: "request.deny", target_type: "request", target_id: "r2" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit?target_type=request",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.items.every((x: { target_type: string }) => x.target_type === "request")).toBe(true)
    await app.close()
  })

  it("filters by user_id", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const userA = await insertUser()
    const userB = await insertUser()

    await insertAudit({
      user_id: userA,
      action: "church.rename",
      target_type: "church",
      target_id: "c1",
    })
    await insertAudit({
      user_id: userA,
      action: "request.approve",
      target_type: "request",
      target_id: "r1",
    })
    await insertAudit({
      user_id: userB,
      action: "church.rename",
      target_type: "church",
      target_id: "c2",
    })

    const res = await app.inject({
      method: "GET",
      url: `/admin/audit?user_id=${userA}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.items.every((x: { user_id: string }) => x.user_id === userA)).toBe(true)
    await app.close()
  })

  it("combines filters with AND semantics", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertAudit({ action: "church.rename", target_type: "church", target_id: "c1" })
    await insertAudit({ action: "church.rename", target_type: "request", target_id: "r1" })
    await insertAudit({ action: "request.approve", target_type: "church", target_id: "c2" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit?action=church.rename&target_type=church",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(1)
    expect(body.items[0].target_id).toBe("c1")
    await app.close()
  })

  it("surfaces user_display_name from joined users row", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true, display_name: "Alice Admin" })
    const token = await insertSession(adminId)

    await insertAudit({
      user_id: adminId,
      action: "church.rename",
      target_type: "church",
      target_id: "c1",
    })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].user_display_name).toBe("Alice Admin")
    expect(body.items[0].user_id).toBe(adminId)
    await app.close()
  })

  it("returns null user_display_name for CLI actor rows (null user_id)", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertAudit({
      user_id: null,
      action: "channel.register",
      target_type: "channel",
      target_id: "ch1",
      payload: { actor: "cli" },
    })

    const res = await app.inject({
      method: "GET",
      url: "/admin/audit",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].user_id).toBeNull()
    expect(body.items[0].user_display_name).toBeNull()
    expect(body.items[0].payload).toEqual({ actor: "cli" })
    await app.close()
  })
})
