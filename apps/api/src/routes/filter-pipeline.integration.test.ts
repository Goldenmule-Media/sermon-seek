/**
 * End-to-end integration test proving the full request → approve → worker
 * ingest pipeline honors the requester's playlist filter spec.
 *
 * Scope (C6): submit via API → admin approve → worker run → assert
 * channel_filter_rules rows and ingested playlists/videos match the spec.
 *
 * Requires TEST_DATABASE_URL. Skips when unset.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import { createLogSender } from "@sermon-search/notifications"
import type { EmailSender, NotificationConfig, NotifyContext } from "@sermon-search/notifications"
import type { TemplateName } from "@sermon-search/notifications"
import type { RunIngestionRequestOptions } from "@sermon-search/worker"
import { runIngestionRequest } from "@sermon-search/worker"
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

// ── Fixture constants ──────────────────────────────────────────────────────────

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"
const WEB_BASE_URL = "http://localhost:3000"

const CHANNEL_ID = "UCFiltersInt000000000001"

const SERMONS_PL = {
  id: "PLFiltersSermons00000001",
  title: "Sermons",
  videoIds: ["vid_filt_s1", "vid_filt_s2"],
}
const ANNOUNCE_PL = {
  id: "PLFiltersAnnounce0000001",
  title: "Announcements",
  videoIds: ["vid_filt_a1"],
}
const KIDS_PL = {
  id: "PLFiltersKids00000000001",
  title: "Kids Ministry",
  videoIds: ["vid_filt_k1"],
}
const ALL_PLAYLISTS = [SERMONS_PL, ANNOUNCE_PL, KIDS_PL]
const ALL_VIDEO_IDS = [...SERMONS_PL.videoIds, ...ANNOUNCE_PL.videoIds, ...KIDS_PL.videoIds]

// ── YouTube stub factories ─────────────────────────────────────────────────────

type YoutubeStubForApp = {
  listPlaylistsById: (
    id: string,
  ) => Promise<{ items?: Array<{ id: string; snippet?: { channelId?: string } }> }>
}

function makeAppYoutubeStub(): YoutubeStubForApp {
  return {
    listPlaylistsById: vi.fn(async (id: string) => {
      const known = ALL_PLAYLISTS.find((p) => p.id === id)
      if (!known) return { items: [] }
      return { items: [{ id, snippet: { channelId: CHANNEL_ID } }] }
    }),
  }
}

function makeRunnerClient() {
  return {
    listChannelsByHandle: vi.fn(async () => ({
      items: [{ id: CHANNEL_ID, snippet: { title: "Filter Test Channel" } }],
    })),
    listChannelsById: vi.fn(async () => ({
      items: [{ id: CHANNEL_ID, snippet: { title: "Filter Test Channel" } }],
    })),
    listChannelsByUsername: vi.fn(async () => ({ items: [] })),
    listPlaylists: vi.fn(async () => ({
      items: ALL_PLAYLISTS.map((p) => ({
        id: p.id,
        snippet: { title: p.title, channelId: CHANNEL_ID },
        contentDetails: { itemCount: p.videoIds.length },
      })),
    })),
    listPlaylistItems: vi.fn(async (playlistId: string) => {
      const pl = ALL_PLAYLISTS.find((p) => p.id === playlistId)
      if (!pl) return { items: [] }
      return {
        items: pl.videoIds.map((vid, i) => ({
          contentDetails: { videoId: vid, videoPublishedAt: "2025-01-01T00:00:00Z" },
          snippet: {
            position: i,
            resourceId: { videoId: vid },
            publishedAt: "2025-01-01T00:00:00Z",
          },
        })),
      }
    }),
    listVideos: vi.fn(async (ids: readonly string[]) => ({
      items: ids.map((id) => ({
        id,
        snippet: {
          channelId: CHANNEL_ID,
          title: `Video ${id}`,
          description: "Test",
          publishedAt: "2025-01-01T00:00:00Z",
          thumbnails: { default: { url: "https://example.test/thumb.jpg" } },
        },
        contentDetails: { duration: "PT10M" },
      })),
    })),
    listPlaylistsById: vi.fn(async (id: string) => {
      const known = ALL_PLAYLISTS.find((p) => p.id === id)
      if (!known) return { items: [] }
      return { items: [{ id, snippet: { channelId: CHANNEL_ID } }] }
    }),
  }
}

function makeFakeEmbedder(): Embedder {
  return {
    model: "text-embedding-3-small",
    dimensions: 4,
    async embed(texts: string[]) {
      return texts.map(() => [0.1, 0.2, 0.3, 0.4])
    },
  }
}

// ── Fastify app factory ────────────────────────────────────────────────────────

function makeNotifyCapture() {
  const calls: { status: TemplateName; ctx: NotifyContext }[] = []
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

async function buildApiApp(db: Kysely<Database>) {
  const { notifyFn } = makeNotifyCapture()
  const stubSender: EmailSender = { send: async () => {} }
  const stubConfig: NotificationConfig = { from: "no-reply@test.com" }

  const adminRoutes = createAdminRequestsRoutes({
    sender: stubSender,
    notificationConfig: stubConfig,
    notifyFn,
    webBaseUrl: WEB_BASE_URL,
  })

  const requestRoutes = createRequestsRoutes({
    lookupSlugCollision: async (db, slug) => {
      const hit = await db
        .selectFrom("churches")
        .select("id")
        .where("slug", "=", slug)
        .executeTakeFirst()
      return hit !== undefined
    },
    lookupChurchByYoutubeChannelId: async (db, ytId) => {
      const row = await db
        .selectFrom("churches")
        .select(["id", "slug", "status"])
        .where("youtube_channel_id", "=", ytId)
        .executeTakeFirst()
      return row ?? null
    },
    lookupInFlightRequestForChurch: async (db, churchId) => {
      const row = await db
        .selectFrom("ingestion_requests")
        .select(["id", "user_id"])
        .where("church_id", "=", churchId)
        .where("status", "in", ["received", "running", "awaiting_approval"])
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst()
      return row ?? null
    },
    resolveChannelOrNull: async () => ({
      youtubeChannelId: CHANNEL_ID,
      title: "Filter Test Channel",
    }),
  })

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cookie, { secret: COOKIE_SECRET })
  await app.register(
    fp(
      async (inst) => {
        inst.decorate("db", db)
      },
      { name: "db" },
    ),
  )
  await app.register(
    fp(
      async (inst) => {
        inst.decorate("youtube", makeAppYoutubeStub())
      },
      { name: "youtube" },
    ),
  )
  await app.register(sessionPlugin)
  await app.register(rateLimitPlugin)
  await app.register(requestRoutes)
  await app.register(meRequestsRoutes)
  await app.register(adminRoutes)
  await app.ready()

  return app
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function insertUser(db: Kysely<Database>, opts: { is_admin?: boolean } = {}) {
  const row = await db
    .insertInto("users")
    .values({
      google_sub: `sub-${Math.random().toString(36).slice(2)}`,
      display_name: "Test User",
      is_admin: opts.is_admin ?? false,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow()
  return row.id
}

async function insertSession(db: Kysely<Database>, userId: string) {
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

// ── Suite ──────────────────────────────────────────────────────────────────────

describeIfDb("filter-pipeline integration (C6)", () => {
  let db: Kysely<Database>
  let tmpRoot: string

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
    tmpRoot = await mkdtemp(join(tmpdir(), "filter-pipeline-int-"))
    process.env.CACHE_DIR = tmpRoot
  })

  afterAll(async () => {
    await db.destroy()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    __resetForTests()
    await sql`
      TRUNCATE ingestion_requests, sessions, users, churches,
               channel_filter_rules, worker_heartbeats, admin_audit_log
      RESTART IDENTITY CASCADE
    `.execute(db)
  })

  async function runOneFilterMode(opts: {
    mode: "none" | "include" | "exclude"
    playlistIds: string[]
    expectedPlaylistIds: string[]
    expectedVideoIds: string[]
  }) {
    const { mode, playlistIds, expectedPlaylistIds, expectedVideoIds } = opts

    const app = await buildApiApp(db)

    const userId = await insertUser(db)
    const adminId = await insertUser(db, { is_admin: true })
    const userToken = await insertSession(db, userId)
    const adminToken = await insertSession(db, adminId)

    // 1. Submit request via API
    const playlistFilters =
      mode === "none"
        ? { mode: "none" as const, playlist_ids: [] }
        : { mode, playlist_ids: playlistIds }

    const postRes = await app.inject({
      method: "POST",
      url: "/requests",
      payload: {
        requested_slug: `filter-test-${mode}`,
        requested_name: "Filter Test Church",
        youtube_handle_or_url: "@FiltersIntTest",
        contact_email: "test@example.com",
        playlist_filters: playlistFilters,
      },
      cookies: { [SESSION_COOKIE]: userToken },
    })
    expect(postRes.statusCode).toBe(201)
    const { request_id } = postRes.json()

    // 2. Verify include/exclude columns were persisted correctly
    const reqRow = await db
      .selectFrom("ingestion_requests")
      .select(["include_playlist_ids", "exclude_playlist_ids", "status"])
      .where("id", "=", request_id)
      .executeTakeFirstOrThrow()
    expect(reqRow.status).toBe("received")
    if (mode === "include") {
      expect(reqRow.include_playlist_ids).toEqual(playlistIds)
      expect(reqRow.exclude_playlist_ids).toEqual([])
    } else if (mode === "exclude") {
      expect(reqRow.include_playlist_ids).toEqual([])
      expect(reqRow.exclude_playlist_ids).toEqual(playlistIds)
    } else {
      expect(reqRow.include_playlist_ids).toEqual([])
      expect(reqRow.exclude_playlist_ids).toEqual([])
    }

    // 3. Simulate cap-hit: create church + channels row, then flip to awaiting_approval.
    //    (Mirrors the happy-path simulation in requests.integration.test.ts.)
    const churchRow = await db
      .insertInto("churches")
      .values({
        slug: `filter-test-${mode}`,
        name: "Filter Test Church",
        youtube_channel_id: CHANNEL_ID,
        status: "pending",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    const churchId = churchRow.id

    const channelRow = await db
      .insertInto("channels")
      .values({
        church_id: churchId,
        youtube_channel_id: CHANNEL_ID,
        title: "Filter Test Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    const channelDbId = channelRow.id

    await db
      .updateTable("ingestion_requests")
      .set({
        church_id: churchId,
        status: "awaiting_approval",
        limit_reached: true,
        videos_discovered: ALL_VIDEO_IDS.length,
        videos_ingested: 1,
        tokens_ingested: 800_000,
        updated_at: sql`now()`,
      })
      .where("id", "=", request_id)
      .execute()

    // 4. Admin approve — materializes channel_filter_rules
    const approveRes = await app.inject({
      method: "POST",
      url: `/admin/requests/${request_id}/approve`,
      cookies: { [SESSION_COOKIE]: adminToken },
    })
    expect(approveRes.statusCode).toBe(200)
    expect(approveRes.json().status).toBe("approved")

    // 5. Assert channel_filter_rules rows match the filter spec
    const rules = await db
      .selectFrom("channel_filter_rules")
      .selectAll()
      .where("channel_id", "=", channelDbId)
      .orderBy("target_id", "asc")
      .execute()

    if (mode === "none") {
      expect(rules).toHaveLength(0)
    } else {
      expect(rules).toHaveLength(playlistIds.length)
      const ruleType = mode === "include" ? "include" : "exclude"
      for (const rule of rules) {
        expect(rule.rule_type).toBe(ruleType)
        expect(rule.target_kind).toBe("playlist")
        expect(playlistIds).toContain(rule.target_id)
      }
    }

    // 6. Run the worker against the approved request
    const runnerOpts: RunIngestionRequestOptions = {
      db,
      client: makeRunnerClient() as RunIngestionRequestOptions["client"],
      embedder: makeFakeEmbedder(),
      enricher: {
        model: "test-model",
        async enrich() {
          return { summary: "A sermon.", topics: ["faith"], model: "test-model" }
        },
      },
      sender: createLogSender(),
      notificationConfig: { from: "noreply@test.com" },
      webBaseUrl: WEB_BASE_URL,
      requestId: request_id,
      tokenCap: Number.POSITIVE_INFINITY,
      workerId: `filter-test-${mode}:1`,
      log: () => {},
    }
    await runIngestionRequest(runnerOpts)

    // 7. Assert the request completed
    const finalReq = await db
      .selectFrom("ingestion_requests")
      .select("status")
      .where("id", "=", request_id)
      .executeTakeFirstOrThrow()
    expect(finalReq.status).toBe("complete")

    // 8. Assert the church is active
    const finalChurch = await db
      .selectFrom("churches")
      .select("status")
      .where("id", "=", churchId)
      .executeTakeFirstOrThrow()
    expect(finalChurch.status).toBe("active")

    // 9. Assert only the expected playlists were ingested
    const ingestedPlaylists = await db
      .selectFrom("playlists")
      .select("youtube_playlist_id")
      .where("church_id", "=", churchId)
      .orderBy("youtube_playlist_id", "asc")
      .execute()
    expect(ingestedPlaylists.map((r) => r.youtube_playlist_id).sort()).toEqual(
      [...expectedPlaylistIds].sort(),
    )

    // 10. Assert only the expected videos were ingested
    const ingestedVideos = await db
      .selectFrom("videos")
      .select("youtube_video_id")
      .where("church_id", "=", churchId)
      .orderBy("youtube_video_id", "asc")
      .execute()
    expect(ingestedVideos.map((r) => r.youtube_video_id).sort()).toEqual(
      [...expectedVideoIds].sort(),
    )

    await app.close()
  }

  it("mode=none: no filter rules written, all playlists and videos ingested", async () => {
    await runOneFilterMode({
      mode: "none",
      playlistIds: [],
      expectedPlaylistIds: ALL_PLAYLISTS.map((p) => p.id),
      expectedVideoIds: ALL_VIDEO_IDS,
    })
  }, 30_000)

  it("mode=include: include rule rows written, only the included playlist and its videos ingested", async () => {
    await runOneFilterMode({
      mode: "include",
      playlistIds: [SERMONS_PL.id],
      expectedPlaylistIds: [SERMONS_PL.id],
      expectedVideoIds: SERMONS_PL.videoIds,
    })
  }, 30_000)

  it("mode=exclude: exclude rule rows written, all playlists except the excluded one ingested", async () => {
    await runOneFilterMode({
      mode: "exclude",
      playlistIds: [KIDS_PL.id],
      expectedPlaylistIds: [SERMONS_PL.id, ANNOUNCE_PL.id],
      expectedVideoIds: [...SERMONS_PL.videoIds, ...ANNOUNCE_PL.videoIds],
    })
  }, 30_000)
})
