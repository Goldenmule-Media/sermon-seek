import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { FastifyInstance } from "fastify"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../server.js"
import { type SeedResult, seedChurches } from "../test/seed-churches.js"
import { TENANT_SCOPED_ROUTES } from "../test/tenant-scoped-routes.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

vi.mock("../config.js", () => ({
  config: {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    ADMIN_API_KEY: "test-admin-key",
    YOUTUBE_API_KEY: "fake-yt-key",
    PORT: 3001,
    HOST: "0.0.0.0",
    CORS_ORIGIN: "http://localhost:3000",
    EMBEDDING_MODEL: "text-embedding-3-small",
  },
}))

describeIfDb("cross-tenant isolation", () => {
  let app: FastifyInstance
  let db: Kysely<Database>
  let seed: SeedResult

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
    // Cascades to all church-owned tables and their dependents.
    await sql`TRUNCATE churches RESTART IDENTITY CASCADE`.execute(db)
    seed = await seedChurches(db)
  })

  // Use the no-arg inject() overload which returns Chain (typed as Promise<Response>).
  // This avoids overload-resolution issues with the two-arg and one-arg variants.

  function injectA(path: string, query?: Record<string, string>) {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : ""
    return app
      .inject()
      .headers({ "x-church-slug": seed.aSlug })
      .get(`/v1/${seed.aSlug}${path}${qs}`)
  }

  // Header says B but path says A → should get 400.
  function injectMismatch(path: string) {
    return app.inject().headers({ "x-church-slug": seed.bSlug }).get(`/v1/${seed.aSlug}${path}`)
  }

  function assertNoLeakB(body: string) {
    expect(body).not.toContain(seed.ytB1)
    expect(body).not.toContain(seed.ytB2)
    expect(body).not.toContain("Bravo")
  }

  // ─── Coverage ──────────────────────────────────────────────────────────────

  it("every route in TENANT_SCOPED_ROUTES is registered on the app", () => {
    for (const route of TENANT_SCOPED_ROUTES) {
      const url = `/v1/:church${route.path}`
      expect(app.hasRoute({ method: route.method, url }), `missing: ${route.method} ${url}`).toBe(
        true,
      )
    }
  })

  // ─── /home ──────────────────────────────────────────────────────────────────

  describe("GET /home", () => {
    it("isolation: returns only church A data", async () => {
      const res = await injectA("/home")
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch("/home")
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe("church slug mismatch")
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get("/v1/no-such-church/home")
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toBe("church not found")
    })
  })

  // ─── /search ────────────────────────────────────────────────────────────────

  describe("GET /search", () => {
    it("isolation: fulltext search returns only church A results", async () => {
      const res = await injectA("/search", { q: "alpha", mode: "fulltext" })
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch("/search")
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get("/v1/no-such-church/search?q=alpha&mode=fulltext")
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /playlists ──────────────────────────────────────────────────────────────

  describe("GET /playlists", () => {
    it("isolation: returns only church A playlists", async () => {
      const res = await injectA("/playlists")
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
      const body = res.json() as { playlists: Array<{ title: string }> }
      expect(body.playlists.some((p) => p.title.includes("Alpha"))).toBe(true)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch("/playlists")
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get("/v1/no-such-church/playlists")
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /playlists/:slug/videos ─────────────────────────────────────────────────

  describe("GET /playlists/:slug/videos", () => {
    it("isolation: returns only church A videos", async () => {
      const res = await injectA(`/playlists/${seed.playlistSlug}/videos`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/playlists/${seed.playlistSlug}/videos`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/playlists/${seed.playlistSlug}/videos`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /topics ─────────────────────────────────────────────────────────────────

  describe("GET /topics", () => {
    it("isolation: returns only church A topics", async () => {
      const res = await injectA("/topics")
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch("/topics")
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get("/v1/no-such-church/topics")
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /topics/:slug ───────────────────────────────────────────────────────────

  describe("GET /topics/:slug", () => {
    it("isolation: returns only church A videos for shared topic slug", async () => {
      const res = await injectA(`/topics/${seed.topicSlug}`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/topics/${seed.topicSlug}`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/topics/${seed.topicSlug}`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id ─────────────────────────────────────────────────────────────

  describe("GET /videos/:id", () => {
    it("isolation: church A can fetch own video", async () => {
      const res = await injectA(`/videos/${seed.ytA1}`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: church A fetching church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.ytB1}`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.ytA1}`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.ytA1}`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id/transcript ──────────────────────────────────────────────────

  describe("GET /videos/:id/transcript", () => {
    it("isolation: church A can fetch own video transcript", async () => {
      const res = await injectA(`/videos/${seed.ytA1}/transcript`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: church A fetching church B transcript → 404", async () => {
      const res = await injectA(`/videos/${seed.ytB1}/transcript`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.ytA1}/transcript`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.ytA1}/transcript`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id/related ─────────────────────────────────────────────────────

  describe("GET /videos/:id/related", () => {
    it("isolation: related videos only from church A", async () => {
      const res = await injectA(`/videos/${seed.ytA1}/related`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
      const body = res.json() as { related: Array<{ video_id: string }> }
      expect(body.related.some((r) => r.video_id === seed.ytA2)).toBe(true)
    })

    it("cross-tenant: church A fetching related for church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.ytB1}/related`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.ytA1}/related`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.ytA1}/related`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id/search ───────────────────────────────────────────────────────

  describe("GET /videos/:id/search", () => {
    it("isolation: in-video search returns only church A results", async () => {
      const res = await injectA(`/videos/${seed.ytA1}/search`, { q: "alpha" })
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: in-video search against church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.ytB1}/search`, { q: "bravo" })
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.ytA1}/search`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.ytA1}/search?q=alpha`)
      expect(res.statusCode).toBe(404)
    })
  })
})
