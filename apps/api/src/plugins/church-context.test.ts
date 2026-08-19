import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import fp from "fastify-plugin"
import type { Kysely } from "kysely"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { churchContextPlugin } = await import("./church-context.js")

const KNOWN_SLUG = "jubileestl"
const KNOWN_ROW = { id: "ch-1", slug: KNOWN_SLUG, name: "Jubilee" }

type MockOptions = {
  canonicalSlug?: string | null
  canonicalRow?: typeof KNOWN_ROW | null
  aliasSlug?: string | null
}

function buildMockDb(opts: MockOptions = {}) {
  const canonicalSlug = opts.canonicalSlug === undefined ? KNOWN_SLUG : opts.canonicalSlug
  const canonicalRow = opts.canonicalRow === undefined ? KNOWN_ROW : opts.canonicalRow
  const aliasSlug = opts.aliasSlug ?? null

  const selectFromSpy = vi.fn((table: string) => {
    let capturedVal: unknown
    const isAliasTable = table === "church_slug_aliases as a"
    const chain = {
      select: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((_col: unknown, _op: unknown, val: unknown) => {
        capturedVal = val
        return chain
      }),
      executeTakeFirst: vi.fn(() => {
        if (isAliasTable) {
          return Promise.resolve(capturedVal === aliasSlug ? canonicalRow : null)
        }
        return Promise.resolve(capturedVal === canonicalSlug ? canonicalRow : null)
      }),
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
      ctx.useChurchContext(ctx)
      ctx.get("/ping", async (request) => ({
        churchId: request.churchId,
        churchSlug: request.churchSlug,
      }))
    },
    { prefix: "/:church" },
  )

  // Route without :church param — header drives resolution
  await app.register(async (ctx) => {
    ctx.useChurchContext(ctx)
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
    mockDb = buildMockDb()
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

  describe("alias resolution", () => {
    const OLD_SLUG = "oldslug"
    let aliasMockDb: ReturnType<typeof buildMockDb>
    let aliasApp: Awaited<ReturnType<typeof buildTestApp>>

    beforeEach(async () => {
      aliasMockDb = buildMockDb({ aliasSlug: OLD_SLUG })
      aliasApp = await buildTestApp(aliasMockDb.db)
    })

    afterEach(async () => {
      await aliasApp.close()
    })

    it("path-slug alias → 308 with Location to canonical slug", async () => {
      const res = await aliasApp.inject({ method: "GET", url: `/${OLD_SLUG}/ping` })
      expect(res.statusCode).toBe(308)
      expect(res.headers.location).toBe(`/${KNOWN_SLUG}/ping`)
    })

    it("path-slug alias preserves query string in Location", async () => {
      const res = await aliasApp.inject({
        method: "GET",
        url: `/${OLD_SLUG}/ping?q=1&x=2`,
      })
      expect(res.statusCode).toBe(308)
      expect(res.headers.location).toBe(`/${KNOWN_SLUG}/ping?q=1&x=2`)
    })

    it("header-only alias → 200 with X-Canonical-Church-Slug header", async () => {
      const res = await aliasApp.inject({
        method: "GET",
        url: "/header-ping",
        headers: { "x-church-slug": OLD_SLUG },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers["x-canonical-church-slug"]).toBe(KNOWN_SLUG)
      expect(res.json()).toMatchObject({ churchId: KNOWN_ROW.id, churchSlug: KNOWN_SLUG })
    })

    it("evictSlug forces DB re-query for an alias", async () => {
      await aliasApp.inject({ method: "GET", url: `/${OLD_SLUG}/ping` })
      const callsBefore = aliasMockDb.selectFromSpy.mock.calls.length
      aliasApp.evictSlug(OLD_SLUG)
      await aliasApp.inject({ method: "GET", url: `/${OLD_SLUG}/ping` })
      expect(aliasMockDb.selectFromSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    })

    it("canonical wins over alias when both match the same slug", async () => {
      // Both churches.slug and church_slug_aliases.slug match the same input slug.
      // The canonical row's slug equals the input so this is a true canonical hit
      // (not flagged as an alias).
      const collisionMockDb = buildMockDb({
        canonicalSlug: OLD_SLUG,
        canonicalRow: { id: "ch-1", slug: OLD_SLUG, name: "Jubilee" },
        aliasSlug: OLD_SLUG,
      })
      const collisionApp = await buildTestApp(collisionMockDb.db)
      try {
        const res = await collisionApp.inject({ method: "GET", url: `/${OLD_SLUG}/ping` })
        expect(res.statusCode).toBe(200)
        expect(res.headers["x-canonical-church-slug"]).toBeUndefined()
      } finally {
        await collisionApp.close()
      }
    })
  })
})
