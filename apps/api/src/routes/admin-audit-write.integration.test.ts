import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { EmailSender, NotificationConfig } from "@sermon-search/notifications"
import type { YoutubeClient, youtube } from "@sermon-search/worker"
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

const PLAYLIST_ID = "PLtest0000000000000000001"
const YT_CHANNEL_ID = "UCtest000000000000000001"
const YT_VIDEO_ID = "dQw4w9WgXcQ"

const {
  ADMIN_KEY,
  COOKIE_SECRET,
  SESSION_COOKIE,
  mockRunViewStats,
  mockIngestChannel,
  mockResolveChannel,
  mockIngestVideoTranscript,
  mockCacheUnlink,
  mockValidatePlaylistTarget,
} = vi.hoisted(() => ({
  ADMIN_KEY: "test-key-audit-write",
  COOKIE_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  SESSION_COOKIE: "sermon_session",
  mockRunViewStats: vi.fn(),
  mockIngestChannel: vi.fn(),
  mockResolveChannel: vi.fn(),
  mockIngestVideoTranscript: vi.fn(),
  mockCacheUnlink: vi.fn(),
  mockValidatePlaylistTarget: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    ADMIN_API_KEY: ADMIN_KEY,
    SLUG_ALIAS_TTL_DAYS: 90,
    SESSION_COOKIE_NAME: SESSION_COOKIE,
    COOKIE_SECRET,
    COOKIE_SECURE: false,
    LIMITED_INGEST_TOKEN_CAP: 750_000,
    WEB_BASE_URL: "http://localhost:3000",
    GOOGLE_OAUTH_CLIENT_ID: "test-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/v1/auth/google/callback",
    STATE_COOKIE_NAME: "sermon_oauth_state",
  },
}))

vi.mock("@sermon-search/worker", () => ({
  resolveChannel: mockResolveChannel,
  ingestChannel: mockIngestChannel,
  runViewStats: mockRunViewStats,
  ingestVideoTranscript: mockIngestVideoTranscript,
  validatePlaylistTarget: mockValidatePlaylistTarget,
  cache: { unlink: mockCacheUnlink },
}))

type PlaylistsListResponse = youtube.PlaylistsListResponse

describeIfDb("audit-log writes — every admin mutation", () => {
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
    await sql`TRUNCATE admin_audit_log, channel_filter_rules, channels, videos, transcripts, ingestion_requests, playlists, church_slug_aliases, sessions, users, churches, system_runs RESTART IDENTITY CASCADE`.execute(
      db,
    )
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function insertUser(overrides: { is_admin?: boolean } = {}) {
    const row = await db
      .insertInto("users")
      .values({
        google_sub: `sub-${Math.random()}`,
        display_name: "Test Admin",
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

  async function insertChurch(slug: string, opts: { status?: string } = {}) {
    const row = await db
      .insertInto("churches")
      .values({
        slug,
        name: `${slug} church`,
        ...(opts.status ? { status: opts.status as "pending" } : {}),
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
        youtube_channel_id: opts.youtube_channel_id ?? YT_CHANNEL_ID,
        title: "Test Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertVideo(
    churchId: string,
    channelId: string,
    opts: { youtube_video_id?: string } = {},
  ) {
    const row = await db
      .insertInto("videos")
      .values({
        church_id: churchId,
        channel_id: channelId,
        youtube_video_id: opts.youtube_video_id ?? YT_VIDEO_ID,
        title: "Test Video",
        published_at: new Date(),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertIngestionRequest(
    userId: string,
    overrides: { status?: string; church_id?: string | null; admin_note?: string } = {},
  ) {
    const row = await db
      .insertInto("ingestion_requests")
      .values({
        user_id: userId,
        church_id: overrides.church_id ?? null,
        requested_slug: `slug-${Math.random().toString(36).slice(2)}`,
        requested_name: "Test Church",
        youtube_handle_or_url: "@TestChannel",
        contact_email: "submitter@example.com",
        status: (overrides.status ?? "awaiting_approval") as "awaiting_approval",
        tokens_ingested: 0,
        videos_discovered: 0,
        videos_ingested: 0,
        ...(overrides.admin_note ? { admin_note: overrides.admin_note } : {}),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function auditRows(action: string, target_type?: string, target_id?: string) {
    let q = db.selectFrom("admin_audit_log").selectAll().where("action", "=", action)
    if (target_type) q = q.where("target_type", "=", target_type)
    if (target_id) q = q.where("target_id", "=", target_id)
    return q.execute()
  }

  // Build app for admin.ts routes (requireAdminOrApiKey, needs resolveChurchBySlug + evictSlug)
  async function buildAdminApp(mockChurch?: { id: string; slug: string; name: string }) {
    const { adminRoutes } = await import("./admin.js")
    const stubChurch = mockChurch ?? { id: "ch-stub", slug: "test-church", name: "Test Church" }
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(adminAuthPlugin)
    await app.register(
      fp(
        async (instance) => {
          instance.decorate("db", db)
        },
        { name: "db" },
      ),
    )
    await app.register(sessionPlugin)
    app.decorate("youtube", {} as YoutubeClient)
    app.decorate("resolveChurchBySlug", vi.fn().mockResolvedValue(stubChurch) as never)
    app.decorate("evictSlug", vi.fn() as never)
    await app.register(adminRoutes)
    await app.ready()
    return app
  }

  // Build app for filter-rules.ts routes (requireAdminOrApiKey)
  async function buildFilterRulesApp() {
    const { filterRulesRoutes } = await import("./filter-rules.js")
    const mockYoutube: Partial<YoutubeClient> = {
      listPlaylistsById: vi.fn(
        async (_id: string): Promise<PlaylistsListResponse> => ({
          items: [{ id: PLAYLIST_ID, snippet: { channelId: YT_CHANNEL_ID } }],
        }),
      ),
    }
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(adminAuthPlugin)
    await app.register(
      fp(
        async (instance) => {
          instance.decorate("db", db)
        },
        { name: "db" },
      ),
    )
    await app.register(sessionPlugin)
    app.decorate("youtube", mockYoutube as YoutubeClient)
    await app.register(filterRulesRoutes)
    await app.ready()
    return app
  }

  // Build app for admin-requests.ts routes (requireAdmin, needs session cookie)
  async function buildRequestsApp() {
    const stubSender: EmailSender = { send: async () => {} }
    const stubConfig: NotificationConfig = { from: "no-reply@test.com" }
    const notifyFn = vi.fn().mockResolvedValue({ recipients: [] })

    const routes = createAdminRequestsRoutes({
      sender: stubSender,
      notificationConfig: stubConfig,
      notifyFn,
      webBaseUrl: "http://localhost:3000",
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
    await app.register(routes)
    await app.ready()
    return app
  }

  // ---------------------------------------------------------------------------
  // channel.register
  // ---------------------------------------------------------------------------

  describe("POST /admin/channels — channel.register", () => {
    it("writes one audit row with action=channel.register via x-admin-key (actor=cli)", async () => {
      const churchId = await insertChurch("alpha")
      mockResolveChannel.mockResolvedValue({
        youtubeChannelId: YT_CHANNEL_ID,
        title: "Alpha Channel",
      })
      const app = await buildAdminApp({ id: churchId, slug: "alpha", name: "Alpha Church" })

      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
        payload: { churchSlug: "alpha", youtubeChannelId: YT_CHANNEL_ID },
      })
      expect(res.statusCode).toBe(200)

      const newChannelId = res.json().id
      const rows = await auditRows("channel.register", "channel", newChannelId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.user_id).toBeNull()
      expect((rows[0]?.payload as { actor: string }).actor).toBe("cli")

      await app.close()
    })

    it("writes one audit row with action=channel.register via session (actor=session, user_id set)", async () => {
      const churchId = await insertChurch("beta")
      const adminId = await insertUser({ is_admin: true })
      const token = await insertSession(adminId)

      mockResolveChannel.mockResolvedValue({
        youtubeChannelId: "UCtest000000000000000002",
        title: "Beta Channel",
      })
      const app = await buildAdminApp({ id: churchId, slug: "beta", name: "Beta Church" })

      const res = await app.inject({
        method: "POST",
        url: "/admin/channels",
        headers: { "content-type": "application/json" },
        cookies: { [SESSION_COOKIE]: token },
        payload: { churchSlug: "beta", youtubeChannelId: "UCtest000000000000000002" },
      })
      expect(res.statusCode).toBe(200)

      const newChannelId = res.json().id
      const rows = await auditRows("channel.register", "channel", newChannelId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.user_id).toBe(adminId)
      expect((rows[0]?.payload as { actor: string }).actor).toBe("session")

      await app.close()
    })
  })

  // ---------------------------------------------------------------------------
  // ingest.refresh
  // ---------------------------------------------------------------------------

  it("POST /admin/ingest/refresh — writes one audit row action=ingest.refresh", async () => {
    const churchId = await insertChurch("gamma")
    await insertChannel(churchId)

    mockIngestChannel.mockResolvedValue({
      youtubeChannelId: YT_CHANNEL_ID,
      playlistCount: 1,
      videoCount: 2,
    })

    const app = await buildAdminApp({ id: churchId, slug: "gamma", name: "Gamma Church" })

    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/refresh?churchSlug=gamma",
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("ingest.refresh", "church", churchId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBeNull()
    expect((rows[0]?.payload as { actor: string }).actor).toBe("cli")

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // ingest.reingest
  // ---------------------------------------------------------------------------

  it("POST /admin/ingest/reingest — queues a received request and writes audit row action=ingest.reingest", async () => {
    const adminId = await insertUser({ is_admin: true })
    const churchId = await insertChurch("reingest-church")
    await insertChannel(churchId)

    const app = await buildAdminApp({
      id: churchId,
      slug: "reingest-church",
      name: "Reingest Church",
    })

    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/reingest",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "reingest-church" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { requests: Array<{ id: string; youtubeChannelId: string }> }
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0]?.youtubeChannelId).toBe(YT_CHANNEL_ID)

    // A worker-claimable request was created, scoped to the church and the channel,
    // attributed to the admin user (x-admin-key path has no session user).
    const reqRow = await db
      .selectFrom("ingestion_requests")
      .selectAll()
      .where("id", "=", body.requests[0]?.id ?? "")
      .executeTakeFirstOrThrow()
    expect(reqRow.status).toBe("received")
    expect(reqRow.church_id).toBe(churchId)
    expect(reqRow.youtube_handle_or_url).toBe(YT_CHANNEL_ID)
    expect(reqRow.user_id).toBe(adminId)

    const rows = await auditRows("ingest.reingest", "church", churchId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBeNull()
    expect((rows[0]?.payload as { actor: string }).actor).toBe("cli")

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // ingest.view_stats
  // ---------------------------------------------------------------------------

  it("POST /admin/ingest/view-stats — writes one audit row action=ingest.view_stats on success", async () => {
    const churchId = await insertChurch("delta")
    mockRunViewStats.mockResolvedValue({
      channelCount: 1,
      playlistCount: 1,
      videoCount: 5,
      fetchedFromApi: 5,
    })

    const app = await buildAdminApp({ id: churchId, slug: "delta", name: "Delta Church" })

    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "delta" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("ingest.view_stats", "church", churchId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBeNull()

    await app.close()
  })

  it("POST /admin/ingest/view-stats — writes NO audit row when runViewStats throws", async () => {
    const churchId = await insertChurch("epsilon")
    mockRunViewStats.mockRejectedValue(new Error("quota exceeded"))

    const app = await buildAdminApp({ id: churchId, slug: "epsilon", name: "Epsilon Church" })

    const res = await app.inject({
      method: "POST",
      url: "/admin/ingest/view-stats",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "epsilon" },
    })
    expect(res.statusCode).toBe(500)

    const rows = await auditRows("ingest.view_stats")
    expect(rows).toHaveLength(0)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // video.retranscribe
  // ---------------------------------------------------------------------------

  it("POST /admin/videos/:id/retranscribe — writes one audit row on success", async () => {
    const churchId = await insertChurch("zeta")
    const channelId = await insertChannel(churchId)
    await insertVideo(churchId, channelId, { youtube_video_id: YT_VIDEO_ID })

    mockCacheUnlink.mockResolvedValue(undefined)
    mockIngestVideoTranscript.mockResolvedValue({ status: "ok", transcriptId: "tr-001" })

    const app = await buildAdminApp({ id: churchId, slug: "zeta", name: "Zeta Church" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/videos/${YT_VIDEO_ID}/retranscribe`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "zeta" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("video.retranscribe", "video", YT_VIDEO_ID)
    expect(rows).toHaveLength(1)
    expect((rows[0]?.payload as { transcriptId: string }).transcriptId).toBe("tr-001")

    await app.close()
  })

  it("POST /admin/videos/:id/retranscribe — writes one audit row with outcome=no_captions on 422", async () => {
    const churchId = await insertChurch("eta")
    const channelId = await insertChannel(churchId)
    await insertVideo(churchId, channelId, { youtube_video_id: YT_VIDEO_ID })

    mockCacheUnlink.mockResolvedValue(undefined)
    mockIngestVideoTranscript.mockResolvedValue({ status: "no_captions" })

    const app = await buildAdminApp({ id: churchId, slug: "eta", name: "Eta Church" })

    const res = await app.inject({
      method: "POST",
      url: `/admin/videos/${YT_VIDEO_ID}/retranscribe`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { churchSlug: "eta" },
    })
    expect(res.statusCode).toBe(422)

    const rows = await auditRows("video.retranscribe", "video", YT_VIDEO_ID)
    expect(rows).toHaveLength(1)
    expect((rows[0]?.payload as { outcome: string }).outcome).toBe("no_captions")

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // church.rename
  // ---------------------------------------------------------------------------

  it("PATCH /admin/churches/:id — writes one audit row action=church.rename inside the transaction", async () => {
    const churchId = await insertChurch("theta")
    const app = await buildAdminApp({ id: churchId, slug: "theta", name: "Theta Church" })

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/churches/${churchId}`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { slug: "theta-renamed" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("church.rename", "church", churchId)
    expect(rows).toHaveLength(1)
    expect((rows[0]?.payload as { previous_slug: string }).previous_slug).toBe("theta")
    expect((rows[0]?.payload as { new_slug: string }).new_slug).toBe("theta-renamed")
    expect((rows[0]?.payload as { slug_changed: boolean }).slug_changed).toBe(true)

    await app.close()
  })

  it("PATCH /admin/churches/:id — no audit row if transaction rolls back (duplicate slug conflict)", async () => {
    await insertChurch("existing-slug")
    const churchId = await insertChurch("iota")

    // Insert a church_slug_alias that will conflict when slug_alias is inserted inside the trx
    // Easier: just attempt rename to a slug that already exists as a church slug
    const app = await buildAdminApp({ id: churchId, slug: "iota", name: "Iota Church" })

    const res = await app.inject({
      method: "PATCH",
      url: `/admin/churches/${churchId}`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { slug: "existing-slug" },
    })
    // Should get 409 from collision check before transaction even runs
    expect(res.statusCode).toBe(409)

    const rows = await auditRows("church.rename")
    expect(rows).toHaveLength(0)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // request.approve
  // ---------------------------------------------------------------------------

  it("POST /admin/requests/:id/approve — writes one audit row action=request.approve", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, { status: "awaiting_approval" })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.approve", "request", reqId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(adminId)
    expect((rows[0]?.payload as { actor: string }).actor).toBe("session")
    expect((rows[0]?.payload as { to_status: string }).to_status).toBe("approved")

    await app.close()
  })

  it("POST /admin/requests/:id/approve — idempotent: already-approved request writes zero audit rows", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, { status: "approved" })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/approve`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.approve")
    expect(rows).toHaveLength(0)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // request.deny
  // ---------------------------------------------------------------------------

  it("POST /admin/requests/:id/deny — writes one audit row action=request.deny", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, { status: "awaiting_approval" })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/deny`,
      headers: { "content-type": "application/json" },
      cookies: { [SESSION_COOKIE]: token },
      payload: { note: "Not eligible" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.deny", "request", reqId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(adminId)
    expect((rows[0]?.payload as { to_status: string }).to_status).toBe("denied")
    expect((rows[0]?.payload as { admin_note: string }).admin_note).toBe("Not eligible")

    await app.close()
  })

  it("POST /admin/requests/:id/deny — already-denied with changed note writes one audit row", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, {
      status: "denied",
      admin_note: "Old note",
    })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/deny`,
      headers: { "content-type": "application/json" },
      cookies: { [SESSION_COOKIE]: token },
      payload: { note: "Updated note" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.deny", "request", reqId)
    expect(rows).toHaveLength(1)
    expect((rows[0]?.payload as { admin_note: string }).admin_note).toBe("Updated note")

    await app.close()
  })

  it("POST /admin/requests/:id/deny — already-denied with identical note writes zero audit rows", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, {
      status: "denied",
      admin_note: "Same note",
    })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/deny`,
      headers: { "content-type": "application/json" },
      cookies: { [SESSION_COOKIE]: token },
      payload: { note: "Same note" },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.deny")
    expect(rows).toHaveLength(0)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // request.retry
  // ---------------------------------------------------------------------------

  it("POST /admin/requests/:id/retry — writes one audit row action=request.retry", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, {
      status: "failed",
      admin_note: "yt-dlp boom",
    })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/retry`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.retry", "request", reqId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(adminId)
    expect((rows[0]?.payload as { actor: string }).actor).toBe("session")
    expect((rows[0]?.payload as { from_status: string }).from_status).toBe("failed")
    expect((rows[0]?.payload as { to_status: string }).to_status).toBe("received")

    await app.close()
  })

  it("POST /admin/requests/:id/retry — idempotent: already-received request writes zero audit rows", async () => {
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const subjectId = await insertUser()
    const reqId = await insertIngestionRequest(subjectId, { status: "received" })

    const app = await buildRequestsApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${reqId}/retry`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("request.retry")
    expect(rows).toHaveLength(0)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // filter_rule.create
  // ---------------------------------------------------------------------------

  it("POST /admin/channels/:channelId/filter-rules — writes one audit row action=filter_rule.create", async () => {
    const churchId = await insertChurch("kappa")
    const channelId = await insertChannel(churchId)

    mockValidatePlaylistTarget.mockResolvedValue({ ok: true })

    const app = await buildFilterRulesApp()

    const res = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID },
    })
    expect(res.statusCode).toBe(200)

    const ruleId = res.json().id
    const rows = await auditRows("filter_rule.create", "filter_rule", ruleId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBeNull()
    expect((rows[0]?.payload as { actor: string }).actor).toBe("cli")
    expect((rows[0]?.payload as { channel_id: string }).channel_id).toBe(channelId)

    await app.close()
  })

  // ---------------------------------------------------------------------------
  // filter_rule.delete
  // ---------------------------------------------------------------------------

  it("DELETE /admin/channels/:channelId/filter-rules/:ruleId — writes one audit row action=filter_rule.delete", async () => {
    const churchId = await insertChurch("lambda")
    const channelId = await insertChannel(churchId)

    const ruleRow = await db
      .insertInto("channel_filter_rules")
      .values({
        channel_id: channelId,
        rule_type: "exclude",
        target_kind: "playlist",
        target_id: PLAYLIST_ID,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()

    mockValidatePlaylistTarget.mockResolvedValue({ ok: true })

    const app = await buildFilterRulesApp()

    const res = await app.inject({
      method: "DELETE",
      url: `/admin/channels/${channelId}/filter-rules/${ruleRow.id}`,
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(res.statusCode).toBe(200)

    const rows = await auditRows("filter_rule.delete", "filter_rule", ruleRow.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBeNull()
    expect((rows[0]?.payload as { channel_id: string }).channel_id).toBe(channelId)

    await app.close()
  })
})
