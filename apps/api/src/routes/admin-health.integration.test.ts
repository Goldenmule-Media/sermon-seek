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
import { adminHealthRoutes } from "./admin-health.js"

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

describeIfDb("GET /admin/health (integration)", () => {
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
    await sql`TRUNCATE worker_heartbeats`.execute(db)
    await sql`TRUNCATE system_runs`.execute(db)
    await sql`TRUNCATE sessions, users RESTART IDENTITY CASCADE`.execute(db)
  })

  async function buildApp() {
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(
      fp(async (instance) => { instance.decorate("db", db) }, { name: "db" }),
    )
    await app.register(sessionPlugin)
    await app.register(adminHealthRoutes)
    await app.ready()
    return app
  }

  async function insertUser(isAdmin: boolean) {
    const row = await db
      .insertInto("users")
      .values({ google_sub: `sub-${Math.random()}`, display_name: "Test User", is_admin: isAdmin })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertSession(userId: string) {
    const token = mintToken()
    await db
      .insertInto("sessions")
      .values({
        user_id: userId,
        session_token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .execute()
    return token
  }

  it("returns 401 with no session", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/admin/health" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 for non-admin session", async () => {
    const app = await buildApp()
    const userId = await insertUser(false)
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/health",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("returns empty arrays and null shapes when no rows exist", async () => {
    const app = await buildApp()
    const userId = await insertUser(true)
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/health",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workers).toEqual([])
    expect(body.view_stats).toEqual({ last_run_at: null, last_status: null })
    expect(body.smoke_test).toEqual({ last_run_at: null, last_status: null })
    await app.close()
  })

  it("marks stale row correctly and fresh row as not stale", async () => {
    // Fresh row
    await db
      .insertInto("worker_heartbeats")
      .values({
        worker_id: "fresh:1",
        kind: "ingest",
        last_beat_at: sql`now()`,
        status: "idle",
        last_job_id: null,
        message: null,
      })
      .execute()

    // Stale row (120s in the past)
    await db
      .insertInto("worker_heartbeats")
      .values({
        worker_id: "stale:1",
        kind: "ingest",
        last_beat_at: sql`now() - interval '120 seconds'`,
        status: "busy",
        last_job_id: "req-old",
        message: "stuck",
      })
      .execute()

    const app = await buildApp()
    const userId = await insertUser(true)
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/health",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const { workers } = res.json()
    expect(workers).toHaveLength(2)

    const fresh = workers.find((w: { worker_id: string }) => w.worker_id === "fresh:1")
    const stale = workers.find((w: { worker_id: string }) => w.worker_id === "stale:1")
    expect(fresh.stale).toBe(false)
    expect(stale.stale).toBe(true)
    expect(stale.last_job_id).toBe("req-old")
    await app.close()
  })

  it("returns view_stats and smoke_test from system_runs", async () => {
    await db
      .insertInto("system_runs")
      .values({ kind: "view-stats", last_run_at: sql`now()`, last_status: "success" })
      .execute()
    await db
      .insertInto("system_runs")
      .values({ kind: "smoke-test", last_run_at: sql`now() - interval '5 minutes'`, last_status: "failed" })
      .execute()

    const app = await buildApp()
    const userId = await insertUser(true)
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/health",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.view_stats.last_status).toBe("success")
    expect(body.view_stats.last_run_at).not.toBeNull()
    expect(body.smoke_test.last_status).toBe("failed")
    expect(body.smoke_test.last_run_at).not.toBeNull()
    await app.close()
  })
})
