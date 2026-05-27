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
import { adminChurchesRoutes } from "./admin-churches.js"

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

describeIfDb("Admin churches integration", () => {
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
    await sql`TRUNCATE church_slug_aliases, channels, videos, ingestion_requests, playlists, sessions, users, churches RESTART IDENTITY CASCADE`.execute(
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
    await app.register(adminChurchesRoutes)
    await app.ready()
    return app
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

  async function insertChurch(slug: string, opts: { status?: string } = {}): Promise<string> {
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
        youtube_channel_id: opts.youtube_channel_id ?? `UC${Math.random().toString(36).slice(2)}`,
        title: "Test Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertVideo(churchId: string, channelId: string) {
    const row = await db
      .insertInto("videos")
      .values({
        church_id: churchId,
        channel_id: channelId,
        youtube_video_id: `vid-${Math.random().toString(36).slice(2)}`,
        title: "Test Video",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertAlias(
    churchId: string,
    slug: string,
    opts: { expires_at?: Date | null } = {},
  ) {
    const row = await db
      .insertInto("church_slug_aliases")
      .values({
        church_id: churchId,
        slug,
        expires_at: opts.expires_at ?? null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  // --- Auth guard tests ---

  it("returns 401 with no session on GET /admin/churches", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/admin/churches" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 403 for a non-admin session on GET /admin/churches", async () => {
    const app = await buildApp()
    const userId = await insertUser({ is_admin: false })
    const token = await insertSession(userId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/churches",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("returns 401 with no session on GET /admin/churches/:id", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/churches/00000000-0000-0000-0000-000000000001",
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  // --- GET /admin/churches list ---

  it("returns empty list when no churches exist", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/churches",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    await app.close()
  })

  it("returns accurate channel_count and video_count per church with no cross-leak", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const churchAId = await insertChurch("church-a")
    const channelA1 = await insertChannel(churchAId)
    const channelA2 = await insertChannel(churchAId)
    for (let i = 0; i < 5; i++) await insertVideo(churchAId, channelA1)

    const churchBId = await insertChurch("church-b")
    const channelB1 = await insertChannel(churchBId)
    await insertVideo(churchBId, channelB1)

    const res = await app.inject({
      method: "GET",
      url: "/admin/churches",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)

    const a = body.items.find((x: { slug: string }) => x.slug === "church-a")
    const b = body.items.find((x: { slug: string }) => x.slug === "church-b")

    expect(a.channel_count).toBe(2)
    expect(a.video_count).toBe(5)
    expect(b.channel_count).toBe(1)
    expect(b.video_count).toBe(1)
    await app.close()
  })

  it("filters by slug_prefix", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    await insertChurch("grace-1")
    await insertChurch("grace-2")
    await insertChurch("mount-olive")

    const res = await app.inject({
      method: "GET",
      url: "/admin/churches?slug_prefix=grace",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((x: { slug: string }) => x.slug.startsWith("grace"))).toBe(true)
    await app.close()
  })

  it("paginates correctly", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    for (let i = 0; i < 5; i++) await insertChurch(`church-${i}`)

    const res = await app.inject({
      method: "GET",
      url: "/admin/churches?limit=2&offset=1",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(5)
    expect(body.items).toHaveLength(2)
    await app.close()
  })

  // --- GET /admin/churches/:id detail ---

  it("returns 404 for unknown church id", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const res = await app.inject({
      method: "GET",
      url: "/admin/churches/00000000-0000-0000-0000-000000000001",
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("returns church with empty aliases and channels and zero counters", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const churchId = await insertChurch("lone-church")

    const res = await app.inject({
      method: "GET",
      url: `/admin/churches/${churchId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(churchId)
    expect(body.slug).toBe("lone-church")
    expect(body.aliases).toEqual([])
    expect(body.channels).toEqual([])
    expect(body.channel_count).toBe(0)
    expect(body.video_count).toBe(0)
    await app.close()
  })

  it("returns aliases and channels with expected fields", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const churchId = await insertChurch("renamed-church")

    const aliasId = await insertAlias(churchId, "old-slug")
    const channelId = await insertChannel(churchId, { youtube_channel_id: "UCtest456" })

    const res = await app.inject({
      method: "GET",
      url: `/admin/churches/${churchId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.aliases).toHaveLength(1)
    expect(body.aliases[0].id).toBe(aliasId)
    expect(body.aliases[0].slug).toBe("old-slug")
    expect(body.aliases[0].expires_at).toBeNull()
    expect(typeof body.aliases[0].created_at).toBe("string")

    expect(body.channels).toHaveLength(1)
    expect(body.channels[0].id).toBe(channelId)
    expect(body.channels[0].youtube_channel_id).toBe("UCtest456")
    expect(body.channels[0].title).toBe("Test Channel")
    expect(typeof body.channels[0].ingested_at).toBe("string")

    expect(body.channel_count).toBe(1)
    expect(body.video_count).toBe(0)
    await app.close()
  })

  it("detail counters match list counters", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)
    const churchId = await insertChurch("counter-check")
    const channelId = await insertChannel(churchId)
    await insertVideo(churchId, channelId)
    await insertVideo(churchId, channelId)

    const [listRes, detailRes] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/admin/churches",
        cookies: { [SESSION_COOKIE]: token },
      }),
      app.inject({
        method: "GET",
        url: `/admin/churches/${churchId}`,
        cookies: { [SESSION_COOKIE]: token },
      }),
    ])

    const listItem = listRes.json().items[0]
    const detail = detailRes.json()

    expect(detail.channel_count).toBe(listItem.channel_count)
    expect(detail.video_count).toBe(listItem.video_count)
    await app.close()
  })

  it("cross-tenant isolation: detail for church A excludes church B data", async () => {
    const app = await buildApp()
    const adminId = await insertUser({ is_admin: true })
    const token = await insertSession(adminId)

    const churchAId = await insertChurch("church-alpha")
    const churchBId = await insertChurch("church-beta")

    await insertAlias(churchBId, "old-beta-slug")
    await insertChannel(churchBId, { youtube_channel_id: "UCbeta" })

    const res = await app.inject({
      method: "GET",
      url: `/admin/churches/${churchAId}`,
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.aliases).toHaveLength(0)
    expect(body.channels).toHaveLength(0)
    expect(body.channel_count).toBe(0)
    expect(body.video_count).toBe(0)
    await app.close()
  })
})
