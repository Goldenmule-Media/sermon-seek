import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { YoutubeClient, youtube } from "@sermon-search/worker"
import Fastify from "fastify"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

vi.mock("../config.js", () => ({
  config: { ADMIN_API_KEY: "test-admin-key" },
}))

const ADMIN_KEY = "test-admin-key"

const YT_CHANNEL_ID = "UCtest000000000000000001"
const OTHER_YT_CHANNEL_ID = "UCtest000000000000000002"
const PLAYLIST_ID = "PLtest0000000000000000001"

type PlaylistsListResponse = youtube.PlaylistsListResponse

describeIfDb("filter-rules integration", () => {
  let db: Kysely<Database>
  let channelId: string
  let mockYoutube: Partial<YoutubeClient>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE channel_filter_rules, channels RESTART IDENTITY CASCADE`.execute(db)

    const row = await db
      .insertInto("channels")
      .values({ youtube_channel_id: YT_CHANNEL_ID, title: "Test Channel" })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    channelId = row.id

    mockYoutube = {
      listPlaylistsById: vi.fn(
        async (_id: string): Promise<PlaylistsListResponse> => ({
          items: [{ id: PLAYLIST_ID, snippet: { channelId: YT_CHANNEL_ID } }],
        }),
      ),
    }
  })

  async function buildApp() {
    const { adminAuthPlugin } = await import("../plugins/admin-auth.js")
    const { filterRulesRoutes } = await import("./filter-rules.js")

    const app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)

    await app.register(adminAuthPlugin)
    app.decorate("db", db)
    app.decorate("youtube", mockYoutube as YoutubeClient)
    await app.register(filterRulesRoutes)
    await app.ready()
    return app
  }

  it("happy path: POST → GET → DELETE roundtrip", async () => {
    const app = await buildApp()

    // POST creates a rule
    const createRes = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
      payload: { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID },
    })
    expect(createRes.statusCode).toBe(200)
    const created = createRes.json()
    expect(created.rule_type).toBe("include")
    expect(created.target_id).toBe(PLAYLIST_ID)
    expect(created.channel_id).toBe(channelId)
    expect(created.id).toBeTruthy()

    // GET lists it
    const listRes = await app.inject({
      method: "GET",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(listRes.statusCode).toBe(200)
    const listed = listRes.json()
    expect(listed.rules).toHaveLength(1)
    expect(listed.rules[0].id).toBe(created.id)

    // DELETE removes it
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/admin/channels/${channelId}/filter-rules/${created.id}`,
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(deleteRes.json()).toEqual({ ok: true })

    // GET confirms it's gone
    const listRes2 = await app.inject({
      method: "GET",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(listRes2.json().rules).toHaveLength(0)

    await app.close()
  })

  it("GET 404 on unknown channel", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "GET",
      url: "/admin/channels/00000000-0000-0000-0000-000000000099/filter-rules",
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("POST 404 on unknown channel", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/admin/channels/00000000-0000-0000-0000-000000000099/filter-rules",
      headers: { "x-admin-key": ADMIN_KEY },
      payload: { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("DELETE 404 on unknown channel", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/channels/00000000-0000-0000-0000-000000000099/filter-rules/00000000-0000-0000-0000-000000000001",
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("DELETE 404 when rule does not exist", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/channels/${channelId}/filter-rules/00000000-0000-0000-0000-000000000099`,
      headers: { "x-admin-key": ADMIN_KEY },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it("POST 422 when YouTube returns no items", async () => {
    mockYoutube.listPlaylistsById = vi.fn(
      async (): Promise<PlaylistsListResponse> => ({
        items: [],
      }),
    )
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
      payload: { rule_type: "include", target_kind: "playlist", target_id: "PLbogus" },
    })
    expect(res.statusCode).toBe(422)
    await app.close()
  })

  it("POST 422 when playlist belongs to a different channel", async () => {
    mockYoutube.listPlaylistsById = vi.fn(
      async (): Promise<PlaylistsListResponse> => ({
        items: [{ id: PLAYLIST_ID, snippet: { channelId: OTHER_YT_CHANNEL_ID } }],
      }),
    )
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
      payload: { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID },
    })
    expect(res.statusCode).toBe(422)
    await app.close()
  })

  it("POST 409 on duplicate rule", async () => {
    const app = await buildApp()
    const payload = { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID }

    const first = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
      payload,
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      headers: { "x-admin-key": ADMIN_KEY },
      payload,
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe("rule already exists")

    await app.close()
  })

  it("all endpoints require auth", async () => {
    const app = await buildApp()

    const getRes = await app.inject({
      method: "GET",
      url: `/admin/channels/${channelId}/filter-rules`,
    })
    expect(getRes.statusCode).toBe(401)

    const postRes = await app.inject({
      method: "POST",
      url: `/admin/channels/${channelId}/filter-rules`,
      payload: { rule_type: "include", target_kind: "playlist", target_id: PLAYLIST_ID },
    })
    expect(postRes.statusCode).toBe(401)

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/admin/channels/${channelId}/filter-rules/00000000-0000-0000-0000-000000000001`,
    })
    expect(deleteRes.statusCode).toBe(401)

    await app.close()
  })
})
