import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { FastifyInstance } from "fastify"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApp } from "../server.js"
import { type SeedResult, seedChurches } from "../test/seed-churches.js"
import { TENANT_SCOPED_ROUTES } from "../test/tenant-scoped-routes.js"

// Hoisted so the vi.mock factories below (which are themselves hoisted to the
// top of the module) can reference this value. Keep in sync with
// TEST_EMBEDDING_MODEL exported from ../test/seed-churches.js.
const { TEST_EMBEDDING_MODEL } = vi.hoisted(() => ({
  TEST_EMBEDDING_MODEL: "text-embedding-3-small",
}))

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

// Deterministic embedder: always returns dim-0=+1 so cosine similarity is +1
// for Alpha chunks (dim-0=+1) and -1 for Bravo chunks (dim-0=-1). If ScopedDb
// ever fails to filter embeddings by church_id, Bravo chunks would surface.
vi.mock("@sermon-search/embeddings", () => ({
  createOpenAIEmbedder: () => ({
    model: TEST_EMBEDDING_MODEL,
    dimensions: 1536,
    embed: async (texts: string[]) =>
      texts.map(() => {
        const v = new Array(1536).fill(0)
        v[0] = 1
        return v
      }),
  }),
}))

vi.mock("../config.js", () => ({
  config: {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    ADMIN_API_KEY: "test-admin-key",
    YOUTUBE_API_KEY: "fake-yt-key",
    OPENAI_API_KEY: "sk-test",
    PORT: 3001,
    HOST: "0.0.0.0",
    CORS_ORIGIN: "http://localhost:3000",
    EMBEDDING_MODEL: TEST_EMBEDDING_MODEL,
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

  function injectB(path: string, query?: Record<string, string>) {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : ""
    return app
      .inject()
      .headers({ "x-church-slug": seed.bSlug })
      .get(`/v1/${seed.bSlug}${path}${qs}`)
  }

  // Header says B but path says A → should get 400.
  function injectMismatch(path: string) {
    return app.inject().headers({ "x-church-slug": seed.bSlug }).get(`/v1/${seed.aSlug}${path}`)
  }

  function assertNoLeakB(body: string) {
    expect(body).not.toContain(seed.bOnlyYtVideoId)
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

  it("every /v1/:church route on the app is listed in TENANT_SCOPED_ROUTES", () => {
    const routeRe = /(\/\S+)\s+\(([^)]+)\)/
    for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
      const m = line.match(routeRe)
      if (!m || !m[1] || !m[2]) continue
      const url = m[1]
      if (!url.startsWith("/v1/:church/")) continue
      const path = url.slice("/v1/:church".length)
      const methods = m[2].split(", ").filter((meth) => meth !== "HEAD")
      for (const method of methods) {
        const listed = TENANT_SCOPED_ROUTES.some((r) => r.method === method && r.path === path)
        expect(listed, `unlisted tenant route: ${method} ${path}`).toBe(true)
      }
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

    it("isolation: mode=semantic returns only church A results", async () => {
      const res = await injectA("/search", { q: "grace", mode: "semantic" })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { results: unknown[] }
      expect(body.results.length).toBeGreaterThan(0)
      assertNoLeakB(JSON.stringify(body))
    })

    it("isolation: mode=hybrid returns only church A results", async () => {
      const res = await injectA("/search", { q: "grace", mode: "hybrid" })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { results: unknown[] }
      expect(body.results.length).toBeGreaterThan(0)
      assertNoLeakB(JSON.stringify(body))
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
      const res = await injectA(`/videos/${seed.aOnlyYtVideoId}`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: church A fetching church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.bOnlyYtVideoId}`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.aOnlyYtVideoId}`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.aOnlyYtVideoId}`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id — shared youtube id ─────────────────────────────────────────
  // Proves that sharing a youtube_video_id across churches (permitted by the
  // compound unique from #860) does not cause a cross-tenant row-takeover.

  describe("GET /videos/:id — shared youtube id", () => {
    it("church A fetching shared id returns Alpha row, not Bravo", async () => {
      const res = await injectA(`/videos/${seed.sharedYtVideoId}`)
      expect(res.statusCode).toBe(200)
      const body = JSON.stringify(res.json())
      expect(body).toContain(seed.aSharedTitle)
      expect(body).not.toContain(seed.bSharedTitle)
      expect(body).not.toContain("Bravo")
    })

    it("church B fetching shared id returns Bravo row, not Alpha", async () => {
      const res = await injectB(`/videos/${seed.sharedYtVideoId}`)
      expect(res.statusCode).toBe(200)
      const body = JSON.stringify(res.json())
      expect(body).toContain(seed.bSharedTitle)
      expect(body).not.toContain(seed.aSharedTitle)
      expect(body).not.toContain("Alpha")
    })
  })

  // ─── /videos/:id/transcript ──────────────────────────────────────────────────

  describe("GET /videos/:id/transcript", () => {
    it("isolation: church A can fetch own video transcript", async () => {
      const res = await injectA(`/videos/${seed.aOnlyYtVideoId}/transcript`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: church A fetching church B transcript → 404", async () => {
      const res = await injectA(`/videos/${seed.bOnlyYtVideoId}/transcript`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.aOnlyYtVideoId}/transcript`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.aOnlyYtVideoId}/transcript`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id/related ─────────────────────────────────────────────────────

  describe("GET /videos/:id/related", () => {
    it("isolation: related videos only from church A", async () => {
      const res = await injectA(`/videos/${seed.sharedYtVideoId}/related`)
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
      const body = res.json() as { related: Array<{ video_id: string }> }
      expect(body.related.some((r) => r.video_id === seed.aOnlyYtVideoId)).toBe(true)
    })

    it("cross-tenant: church A fetching related for church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.bOnlyYtVideoId}/related`)
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.aOnlyYtVideoId}/related`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.aOnlyYtVideoId}/related`)
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── /videos/:id/search ───────────────────────────────────────────────────────

  describe("GET /videos/:id/search", () => {
    it("isolation: in-video search returns only church A results", async () => {
      const res = await injectA(`/videos/${seed.aOnlyYtVideoId}/search`, { q: "alpha" })
      expect(res.statusCode).toBe(200)
      assertNoLeakB(JSON.stringify(res.json()))
    })

    it("cross-tenant: in-video search against church B video → 404", async () => {
      const res = await injectA(`/videos/${seed.bOnlyYtVideoId}/search`, { q: "bravo" })
      expect(res.statusCode).toBe(404)
    })

    it("mismatch header vs path → 400", async () => {
      const res = await injectMismatch(`/videos/${seed.aOnlyYtVideoId}/search`)
      expect(res.statusCode).toBe(400)
    })

    it("unknown church slug → 404", async () => {
      const res = await app.inject().get(`/v1/no-such-church/videos/${seed.aOnlyYtVideoId}/search?q=alpha`)
      expect(res.statusCode).toBe(404)
    })
  })
})
