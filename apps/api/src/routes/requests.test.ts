import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { __resetForTests } from "../plugins/rate-limit.js"
import type { AuthenticatedUser } from "../plugins/session.js"

vi.mock("../config.js", () => ({
  config: {
    ADMIN_API_KEY: "test-key",
    SESSION_COOKIE_NAME: "sermon_session",
  },
}))

const { rateLimitPlugin } = await import("../plugins/rate-limit.js")
const { createRequestsRoutes } = await import("./requests.js")

const STUB_USER: AuthenticatedUser = {
  id: "user-abc",
  display_name: "Test User",
  avatar_url: null,
  is_admin: false,
  status: "active",
}

const OTHER_USER_ID = "user-xyz"

const STUB_RESOLVED = { youtubeChannelId: "UCtest123456789012345678", title: "Test Channel" }

async function buildApp(
  overrides: Partial<{
    lookupSlugCollision: (db: Kysely<Database>, slug: string) => Promise<boolean>
    lookupChurchByYoutubeChannelId: (
      db: Kysely<Database>,
      ytChannelId: string,
    ) => Promise<{ id: string; slug: string; status: string } | null>
    lookupInFlightRequestForChurch: (
      db: Kysely<Database>,
      churchId: string,
    ) => Promise<{ id: string; user_id: string } | null>
    resolveChannelOrNull: (
      youtube: unknown,
      handle: string,
    ) => Promise<{ youtubeChannelId: string; title: string } | null>
    authenticated: boolean
    insertRow: { id: string }
  }> = {},
) {
  const {
    authenticated = true,
    lookupSlugCollision = async () => false,
    lookupChurchByYoutubeChannelId = async () => null,
    lookupInFlightRequestForChurch = async () => null,
    resolveChannelOrNull = async () => STUB_RESOLVED,
    insertRow = { id: "req-001" },
  } = overrides

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Stub db — only executeTakeFirstOrThrow is used for the insert path
  const stubDb = {
    insertInto: () => ({
      values: () => ({
        returning: () => ({
          executeTakeFirstOrThrow: async () => insertRow,
        }),
      }),
    }),
  } as unknown as Kysely<Database>

  app.decorate("db", stubDb)
  app.decorate("youtube", {} as never)

  // Auth stubs
  app.decorateRequest("user", null)
  app.decorateRequest("sessionId", null)
  app.decorate(
    "requireUser",
    async (request: Parameters<typeof vi.fn>[0], reply: Parameters<typeof vi.fn>[1]) => {
      if (!authenticated) {
        await (reply as { code: (n: number) => { send: (b: unknown) => void } })
          .code(401)
          .send({ error: "unauthenticated" })
        return
      }
      ;(request as { user: AuthenticatedUser }).user = STUB_USER
    },
  )
  app.decorate(
    "requireAdmin",
    async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
      await reply.code(403).send({ error: "forbidden" })
    },
  )

  await app.register(rateLimitPlugin)

  const routes = createRequestsRoutes({
    lookupSlugCollision,
    lookupChurchByYoutubeChannelId,
    lookupInFlightRequestForChurch,
    resolveChannelOrNull,
  })
  await app.register(routes)
  await app.ready()
  return app
}

const VALID_BODY = {
  requested_slug: "mychurch",
  requested_name: "My Church",
  youtube_handle_or_url: "@mychurch",
  contact_email: "contact@mychurch.org",
}

describe("POST /requests — auth gate", () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    __resetForTests()
    app = await buildApp({ authenticated: false })
  })

  afterEach(async () => {
    await app.close()
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(401)
  })
})

describe("POST /requests — slug validation", () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    __resetForTests()
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it("400 for bad slug format (uppercase)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/requests",
      payload: { ...VALID_BODY, requested_slug: "BAD_SLUG" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: "invalid_slug", reason: "format" })
  })

  it("400 for reserved slug", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/requests",
      payload: { ...VALID_BODY, requested_slug: "admin" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: "invalid_slug", reason: "reserved" })
  })

  it("409 slug_taken when collision found", async () => {
    const collisionApp = await buildApp({ lookupSlugCollision: async () => true })
    const res = await collisionApp.inject({
      method: "POST",
      url: "/requests",
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: "slug_taken" })
    await collisionApp.close()
  })
})

describe("POST /requests — channel resolution", () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    __resetForTests()
    app = await buildApp({ resolveChannelOrNull: async () => null })
  })

  afterEach(async () => {
    await app.close()
  })

  it("422 unknown_handle when channel cannot be resolved", async () => {
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: "unknown_handle" })
  })
})

describe("POST /requests — channel dedupe", () => {
  afterEach(async () => {
    __resetForTests()
  })

  it("409 channel_already_ingested for active church", async () => {
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "active",
      }),
    })
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({
      error: "channel_already_ingested",
      existing_slug: "stmarks",
      search_url: "/stmarks/",
    })
    await app.close()
  })

  it("409 channel_request_in_flight (is_yours: true) includes request_id", async () => {
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "pending",
      }),
      lookupInFlightRequestForChurch: async () => ({ id: "req-existing", user_id: STUB_USER.id }),
    })
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body).toMatchObject({
      error: "channel_request_in_flight",
      existing_slug: "stmarks",
      search_url: "/stmarks/",
      is_yours: true,
      request_id: "req-existing",
    })
    await app.close()
  })

  it("409 channel_request_in_flight (is_yours: false) omits request_id", async () => {
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "pending",
      }),
      lookupInFlightRequestForChurch: async () => ({ id: "req-existing", user_id: OTHER_USER_ID }),
    })
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body).toMatchObject({
      error: "channel_request_in_flight",
      is_yours: false,
    })
    expect(body).not.toHaveProperty("request_id")
    await app.close()
  })

  it("409 channel_unavailable for denied church", async () => {
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "denied",
      }),
    })
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: "channel_unavailable" })
    await app.close()
  })

  it("409 channel_unavailable for suspended church", async () => {
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "suspended",
      }),
    })
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: "channel_unavailable" })
    await app.close()
  })
})

describe("POST /requests — happy path", () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    __resetForTests()
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it("returns 201 with request_id, status_url, search_url", async () => {
    const res = await app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      request_id: "req-001",
      status_url: "/me/requests/req-001",
      // search_url is null at submit time — church_id is not linked until the
      // worker's first run; the status page falls back to /${requested_slug}/.
      search_url: null,
    })
  })
})

describe("POST /requests — rate limit", () => {
  it("returns 429 after 5 requests/hr, with Retry-After header", async () => {
    __resetForTests()
    const app = await buildApp()
    const POST = () => app.inject({ method: "POST", url: "/requests", payload: VALID_BODY })

    for (let i = 0; i < 5; i++) {
      const r = await POST()
      expect(r.statusCode).toBe(201)
    }

    const overflow = await POST()
    expect(overflow.statusCode).toBe(429)
    expect(overflow.json()).toMatchObject({ error: "rate_limited" })
    expect(Number(overflow.headers["retry-after"])).toBeGreaterThan(0)
    await app.close()
  })
})

describe("HEAD /requests/slug-available/:slug", () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    __resetForTests()
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it("401 when unauthenticated", async () => {
    const unauthApp = await buildApp({ authenticated: false })
    const res = await unauthApp.inject({ method: "HEAD", url: "/requests/slug-available/mychurch" })
    expect(res.statusCode).toBe(401)
    await unauthApp.close()
  })

  it("200 for an available slug", async () => {
    const res = await app.inject({ method: "HEAD", url: "/requests/slug-available/mychurch" })
    expect(res.statusCode).toBe(200)
  })

  it("409 for a taken slug", async () => {
    const takenApp = await buildApp({ lookupSlugCollision: async () => true })
    const res = await takenApp.inject({ method: "HEAD", url: "/requests/slug-available/mychurch" })
    expect(res.statusCode).toBe(409)
    await takenApp.close()
  })

  it("400 for a bad slug format", async () => {
    const res = await app.inject({ method: "HEAD", url: "/requests/slug-available/BADSLUG" })
    expect(res.statusCode).toBe(400)
  })

  it("400 for a reserved slug", async () => {
    const res = await app.inject({ method: "HEAD", url: "/requests/slug-available/admin" })
    expect(res.statusCode).toBe(400)
  })
})

describe("GET /requests/channel-preflight", () => {
  afterEach(() => {
    __resetForTests()
  })

  it("401 when unauthenticated", async () => {
    __resetForTests()
    const app = await buildApp({ authenticated: false })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("200 unknown_handle when channel not found", async () => {
    __resetForTests()
    const app = await buildApp({ resolveChannelOrNull: async () => null })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@missing",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ state: "unknown_handle" })
    await app.close()
  })

  it("200 available when no church exists", async () => {
    __resetForTests()
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      state: "available",
      youtube_channel_id: STUB_RESOLVED.youtubeChannelId,
    })
    await app.close()
  })

  it("200 already_ingested for active church", async () => {
    __resetForTests()
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "active",
      }),
    })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      state: "already_ingested",
      existing_slug: "stmarks",
      search_url: "/stmarks/",
    })
    await app.close()
  })

  it("200 request_in_flight (is_yours: true) with request_id", async () => {
    __resetForTests()
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "pending",
      }),
      lookupInFlightRequestForChurch: async () => ({ id: "req-in-flight", user_id: STUB_USER.id }),
    })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      state: "request_in_flight",
      is_yours: true,
      request_id: "req-in-flight",
    })
    await app.close()
  })

  it("200 request_in_flight (is_yours: false) without request_id", async () => {
    __resetForTests()
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "pending",
      }),
      lookupInFlightRequestForChurch: async () => ({ id: "req-in-flight", user_id: OTHER_USER_ID }),
    })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ state: "request_in_flight", is_yours: false })
    expect(body).not.toHaveProperty("request_id")
    await app.close()
  })

  it("200 channel_unavailable for denied church", async () => {
    __resetForTests()
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "denied",
      }),
    })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ state: "channel_unavailable" })
    await app.close()
  })

  it("200 channel_unavailable for suspended church", async () => {
    __resetForTests()
    const app = await buildApp({
      lookupChurchByYoutubeChannelId: async () => ({
        id: "ch-1",
        slug: "stmarks",
        status: "suspended",
      }),
    })
    const res = await app.inject({
      method: "GET",
      url: "/requests/channel-preflight?handle=@mychurch",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ state: "channel_unavailable" })
    await app.close()
  })

  it("429 after exceeding 30 preflight/hr/user", async () => {
    __resetForTests()
    const app = await buildApp()
    const GET = () =>
      app.inject({ method: "GET", url: "/requests/channel-preflight?handle=@mychurch" })

    for (let i = 0; i < 30; i++) {
      const r = await GET()
      expect(r.statusCode).toBe(200)
    }
    const overflow = await GET()
    expect(overflow.statusCode).toBe(429)
    await app.close()
  })
})
