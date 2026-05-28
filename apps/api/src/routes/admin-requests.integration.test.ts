import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { NotifyContext } from "@sermon-search/notifications"
import type { EmailSender, NotificationConfig } from "@sermon-search/notifications"
import type { TemplateName } from "@sermon-search/notifications"
import Fastify from "fastify"
import fp from "fastify-plugin"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { adminAuthPlugin } from "../plugins/admin-auth.js"
import { hashToken, mintToken, sessionPlugin } from "../plugins/session.js"
import { createAdminRequestsRoutes } from "./admin-requests.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"
const TOKEN_CAP = 750_000
const WEB_BASE_URL = "http://localhost:3000"

const ADMIN_API_KEY = "test-admin-key-requests"

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
    ADMIN_API_KEY: "test-admin-key-requests",
  },
}))

describeIfDb("Admin requests integration", () => {
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
    await sql`TRUNCATE ingestion_requests, sessions, users, churches, playlists, channel_filter_rules RESTART IDENTITY CASCADE`.execute(
      db,
    )
  })

  // --- Helpers ---

  interface NotifyCall {
    status: TemplateName
    ctx: NotifyContext
  }

  function makeNotifyCapture() {
    const calls: NotifyCall[] = []
    const notifyFn = async (
      _sender: EmailSender,
      status: TemplateName,
      ctx: NotifyContext,
      _config: NotificationConfig,
    ) => {
      calls.push({ status, ctx })
      return { recipients: [ctx.request.contact_email] }
    }
    return { calls, notifyFn }
  }

  async function buildApp(
    notifyFn?: typeof makeNotifyCapture extends () => infer R ? R["notifyFn"] : never,
  ) {
    const { calls, notifyFn: defaultCapture } = makeNotifyCapture()
    const usedNotifyFn = notifyFn ?? defaultCapture

    const stubSender: EmailSender = { send: async () => {} }
    const stubConfig: NotificationConfig = { from: "no-reply@test.com" }

    const adminRequestsRoutes = createAdminRequestsRoutes({
      sender: stubSender,
      notificationConfig: stubConfig,
      notifyFn: usedNotifyFn,
      webBaseUrl: WEB_BASE_URL,
    })

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
    await app.register(adminRequestsRoutes)
    await app.ready()
    return { app, calls }
  }

  async function buildAppWithCapture() {
    const { calls, notifyFn } = makeNotifyCapture()
    const stubSender: EmailSender = { send: async () => {} }
    const stubConfig: NotificationConfig = { from: "no-reply@test.com" }

    const adminRequestsRoutes = createAdminRequestsRoutes({
      sender: stubSender,
      notificationConfig: stubConfig,
      notifyFn,
      webBaseUrl: WEB_BASE_URL,
    })

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
    await app.register(adminRequestsRoutes)
    await app.ready()
    return { app, calls }
  }

  async function insertUser(overrides: { is_admin?: boolean } = {}) {
    const row = await db
      .insertInto("users")
      .values({
        google_sub: `sub-${Math.random()}`,
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

  async function insertChurch(
    slug: string,
    opts: { status?: string; youtube_channel_id?: string } = {},
  ): Promise<string> {
    const row = await db
      .insertInto("churches")
      .values({
        slug,
        name: `${slug} church`,
        ...(opts.status ? { status: opts.status as "pending" } : {}),
        ...(opts.youtube_channel_id ? { youtube_channel_id: opts.youtube_channel_id } : {}),
      })
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
      admin_note?: string
      include_playlist_ids?: string[]
      exclude_playlist_ids?: string[]
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
        contact_email: "submitter@example.com",
        status: (overrides.status ?? "received") as "received",
        tokens_ingested: overrides.tokens_ingested ?? 0,
        videos_discovered: overrides.videos_discovered ?? 0,
        videos_ingested: overrides.videos_ingested ?? 0,
        ...(overrides.admin_note ? { admin_note: overrides.admin_note } : {}),
        ...(overrides.include_playlist_ids
          ? { include_playlist_ids: overrides.include_playlist_ids }
          : {}),
        ...(overrides.exclude_playlist_ids
          ? { exclude_playlist_ids: overrides.exclude_playlist_ids }
          : {}),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertPlaylist(
    churchId: string,
    channelId: string,
    overrides: { title?: string } = {},
  ) {
    const row = await db
      .insertInto("playlists")
      .values({
        church_id: churchId,
        channel_id: channelId,
        youtube_playlist_id: `PL${Math.random().toString(36).slice(2)}`,
        slug: `playlist-${Math.random().toString(36).slice(2)}`,
        title: overrides.title ?? "Test Playlist",
        position: 0,
        video_count: 5,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertChannel(churchId: string, opts: { youtube_channel_id?: string } = {}) {
    const row = await db
      .insertInto("channels")
      .values({
        church_id: churchId,
        youtube_channel_id: opts.youtube_channel_id ?? `UC${Math.random().toString(36).slice(2)}`,
        title: "Test Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  // --- Auth guard tests ---

  it("returns 200 via x-admin-key on GET /admin/requests", async () => {
    const { app } = await buildAppWithCapture()
    const res = await app.inject({
      method: "GET",
      url: "/admin/requests",
      headers: { "x-admin-key": ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.requests).toEqual([])
    await app.close()
  })

  it("returns 401 with no session on GET /admin/requests", async () => {
    const { app } = await buildAppWithCapture()
    const res = await app.inject({ method: "GET", url: "/admin/requests" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 for a non-admin session on GET /admin/requests", async () => {
    const { app } = await buildAppWithCapture()
    const userId = await insertUser({ is_admin: false })
    const token = await insertSession(userId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("returns 401 on detail with no session", async () => {
    const { app } = await buildAppWithCapture()
    const res = await app.inject({
      method: "GET",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001",
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 401 on approve with no session", async () => {
    const { app } = await buildAppWithCapture()
    const res = await app.inject({
      method: "POST",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001/approve",
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 401 on deny with no session", async () => {
    const { app } = await buildAppWithCapture()
    const res = await app.inject({
      method: "POST",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001/deny",
      payload: { note: "spam" },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  // --- GET /admin/requests list ---

  it("returns all requests for admin user", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()

    await insertRequest(userId, { status: "received" })
    await insertRequest(userId, { status: "awaiting_approval" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.requests).toHaveLength(2)
    expect(body.limit).toBe(20)
    expect(body.offset).toBe(0)
    await app.close()
  })

  it("filters by status", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()

    await insertRequest(userId, { status: "received" })
    await insertRequest(userId, { status: "awaiting_approval" })
    await insertRequest(userId, { status: "awaiting_approval" })

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests?status=awaiting_approval",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.requests.every((r: { status: string }) => r.status === "awaiting_approval")).toBe(
      true,
    )
    await app.close()
  })

  it("filters by user_id", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId1 = await insertUser()
    const userId2 = await insertUser()

    await insertRequest(userId1)
    await insertRequest(userId1)
    await insertRequest(userId2)

    const res = await app.inject({
      method: "GET",
      url: `/admin/requests?user_id=${userId1}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.requests.every((r: { user_id: string }) => r.user_id === userId1)).toBe(true)
    await app.close()
  })

  it("paginates correctly", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()

    for (let i = 0; i < 5; i++) await insertRequest(userId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests?limit=2&offset=1",
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

  it("includes tokens_cap on list rows", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    await insertRequest(userId, { tokens_ingested: 123456 })

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.requests[0].tokens_cap).toBe(TOKEN_CAP)
    expect(body.requests[0].tokens_ingested).toBe(123456)
    await app.close()
  })

  it("includes display_name from submitter", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await db
      .insertInto("users")
      .values({
        google_sub: `sub-named-${Math.random()}`,
        display_name: "Alice Smith",
        is_admin: false,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
      .then((r) => r.id)
    await insertRequest(userId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().requests[0].display_name).toBe("Alice Smith")
    await app.close()
  })

  // --- GET /admin/requests/:id detail ---

  it("returns 404 for unknown id", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const res = await app.inject({
      method: "GET",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("returns detail with submitter info and empty playlists when no church", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, {
      requested_slug: "grace-chapel",
      status: "received",
      tokens_ingested: 5000,
    })

    const res = await app.inject({
      method: "GET",
      url: `/admin/requests/${requestId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(requestId)
    expect(body.user_id).toBe(userId)
    expect(body.contact_email).toBe("submitter@example.com")
    expect(body.tokens_ingested).toBe(5000)
    expect(body.tokens_cap).toBe(TOKEN_CAP)
    expect(body.church_slug).toBeNull()
    expect(body.church_status).toBeNull()
    expect(body.youtube_channel_id).toBeNull()
    expect(body.channel_title).toBeNull()
    expect(body.discovered_playlists).toEqual([])
    await app.close()
  })

  it("returns detail with church + channel + playlists when linked", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("mount-olive", {
      status: "pending",
      youtube_channel_id: "UCtest123",
    })
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest123" })
    await insertPlaylist(churchId, channelId, { title: "Sermons 2024" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      requested_slug: "mount-olive",
      status: "awaiting_approval",
    })

    const res = await app.inject({
      method: "GET",
      url: `/admin/requests/${requestId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.church_slug).toBe("mount-olive")
    expect(body.church_status).toBe("pending")
    expect(body.youtube_channel_id).toBe("UCtest123")
    expect(body.channel_title).toBe("Test Channel")
    expect(body.search_url).toBe("/mount-olive/")
    expect(body.discovered_playlists).toHaveLength(1)
    expect(body.discovered_playlists[0].title).toBe("Sermons 2024")
    expect(body.discovered_playlists[0].video_count).toBe(5)
    await app.close()
  })

  // --- POST /admin/requests/:id/approve ---

  it("approve: 404 for unknown request", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const res = await app.inject({
      method: "POST",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001/approve",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("approve: flips awaiting_approval → approved and fires notify", async () => {
    const { app, calls } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("approved")

    // Verify DB updated
    const row = await db
      .selectFrom("ingestion_requests")
      .select("status")
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow()
    expect(row.status).toBe("approved")

    // Notification fired
    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe("approved")
    expect(calls[0].ctx.request.contact_email).toBe("submitter@example.com")
    await app.close()
  })

  it("approve: idempotent — second call returns 200 without re-notifying", async () => {
    const { app, calls } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval" })

    // First approve
    await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })

    // Second approve
    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("approved")
    // Only one notification from first call
    expect(calls).toHaveLength(1)
    await app.close()
  })

  it("approve: 409 when status is received (not awaiting_approval)", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "received" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().current_status).toBe("received")
    await app.close()
  })

  it("approve: 409 when status is complete", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "complete" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it("approve: mode=none — no channel_filter_rules rows written", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("grace-chapel", { youtube_channel_id: "UCtest001" })
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest001" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      status: "awaiting_approval",
    })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("approved")

    const rules = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelId)
      .execute()
    expect(rules).toHaveLength(0)
    await app.close()
  })

  it("approve: mode=include — writes include channel_filter_rules rows with audit entries", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("grace-chapel-2", { youtube_channel_id: "UCtest002" })
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest002" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      status: "awaiting_approval",
      include_playlist_ids: ["PLaaa", "PLbbb"],
    })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rules = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelId)
      .orderBy("target_id", "asc")
      .execute()
    expect(rules).toHaveLength(2)
    expect(rules[0].rule_type).toBe("include")
    expect(rules[0].target_kind).toBe("playlist")
    expect(rules[0].target_id).toBe("PLaaa")
    expect(rules[1].target_id).toBe("PLbbb")

    const auditRows = await db
      .selectFrom("admin_audit_log")
      .select(["action", "target_id"])
      .where("action", "in", ["request.approve", "filter_rule.create"])
      .where("target_id", "in", [requestId, rules[0].id, rules[1].id])
      .execute()
    const actions = auditRows.map((r) => r.action)
    expect(actions.filter((a) => a === "filter_rule.create")).toHaveLength(2)
    expect(actions.filter((a) => a === "request.approve")).toHaveLength(1)
    await app.close()
  })

  it("approve: mode=exclude — writes exclude channel_filter_rules rows", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("grace-chapel-3", { youtube_channel_id: "UCtest003" })
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest003" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      status: "awaiting_approval",
      exclude_playlist_ids: ["PLxxx", "PLyyy"],
    })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rules = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelId)
      .orderBy("target_id", "asc")
      .execute()
    expect(rules).toHaveLength(2)
    expect(rules[0].rule_type).toBe("exclude")
    expect(rules[0].target_kind).toBe("playlist")
    expect(rules.map((r) => r.target_id).sort()).toEqual(["PLxxx", "PLyyy"])
    await app.close()
  })

  it("approve: idempotent rule materialization — pre-existing rule is not duplicated", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("grace-chapel-4", { youtube_channel_id: "UCtest004" })
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest004" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      status: "awaiting_approval",
      include_playlist_ids: ["PLaaa", "PLbbb"],
    })

    // Pre-insert one of the rules to simulate a partial-failure retry scenario.
    await db
      .insertInto("channel_filter_rules")
      .values({
        channel_id: channelId,
        rule_type: "include",
        target_kind: "playlist",
        target_id: "PLaaa",
        note: null,
      })
      .execute()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rules = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelId)
      .execute()
    // Should have exactly 2: the pre-existing PLaaa + the newly inserted PLbbb.
    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.target_id).sort()).toEqual(["PLaaa", "PLbbb"])
    await app.close()
  })

  // --- POST /admin/requests/:id/deny ---

  it("deny: 404 for unknown request", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const res = await app.inject({
      method: "POST",
      url: "/admin/requests/00000000-0000-0000-0000-000000000001/deny",
      payload: { note: "Spam channel" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("deny: 400 when note is missing or empty", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it("deny: flips awaiting_approval → denied with note, sets church status, fires notify", async () => {
    const { app, calls } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const churchId = await insertChurch("stmarks", { status: "pending" })
    const requestId = await insertRequest(userId, {
      church_id: churchId,
      status: "awaiting_approval",
    })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Channel is spam" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("denied")

    // Verify request updated
    const reqRow = await db
      .selectFrom("ingestion_requests")
      .select(["status", "admin_note"])
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow()
    expect(reqRow.status).toBe("denied")
    expect(reqRow.admin_note).toBe("Channel is spam")

    // Verify church status updated
    const churchRow = await db
      .selectFrom("churches")
      .select("status")
      .where("id", "=", churchId)
      .executeTakeFirstOrThrow()
    expect(churchRow.status).toBe("denied")

    // Notification fired
    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe("denied")
    expect(calls[0].ctx.request.admin_note).toBe("Channel is spam")
    await app.close()
  })

  it("deny: works without a church (no church_id on request)", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval", church_id: null })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Bad request" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it("deny: can deny from received status", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "received" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Abuse detected" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it("deny: idempotent — second call returns 200 without re-notifying", async () => {
    const { app, calls } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval" })

    // First deny
    await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Original note" },
      cookies: { [SESSION_COOKIE]: token },
    })

    // Second deny (idempotent)
    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Updated note" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    // Only one notification from the first call
    expect(calls).toHaveLength(1)

    // Note should be updated
    const reqRow = await db
      .selectFrom("ingestion_requests")
      .select("admin_note")
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow()
    expect(reqRow.admin_note).toBe("Updated note")
    await app.close()
  })

  it("deny: 409 when status is approved", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "approved" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Too late" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().current_status).toBe("approved")
    await app.close()
  })

  it("deny: 409 when status is complete", async () => {
    const { app } = await buildAppWithCapture()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "complete" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/deny`,
      payload: { note: "Already done" },
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it("approve via x-admin-key writes audit row with actor=cli", async () => {
    const { app } = await buildAppWithCapture()
    const userId = await insertUser()
    const requestId = await insertRequest(userId, { status: "awaiting_approval" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${requestId}/approve`,
      headers: { "x-admin-key": ADMIN_API_KEY },
    })
    expect(res.statusCode).toBe(200)

    const auditRow = await db
      .selectFrom("admin_audit_log")
      .select(["action", "payload"])
      .where("action", "=", "request.approve")
      .where("target_id", "=", requestId)
      .executeTakeFirstOrThrow()
    expect(auditRow.action).toBe("request.approve")
    expect((auditRow.payload as { actor: string }).actor).toBe("cli")
    await app.close()
  })
})
