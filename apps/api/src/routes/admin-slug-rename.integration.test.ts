import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import { RESERVED_SLUGS, SLUG_REGEX } from "@sermon-search/types"
import Fastify, { type FastifyInstance } from "fastify"
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { churchContextPlugin } from "../plugins/church-context.js"
import { dbPlugin } from "../plugins/db.js"
import { buildApp } from "../server.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

// Hoisted so vi.mock's hoisted factory can reference these without a TDZ error.
const { ADMIN_KEY, SLUG_ALIAS_TTL_DAYS } = vi.hoisted(() => ({
  ADMIN_KEY: "test-admin-key",
  SLUG_ALIAS_TTL_DAYS: 90,
}))

vi.mock("../config.js", () => ({
  config: {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    ADMIN_API_KEY: ADMIN_KEY,
    YOUTUBE_API_KEY: "fake-yt-key",
    OPENAI_API_KEY: "sk-test",
    PORT: 3001,
    HOST: "0.0.0.0",
    CORS_ORIGIN: "http://localhost:3000",
    EMBEDDING_MODEL: "text-embedding-3-small",
    SLUG_ALIAS_TTL_DAYS,
  },
}))

const ALPHA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const BRAVO_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

describeIfDb("admin slug rename + alias integration", () => {
  let app: FastifyInstance
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
    await db.destroy()
  })

  beforeEach(async () => {
    // Cascades to church_slug_aliases via the FK with ON DELETE CASCADE.
    await sql`TRUNCATE churches RESTART IDENTITY CASCADE`.execute(db)
    await db
      .insertInto("churches")
      .values([
        { id: ALPHA_ID, slug: "alpha", name: "Alpha Church" },
        { id: BRAVO_ID, slug: "bravo", name: "Bravo Church" },
      ])
      .execute()
  })

  function patchChurch(id: string, body: object) {
    return app.inject({
      method: "PATCH",
      url: `/v1/admin/churches/${id}`,
      headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: body,
    })
  }

  // ─── 1. bad-format slug → 400 reason=format ─────────────────────────────────

  describe("validation: bad-format slug", () => {
    const badFormats: Array<[string, string]> = [
      ["uppercase", "BadSlug"],
      ["leading dash", "-foo"],
      ["trailing dash", "foo-"],
      ["underscore", "foo_bar"],
      ["empty after trim", " "],
      ["65 chars", "a".repeat(65)],
    ]

    for (const [label, slug] of badFormats) {
      it(`rejects ${label} (${JSON.stringify(slug)}) with 400 format`, async () => {
        const res = await patchChurch(ALPHA_ID, { slug })
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual({ error: "invalid slug: format" })
      })
    }
  })

  // ─── 2. every reserved word → 400 ───────────────────────────────────────────

  describe("validation: reserved slugs", () => {
    for (const reserved of RESERVED_SLUGS) {
      it(`rejects reserved slug "${reserved}" with 400`, async () => {
        const res = await patchChurch(ALPHA_ID, { slug: reserved })
        expect(res.statusCode).toBe(400)
        const body = res.json() as { error: string }
        // The validator runs format before reserved. Entries that contain '.'
        // (robots.txt, sitemap.xml) fail format first; everything else hits
        // the reserved branch. Either response satisfies "this name can never
        // be a slug", so we accept both for the format-failing entries.
        if (SLUG_REGEX.test(reserved)) {
          expect(body.error).toBe("invalid slug: reserved")
        } else {
          expect(["invalid slug: reserved", "invalid slug: format"]).toContain(body.error)
        }
      })
    }
  })

  // ─── 3. collision with churches.slug → 409 ──────────────────────────────────

  it("rejects rename colliding with an existing churches.slug → 409", async () => {
    const res = await patchChurch(ALPHA_ID, { slug: "bravo" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "slug already in use" })

    const row = await db
      .selectFrom("churches")
      .select(["slug"])
      .where("id", "=", ALPHA_ID)
      .executeTakeFirstOrThrow()
    expect(row.slug).toBe("alpha")
  })

  // ─── 4. collision with church_slug_aliases.slug → 409 ───────────────────────

  it("rejects rename colliding with an existing church_slug_aliases.slug → 409", async () => {
    await db
      .insertInto("church_slug_aliases")
      .values({ church_id: BRAVO_ID, slug: "legacy-bravo", expires_at: null })
      .execute()

    const res = await patchChurch(ALPHA_ID, { slug: "legacy-bravo" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "slug already in use" })

    const row = await db
      .selectFrom("churches")
      .select(["slug"])
      .where("id", "=", ALPHA_ID)
      .executeTakeFirstOrThrow()
    expect(row.slug).toBe("alpha")
  })

  // ─── 5. successful rename ───────────────────────────────────────────────────

  it("successful rename: writes alias row, updates churches.slug, returns expected body", async () => {
    const beforeNow = Date.now()
    const res = await patchChurch(ALPHA_ID, { slug: "alpha2" })
    const afterNow = Date.now()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      id: ALPHA_ID,
      slug: "alpha2",
      name: "Alpha Church",
      previous_slug: "alpha",
    })

    const church = await db
      .selectFrom("churches")
      .select(["slug", "name"])
      .where("id", "=", ALPHA_ID)
      .executeTakeFirstOrThrow()
    expect(church.slug).toBe("alpha2")
    expect(church.name).toBe("Alpha Church")

    const aliases = await db
      .selectFrom("church_slug_aliases")
      .select(["slug", "expires_at"])
      .where("church_id", "=", ALPHA_ID)
      .execute()
    expect(aliases).toHaveLength(1)
    const alias = aliases[0]
    if (!alias) throw new Error("unreachable: alias row missing after length assertion")
    expect(alias.slug).toBe("alpha")
    expect(alias.expires_at).not.toBeNull()
    const expiresMs = (alias.expires_at as unknown as Date).getTime()
    const oneDayMs = 24 * 60 * 60 * 1000
    const lower = beforeNow + (SLUG_ALIAS_TTL_DAYS - 1) * oneDayMs
    const upper = afterNow + (SLUG_ALIAS_TTL_DAYS + 1) * oneDayMs
    expect(expiresMs).toBeGreaterThanOrEqual(lower)
    expect(expiresMs).toBeLessThanOrEqual(upper)
  })

  // ─── 6. 308 redirect with query-string preserved ────────────────────────────

  it("after rename, GET /<old>/... returns 308 with Location to <new> and query preserved", async () => {
    const renameRes = await patchChurch(ALPHA_ID, { slug: "alpha2" })
    expect(renameRes.statusCode).toBe(200)

    const res = await app.inject({
      method: "GET",
      url: "/v1/alpha/home?q=grace&mode=fulltext",
    })
    expect(res.statusCode).toBe(308)
    expect(res.headers.location).toBe("/v1/alpha2/home?q=grace&mode=fulltext")
  })

  // ─── 7. header-only alias → 200 + X-Canonical-Church-Slug ───────────────────

  it("after rename, header-only request returns 200 with X-Canonical-Church-Slug", async () => {
    const renameRes = await patchChurch(ALPHA_ID, { slug: "alpha2" })
    expect(renameRes.statusCode).toBe(200)

    // Production routes are mounted under /v1/:church/*, so requireChurchContext
    // never sees a request without a path slug in app/server.ts. Build a small
    // app that registers the real church-context plugin and exposes one route
    // that has no :church path param, so only the header branch is exercised.
    const probeApp = Fastify().withTypeProvider<ZodTypeProvider>()
    probeApp.setValidatorCompiler(validatorCompiler)
    probeApp.setSerializerCompiler(serializerCompiler)
    await probeApp.register(dbPlugin)
    await probeApp.register(churchContextPlugin)
    probeApp.get(
      "/probe",
      { preHandler: (req, reply) => probeApp.requireChurchContext(req, reply) },
      async (request) => ({ slug: request.churchSlug }),
    )
    await probeApp.ready()

    try {
      const res = await probeApp.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-church-slug": "alpha" },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers["x-canonical-church-slug"]).toBe("alpha2")
      expect(res.json()).toEqual({ slug: "alpha2" })
    } finally {
      await probeApp.close()
    }
  })

  // ─── 8. cache invalidation across rename ────────────────────────────────────

  it("rename invalidates the in-process slug cache so the next hit takes the alias path", async () => {
    // Prime the cache: first hit caches "alpha" → { slug: "alpha", ... }.
    const primed = await app.inject({ method: "GET", url: "/v1/alpha/home" })
    expect(primed.statusCode).toBe(200)

    // Rename. If evictSlug doesn't fire, the cached entry above would still
    // claim slug === "alpha" and the next hit would return 200, not 308.
    const renameRes = await patchChurch(ALPHA_ID, { slug: "alpha2" })
    expect(renameRes.statusCode).toBe(200)

    const after = await app.inject({ method: "GET", url: "/v1/alpha/home" })
    expect(after.statusCode).toBe(308)
    expect(after.headers.location).toBe("/v1/alpha2/home")
  })
})
