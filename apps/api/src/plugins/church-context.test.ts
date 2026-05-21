import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import fp from "fastify-plugin"
import type { Kysely } from "kysely"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { churchContextPlugin } = await import("./church-context.js")

const KNOWN_SLUG = "jubileestl"
const KNOWN_ROW = { id: "ch-1", slug: KNOWN_SLUG, name: "Jubilee" }

function buildMockDb(knownSlug: string, knownRow: typeof KNOWN_ROW | null = KNOWN_ROW) {
  const selectFromSpy = vi.fn((_table: string) => {
    let capturedVal: unknown
    const chain = {
      select: vi.fn(() => chain),
      where: vi.fn((_col: unknown, _op: unknown, val: unknown) => {
        capturedVal = val
        return chain
      }),
      executeTakeFirst: vi.fn(() => Promise.resolve(capturedVal === knownSlug ? knownRow : null)),
    }
    return chain
  })
  const db = { selectFrom: selectFromSpy } as unknown as Kysely<Database>
  return { db, selectFromSpy }
}

async function buildTestApp(db: Kysely<Database>) {
  const app = Fastify({ logger: false })

  // Register a named stub to satisfy churchContextPlugin's dependency on "db"
  await app.register(
    fp(
      async (instance) => {
        instance.decorate("db", db)
      },
      { name: "db" },
    ),
  )

  await app.register(churchContextPlugin)

  // Routes under /:church — path param drives resolution
  await app.register(
    async (ctx) => {
      ctx.addHook("preHandler", ctx.requireChurchContext)
      ctx.get("/ping", async (request) => ({
        churchId: request.churchId,
        churchSlug: request.churchSlug,
      }))
    },
    { prefix: "/:church" },
  )

  // Route without :church param — header drives resolution
  await app.register(async (ctx) => {
    ctx.addHook("preHandler", ctx.requireChurchContext)
    ctx.get("/header-ping", async (request) => ({
      churchId: request.churchId,
      churchSlug: request.churchSlug,
    }))
  })

  await app.ready()
  return app
}

describe("churchContextPlugin", () => {
  let mockDb: ReturnType<typeof buildMockDb>
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeEach(async () => {
    mockDb = buildMockDb(KNOWN_SLUG)
    app = await buildTestApp(mockDb.db)
  })

  afterEach(async () => {
    await app.close()
  })

  it("path-only: known slug resolves churchId", async () => {
    const res = await app.inject({ method: "GET", url: `/${KNOWN_SLUG}/ping` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ churchId: KNOWN_ROW.id, churchSlug: KNOWN_SLUG })
  })

  it("header-only: known slug via X-Church-Slug resolves churchId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/header-ping",
      headers: { "x-church-slug": KNOWN_SLUG },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ churchId: KNOWN_ROW.id, churchSlug: KNOWN_SLUG })
  })

  it("matching path + header: resolves successfully", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${KNOWN_SLUG}/ping`,
      headers: { "x-church-slug": KNOWN_SLUG },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ churchId: KNOWN_ROW.id })
  })

  it("mismatched path + header → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${KNOWN_SLUG}/ping`,
      headers: { "x-church-slug": "other-church" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: "church slug mismatch" })
  })

  it("neither path nor header → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/header-ping" })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: "church slug required" })
  })

  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/unknown-slug/ping" })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: "church not found" })
  })

  it("slug cache: DB queried only once across two identical requests", async () => {
    await app.inject({ method: "GET", url: `/${KNOWN_SLUG}/ping` })
    await app.inject({ method: "GET", url: `/${KNOWN_SLUG}/ping` })
    expect(mockDb.selectFromSpy.mock.calls).toHaveLength(1)
  })
})
