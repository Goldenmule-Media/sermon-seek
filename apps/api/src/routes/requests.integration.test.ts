/**
 * End-to-end integration tests for the self-service ingestion request endpoints.
 *
 * Covers:
 *   - Happy path: submit → (simulate cap-hit) → admin approve → (simulate complete) → terminal GET
 *   - POST /requests dedupe paths (all five 409 variants)
 *   - GET /requests/channel-preflight (all five preflight states)
 *   - Authorization (401 with sign_in_url, 403 cross-user, 403 non-admin)
 *   - Per-user rate limit (6th POST → 429 with Retry-After)
 *
 * Requires TEST_DATABASE_URL. When unset, all suites skip.
 *
 * Worker pipeline correctness (cap-hit mechanics, transcript ingestion) is
 * covered by apps/worker/src/requests/runner.integration.test.ts. This file
 * tests the API layer: HTTP contracts, DB state transitions, and notification
 * calls fired by the admin endpoints.
 */
import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { EmailSender, NotificationConfig, NotifyContext } from "@sermon-search/notifications"
import type { TemplateName } from "@sermon-search/notifications"
import Fastify from "fastify"
import fp from "fastify-plugin"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetForTests, rateLimitPlugin } from "../plugins/rate-limit.js"
import { hashToken, mintToken, sessionPlugin } from "../plugins/session.js"
import { createAdminRequestsRoutes } from "./admin-requests.js"
import { meRequestsRoutes } from "./me-requests.js"
import { createRequestsRoutes } from "./requests.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

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

// ── Constants ──────────────────────────────────────────────────────────────────

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"
const TOKEN_CAP = 750_000
const WEB_BASE_URL = "http://localhost:3000"
const STUB_CHANNEL_ID = "UCtest123456789012345678"
const STUB_RESOLVED = { youtubeChannelId: STUB_CHANNEL_ID, title: "Test Channel" }

// ── DB-backed dep implementations (mirror private helpers in requests.ts) ──────

async function lookupSlugCollision(db: Kysely<Database>, slug: string): Promise<boolean> {
  const hit = await db
    .selectFrom("churches")
    .select("id")
    .where("slug", "=", slug)
    .unionAll(db.selectFrom("church_slug_aliases").select("id").where("slug", "=", slug))
    .limit(1)
    .executeTakeFirst()
  return hit !== undefined
}

async function lookupChurchByYoutubeChannelId(
  db: Kysely<Database>,
  ytChannelId: string,
): Promise<{ id: string; slug: string; status: string } | null> {
  const row = await db
    .selectFrom("churches")
    .select(["id", "slug", "status"])
    .where("youtube_channel_id", "=", ytChannelId)
    .executeTakeFirst()
  return row ?? null
}

async function lookupInFlightRequestForChurch(
  db: Kysely<Database>,
  churchId: string,
): Promise<{ id: string; user_id: string } | null> {
  const row = await db
    .selectFrom("ingestion_requests")
    .select(["id", "user_id"])
    .where("church_id", "=", churchId)
    .where("status", "in", ["received", "running", "awaiting_approval"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

// ── Notification capture (mirrors admin-requests.integration.test.ts) ──────────

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

// ── App factory ────────────────────────────────────────────────────────────────

type ResolverFn = (
  youtube: unknown,
  handle: string,
) => Promise<{ youtubeChannelId: string; title: string } | null>

async function buildApp(db: Kysely<Database>, resolverFn: ResolverFn = async () => STUB_RESOLVED) {
  const { calls, notifyFn } = makeNotifyCapture()
  const stubSender: EmailSender = { send: async () => {} }
  const stubConfig: NotificationConfig = { from: "no-reply@test.com" }

  const adminRoutes = createAdminRequestsRoutes({
    sender: stubSender,
    notificationConfig: stubConfig,
    notifyFn,
    webBaseUrl: WEB_BASE_URL,
  })

  const requestRoutes = createRequestsRoutes({
    lookupSlugCollision,
    lookupChurchByYoutubeChannelId,
    lookupInFlightRequestForChurch,
    resolveChannelOrNull: resolverFn,
  })

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cookie, { secret: COOKIE_SECRET })
  await app.register(fp(async (inst) => { inst.decorate("db", db) }, { name: "db" }))
  await app.register(fp(async (inst) => { inst.decorate("youtube", {}) }, { name: "youtube" }))
  await app.register(sessionPlugin)
  await app.register(rateLimitPlugin)
  await app.register(requestRoutes)
  await app.register(meRequestsRoutes)
  await app.register(adminRoutes)
  await app.ready()

  return { app, notifyCalls: calls }
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function insertUser(
  db: Kysely<Database>,
  overrides: { is_admin?: boolean } = {},
): Promise<string> {
  const row = await db
    .insertInto("users")
    .values({
      google_sub: `sub-${Math.random().toString(36).slice(2)}`,
      display_name: "Test User",
      is_admin: overrides.is_admin ?? false,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow()
  return row.id
}

async function insertSession(db: Kysely<Database>, userId: string): Promise<string> {
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

async function insertChurch(
  db: Kysely<Database>,
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
  db: Kysely<Database>,
  userId: string,
  overrides: {
    church_id?: string | null
    requested_slug?: string
    status?: string
    tokens_ingested?: number
    videos_discovered?: number
    videos_ingested?: number
    limit_reached?: boolean
    contact_email?: string
  } = {},
): Promise<string> {
  const row = await db
    .insertInto("ingestion_requests")
    .values({
      user_id: userId,
      church_id: overrides.church_id ?? null,
      requested_slug:
        overrides.requested_slug ?? `slug-${Math.random().toString(36).slice(2)}`,
      requested_name: "Test Church",
      youtube_handle_or_url: "@TestChannel",
      contact_email: overrides.contact_email ?? "submitter@example.com",
      status: (overrides.status ?? "received") as "received",
      tokens_ingested: overrides.tokens_ingested ?? 0,
      videos_discovered: overrides.videos_discovered ?? 0,
      videos_ingested: overrides.videos_ingested ?? 0,
      ...(overrides.limit_reached !== undefined
        ? { limit_reached: overrides.limit_reached }
        : {}),
    })
    .returning(["id"])
    .executeTakeFirstOrThrow()
  return row.id
}

// ── Test body ──────────────────────────────────────────────────────────────────

describeIfDb("requests integration", () => {
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
    __resetForTests()
    await sql`TRUNCATE ingestion_requests, sessions, users, churches RESTART IDENTITY CASCADE`.execute(
      db,
    )
  })

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe("happy path: submit → cap-hit → admin approve → complete", () => {
    it(
      "full flow drives all status transitions and fires the approved notification",
      async () => {
        const { app, notifyCalls } = await buildApp(db)
        const userId = await insertUser(db)
        const adminId = await insertUser(db, { is_admin: true })
        const userToken = await insertSession(db, userId)
        const adminToken = await insertSession(db, adminId)

        // 1. POST /requests — creates a received request
        const postRes = await app.inject({
          method: "POST",
          url: "/requests",
          payload: {
            requested_slug: "testchurch",
            requested_name: "Test Church",
            youtube_handle_or_url: "@TestChannel",
            contact_email: "submitter@example.com",
          },
          cookies: { [SESSION_COOKIE]: userToken },
        })
        expect(postRes.statusCode).toBe(201)
        const { request_id, status_url, search_url } = postRes.json()
        expect(status_url).toBe(`/me/requests/${request_id}`)
        expect(search_url).toBe("/testchurch/")

        // Verify initial DB state
        const initial = await db
          .selectFrom("ingestion_requests")
          .selectAll()
          .where("id", "=", request_id)
          .executeTakeFirstOrThrow()
        expect(initial.status).toBe("received")
        expect(initial.church_id).toBeNull()

        // 2. Simulate worker: channel resolved, cap hit → awaiting_approval
        const churchId = await insertChurch(db, "testchurch", {
          status: "pending",
          youtube_channel_id: STUB_CHANNEL_ID,
        })
        await db
          .updateTable("ingestion_requests")
          .set({
            status: "awaiting_approval",
            limit_reached: true,
            church_id: churchId,
            videos_discovered: 2,
            videos_ingested: 1,
            tokens_ingested: 800_000,
            updated_at: sql`now()`,
          })
          .where("id", "=", request_id)
          .execute()

        // Confirm DB reflects cap-hit state
        const capped = await db
          .selectFrom("ingestion_requests")
          .selectAll()
          .where("id", "=", request_id)
          .executeTakeFirstOrThrow()
        expect(capped.status).toBe("awaiting_approval")
        expect(capped.limit_reached).toBe(true)
        expect(Number(capped.tokens_ingested)).toBe(800_000)

        const pendingChurch = await db
          .selectFrom("churches")
          .select("status")
          .where("id", "=", churchId)
          .executeTakeFirstOrThrow()
        expect(pendingChurch.status).toBe("pending")

        // 3. Admin approve — the API endpoint fires the notification
        const approveRes = await app.inject({
          method: "POST",
          url: `/admin/requests/${request_id}/approve`,
          cookies: { [SESSION_COOKIE]: adminToken },
        })
        expect(approveRes.statusCode).toBe(200)
        expect(approveRes.json().status).toBe("approved")

        const approved = await db
          .selectFrom("ingestion_requests")
          .select("status")
          .where("id", "=", request_id)
          .executeTakeFirstOrThrow()
        expect(approved.status).toBe("approved")

        expect(notifyCalls).toHaveLength(1)
        expect(notifyCalls[0].status).toBe("approved")
        expect(notifyCalls[0].ctx.request.contact_email).toBe("submitter@example.com")

        // 4. Simulate worker completing the uncapped run
        await db
          .updateTable("ingestion_requests")
          .set({
            status: "complete",
            videos_ingested: 2,
            tokens_ingested: 1_600_000,
            updated_at: sql`now()`,
          })
          .where("id", "=", request_id)
          .execute()
        await db
          .updateTable("churches")
          .set({ status: "active" })
          .where("id", "=", churchId)
          .execute()

        // Verify churches.status transition
        const activeChurch = await db
          .selectFrom("churches")
          .select("status")
          .where("id", "=", churchId)
          .executeTakeFirstOrThrow()
        expect(activeChurch.status).toBe("active")

        // 5. GET /me/requests/:id — terminal counters and search_url
        const getRes = await app.inject({
          method: "GET",
          url: `/me/requests/${request_id}`,
          cookies: { [SESSION_COOKIE]: userToken },
        })
        expect(getRes.statusCode).toBe(200)
        const body = getRes.json()
        expect(body.status).toBe("complete")
        expect(body.tokens_ingested).toBe(1_600_000)
        expect(body.tokens_cap).toBe(TOKEN_CAP)
        expect(body.videos_discovered).toBe(2)
        expect(body.videos_ingested).toBe(2)
        expect(body.limit_reached).toBe(true)
        expect(body.search_url).toBe("/testchurch/")

        await app.close()
      },
      30_000,
    )
  })

  // ── POST dedupe paths ────────────────────────────────────────────────────────

  describe("POST /requests dedupe paths", () => {
    const VALID_BODY = {
      requested_slug: "newchurch",
      requested_name: "New Church",
      youtube_handle_or_url: "@NewChannel",
      contact_email: "submitter@example.com",
    }

    it("409 channel_already_ingested when channel has an active church", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      await insertChurch(db, "stmarks", {
        status: "active",
        youtube_channel_id: STUB_CHANNEL_ID,
      })

      const res = await app.inject({
        method: "POST",
        url: "/requests",
        payload: VALID_BODY,
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({
        error: "channel_already_ingested",
        existing_slug: "stmarks",
        search_url: "/stmarks/",
      })
      await app.close()
    })

    it(
      "409 channel_request_in_flight with is_yours:true and request_id when caller owns the in-flight request",
      async () => {
        const { app } = await buildApp(db)
        const userId = await insertUser(db)
        const userToken = await insertSession(db, userId)
        const churchId = await insertChurch(db, "stmarks", {
          status: "pending",
          youtube_channel_id: STUB_CHANNEL_ID,
        })
        const existingRequestId = await insertRequest(db, userId, {
          church_id: churchId,
          status: "awaiting_approval",
        })

        const res = await app.inject({
          method: "POST",
          url: "/requests",
          payload: VALID_BODY,
          cookies: { [SESSION_COOKIE]: userToken },
        })
        expect(res.statusCode).toBe(409)
        const body = res.json()
        expect(body).toMatchObject({
          error: "channel_request_in_flight",
          existing_slug: "stmarks",
          search_url: "/stmarks/",
          is_yours: true,
          request_id: existingRequestId,
        })
        await app.close()
      },
    )

    it(
      "409 channel_request_in_flight with is_yours:false and no request_id when another user owns it",
      async () => {
        const { app } = await buildApp(db)
        const userId = await insertUser(db)
        const otherId = await insertUser(db)
        const userToken = await insertSession(db, userId)
        const churchId = await insertChurch(db, "stmarks", {
          status: "pending",
          youtube_channel_id: STUB_CHANNEL_ID,
        })
        await insertRequest(db, otherId, {
          church_id: churchId,
          status: "running",
        })

        const res = await app.inject({
          method: "POST",
          url: "/requests",
          payload: VALID_BODY,
          cookies: { [SESSION_COOKIE]: userToken },
        })
        expect(res.statusCode).toBe(409)
        const body = res.json()
        expect(body).toMatchObject({
          error: "channel_request_in_flight",
          is_yours: false,
        })
        expect(body).not.toHaveProperty("request_id")
        await app.close()
      },
    )

    it("409 channel_unavailable for a denied church", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      await insertChurch(db, "stmarks", {
        status: "denied",
        youtube_channel_id: STUB_CHANNEL_ID,
      })

      const res = await app.inject({
        method: "POST",
        url: "/requests",
        payload: VALID_BODY,
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({
        error: "channel_unavailable",
        note: "admin attention required",
      })
      await app.close()
    })

    it("409 channel_unavailable for a suspended church", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      await insertChurch(db, "stmarks", {
        status: "suspended",
        youtube_channel_id: STUB_CHANNEL_ID,
      })

      const res = await app.inject({
        method: "POST",
        url: "/requests",
        payload: VALID_BODY,
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: "channel_unavailable" })
      await app.close()
    })
  })

  // ── GET /requests/channel-preflight ─────────────────────────────────────────

  describe("GET /requests/channel-preflight states", () => {
    it("available — no church exists for the resolved channel", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@TestChannel",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        state: "available",
        youtube_channel_id: STUB_CHANNEL_ID,
      })
      await app.close()
    })

    it("unknown_handle — resolver returns null", async () => {
      const { app } = await buildApp(db, async () => null)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@missing",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ state: "unknown_handle" })
      await app.close()
    })

    it("already_ingested — active church exists for the channel", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      await insertChurch(db, "stmarks", {
        status: "active",
        youtube_channel_id: STUB_CHANNEL_ID,
      })

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@TestChannel",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        state: "already_ingested",
        existing_slug: "stmarks",
        search_url: "/stmarks/",
      })
      await app.close()
    })

    it("request_in_flight with is_yours:true — caller owns the pending request", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      const churchId = await insertChurch(db, "stmarks", {
        status: "pending",
        youtube_channel_id: STUB_CHANNEL_ID,
      })
      const ownRequestId = await insertRequest(db, userId, {
        church_id: churchId,
        status: "awaiting_approval",
      })

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@TestChannel",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        state: "request_in_flight",
        existing_slug: "stmarks",
        search_url: "/stmarks/",
        is_yours: true,
        request_id: ownRequestId,
      })
      await app.close()
    })

    it("request_in_flight with is_yours:false — another user owns the pending request", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const otherId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      const churchId = await insertChurch(db, "stmarks", {
        status: "pending",
        youtube_channel_id: STUB_CHANNEL_ID,
      })
      await insertRequest(db, otherId, {
        church_id: churchId,
        status: "running",
      })

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@TestChannel",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({
        state: "request_in_flight",
        is_yours: false,
      })
      expect(body).not.toHaveProperty("request_id")
      await app.close()
    })

    it("channel_unavailable — denied church", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      await insertChurch(db, "stmarks", {
        status: "denied",
        youtube_channel_id: STUB_CHANNEL_ID,
      })

      const res = await app.inject({
        method: "GET",
        url: "/requests/channel-preflight?handle=@TestChannel",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ state: "channel_unavailable" })
      await app.close()
    })
  })

  // ── Authorization ─────────────────────────────────────────────────────────────

  describe("authorization", () => {
    it("unauthenticated POST /requests → 401 with error and sign_in_url", async () => {
      const { app } = await buildApp(db)

      const res = await app.inject({
        method: "POST",
        url: "/requests",
        payload: {
          requested_slug: "newchurch",
          requested_name: "New Church",
          youtube_handle_or_url: "@NewChannel",
          contact_email: "x@example.com",
        },
      })
      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error).toBe("unauthenticated")
      expect(typeof body.sign_in_url).toBe("string")
      expect(body.sign_in_url).toContain("/v1/auth/google/start?return_to=")
      await app.close()
    })

    it("GET /me/requests/:id for a request the caller doesn't own → 403", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db)
      const otherId = await insertUser(db)
      const userToken = await insertSession(db, userId)
      const requestId = await insertRequest(db, otherId)

      const res = await app.inject({
        method: "GET",
        url: `/me/requests/${requestId}`,
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("forbidden")
      await app.close()
    })

    it("non-admin hitting GET /admin/requests → 403", async () => {
      const { app } = await buildApp(db)
      const userId = await insertUser(db, { is_admin: false })
      const userToken = await insertSession(db, userId)

      const res = await app.inject({
        method: "GET",
        url: "/admin/requests",
        cookies: { [SESSION_COOKIE]: userToken },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe("forbidden")
      await app.close()
    })
  })

  // ── Rate limit ────────────────────────────────────────────────────────────────

  describe("rate limit", () => {
    it("6th POST in an hour from one user → 429 with Retry-After and retry_after_seconds", async () => {
      let channelCounter = 0
      const { app } = await buildApp(db, async () => ({
        youtubeChannelId: `UCratelimit${channelCounter++}`,
        title: "Test Channel",
      }))

      const userId = await insertUser(db)
      const userToken = await insertSession(db, userId)

      const post = (n: number) =>
        app.inject({
          method: "POST",
          url: "/requests",
          payload: {
            requested_slug: `ratelimit-${n}`,
            requested_name: "Rate Church",
            youtube_handle_or_url: `@RateChannel${n}`,
            contact_email: "rate@example.com",
          },
          cookies: { [SESSION_COOKIE]: userToken },
        })

      for (let i = 0; i < 5; i++) {
        const r = await post(i)
        expect(r.statusCode).toBe(201)
      }

      const overflow = await post(5)
      expect(overflow.statusCode).toBe(429)
      expect(overflow.json()).toMatchObject({ error: "rate_limited" })
      expect(typeof overflow.json().retry_after_seconds).toBe("number")
      expect(overflow.json().retry_after_seconds).toBeGreaterThan(0)
      expect(Number(overflow.headers["retry-after"])).toBeGreaterThan(0)

      await app.close()
    })
  })
})
